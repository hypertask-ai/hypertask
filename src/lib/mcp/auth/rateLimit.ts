import { NextRequest, NextResponse } from 'next/server';
import { HTPR_7133_MCP_RATELIMIT_FAST_FLAG, HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG } from '@/lib/flags/keys';
import { createHash } from 'crypto';
import { getRedis } from '@/lib/redis';
import { decideMcpRateLimit, MCP_RATE_LIMIT_WINDOW_SECONDS } from '@/lib/mcp/rateLimitDecision';
import { extractBearerToken, validateMcpAuth } from './session';
import type { McpAuthContext } from './types';
import { getMcpOperationContext } from '../operationContext';

const MCP_RATE_LIMIT_PER_MINUTE = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE) || 120
const MCP_AGENT_RATE_LIMIT_PER_MINUTE = Number(process.env.MCP_AGENT_RATE_LIMIT_PER_MINUTE) || 600

const MAX_LOCAL_COUNTS = 1_000
const LEASE = 10
const localCounts = new Map<string, { count: number; reserved: number; leasing: boolean }>()
let localWindowStart: number | undefined
let fastFlagDecision: { enabled: boolean; expiresAt: number } | undefined
let exactCountFlagDecision: { enabled: boolean; expiresAt: number } | undefined

async function shouldUseExactCountRateLimit(): Promise<boolean> {
  if (exactCountFlagDecision && exactCountFlagDecision.expiresAt > Date.now()) return exactCountFlagDecision.enabled
  let enabled = true
  try {
    const { featureFlagCandidateUserIds } = await import('@/lib/flags')
    enabled = await featureFlagCandidateUserIds(HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG) === null
  } catch {}
  exactCountFlagDecision = { enabled, expiresAt: Date.now() + 30_000 }
  return enabled
}

async function shouldUseFastRateLimit(): Promise<boolean> {
  if (fastFlagDecision && fastFlagDecision.expiresAt > Date.now()) return fastFlagDecision.enabled
  try {
    const { featureFlagCandidateUserIds } = await import('@/lib/flags')
    const enabled = await featureFlagCandidateUserIds(HTPR_7133_MCP_RATELIMIT_FAST_FLAG) === null
    fastFlagDecision = { enabled, expiresAt: Date.now() + 30_000 }
    return enabled
  } catch {
    fastFlagDecision = { enabled: false, expiresAt: Date.now() + 30_000 }
    return false
  }
}

export function classifyMcpRateLimitCount(
  count: number
): 'allow' | 'resolve-tier' | 'block' {
  if (count <= MCP_RATE_LIMIT_PER_MINUTE) return 'allow'
  if (count > MCP_AGENT_RATE_LIMIT_PER_MINUTE) return 'block'
  return 'resolve-tier'
}

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
    const fastEnabled = !(await shouldUseExactCountRateLimit()) && await shouldUseFastRateLimit()
    if (!fastEnabled) localCounts.clear()
    const redis = await getRedis()
    const prepaid = fastEnabled && localWindowStart === windowStartSeconds ? localCounts.get(key) : undefined
    if (prepaid && prepaid.reserved > 0) {
      prepaid.reserved--
      return null
    }

    const trackCount = fastEnabled && fastFlagDecision?.enabled && localWindowStart === windowStartSeconds
    const state = trackCount ? localCounts.get(key) : undefined
    const increment = state && !state.leasing && state.count + LEASE <= MCP_RATE_LIMIT_PER_MINUTE / 2 ? LEASE : 1
    if (state && increment === LEASE) state.leasing = true
    let count: number
    try {
      count = await (increment === LEASE ? redis.incrby(key, LEASE) : redis.incr(key))
    } finally {
      if (state && increment === LEASE) state.leasing = false
    }
    if (count === increment) await redis.expire(key, MCP_RATE_LIMIT_WINDOW_SECONDS)
    let keptSlots = false
    if (trackCount && fastFlagDecision?.enabled && localWindowStart === windowStartSeconds) {
      let entry = localCounts.get(key)
      if (!entry && localCounts.size < MAX_LOCAL_COUNTS) {
        entry = { count: 0, reserved: 0, leasing: false }
        localCounts.set(key, entry)
      }
      if (entry) {
        entry.count = Math.max(entry.count, count)
        if (increment === LEASE && entry === state && count <= MCP_RATE_LIMIT_PER_MINUTE / 2) {
          entry.reserved += LEASE - 1
          keptSlots = true
        }
      }
    }
    if (increment === LEASE && !keptSlots) {
      count -= LEASE - 1
      await redis.decrby(key, LEASE - 1)
    }

    const countOutcome = classifyMcpRateLimitCount(count)
    if (countOutcome === 'allow') return null

    let limit = MCP_AGENT_RATE_LIMIT_PER_MINUTE
    if (countOutcome === 'resolve-tier') {
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

export function resolveMcpRateLimit(ctx: McpAuthContext | null, token: string): number {
  const isAgentTier = ctx !== null && (ctx.agentId !== null || token.startsWith('htk_'))
  return isAgentTier ? MCP_AGENT_RATE_LIMIT_PER_MINUTE : MCP_RATE_LIMIT_PER_MINUTE
}
