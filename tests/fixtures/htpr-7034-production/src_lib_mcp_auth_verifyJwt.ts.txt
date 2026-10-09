import prisma from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { randomUUID, createHash } from 'crypto';
import createLog from '@/utils/controllers/logs/createLog';
import { LogType, Prisma, Status } from '@prisma/client';
import { isOAuthAccessTokenPayload, JWT_LEGACY_OAUTH_AUDIENCE, JWT_OAUTH_AUDIENCE, JWT_OAUTH_ISSUER, oauthClientIdFromPayload, OAUTH_CLIENT_ID_CLAIM, oauthLegacyRevocationJti } from '@/lib/mcp/oauthTokenContract';
import { HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG, isFeatureEnabled } from '@/lib/flags';
import { agentWithinTeamWhere, getManagementKeyTeam } from '@/lib/mcp/managementKeyTeamScope';
import type { AgentTokenTeamScope, McpAuthContext, ValidateMcpAuthOptions } from './types';

const JWT_SECRET = process.env.JWT_SECRET as string
const JWT_ISSUER = process.env.JWT_ISSUER || 'hypertask'
export const JWT_MCP_AUDIENCE = 'mcp-api'
export const JWT_LEGACY_MCP_AUDIENCE = 'hypertasks-mcp'
const AGENT_TOKEN_GENERATION_CLAIM = 'agentTokenGeneration'
const AGENT_TEAM_ID_CLAIM = 'agentTeamId'
const AGENT_TEAM_ACCESS_BINDING_CLAIM = 'agentTeamAccessBinding'
export const MCP_TOKEN_ISSUED_AT_MS_CLAIM = 'mcpIssuedAtMs'

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

// ponytail: in-memory per-process throttle, resets on deploy/restart — fine for a
// UX nice-to-have status pill; upgrade to Redis if cross-instance accuracy matters.
const mcpConnectionLogThrottle = new Map<number, number>()

const AUTH_LOG_MAX_ENTRIES = 1_000
const AUTH_LOG_REPEAT_MS = 30_000
const boundedJwtLogThrottle = new Map<string, number>()
const boundedConnectionLogThrottle = new Map<number, number>()

function boundedLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, 200)
  if (value instanceof Error) return { name: value.name.slice(0, 200), message: value.message.slice(0, 200) }
  if (value && typeof value === 'object') {
    if (depth >= 3) return '[omitted]'
    if (Array.isArray(value)) return value.slice(0, 10).map(item => boundedLogValue(item, depth + 1))
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key.slice(0, 200), boundedLogValue(item, depth + 1)]))
  }
  return value
}

export function boundedMcpAuthLog(...args: unknown[]): void {
  const bounded = args.map(value => boundedLogValue(value))
  // The bounded rendering itself is the dedupe key (capped), so no hash is needed.
  const key = JSON.stringify(bounded).slice(0, 1000)
  const now = Date.now()
  const previous = boundedJwtLogThrottle.get(key)
  if (previous !== undefined && now - previous < AUTH_LOG_REPEAT_MS) return
  boundedJwtLogThrottle.delete(key)
  if (boundedJwtLogThrottle.size >= AUTH_LOG_MAX_ENTRIES) {
    boundedJwtLogThrottle.delete(boundedJwtLogThrottle.keys().next().value!)
  }
  boundedJwtLogThrottle.set(key, now)
  console.log(...bounded)
}

export function verifyMcpJwtToken(token: string, options: ValidateMcpAuthOptions = {}): jwt.JwtPayload | null {
  const log = options.boundedLogging ? boundedMcpAuthLog : console.log
  if (!JWT_SECRET) {
    log('[MCP Auth] JWT_SECRET not configured')
    return null // JWT not configured
  }

  // First decode without verification to inspect token structure
  let decodedWithoutVerify: jwt.JwtPayload | null = null
  try {
    decodedWithoutVerify = jwt.decode(token, { complete: false }) as jwt.JwtPayload
    if (decodedWithoutVerify) {
      log('[MCP Auth] Token decoded (unverified):', {
        userId: decodedWithoutVerify.userId,
        sub: decodedWithoutVerify.sub,
        iss: decodedWithoutVerify.iss,
        aud: decodedWithoutVerify.aud,
        exp: decodedWithoutVerify.exp ? new Date(decodedWithoutVerify.exp * 1000).toISOString() : null,
        iat: decodedWithoutVerify.iat ? new Date(decodedWithoutVerify.iat * 1000).toISOString() : null
      })
    }
  } catch (err) {
    log('[MCP Auth] Failed to decode token:', err)
    return null
  }

  if (!decodedWithoutVerify) {
    log('[MCP Auth] Token decode returned null')
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
      log('[MCP Auth] JWT verified with current format (mcp-api)')
    } catch (err: any) {
      log('[MCP Auth] Current format failed:', err?.message)
      // Try legacy format (hypertasks-mcp audience, hypertasks issuer)
      try {
        decoded = jwt.verify(token, JWT_SECRET, {
          issuer: 'hypertasks', // Legacy issuer
          audience: JWT_LEGACY_MCP_AUDIENCE,
        }) as jwt.JwtPayload
        log('[MCP Auth] JWT verified with legacy format (hypertasks-mcp)')
      } catch (err2: any) {
        log('[MCP Auth] Legacy format failed:', err2?.message)
        try {
          decoded = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_OAUTH_ISSUER,
            audience: [JWT_OAUTH_AUDIENCE, JWT_LEGACY_OAUTH_AUDIENCE],
          }) as jwt.JwtPayload
          log('[MCP Auth] JWT verified as OAuth access token')
        } catch (errOAuth: any) {
          log('[MCP Auth] OAuth format failed:', errOAuth?.message)
          // Only tokens minted before MCP audiences were introduced may use the
          // compatibility path. A present audience belongs to another token contract.
          if (decodedWithoutVerify.aud !== undefined) {
            log('[MCP Auth] Token has an unsupported audience:', decodedWithoutVerify.aud)
            return null
          }
          try {
            decoded = jwt.verify(token, JWT_SECRET, {
              issuer: ['hypertasks', JWT_ISSUER, JWT_OAUTH_ISSUER],
            }) as jwt.JwtPayload
            log('[MCP Auth] Legacy audience-less JWT verified')
          } catch (err3: any) {
            log('[MCP Auth] All verification attempts failed')
            log('[MCP Auth] Signature error details:', err3?.message)
            log('[MCP Auth] JWT_SECRET exists:', !!JWT_SECRET, 'Length:', JWT_SECRET?.length)
            log('[MCP Auth] Token issuer:', decodedWithoutVerify?.iss, 'Expected:', ['hypertasks', JWT_ISSUER])
            log('[MCP Auth] Token audience:', decodedWithoutVerify?.aud, 'Expected:', [JWT_LEGACY_MCP_AUDIENCE, JWT_MCP_AUDIENCE])
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
export async function validateJwtToken(token: string, options: ValidateMcpAuthOptions = {}): Promise<McpAuthContext | null> {
  const log = options.boundedLogging ? boundedMcpAuthLog : console.log
  const decoded = verifyMcpJwtToken(token, options)
  if (options.failureSnapshot) options.failureSnapshot.verifiedJwt = decoded
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

    if (options.failureSnapshot) options.failureSnapshot.user = user ?? null
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
        if (options.failureSnapshot) options.failureSnapshot.oauthClient = client
        if (!client) {
          log('[MCP Auth] OAuth client was removed')
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

    if (options.failureSnapshot) options.failureSnapshot.revokedToken = revokedToken
    if (revokedToken) {
      log('[MCP Auth] Token has been revoked')
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
        log('[MCP Auth] Token was issued before user revoked all tokens:', {
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
        log('[MCP Auth] Invalid or revoked agent on token:', rawAgentId)
        return null
      }
      if (options.failureSnapshot) {
        options.failureSnapshot.agent = { id: agent.id, mcpTokenJti: agent.mcpTokenJti, revokedAt: null }
      }
      const storedGeneration = storedAgentTokenGeneration(agent)
      if (!storedGeneration) {
        log('[MCP Auth] No stored token for agent (revoked):', rawAgentId)
        return null
      }
      if (presentedAgentTokenGeneration(decoded) !== storedGeneration) {
        log('[MCP Auth] Agent token generation does not match \u2014 rotated or revoked')
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
        log('[MCP Auth] Agent token does not match the stored digest')
        return null
      }
      agentId = agent.id
      agentRuntimeGeneration = agent.runtimeGeneration
    }

    const now = Date.now()
    const connectionThrottle = options.boundedLogging ? boundedConnectionLogThrottle : mcpConnectionLogThrottle
    const lastLogged = connectionThrottle.get(user.id)
    if (!lastLogged || now - lastLogged > 30 * 60 * 1000) {
      if (options.boundedLogging && !connectionThrottle.has(user.id) && connectionThrottle.size >= AUTH_LOG_MAX_ENTRIES) {
        connectionThrottle.delete(connectionThrottle.keys().next().value!)
      }
      connectionThrottle.set(user.id, now)
      void createLog({
        log: 'mcp_connected',
        type: LogType.Signup,
        status: Status.Normal,
        LoggedById: user.id,
      }).catch((err) => {
        if (options.boundedLogging) boundedMcpAuthLog('[MCP Auth] Failed to log mcp_connected:', err)
        else console.error('[MCP Auth] Failed to log mcp_connected:', err)
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
  agentId?: string,
  agentTeamScope?: AgentTokenTeamScope
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
  if (agentTeamScope) {
    if (!agentId) {
      throw new Error('A team-bound token requires an agent id')
    }
    if (!agentTeamScope.teamId || !agentTeamScope.accessBinding) {
      throw new Error('A team-bound token requires a complete team scope')
    }
    payload[AGENT_TEAM_ID_CLAIM] = agentTeamScope.teamId
    payload[AGENT_TEAM_ACCESS_BINDING_CLAIM] = agentTeamScope.accessBinding
  }

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
 * @param subject Firebase UID, or database user ID string when no UID exists
 * @param userId Database user ID
 * @param email User email
 * @param clientId OAuth client registration bound to this credential
 * @param expiresIn Expiration in seconds (default: 90 days). Ignored when agentId is set (no JWT exp).
 * @param agentId Optional agent UUID; when set, token has no expiry.
 * @param agentTokenJti Current agent credential generation.
 * @param agentTeamScope Optional team grant carried by a team-bound agent.
 * @returns JWT token string
 */
const MCP_OAUTH_TOKEN_EXPIRY = 90 * 24 * 60 * 60; // 90 days

export function createOAuthToken(
  subject: string,
  userId: number,
  email: string,
  clientId: string,
  expiresIn: number = MCP_OAUTH_TOKEN_EXPIRY,
  agentId?: string | null,
  agentTokenJti?: string | null,
  agentTeamScope?: AgentTokenTeamScope
): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured')
  }
  if (!clientId || clientId.length > 64) {
    throw new Error('OAuth tokens require a valid client id')
  }

  const oauthIssuer = JWT_OAUTH_ISSUER
  const oauthAudience = JWT_OAUTH_AUDIENCE

  // Don't include 'iss' and 'aud' in payload - jwt.sign() will add them via options
  const issuedAt = Date.now()
  const payload: Record<string, unknown> = {
    sub: subject,
    userId: userId,
    email: email,
    [OAUTH_CLIENT_ID_CLAIM]: clientId,
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
  if (agentTeamScope) {
    if (!agentId) {
      throw new Error('A team-bound OAuth token requires an agent id')
    }
    if (!agentTeamScope.teamId || !agentTeamScope.accessBinding) {
      throw new Error('A team-bound OAuth token requires a complete team scope')
    }
    payload[AGENT_TEAM_ID_CLAIM] = agentTeamScope.teamId
    payload[AGENT_TEAM_ACCESS_BINDING_CLAIM] = agentTeamScope.accessBinding
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

