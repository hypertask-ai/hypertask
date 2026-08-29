import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { LogType, Status } from '@prisma/client'
import {
  MCP_AGENT_REVOKED_MESSAGE,
  MCP_AGENT_TOKEN_REFRESH_MESSAGE,
  MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE,
  createMcpToken,
  createUnauthorizedResponse,
  MCP_LEGACY_TOKEN_MESSAGE,
  revokeTokenByJti,
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
  revokeToken: typeof revokeTokenByJti
  createAuditLog: typeof createLog
}

const tokenRefreshDependencies: TokenRefreshDependencies = {
  validateAuth: validateMcpAuth,
  verifyToken: verifyMcpJwtToken,
  findAgent: (agentId) => prisma.agent.findUnique({
    where: { id: agentId },
    select: { revokedAt: true, mcpTokenJti: true },
  }),
  createToken: createMcpToken,
  revokeToken: revokeTokenByJti,
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

  if (!oldDecoded) {
    return createUnauthorizedResponse(
      'Invalid or missing authentication token.',
      'invalid_token'
    )
  }

  // Only tokens we can revoke may be rotated. Without a jti the old token
  // stays valid after refresh, letting a caller multiply live 30-day
  // tokens or extend lifetime indefinitely. Force re-login instead.
  if (!oldDecoded.jti) {
    return createUnauthorizedResponse(MCP_LEGACY_TOKEN_MESSAGE, 'legacy_token')
  }

  const token = dependencies.createToken(user.id, user.email, '30d')
  const decoded = jwt.decode(token) as jwt.JwtPayload | null
  if (!decoded?.exp) {
    throw new Error('Failed to decode refreshed MCP token expiration')
  }

  // Revoke only after the replacement token exists, so a failure here
  // can never leave the caller with no valid token.
  if (oldDecoded.exp) {
    await dependencies.revokeToken(
      oldDecoded.jti,
      user.id,
      new Date(oldDecoded.exp * 1000)
    )
  }

  await dependencies.createAuditLog({
    log: 'mcp_token_refresh',
    type: LogType.Signup,
    status: Status.Normal,
    LoggedById: user.id,
  })

  return NextResponse.json({
    success: true,
    token,
    expiresAt: new Date(decoded.exp * 1000).toISOString(),
  })
}
