import { after, NextRequest, NextResponse } from 'next/server';
import { HTPR_7133_MCP_RATELIMIT_FAST_FLAG } from '@/lib/flags/keys';
import { createHash } from 'crypto';
import { getRedis } from '@/lib/redis';
import { decideMcpRateLimit, MCP_RATE_LIMIT_WINDOW_SECONDS } from '@/lib/mcp/rateLimitDecision';
import { extractBearerToken, validateMcpAuth } from './session';
import type { McpAuthContext } from './types';
import { getMcpOperationContext } from '../operationContext';

// Default/anonymous tier - unauthenticated or invalid-token traffic (HTPR-4135). Unchanged.
const MCP_RATE_LIMIT_PER_MINUTE = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE) || 120
// Agent tier - successfully authenticated agent JWTs (agentId claim) or valid htk_ API
// keys get a higher published limit instead of being treated as anonymous scraping
// traffic (HTPR-4431). Picked as 5x default; tune via env if it's wrong in practice.
const MCP_AGENT_RATE_LIMIT_PER_MINUTE = Number(process.env.MCP_AGENT_RATE_LIMIT_PER_MINUTE) || 600

const MAX_LOCAL_COUNTS = 1_000
const localCounts = new Map<string, { count?: number; pending: number }>()
let localWindowStart: number | undefined
let fastFlagDecision: { enabled: boolean; expiresAt: number } | undefined

async function shouldUseFastRateLimit(): Promise<boolean> {
  if (fastFlagDecision && fastFlagDecision.expiresAt > Date.now()) return fastFlagDecision.enabled
  try {
    const { featureFlagCandidateUserIds } = await import('@/lib/flags')
    // No token-derived user: only the global Everyone mode returns null.
    const enabled = await featureFlagCandidateUserIds(HTPR_7133_MCP_RATELIMIT_FAST_FLAG) === null
    fastFlagDecision = { enabled, expiresAt: Date.now() + 30_000 }
    return enabled
  } catch {
    fastFlagDecision = { enabled: false, expiresAt: Date.now() + 30_000 }
    return false
  }
}

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
 * (never the raw token). Fails open on any storage error - never blocks
 * legitimate traffic because our own infra hiccupped.
 */
export async function checkMcpRateLimit(
  request: NextRequest,
  resolveAuth?: () => Promise<McpAuthContext | null>,
): Promise<NextResponse | null> {
  if (getMcpOperationContext(request)?.rateLimitChecked) return null
  const token = extractBearerToken(request.headers.get('Authorization'))
  if (!token) return null

  try {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const nowSeconds = Math.floor(Date.now() / 1000)
    const windowStartSeconds = Math.floor(nowSeconds / MCP_RATE_LIMIT_WINDOW_SECONDS) * MCP_RATE_LIMIT_WINDOW_SECONDS
    const key = `mcp:ratelimit:${tokenHash}:${windowStartSeconds}`

    if (localWindowStart !== windowStartSeconds) {
      localCounts.clear()
      localWindowStart = windowStartSeconds
    }
    const fastEnabled = await shouldUseFastRateLimit()
    if (!fastEnabled) localCounts.clear()
    const redis = await getRedis()
    const trackCount = fastEnabled && localWindowStart === windowStartSeconds
    let state = trackCount ? localCounts.get(key) : undefined
    if (trackCount && !state) {
      if (localCounts.size >= MAX_LOCAL_COUNTS) localCounts.delete(localCounts.keys().next().value!)
      state = { pending: 0 }
      localCounts.set(key, state)
    }
    const skipWait = state?.count !== undefined &&
      state.count + state.pending + 1 <= MCP_RATE_LIMIT_PER_MINUTE / 2
    if (state) state.pending++
    const localState = state
    const increment = (async () => {
      try {
        const count = await redis.incr(key)
        if (count === 1) await redis.expire(key, MCP_RATE_LIMIT_WINDOW_SECONDS)
        if (localState) localState.count = Math.max(localState.count ?? 0, count)
        return count
      } catch (err) {
        if (localState) localState.count = undefined
        console.warn('[MCP Rate Limit] Redis check failed, failing open:', err)
        return undefined
      } finally {
        if (localState) localState.pending--
      }
    })()
    // Skip only below half the anonymous limit, including every unconfirmed local call.
    // Each call still increments Redis; other-instance traffic can overshoot until replies
    // confirm a higher count, after which the next call awaits the shared limit again.
    if (skipWait) {
      try {
        after(() => increment.then(() => {}))
        return null
      } catch {
        // Outside a supported request lifecycle, await the same increment, never a second one.
      }
    }
    const count = await increment
    if (count === undefined) return null

    const countOutcome = classifyMcpRateLimitCount(count)
    if (countOutcome === 'allow') return null

    let limit = MCP_AGENT_RATE_LIMIT_PER_MINUTE
    if (countOutcome === 'resolve-tier') {
      // ponytail: this double-validates with each route; memoize per request if it becomes a hot path.
      const ctx = await (resolveAuth ? resolveAuth() : validateMcpAuth(request))
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

/**
 * Which per-minute limit applies given the already-resolved auth context (or null if
 * the token failed validation) and the raw bearer token. Only a successfully
 * authenticated agent JWT (agentId set) or a successfully authenticated htk_ API key
 * gets the relaxed tier. Anything else - invalid tokens, human JWTs, htmk_ management
 * keys - stays on the strict default tier. Exported for direct unit testing.
 */
export function resolveMcpRateLimit(ctx: McpAuthContext | null, token: string): number {
  const isAgentTier = ctx !== null && (ctx.agentId !== null || token.startsWith('htk_'))
  return isAgentTier ? MCP_AGENT_RATE_LIMIT_PER_MINUTE : MCP_RATE_LIMIT_PER_MINUTE
}
