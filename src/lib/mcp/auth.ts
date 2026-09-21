import { AGENT_TEAM_ACCESS_BINDING_CLAIM, AGENT_TEAM_ID_CLAIM, AgentTokenTeamScope } from "./session";
import { MCP_TOKEN_ISSUED_AT_MS_CLAIM, McpAuthContext, extractBearerToken, isManagementKeyToken, tokenRevocationJtis, validateManagementApiKey } from "./mcpAuthErrors";
import { AGENT_TOKEN_GENERATION_CLAIM, JWT_MCP_AUDIENCE, presentedAgentTokenGeneration, storedAgentTokenGeneration, verifyMcpJwtToken } from "./verifyJwt";
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import createLog from '@/utils/controllers/logs/createLog';
import { LogType, Status } from '@prisma/client';
import { getRedis } from '@/lib/redis';
import { decideMcpRateLimit, MCP_RATE_LIMIT_WINDOW_SECONDS } from '@/lib/mcp/rateLimitDecision';
import { hashApiKey } from '@/lib/apiKeys';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import { isOAuthAccessTokenPayload, JWT_OAUTH_AUDIENCE, oauthClientIdFromPayload, oauthLegacyRevocationJti } from '@/lib/mcp/oauthTokenContract';
import { hasAnyManagementPermission, hasDataPermission, hasManagementReadPermission, hasManagementWritePermission, hasUsageReadPermission } from '@/lib/mcp/managementPermissions';
import { logMcpCliUsage } from '@/lib/mcp/clientTelemetry';
import { HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG, isFeatureEnabled } from '@/lib/flags';
import { agentWithinTeamWhere, getManagementKeyTeam } from '@/lib/mcp/managementKeyTeamScope';

// ponytail: in-memory per-process throttle, resets on deploy/restart — fine for a
// UX nice-to-have status pill; upgrade to Redis if cross-instance accuracy matters.
const mcpConnectionLogThrottle = new Map<number, number>()

// Default/anonymous tier — unauthenticated or invalid-token traffic (HTPR-4135). Unchanged.
const MCP_RATE_LIMIT_PER_MINUTE = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE) || 120
// Agent tier — successfully authenticated agent JWTs (agentId claim) or valid htk_ API
// keys get a higher published limit instead of being treated as anonymous scraping
// traffic (HTPR-4431). Picked as 5x default; tune via env if it's wrong in practice.
const MCP_AGENT_RATE_LIMIT_PER_MINUTE = Number(process.env.MCP_AGENT_RATE_LIMIT_PER_MINUTE) || 600

/**
 * Determines whether the request count alone is enough to allow or block a
 * request, or whether the caller's auth tier must be resolved first.
 */
export function classifyMcpRateLimitCount(
  count: number
): 'allow' | 'resolve-tier' | 'block' {
  if (count <= MCP_RATE_LIMIT_PER_MINUTE) return 'allow'
  if (count > MCP_AGENT_RATE_LIMIT_PER_MINUTE) return 'block'
  return 'resolve-tier'
}

/**
 * Per-token rate limit for /api/mcp/* routes (HTPR-4135), backed by Redis so the
 * count is shared across serverless instances. Keys on a hash of the bearer token
 * (never the raw token). Fails open on any storage error — never blocks
 * legitimate traffic because our own infra hiccupped.
 */
export async function checkMcpRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const token = extractBearerToken(request.headers.get('Authorization'))
  if (!token) return null

  try {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const nowSeconds = Math.floor(Date.now() / 1000)
    const windowStartSeconds = Math.floor(nowSeconds / MCP_RATE_LIMIT_WINDOW_SECONDS) * MCP_RATE_LIMIT_WINDOW_SECONDS
    const key = `mcp:ratelimit:${tokenHash}:${windowStartSeconds}`

    const redis = await getRedis()
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, MCP_RATE_LIMIT_WINDOW_SECONDS)
    }

    const countOutcome = classifyMcpRateLimitCount(count)
    if (countOutcome === 'allow') return null

    let limit = MCP_AGENT_RATE_LIMIT_PER_MINUTE
    if (countOutcome === 'resolve-tier') {
      // ponytail: this double-validates with each route; memoize per request if it becomes a hot path.
      const ctx = await validateMcpAuth(request)
      limit = resolveMcpRateLimit(ctx, token)
    }

    const decision = decideMcpRateLimit(count, limit, windowStartSeconds, nowSeconds)
    if (!decision.limited) return null

    return NextResponse.json(
      { message: 'Rate limit exceeded. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } }
    )
  } catch (err) {
    console.warn('[MCP Rate Limit] Redis check failed, failing open:', err)
    return null
  }
}

export function managementAgentTokenScope(
  management: McpAuthContext['management']
): AgentTokenTeamScope | undefined {
  if (!management?.teamId) return undefined
  if (!management.teamAccessBinding) {
    throw new Error('Team-scoped management context has no access binding')
  }
  return {
    teamId: management.teamId,
    accessBinding: management.teamAccessBinding,
  }
}

type ValidateMcpAuthOptions = {
  /**
   * Return a verified htmk_ context without requiring data scope. The caller
   * must enforce the management permission before performing any action.
   */
  deferManagementPermissionCheck?: boolean
}

/**
 * Which per-minute limit applies given the already-resolved auth context (or null if
 * the token failed validation) and the raw bearer token. Only a successfully
 * authenticated agent JWT (agentId set) or a successfully authenticated htk_ API key
 * gets the relaxed tier. Anything else — invalid tokens, human JWTs, htmk_ management
 * keys — stays on the strict default tier. Exported for direct unit testing.
 */
export function resolveMcpRateLimit(ctx: McpAuthContext | null, token: string): number {
  const isAgentTier = ctx !== null && (ctx.agentId !== null || token.startsWith('htk_'))
  return isAgentTier ? MCP_AGENT_RATE_LIMIT_PER_MINUTE : MCP_RATE_LIMIT_PER_MINUTE
}
export const MCP_AGENT_TOKEN_REFRESH_MESSAGE =
  "Agent tokens do not expire and cannot be refreshed. To replace this token, call POST /api/mcp/agents/rotate-token with the owner's token. Rotating immediately invalidates the current token."

/**
 * Unified authentication for MCP routes
 * Supports both JWT tokens and API keys
 *
 * JWT Tokens (Recommended):
 * - Stateless, no database lookup needed (faster)
 * - Contains user info in token
 * - Can be longer-lived (30 days) for MCP use case
 * - Already have infrastructure set up
 *
 * API Keys (Alternative):
 * - Database-backed, can track usage
 * - Can be scoped to permissions
 * - Can have multiple keys per user
 * - Better for service-to-service communication
 *
 * @param request NextRequest object
 * @returns User + optional agentId, or null if invalid
 */
export async function validateMcpAuth(
  request: NextRequest,
  options: ValidateMcpAuthOptions = {}
): Promise<McpAuthContext | null> {
  const token = extractBearerToken(request.headers.get('Authorization'))

  if (!token) {
    console.log('[MCP Auth] No Authorization header or invalid format')
    return null
  }

  if (isManagementKeyToken(token)) {
    const managementCtx = await validateManagementApiKey(token)
    if (!managementCtx) {
      console.log('[MCP Auth] Management API key validation failed')
      return null
    }
    if (
      !options.deferManagementPermissionCheck &&
      !hasDataPermission(managementCtx.management?.permissions ?? {})
    ) {
      console.log('[MCP Auth] Management API key rejected:', {
        reason: 'insufficient_scope',
      })
      return null
    }

    console.log('[MCP Auth] Management API key validated for user:', managementCtx.user.id)
    logMcpCliUsage(request, token, managementCtx)
    return managementCtx
  }

  if (token.startsWith('htk_')) {
    const ctx = await validateApiKey(token)
    if (ctx) {
      console.log('[MCP Auth] API key validated for user:', ctx.user.id)
      logMcpCliUsage(request, token, ctx)
      return ctx
    }

    console.log('[MCP Auth] API key validation failed')
    return null
  }

  const ctx = await validateJwtToken(token)
  if (ctx) {
    console.log('[MCP Auth] JWT validated for user:', ctx.user.id, 'agentId:', ctx.agentId ?? '(none)')
    logMcpCliUsage(request, token, ctx)
    return ctx
  }

  console.log('[MCP Auth] JWT token validation failed')
  return null
}

async function validateApiKey(token: string): Promise<McpAuthContext | null> {
  try {
    const keyHash = hashApiKey(token)
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
      },
      select: {
        id: true,
        lastUsedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    })

    if (!apiKey?.user) {
      return null
    }

    const now = new Date()
    const lastUsedCutoff = new Date(now.getTime() - 5 * 60 * 1000)
    if (!apiKey.lastUsedAt || apiKey.lastUsedAt < lastUsedCutoff) {
      void prisma.apiKey.updateMany({
        where: {
          id: apiKey.id,
          OR: [
            { lastUsedAt: null },
            { lastUsedAt: { lt: lastUsedCutoff } },
          ],
        },
        data: {
          lastUsedAt: now,
        },
      }).catch(() => undefined)
    }

    return {
      user: {
        id: apiKey.user.id,
        email: apiKey.user.email,
        displayName: apiKey.user.displayName ?? undefined,
      },
      agentId: null,
    }
  } catch {
    console.log('[MCP Auth] API key lookup failed')
    return null
  }
}

/**
 * Authentication for account-management MCP routes. A regular MCP JWT can
 * bootstrap the first key; subsequent calls may use an htmk_ management key.
 */
export type ManagementAction = 'read' | 'write' | 'usage:read'

export async function validateManagementAuth(
  request: NextRequest,
  requiredAction?: ManagementAction
): Promise<McpAuthContext | null> {
  const token = extractBearerToken(request.headers.get('Authorization'))

  if (!token) {
    console.log('[MCP Auth] No Authorization header or invalid format')
    return null
  }

  if (isManagementKeyToken(token)) {
    const managementCtx = await validateManagementApiKey(token)
    const permissions = managementCtx?.management?.permissions ?? {}
    let hasRequiredPermission = hasAnyManagementPermission(permissions)
    if (requiredAction === 'write') {
      hasRequiredPermission = hasManagementWritePermission(permissions)
    } else if (requiredAction === 'read') {
      hasRequiredPermission = hasManagementReadPermission(permissions)
    } else if (requiredAction === 'usage:read') {
      hasRequiredPermission = hasUsageReadPermission(permissions)
    }
    if (
      !managementCtx ||
      !hasRequiredPermission
    ) {
      console.log('[MCP Auth] Management API key lacks required management permission', {
        requiredAction: requiredAction ?? 'any',
      })
      return null
    }

    logMcpCliUsage(request, token, managementCtx)
    return managementCtx
  }

  // Usage reports are intentionally management-key-only. Do not let a regular
  // MCP JWT reach the generic JWT branch when this action is requested.
  if (requiredAction === 'usage:read') return null

  // Management endpoints accept only real MCP tokens (aud mcp-api). The same
  // JWT_SECRET signs calendar-feed/email-link tokens, and validateJwtToken
  // keeps a legacy no-audience fallback for old MCP clients — without this
  // gate any same-secret JWT could mint a persistent management key.
  const unverified = jwt.decode(token) as jwt.JwtPayload | null
  const aud = unverified?.aud
  const audiences = Array.isArray(aud) ? aud : aud ? [aud] : []
  if (!audiences.includes(JWT_MCP_AUDIENCE)) {
    console.log('[MCP Auth] Management endpoints require an mcp-api audience token')
    return null
  }

  const ctx = await validateJwtToken(token)
  if (!ctx) return null
  // Agent-bound JWTs are data credentials for bots; letting one mint or
  // revoke keys would escalate a leaked bot token to account admin.
  if (ctx.agentId) {
    console.log('[MCP Auth] Agent tokens cannot access management endpoints')
    return null
  }
  logMcpCliUsage(request, token, ctx)
  return ctx
}

/**
 * Usage is an account-owner management-key surface, not a general MCP data
 * surface. Keep regular MCP JWTs, data keys, and browser sessions out.
 */
export async function validateUsageReadAuth(
  request: NextRequest
): Promise<McpAuthContext | null> {
  const token = extractBearerToken(request.headers.get('Authorization'))
  if (!token) return null
  if (!isManagementKeyToken(token)) return null

  return validateManagementAuth(request, 'usage:read')
}

export async function validateManagementOrSessionAuth(
  request: NextRequest,
  requiredAction?: ManagementAction
): Promise<McpAuthContext | null> {
  const managementCtx = await validateManagementAuth(request, requiredAction)
  if (managementCtx) return managementCtx

  // A presented credential is the selected principal. Do not silently upgrade
  // an invalid, under-scoped, data-key, or agent credential through an ambient
  // browser session. Session auth is a fallback only when no bearer was sent.
  if (request.headers.has('Authorization')) return null

  const session = await getSessionUser(request.headers)
  if (!session) return null

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  })
  if (!user) return null

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? undefined,
    },
    agentId: null,
  }
}

/**
 * Digest stored in place of an agent's bearer token.
 *
 * The plaintext credential is never written to the database, so a leaked dump
 * hands out a hash instead of a live key. Callers still present the real token,
 * which is verified against JWT_SECRET on its own before this comparison runs.
 */
export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * The credential columns an Agent row stores for a freshly issued token.
 *
 * Pass null when the credential is being destroyed. Every write site goes
 * through here so a new one cannot reintroduce a plaintext column, and so a
 * token minted without a jti fails loudly instead of being stored as something
 * revocation can never match.
 */
export function agentTokenCredentialFields(token: string | null): {
  mcpTokenHash: string | null
  mcpTokenJti: string | null
} {
  if (!token) return { mcpTokenHash: null, mcpTokenJti: null }

  const decoded = jwt.decode(token) as jwt.JwtPayload | null
  const generation = decoded?.jti
  if (typeof generation !== 'string' || generation.length === 0) {
    throw new Error('Agent token has no jti and could never be revoked')
  }

  return { mcpTokenHash: hashAgentToken(token), mcpTokenJti: generation }
}

/**
 * True when a presented token is the exact credential stored for an agent.
 *
 * Used where a caller has to prove it holds the current bearer token rather
 * than merely naming its generation.
 */
export function agentTokenMatchesStored(
  token: string | null | undefined,
  agent: { mcpTokenHash: string | null } | null | undefined
): boolean {
  if (!token || !agent?.mcpTokenHash) return false
  return hashAgentToken(token) === agent.mcpTokenHash
}

/**
 * Validates JWT token for MCP API access
 */
async function validateJwtToken(token: string): Promise<McpAuthContext | null> {
  const decoded = verifyMcpJwtToken(token)
  if (!decoded) return null

  const isOAuthAccessToken = isOAuthAccessTokenPayload(decoded)
  const oauthClientId = isOAuthAccessToken
    ? oauthClientIdFromPayload(decoded)
    : undefined

  try {
    // Extract user identifier from token
    let userId: number | null = null
    let email: string | null = null

    if (decoded.userId && typeof decoded.userId === 'number') {
      userId = decoded.userId
    } else if (decoded.sub && typeof decoded.sub === 'string') {
      email = decoded.sub.toLowerCase()
    } else {
      return null
    }

    // Fetch user from database (including revocation timestamp)
    let user
    if (userId) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          mcpTokensRevokedAt: true,
        }
      })
    } else if (email) {
      user = await prisma.user.findFirst({
        where: { email },
        select: {
          id: true,
          email: true,
          displayName: true,
          mcpTokensRevokedAt: true,
        }
      })
    } else {
      return null
    }

    if (!user) {
      return null
    }

    if (isOAuthAccessToken) {
      if (oauthClientId === null) return null
      if (oauthClientId !== undefined) {
        const client = await prisma.oAuthClient.findUnique({
          where: { client_id: oauthClientId },
          select: { client_id: true },
        })
        if (!client) {
          console.log('[MCP Auth] OAuth client was removed')
          return null
        }
      }
    }

    const revocationJtis = tokenRevocationJtis(user.id, token, decoded)
    if (isOAuthAccessToken && oauthClientId === undefined) {
      revocationJtis.push(oauthLegacyRevocationJti(user.id))
    }
    const revokedToken = await prisma.revokedToken.findFirst({
      where: {
        user_id: user.id,
        jti: { in: revocationJtis },
      },
    })

    if (revokedToken) {
      console.log('[MCP Auth] Token has been revoked')
      return null
    }

    // Check user-level token revocation (for old tokens without jti)
    // If user has revoked all tokens, check if this token was issued before revocation
    if (user.mcpTokensRevokedAt) {
      // Token was issued before revocation - check if it's older than revocation time
      const issuedAtMs = decoded[MCP_TOKEN_ISSUED_AT_MS_CLAIM]
      const tokenIssuedAt =
        typeof issuedAtMs === 'number' && Number.isFinite(issuedAtMs)
          ? new Date(issuedAtMs)
          : decoded.iat
            ? new Date(decoded.iat * 1000)
            : null

      if (tokenIssuedAt && tokenIssuedAt < user.mcpTokensRevokedAt) {
        console.log('[MCP Auth] Token was issued before user revoked all tokens:', {
          tokenIssuedAt: tokenIssuedAt.toISOString(),
          revokedAt: user.mcpTokensRevokedAt.toISOString(),
        })
        return null
      }
    }

    let agentId: string | null = null
    let agentRuntimeGeneration: number | null = null
    const rawAgentId = decoded.agentId
    const rawAgentTeamId = decoded[AGENT_TEAM_ID_CLAIM]
    const rawAgentTeamAccessBinding = decoded[AGENT_TEAM_ACCESS_BINDING_CLAIM]
    const hasAgentTeamScope =
      rawAgentTeamId !== undefined || rawAgentTeamAccessBinding !== undefined
    if (
      hasAgentTeamScope &&
      (typeof rawAgentId !== 'string' ||
        rawAgentId.length === 0 ||
        typeof rawAgentTeamId !== 'string' ||
        rawAgentTeamId.length === 0 ||
        typeof rawAgentTeamAccessBinding !== 'string' ||
        rawAgentTeamAccessBinding.length === 0)
    ) {
      return null
    }
    if (typeof rawAgentId === 'string' && rawAgentId.length > 0) {
      const agentTeamId = rawAgentTeamId as string | undefined
      if (agentTeamId) {
        if (
          !(await isFeatureEnabled(
            HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG,
            user.id
          ))
        ) {
          return null
        }
        const team = await getManagementKeyTeam(user.id, agentTeamId)
        if (!team || team.accessBinding !== rawAgentTeamAccessBinding) {
          return null
        }
      }
      const agent = await prisma.agent.findFirst({
        where: {
          id: rawAgentId,
          userId: user.id,
          revokedAt: null,
          ...(agentTeamId ? agentWithinTeamWhere(agentTeamId) : {}),
        },
        select: {
          id: true,
          mcpTokenHash: true,
          mcpTokenJti: true,
          runtimeGeneration: true,
        },
      })
      if (!agent) {
        console.log('[MCP Auth] Invalid or revoked agent on token:', rawAgentId)
        return null
      }
      const storedGeneration = storedAgentTokenGeneration(agent)
      if (!storedGeneration) {
        console.log('[MCP Auth] No stored token for agent (revoked):', rawAgentId)
        return null
      }
      if (presentedAgentTokenGeneration(decoded) !== storedGeneration) {
        console.log('[MCP Auth] Agent token generation does not match — rotated or revoked')
        return null
      }
      // An OAuth access token carries the generation instead of the bearer
      // token, so only a directly presented managed token can be bound to the
      // stored digest. When it can be, it is: the generation alone would accept
      // any token sharing that jti.
      //
      // The audience is checked alongside the claim so the digest is skipped
      // only for something the OAuth exchange actually minted. Signature
      // verification falls back to an audience-free pass for old tokens, so the
      // private claim on its own would let any other JWT_SECRET-signed flow
      // opt out of the digest binding.
      const audiences = Array.isArray(decoded.aud)
        ? decoded.aud
        : decoded.aud
          ? [decoded.aud]
          : []
      const carriesOAuthGeneration =
        typeof decoded[AGENT_TOKEN_GENERATION_CLAIM] === 'string' &&
        audiences.includes(JWT_OAUTH_AUDIENCE)
      if (
        !carriesOAuthGeneration &&
        (!agent.mcpTokenHash || hashAgentToken(token) !== agent.mcpTokenHash)
      ) {
        console.log('[MCP Auth] Agent token does not match the stored digest')
        return null
      }
      agentId = agent.id
      agentRuntimeGeneration = agent.runtimeGeneration
    }

    const now = Date.now()
    const lastLogged = mcpConnectionLogThrottle.get(user.id)
    if (!lastLogged || now - lastLogged > 30 * 60 * 1000) {
      mcpConnectionLogThrottle.set(user.id, now)
      void createLog({
        log: 'mcp_connected',
        type: LogType.Signup,
        status: Status.Normal,
        LoggedById: user.id,
      }).catch((err) => {
        console.error('[MCP Auth] Failed to log mcp_connected:', err)
      })
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? undefined,
      },
      agentId,
      agentRuntimeGeneration,
    }
  } catch (error) {
    return null
  }
}
export * from "./mcpAuthErrors";
export * from "./session";
export * from "./verifyJwt";
