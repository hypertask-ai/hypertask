import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { hasDataPermission } from '@/lib/mcp/managementPermissions';
import { isOAuthAccessTokenPayload, oauthClientIdFromPayload, oauthLegacyRevocationJti } from '@/lib/mcp/oauthTokenContract';
import { MCP_TOKEN_ISSUED_AT_MS_CLAIM, presentedAgentTokenGeneration, storedAgentTokenGeneration, tokenRevocationJtis, verifyMcpJwtToken, boundedMcpAuthLog } from './verifyJwt';
import { extractBearerToken, isManagementKeyToken, validateManagementApiKey } from './session';
import type { McpAuthContext, McpAuthFailureSnapshot } from './types';

/**
 * Creates a standardized 401 Unauthorized response for MCP routes
 * Includes WWW-Authenticate header to trigger Cursor's CONNECT button
 * 
 * @param message Optional error message
 * @param reason Optional reason code (e.g., 'token_revoked', 'token_expired', 'invalid_token')
 */
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
export const MCP_AGENT_TOKEN_REFRESH_MESSAGE =
  "Agent tokens do not expire and cannot be refreshed. To replace this token, call POST /api/mcp/agents/rotate-token with the owner's token. Rotating immediately invalidates the current token."

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

/**
 * Names why a request that already failed authentication was rejected.
 *
 * `validateMcpAuth` collapses every rejection to `null`, so the MCP routes
 * answered a revoked token with the same "Invalid or missing authentication
 * token" as a typo. A CLI session whose saved token had been revoked could not
 * tell a dead session from a bad request, and the recovery step differs
 * (HTPR-4814). The clients already parse this `reason`; the server just never
 * sent a useful one.
 *
 * Runs only on the failure path, so the extra lookup never touches a served
 * request. It classifies; it never grants, so it cannot widen access.
 */
export async function classifyMcpAuthFailure(
  request: NextRequest,
  db?: McpAuthFailureLookup,
  snapshot?: McpAuthFailureSnapshot,
): Promise<McpUnauthorizedReason> {
  const token = extractBearerToken(request.headers.get('Authorization'))
  if (!token) return 'missing_token'

  // A data key is opaque: there is nothing to decode, and naming why a hash
  // missed would answer "does this key exist".
  if (token.startsWith('htk_')) return 'invalid_token'

  // A missing token returns above, before this binds the client. Evaluating
  // prisma as a default argument touched the database on every 401.
  const lookup = db ?? (prisma as unknown as McpAuthFailureLookup)

  // A management key that verifies but carries no data permission is a
  // different recovery step: widen the key's scope rather than replace it.
  // Saying so tells the holder of a working key nothing it does not know.
  if (isManagementKeyToken(token)) {
    const verifyManagementKey = lookup.verifyManagementKey ?? validateManagementApiKey
    const managementCtx = await verifyManagementKey(token)
    if (!managementCtx) return 'invalid_token'
    return hasDataPermission(managementCtx.management?.permissions ?? {})
      ? 'invalid_token'
      : 'insufficient_scope'
  }

  // Revocation state is disclosed only after signature verification, the same
  // rule the token refresh route follows, so a forged token cannot probe
  // whether some jti has been revoked.
  const verified = snapshot?.verifiedJwt !== undefined ? snapshot.verifiedJwt : verifyMcpJwtToken(token)
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
    if (snapshot?.user !== undefined) {
      user = snapshot.user
    } else if (userId) {
      user = await lookup.user.findUnique({ where: { id: userId }, select })
    } else if (email) {
      user = await lookup.user.findFirst({ where: { email }, select })
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
    const revoked = snapshot?.revokedToken !== undefined ? snapshot.revokedToken : await lookup.revokedToken.findFirst({
      where: {
        user_id: user.id,
        jti: { in: revocationJtis },
      },
      select: { jti: true },
    })
    if (revoked) return 'token_revoked'

    if (oauthClientId !== undefined) {
      const client = snapshot?.oauthClient !== undefined ? snapshot.oauthClient : await lookup.oAuthClient.findUnique({
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
      const agent = snapshot?.agent ?? await lookup.agent.findFirst({
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
    if (snapshot) boundedMcpAuthLog('[MCP Auth] Failed to classify rejection:', error)
    else console.error('[MCP Auth] Failed to classify rejection:', error)
    return 'invalid_token'
  }
}

/**
 * The 401 an MCP route should return once `validateMcpAuth` has said no.
 *
 * Keeps the `error` string every existing client already matches on and adds
 * the accurate `reason`, so nothing that reads the old field changes.
 */
export async function mcpUnauthorizedResponse(
  request: NextRequest,
  db?: McpAuthFailureLookup,
  snapshot?: McpAuthFailureSnapshot,
) {
  return createUnauthorizedResponse(
    undefined,
    await classifyMcpAuthFailure(request, db, snapshot)
  )
}
