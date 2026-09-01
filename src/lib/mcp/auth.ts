import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import jwt from 'jsonwebtoken'
import { randomUUID, createHash } from 'crypto'
import createLog from '@/utils/controllers/logs/createLog'
import { LogType, Prisma, Status } from '@prisma/client'
import { getRedis } from '@/lib/redis'
import { decideMcpRateLimit, MCP_RATE_LIMIT_WINDOW_SECONDS } from '@/lib/mcp/rateLimitDecision'
import { hashApiKey } from '@/lib/apiKeys'
import { auth } from '@/lib/auth/betterAuth'
import { getSessionUser } from '@/lib/auth/getSessionUser'
import {
  JWT_OAUTH_AUDIENCE,
  JWT_OAUTH_ISSUER,
} from '@/lib/mcp/oauthTokenContract'
import {
  hasAnyManagementPermission,
  hasDataPermission,
  hasManagementReadPermission,
  hasManagementWritePermission,
  hasUsageReadPermission,
  parseManagementPermissions,
} from '@/lib/mcp/managementPermissions'
import { logMcpCliUsage } from '@/lib/mcp/clientTelemetry'

const JWT_SECRET = process.env.JWT_SECRET as string
const JWT_ISSUER = process.env.JWT_ISSUER || 'hypertask'
const JWT_MCP_AUDIENCE = 'mcp-api' // Specific audience for MCP routes
const AGENT_TOKEN_GENERATION_CLAIM = 'agentTokenGeneration'
const MCP_TOKEN_ISSUED_AT_MS_CLAIM = 'mcpIssuedAtMs'
export const MANAGEMENT_KEY_PREFIX = 'htmk_'
export const isManagementKeyToken = (token: string) =>
  token.startsWith(MANAGEMENT_KEY_PREFIX)
export function extractBearerToken(authHeader: string | null): string | null {
  return authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
}
const scopedTokenRevocationJti = (userId: number, jti: string) =>
  `user:${userId}:${jti}`

export function legacyTokenRevocationJti(token: string): string {
  const digest = createHash('sha256')
    .update('hypertask:mcp:legacy-token-revocation\0')
    .update(token)
    .digest('hex')
  return `legacy:${digest}`
}

function tokenRevocationJtis(
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

/** MCP session: human principal + optional agent actor (null = user acts as themselves). */
export type McpAuthContext = {
  user: { id: number; email: string; displayName?: string | null }
  agentId: string | null
  /** Runtime generation observed while the managed agent token was verified. */
  agentRuntimeGeneration?: number | null
  management?: {
    keyId: string
    permissions: Record<string, string[]>
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

async function validateManagementApiKey(token: string): Promise<McpAuthContext | null> {
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
      },
    }
  } catch (error) {
    console.error('[MCP Auth] Failed to verify management API key:', error)
    return null
  }
}

export function verifyMcpJwtToken(token: string): jwt.JwtPayload | null {
  if (!JWT_SECRET) {
    console.log('[MCP Auth] JWT_SECRET not configured')
    return null // JWT not configured
  }

  // First decode without verification to inspect token structure
  let decodedWithoutVerify: jwt.JwtPayload | null = null
  try {
    decodedWithoutVerify = jwt.decode(token, { complete: false }) as jwt.JwtPayload
    if (decodedWithoutVerify) {
      console.log('[MCP Auth] Token decoded (unverified):', {
        userId: decodedWithoutVerify.userId,
        sub: decodedWithoutVerify.sub,
        iss: decodedWithoutVerify.iss,
        aud: decodedWithoutVerify.aud,
        exp: decodedWithoutVerify.exp ? new Date(decodedWithoutVerify.exp * 1000).toISOString() : null,
        iat: decodedWithoutVerify.iat ? new Date(decodedWithoutVerify.iat * 1000).toISOString() : null
      })
    }
  } catch (err) {
    console.log('[MCP Auth] Failed to decode token:', err)
    return null
  }

  if (!decodedWithoutVerify) {
    console.log('[MCP Auth] Token decode returned null')
    return null
  }

  try {
    // Verify JWT token - try multiple audience/issuer combinations for compatibility
    let decoded: jwt.JwtPayload

    // Try current format first (mcp-api audience)
    try {
      decoded = jwt.verify(token, JWT_SECRET, {
        issuer: JWT_ISSUER,
        audience: JWT_MCP_AUDIENCE,
      }) as jwt.JwtPayload
      console.log('[MCP Auth] JWT verified with current format (mcp-api)')
    } catch (err: any) {
      console.log('[MCP Auth] Current format failed:', err?.message)
      // Try legacy format (hypertasks-mcp audience, hypertasks issuer)
      try {
        decoded = jwt.verify(token, JWT_SECRET, {
          issuer: 'hypertasks', // Legacy issuer
          audience: 'hypertasks-mcp', // Legacy audience
        }) as jwt.JwtPayload
        console.log('[MCP Auth] JWT verified with legacy format (hypertasks-mcp)')
      } catch (err2: any) {
        console.log('[MCP Auth] Legacy format failed:', err2?.message)
        try {
          decoded = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_OAUTH_ISSUER,
            audience: JWT_OAUTH_AUDIENCE,
          }) as jwt.JwtPayload
          console.log('[MCP Auth] JWT verified as OAuth access token')
        } catch (errOAuth: any) {
          console.log('[MCP Auth] OAuth format failed:', errOAuth?.message)
          // Try without audience check (for backward compatibility)
          try {
            decoded = jwt.verify(token, JWT_SECRET, {
              issuer: ['hypertasks', JWT_ISSUER, JWT_OAUTH_ISSUER],
            }) as jwt.JwtPayload
            console.log('[MCP Auth] JWT verified without audience check')
          } catch (err3: any) {
            console.log('[MCP Auth] All verification attempts failed')
            console.log('[MCP Auth] Signature error details:', err3?.message)
            console.log('[MCP Auth] JWT_SECRET exists:', !!JWT_SECRET, 'Length:', JWT_SECRET?.length)
            console.log('[MCP Auth] Token issuer:', decodedWithoutVerify?.iss, 'Expected:', ['hypertasks', JWT_ISSUER])
            console.log('[MCP Auth] Token audience:', decodedWithoutVerify?.aud, 'Expected:', ['hypertasks-mcp', JWT_MCP_AUDIENCE])
            return null
          }
        }
      }
    }

    return decoded
  } catch {
    return null
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
 * The revocation generation an agent's stored credential represents.
 *
 * This used to re-verify a plaintext JWT read back out of the database. The
 * generation is now stored directly, and the guarantee that replaced it is
 * ownership at the query: every caller looks the agent up by id AND userId, so
 * a generation belonging to another owner's agent is never read in the first
 * place.
 */
export function storedAgentTokenGeneration(
  agent: { mcpTokenJti: string | null } | null | undefined
): string | null {
  const generation = agent?.mcpTokenJti
  return typeof generation === 'string' && generation.length > 0
    ? generation
    : null
}

/** Current managed-token generation represented by a verified agent JWT. */
export function presentedAgentTokenGeneration(decoded: jwt.JwtPayload): string | null {
  const privateGeneration = decoded[AGENT_TOKEN_GENERATION_CLAIM]
  if (typeof privateGeneration === 'string' && privateGeneration.length > 0) {
    return privateGeneration
  }

  // Direct managed tokens predate the private OAuth claim; their own jti is
  // also their generation identifier.
  const directGeneration = decoded.jti ?? decoded.jwtid
  return typeof directGeneration === 'string' && directGeneration.length > 0
    ? directGeneration
    : null
}

/**
 * Validates JWT token for MCP API access
 */
async function validateJwtToken(token: string): Promise<McpAuthContext | null> {
  const decoded = verifyMcpJwtToken(token)
  if (!decoded) return null

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

    const revokedToken = await prisma.revokedToken.findFirst({
      where: {
        user_id: user.id,
        jti: { in: tokenRevocationJtis(user.id, token, decoded) },
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
    if (typeof rawAgentId === 'string' && rawAgentId.length > 0) {
      const agent = await prisma.agent.findFirst({
        where: {
          id: rawAgentId,
          userId: user.id,
          revokedAt: null,
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



/**
 * Creates a JWT token for MCP API access
 *
 * @param userId User ID
 * @param email User email
 * @param expiresIn Expiration time (default: 30 days). Ignored when agentId is set (no JWT exp).
 * @param agentId Optional agent UUID; when set, token has no expiry (revoked via Agent.mcpToken / jti).
 * @returns JWT token string
 */
export function createMcpToken(
  userId: number,
  email: string,
  expiresIn: string | number = '30d',
  agentId?: string
): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured')
  }

  const jti = randomUUID()
  const issuedAt = Date.now()

  const payload: Record<string, unknown> = {
    sub: email,
    userId,
    jti,
    iat: Math.floor(issuedAt / 1000),
    [MCP_TOKEN_ISSUED_AT_MS_CLAIM]: issuedAt,
  }
  if (agentId) payload.agentId = agentId

  // If agentId is specified, generate a token *without* expiry (no expiresIn)
  const signOptions: jwt.SignOptions = {
    issuer: JWT_ISSUER,
    audience: JWT_MCP_AUDIENCE,
    ...(agentId ? {} : { expiresIn: expiresIn as any }),
  }

  return jwt.sign(payload as jwt.JwtPayload, JWT_SECRET, signOptions)
}

/**
 * Creates a JWT token for OAuth 2.1 access (MCP client authentication)
 *
 * @param firebaseUid Firebase user UID (used as 'sub')
 * @param userId Database user ID
 * @param email User email
 * @param expiresIn Expiration in seconds (default: 90 days). Ignored when agentId is set (no JWT exp).
 * @param agentId Optional agent UUID; when set, token has no expiry.
 * @returns JWT token string
 */
const MCP_OAUTH_TOKEN_EXPIRY = 90 * 24 * 60 * 60; // 90 days

export function createOAuthToken(
  firebaseUid: string,
  userId: number,
  email: string,
  expiresIn: number = MCP_OAUTH_TOKEN_EXPIRY,
  agentId?: string | null,
  agentTokenJti?: string | null
): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured')
  }

  const oauthIssuer = JWT_OAUTH_ISSUER
  const oauthAudience = JWT_OAUTH_AUDIENCE

  // Don't include 'iss' and 'aud' in payload - jwt.sign() will add them via options
  const issuedAt = Date.now()
  const payload: Record<string, unknown> = {
    sub: firebaseUid,
    userId: userId,
    email: email,
    jti: randomUUID(),
    iat: Math.floor(issuedAt / 1000),
    [MCP_TOKEN_ISSUED_AT_MS_CLAIM]: issuedAt,
  }
  if (agentId) {
    if (!agentTokenJti) {
      throw new Error('Agent OAuth tokens require the current agent token jti')
    }
    payload.agentId = agentId
    // Every OAuth credential keeps a unique jti. A separate private claim ties
    // it to the managed agent's revocable generation.
    payload[AGENT_TOKEN_GENERATION_CLAIM] = agentTokenJti
  }

  return jwt.sign(payload as jwt.JwtPayload, JWT_SECRET, {
    issuer: oauthIssuer,
    audience: oauthAudience,
    ...(agentId ? {} : { expiresIn }),
  } as jwt.SignOptions)
}

/**
 * Revokes a specific token by its jti
 * 
 * @param jti JWT ID of the token to revoke
 * @param userId User ID (for validation)
 * @param expiresAt Token expiration time (for cleanup)
 */
export async function revokeTokenByJti(jti: string, userId: number, expiresAt: Date): Promise<void> {
  try {
    await prisma.revokedToken.upsert({
      where: { jti },
      create: {
        jti,
        user_id: userId,
        revoked_at: new Date(),
        expires_at: expiresAt,
      },
      update: {
        revoked_at: new Date(), // Update if already exists
      },
    })
  } catch (error) {
    console.error('[MCP Auth] Error revoking token:', error)
    throw error
  }
}

export async function claimTokenRotation(
  jti: string,
  userId: number,
  expiresAt: Date
): Promise<boolean> {
  try {
    await prisma.revokedToken.create({
      data: {
        jti,
        user_id: userId,
        revoked_at: new Date(),
        expires_at: expiresAt,
      },
    })
    return true
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return false
    }
    throw error
  }
}

/**
 * Revokes a user-owned token identifier supplied through an administrative
 * surface. Namespacing prevents a caller who learns another account's jti
 * from reserving or revoking that account's token globally.
 */
export async function revokeOwnedTokenByJti(
  jti: string,
  userId: number,
  expiresAt: Date
): Promise<void> {
  return revokeTokenByJti(
    scopedTokenRevocationJti(userId, jti),
    userId,
    expiresAt
  )
}

export type McpAuthFailureLookup = {
  user: {
    findUnique: (args: unknown) => Promise<{ id: number; mcpTokensRevokedAt: Date | null } | null>
    findFirst: (args: unknown) => Promise<{ id: number; mcpTokensRevokedAt: Date | null } | null>
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

    const revoked = await db.revokedToken.findFirst({
      where: {
        user_id: user.id,
        jti: { in: tokenRevocationJtis(user.id, token, verified) },
      },
      select: { jti: true },
    })
    if (revoked) return 'token_revoked'

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

/**
 * The 401 an MCP route should return once `validateMcpAuth` has said no.
 *
 * Keeps the `error` string every existing client already matches on and adds
 * the accurate `reason`, so nothing that reads the old field changes.
 */
export async function mcpUnauthorizedResponse(
  request: NextRequest,
  db?: McpAuthFailureLookup
) {
  return createUnauthorizedResponse(
    undefined,
    await classifyMcpAuthFailure(request, db)
  )
}
