import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { LogType, Status } from '@prisma/client'
import {
  MCP_AGENT_REVOKED_MESSAGE,
  MCP_AGENT_TOKEN_REFRESH_MESSAGE,
  MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE,
  claimTokenRotation,
  createMcpToken,
  createUnauthorizedResponse,
  legacyTokenRevocationJti,
  MCP_LEGACY_TOKEN_MESSAGE,
  validateMcpAuth,
  verifyMcpJwtToken,
} from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import createLog from '@/utils/controllers/logs/createLog'

type TokenRefreshDependencies = {
  validateAuth: typeof validateMcpAuth
  verifyToken: typeof verifyMcpJwtToken
  findAgent: (agentId: string) => Promise<{
    revokedAt: Date | null
    mcpTokenJti: string | null
  } | null>
  createToken: typeof createMcpToken
  claimRotation: typeof claimTokenRotation
  createAuditLog: typeof createLog
}

// Keep this rollout boundary immutable so configuration cannot widen legacy-token eligibility.
export const LEGACY_REFRESH_ISSUED_BEFORE_SECONDS =
  Date.parse('2026-09-02T00:00:00.000Z') / 1000

const tokenRefreshDependencies: TokenRefreshDependencies = {
  validateAuth: validateMcpAuth,
  verifyToken: verifyMcpJwtToken,
  findAgent: (agentId) => prisma.agent.findUnique({
    where: { id: agentId },
    select: { revokedAt: true, mcpTokenJti: true },
  }),
  createToken: createMcpToken,
  claimRotation: claimTokenRotation,
  createAuditLog: createLog,
}

export async function handleMcpTokenRefresh(
  request: NextRequest,
  dependencies: TokenRefreshDependencies = tokenRefreshDependencies
) {
  const authHeader = request.headers.get('Authorization')
  const oldToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : undefined
  const ctx = await dependencies.validateAuth(request)
  if (!ctx) {
    // Agent state is disclosed only after signature verification, so forged IDs cannot probe agent records.
    const decoded = oldToken ? dependencies.verifyToken(oldToken) : null
    const agentId = decoded?.agentId
    if (typeof agentId === 'string' && agentId.length > 0) {
      const agent = await dependencies.findAgent(agentId)
      if (!agent || agent.revokedAt || !agent.mcpTokenJti) {
        return createUnauthorizedResponse(
          MCP_AGENT_REVOKED_MESSAGE,
          'agent_revoked'
        )
      }

      if (agent.mcpTokenJti !== decoded?.jti) {
        return createUnauthorizedResponse(
          MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE,
          'agent_token_superseded'
        )
      }
    }

    return createUnauthorizedResponse(
      'Invalid or missing authentication token.',
      'invalid_token'
    )
  }

  if (ctx.agentId) {
    return NextResponse.json(
      {
        success: false,
        error: MCP_AGENT_TOKEN_REFRESH_MESSAGE,
      },
      { status: 400 }
    )
  }

  const user = ctx.user
  const oldDecoded = oldToken
    ? (jwt.decode(oldToken) as jwt.JwtPayload | null)
    : null

  if (!oldDecoded?.exp) {
    return createUnauthorizedResponse(
      'Invalid or missing authentication token.',
      'invalid_token'
    )
  }

  const oldJti = oldDecoded.jti || oldDecoded.jwtid
  let revocationJti: string
  if (typeof oldJti === 'string' && oldJti.length > 0) {
    revocationJti = oldJti
  } else {
    const oldAudiences = Array.isArray(oldDecoded.aud)
      ? oldDecoded.aud
      : oldDecoded.aud
        ? [oldDecoded.aud]
        : []
    const hasMcpAudience = oldAudiences.some(
      (audience) => audience === 'mcp-api' || audience === 'hypertasks-mcp'
    )
    if (
      typeof oldDecoded.iat !== 'number' ||
      oldDecoded.iat >= LEGACY_REFRESH_ISSUED_BEFORE_SECONDS ||
      !hasMcpAudience ||
      !oldToken
    ) {
      return createUnauthorizedResponse(MCP_LEGACY_TOKEN_MESSAGE, 'legacy_token')
    }
    revocationJti = legacyTokenRevocationJti(oldToken)
  }

  // Mint before claiming the old credential. A signing failure leaves the
  // current token usable, while the unique claim permits only one concurrent
  // request to receive a replacement.
  const token = dependencies.createToken(user.id, user.email, '30d')
  const decoded = jwt.decode(token) as jwt.JwtPayload | null
  if (!decoded?.exp) {
    throw new Error('Failed to decode refreshed MCP token expiration')
  }

  const claimed = await dependencies.claimRotation(
    revocationJti,
    user.id,
    new Date(oldDecoded.exp * 1000)
  )
  if (!claimed) {
    return createUnauthorizedResponse(
      'This token has already been refreshed.',
      'token_revoked'
    )
  }

  // Logging must not strand the caller after the one-time claim succeeds.
  try {
    await dependencies.createAuditLog({
      log: 'mcp_token_refresh',
      type: LogType.Signup,
      status: Status.Normal,
      LoggedById: user.id,
    })
  } catch (error) {
    console.error('Failed to record MCP token refresh audit log:', error)
  }

  return NextResponse.json({
    success: true,
    token,
    expiresAt: new Date(decoded.exp * 1000).toISOString(),
  })
}
