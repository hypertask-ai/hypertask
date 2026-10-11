import { NextRequest, NextResponse } from 'next/server';
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
const LEASE = 10
const localCounts = new Map<string, { count: number; reserved: number; leasing: boolean }>()
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

  let key: string | undefined
  try {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const nowSeconds = Math.floor(Date.now() / 1000)
    const windowStartSeconds = Math.floor(nowSeconds / MCP_RATE_LIMIT_WINDOW_SECONDS) * MCP_RATE_LIMIT_WINDOW_SECONDS
    key = `mcp:ratelimit:${tokenHash}:${windowStartSeconds}`

    if (localWindowStart !== windowStartSeconds) {
      localCounts.clear()
      localWindowStart = windowStartSeconds
    }
    const fastEnabled = await shouldUseFastRateLimit()
    if (!fastEnabled) localCounts.clear()
    const prepaid = fastEnabled && localWindowStart === windowStartSeconds ? localCounts.get(key) : undefined
    // The shared count includes every admitted call, prepaid, so no limit is exceeded.
    // Unused slots can only block up to LEASE - 1 calls early per instance, and are reserved
    // only while the shared count is at most half the lowest limit.
    if (prepaid && prepaid.reserved > 0) {
      prepaid.reserved--
      return null
    }

    const redis = await getRedis()
    const trackCount = fastEnabled && fastFlagDecision?.enabled && localWindowStart === windowStartSeconds
    const state = trackCount ? localCounts.get(key) : undefined
    // One lease in flight per key: concurrent calls count singly, so leases never overwrite each other.
    const increment = state && !state.leasing && state.count + LEASE <= MCP_RATE_LIMIT_PER_MINUTE / 2 ? LEASE : 1
    if (state && increment === LEASE) state.leasing = true
    let count: number
    try {
      count = await (increment === LEASE ? redis.incrby(key, LEASE) : redis.incr(key))
    } finally {
      if (state && increment === LEASE) state.leasing = false
    }
    if (count === increment) await redis.expire(key, MCP_RATE_LIMIT_WINDOW_SECONDS)
    if (trackCount && fastFlagDecision?.enabled && localWindowStart === windowStartSeconds) {
      let entry = localCounts.get(key)
      if (!entry) {
        if (localCounts.size >= MAX_LOCAL_COUNTS) localCounts.delete(localCounts.keys().next().value!)
        entry = { count: 0, reserved: 0, leasing: false }
        localCounts.set(key, entry)
      }
      entry.count = Math.max(entry.count, count)
      if (increment === LEASE && entry === state && count <= MCP_RATE_LIMIT_PER_MINUTE / 2) entry.reserved += LEASE - 1
    }

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
    if (key) localCounts.delete(key)
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
