import { presentedAgentTokenGeneration, storedAgentTokenGeneration, verifyMcpJwtToken } from "./verifyJwt";
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { auth } from '@/lib/auth/betterAuth';
import { isOAuthAccessTokenPayload, oauthClientIdFromPayload, oauthLegacyRevocationJti } from '@/lib/mcp/oauthTokenContract';
import { hasDataPermission, parseManagementPermissions } from '@/lib/mcp/managementPermissions';
import { HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG, isFeatureEnabled } from '@/lib/flags';
import { ACCOUNT_MANAGEMENT_KEY_PREFIX, getManagementKeyTeam, TEAM_MANAGEMENT_KEY_PREFIX } from '@/lib/mcp/managementKeyTeamScope';

export const MCP_TOKEN_ISSUED_AT_MS_CLAIM = 'mcpIssuedAtMs'

export const MANAGEMENT_KEY_PREFIX = ACCOUNT_MANAGEMENT_KEY_PREFIX

export const isManagementKeyToken = (token: string) =>
  token.startsWith(MANAGEMENT_KEY_PREFIX) ||
  token.startsWith(TEAM_MANAGEMENT_KEY_PREFIX)

export function extractBearerToken(authHeader: string | null): string | null {
  return authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
}

export const scopedTokenRevocationJti = (userId: number, jti: string) =>
  `user:${userId}:${jti}`

export function legacyTokenRevocationJti(token: string): string {
  const digest = createHash('sha256')
    .update('hypertask:mcp:legacy-token-revocation\0')
    .update(token)
    .digest('hex')
  return `legacy:${digest}`
}

export function tokenRevocationJtis(
  userId: number,
  token: string,
  decoded: jwt.JwtPayload
): string[] {
  const jti = decoded.jti || decoded.jwtid
  if (typeof jti === 'string' && jti.length > 0) {
    return [jti, scopedTokenRevocationJti(userId, jti)]
  }
  return [legacyTokenRevocationJti(token)]
}

export type McpAuthContext = {
  user: { id: number; email: string; displayName?: string | null }
  agentId: string | null
  /** Runtime generation observed while the managed agent token was verified. */
  agentRuntimeGeneration?: number | null
  management?: {
    keyId: string
    permissions: Record<string, string[]>
    teamId?: string
    teamAccessBinding?: string
  }
}

export type McpUnauthorizedReason =
  | 'token_revoked'
  | 'token_expired'
  | 'invalid_token'
  | 'missing_token'
  | 'insufficient_scope'
  | 'legacy_token'
  | 'agent_revoked'
  | 'agent_token_superseded'

export const MCP_LEGACY_TOKEN_MESSAGE =
  'This token predates refresh support and cannot be refreshed. Run `hypertask login` to replace it.'

export const MCP_AGENT_REVOKED_MESSAGE =
  'This agent has been revoked. Ask the board owner to create a new agent identity.'

export const MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE =
  "This agent's token was replaced by a newer one. Use the current token, or rotate it with POST /api/mcp/agents/rotate-token using the owner's token."

export function createUnauthorizedResponse(message?: string, reason?: McpUnauthorizedReason) {
  const errorMessage = message || 'Unauthorized. Invalid or missing authentication token.'
  const response = {
    success: false,
    error: errorMessage,
    reason: reason || 'invalid_token',
    message: reason === 'token_revoked' 
      ? 'Your token has been revoked. Please generate a new token and reconnect.'
      : reason === 'token_expired'
      ? 'Your token has expired. Please generate a new token and reconnect.'
      : reason === 'insufficient_scope'
      ? 'This management key does not grant access to MCP data endpoints.'
      : reason === 'legacy_token'
      ? MCP_LEGACY_TOKEN_MESSAGE
      : reason === 'agent_revoked'
      ? MCP_AGENT_REVOKED_MESSAGE
      : reason === 'agent_token_superseded'
      ? MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE
      : 'Authentication required. Please check your token and try again.',
  }
  
  // Create NextResponse with WWW-Authenticate header
  // This header signals to clients (like Cursor) that authentication is needed
  // The WWW-Authenticate header is the standard way to prompt for authentication
  return NextResponse.json(response, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Bearer realm="hypertask-mcp", error="invalid_token"',
    },
  })
}

export async function validateManagementApiKey(token: string): Promise<McpAuthContext | null> {
  try {
    const result = await auth.api.verifyApiKey({
      body: {
        key: token,
      },
    })

    if (!result.valid || !result.key) return null

    const userId = Number(result.key.referenceId)
    if (!Number.isInteger(userId) || userId <= 0) return null

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    })
    if (!user) return null

    const keyPrefix = result.key.prefix
    if (
      keyPrefix !== ACCOUNT_MANAGEMENT_KEY_PREFIX &&
      keyPrefix !== TEAM_MANAGEMENT_KEY_PREFIX
    ) {
      return null
    }

    let teamId: string | undefined
    let teamAccessBinding: string | undefined
    if (keyPrefix === TEAM_MANAGEMENT_KEY_PREFIX) {
      if (
        !(await isFeatureEnabled(
          HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
          user.id
        ))
      ) {
        return null
      }

      const keyId = Number(result.key.id)
      if (!Number.isSafeInteger(keyId) || keyId <= 0) return null
      const keyRow = await prisma.betterAuthApiKey.findFirst({
        where: {
          id: keyId,
          userId: user.id,
          prefix: TEAM_MANAGEMENT_KEY_PREFIX,
          enabled: true,
        },
        select: { teamId: true, teamAccessBinding: true },
      })
      if (!keyRow?.teamId || !keyRow.teamAccessBinding) return null

      const team = await getManagementKeyTeam(user.id, keyRow.teamId)
      if (!team || team.accessBinding !== keyRow.teamAccessBinding) {
        await prisma.betterAuthApiKey.updateMany({
          where: { id: keyId, userId: user.id, enabled: true },
          data: { enabled: false },
        })
        return null
      }
      teamId = team.id
      teamAccessBinding = team.accessBinding
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? undefined,
      },
      agentId: null,
      management: {
        keyId: String(result.key.id),
        permissions: parseManagementPermissions(result.key.permissions),
        ...(teamId ? { teamId, teamAccessBinding } : {}),
      },
    }
  } catch (error) {
    console.error('[MCP Auth] Failed to verify management API key:', error)
    return null
  }
}

export type McpAuthFailureLookup = {
  user: {
    findUnique: (args: unknown) => Promise<{ id: number; mcpTokensRevokedAt: Date | null } | null>
    findFirst: (args: unknown) => Promise<{ id: number; mcpTokensRevokedAt: Date | null } | null>
  }
  oAuthClient: {
    findUnique: (args: unknown) => Promise<{ client_id: string } | null>
  }
  revokedToken: {
    findFirst: (args: unknown) => Promise<{ jti: string } | null>
  }
  agent: {
    findFirst: (
      args: unknown
    ) => Promise<{ id: string; mcpTokenJti: string | null; revokedAt: Date | null } | null>
  }
  /** Management-key verification, injectable because it is not a table read. */
  verifyManagementKey?: (token: string) => Promise<McpAuthContext | null>
}

export async function classifyMcpAuthFailure(
  request: NextRequest,
  db: McpAuthFailureLookup = prisma as unknown as McpAuthFailureLookup
): Promise<McpUnauthorizedReason> {
  const token = extractBearerToken(request.headers.get('Authorization'))
  if (!token) return 'missing_token'

  // A data key is opaque: there is nothing to decode, and naming why a hash
  // missed would answer "does this key exist".
  if (token.startsWith('htk_')) return 'invalid_token'

  // A management key that verifies but carries no data permission is a
  // different recovery step: widen the key's scope rather than replace it.
  // Saying so tells the holder of a working key nothing it does not know.
  if (isManagementKeyToken(token)) {
    const verifyManagementKey = db.verifyManagementKey ?? validateManagementApiKey
    const managementCtx = await verifyManagementKey(token)
    if (!managementCtx) return 'invalid_token'
    return hasDataPermission(managementCtx.management?.permissions ?? {})
      ? 'invalid_token'
      : 'insufficient_scope'
  }

  // Revocation state is disclosed only after signature verification, the same
  // rule the token refresh route follows, so a forged token cannot probe
  // whether some jti has been revoked.
  const verified = verifyMcpJwtToken(token)
  if (!verified) {
    // Verification also fails on expiry. `exp` is inside the token the caller
    // already holds, so naming expiry discloses nothing new, and it is the one
    // rejection the caller can fix without help.
    const decoded = jwt.decode(token) as jwt.JwtPayload | null
    const expiresAtMs = typeof decoded?.exp === 'number' ? decoded.exp * 1000 : null
    return expiresAtMs !== null && expiresAtMs <= Date.now()
      ? 'token_expired'
      : 'invalid_token'
  }

  try {
    const userId = typeof verified.userId === 'number' ? verified.userId : null
    const email = typeof verified.sub === 'string' ? verified.sub.toLowerCase() : null
    const select = { id: true, mcpTokensRevokedAt: true }
    let user: { id: number; mcpTokensRevokedAt: Date | null } | null = null
    if (userId) {
      user = await db.user.findUnique({ where: { id: userId }, select })
    } else if (email) {
      user = await db.user.findFirst({ where: { email }, select })
    }
    if (!user) return 'invalid_token'

    const isOAuthAccessToken = isOAuthAccessTokenPayload(verified)
    const oauthClientId = isOAuthAccessToken
      ? oauthClientIdFromPayload(verified)
      : undefined
    if (oauthClientId === null) return 'invalid_token'

    const revocationJtis = tokenRevocationJtis(user.id, token, verified)
    if (isOAuthAccessToken && oauthClientId === undefined) {
      revocationJtis.push(oauthLegacyRevocationJti(user.id))
    }
    const revoked = await db.revokedToken.findFirst({
      where: {
        user_id: user.id,
        jti: { in: revocationJtis },
      },
      select: { jti: true },
    })
    if (revoked) return 'token_revoked'

    if (oauthClientId !== undefined) {
      const client = await db.oAuthClient.findUnique({
        where: { client_id: oauthClientId },
        select: { client_id: true },
      })
      if (!client) return 'token_revoked'
    }

    // "Revoke every token" is recorded on the user, not per token, so a token
    // minted before that moment is revoked even with no row of its own.
    if (user.mcpTokensRevokedAt) {
      // Older tokens carry only a second-resolution `iat`; newer ones also
      // carry the millisecond claim, which is the more precise of the two.
      const issuedAtMs = verified[MCP_TOKEN_ISSUED_AT_MS_CLAIM]
      let issuedAt: Date | null = null
      if (typeof issuedAtMs === 'number' && Number.isFinite(issuedAtMs)) {
        issuedAt = new Date(issuedAtMs)
      } else if (verified.iat) {
        issuedAt = new Date(verified.iat * 1000)
      }
      if (issuedAt && issuedAt < user.mcpTokensRevokedAt) return 'token_revoked'
    }

    // A managed agent's token never expires; it dies when the agent is revoked
    // or when a newer token supersedes it. Those need different recoveries
    // (get a new agent, versus reconnect with the current token), so neither
    // may come back as a bad request.
    const agentId = verified.agentId
    if (typeof agentId === 'string' && agentId.length > 0) {
      const agent = await db.agent.findFirst({
        where: { id: agentId, userId: user.id },
        select: { id: true, mcpTokenJti: true, revokedAt: true },
      })
      // An agent belonging to somebody else must not be distinguishable from
      // one that does not exist.
      if (!agent) return 'invalid_token'
      if (agent.revokedAt || !agent.mcpTokenJti) return 'agent_revoked'

      const storedGeneration = storedAgentTokenGeneration(agent)
      if (
        !storedGeneration ||
        presentedAgentTokenGeneration(verified) !== storedGeneration
      ) {
        return 'agent_token_superseded'
      }
    }

    return 'invalid_token'
  } catch (error) {
    console.error('[MCP Auth] Failed to classify rejection:', error)
    return 'invalid_token'
  }
}

export async function mcpUnauthorizedResponse(
  request: NextRequest,
  db?: McpAuthFailureLookup
) {
  return createUnauthorizedResponse(
    undefined,
    await classifyMcpAuthFailure(request, db)
  )
}
