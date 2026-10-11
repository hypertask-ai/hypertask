import { AsyncLocalStorage } from 'node:async_hooks'
import jwt from 'jsonwebtoken'
import type { NextRequest } from 'next/server'
import { HTPR_6926_MCP_ROUTE_WRAPPER_FLAG } from '@/lib/flags/keys'
import {
  checkMcpRateLimit,
  mcpUnauthorizedResponse,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import type { McpAuthContext, McpAuthFailureSnapshot, McpAuthTimings, ValidateMcpAuthOptions } from './auth/types'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { getMcpOperationContext } from './operationContext'
import { withAdoptedAgentMutationLease } from '@/lib/mcp/tasks/agentMutationLeaseAdoption'

const FLAG_TTL_MS = 30_000
const FLAG_MAX_ENTRIES = 1_000
const flagDecisions = new Map<string, { enabled: boolean; expiresAt: number }>()

export async function shouldUseMcpRouteWrapper(request: NextRequest): Promise<boolean> {
  const token = request.headers?.get?.('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token || /^(htk_|htmk_|httk_)/.test(token)) return false
  let candidate: unknown
  try {
    candidate = (jwt.decode(token) as jwt.JwtPayload | null)?.userId
  } catch {
    return false
  }
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0) return false

  // Decoding selects scaffolding only. The candidate never authorizes a request.
  const key = `${HTPR_6926_MCP_ROUTE_WRAPPER_FLAG}:${candidate}`
  const cached = flagDecisions.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.enabled
  flagDecisions.delete(key)
  try {
    const { isFeatureEnabled } = await import('@/lib/flags')
    const enabled = await isFeatureEnabled(HTPR_6926_MCP_ROUTE_WRAPPER_FLAG, candidate)
    if (!flagDecisions.has(key) && flagDecisions.size >= FLAG_MAX_ENTRIES) {
      flagDecisions.delete(flagDecisions.keys().next().value!)
    }
    flagDecisions.set(key, { enabled, expiresAt: Date.now() + FLAG_TTL_MS })
    return enabled
  } catch {
    return false
  }
}

type RouteScope = {
  originalRequest: NextRequest
  request: NextRequest
  auth?: Promise<McpAuthContext | null>
  rate?: ReturnType<typeof checkMcpRateLimit>
  json?: Promise<unknown>
  failure: McpAuthFailureSnapshot
  timings: McpAuthTimings & { authMs?: number; rateMs?: number }
}
const routeScopes = new AsyncLocalStorage<RouteScope>()

// HTPR-6965: Server-Timing for the wrapped path only. Phase names and durations, nothing
// about the caller. ratelimit includes auth when the check resolves the caller's tier.
function serverTimingHeader(timings: RouteScope['timings'], totalMs: number): string {
  const handlerMs = Math.max(0, totalMs - (timings.authMs ?? 0) - (timings.rateMs ?? 0))
  return [
    ['auth', timings.authMs],
    ['auth_jwt', timings.jwtMs],
    ['auth_db', timings.dbMs],
    ['ratelimit', timings.rateMs],
    ['handler', handlerMs],
  ]
    .filter((phase): phase is [string, number] => phase[1] !== undefined)
    .map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
    .join(', ')
}

async function timed<T>(record: (ms: number) => void, run: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    return await run()
  } finally {
    record(performance.now() - started)
  }
}

function scopeFor(request: NextRequest): RouteScope | undefined {
  const scope = routeScopes.getStore()
  return scope?.request === request ? scope : undefined
}

// The continuation retains each route's guards and error envelopes. Lazy steps
// preserve rate/auth/JSON order, including routes with permission checks before JSON.
export function wrapMcpRoute<Args extends unknown[], Result>(
  legacy: (request: NextRequest, ...args: Args) => Promise<Result>,
): (request: NextRequest, ...args: Args) => Promise<Result> {
  return async (request, ...args) => {
    if (getMcpOperationContext(request) || !(await shouldUseMcpRouteWrapper(request))) return legacy(request, ...args)
    const started = performance.now()
    const scope: RouteScope = { originalRequest: request, request, failure: {}, timings: {} }
    const wrappedRequest = new Proxy(request, {
      get(target, property) {
        if (property === 'json') return () => scope.json ??= target.json()
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    scope.request = wrappedRequest
    const result = await routeScopes.run(scope, () => legacy(wrappedRequest, ...args))
    try {
      if (result instanceof Response) {
        result.headers.set('Server-Timing', serverTimingHeader(scope.timings, performance.now() - started))
      }
    } catch {
      // Immutable response headers: skip the measurement, never fail the call.
    }
    return result
  }
}

export function validateMcpRouteAuth(request: NextRequest, options: ValidateMcpAuthOptions = {}) {
  const scope = scopeFor(request)
  if (!scope) return validateMcpAuth(request, options)
  return scope.auth ??= timed(ms => { scope.timings.authMs = ms }, () => validateMcpAuth(scope.originalRequest, {
    ...options,
    boundedLogging: true,
    failureSnapshot: scope.failure,
    timings: scope.timings,
  }))
}

export function checkMcpRouteRateLimit(request: NextRequest) {
  const scope = scopeFor(request)
  if (!scope) return checkMcpRateLimit(request)
  return scope.rate ??= timed(ms => { scope.timings.rateMs = ms }, () =>
    checkMcpRateLimit(scope.originalRequest, () => validateMcpRouteAuth(request)))
}

export function mcpRouteUnauthorizedResponse(
  request: NextRequest,
  db?: Parameters<typeof mcpUnauthorizedResponse>[1],
) {
  const scope = scopeFor(request)
  return scope
    ? mcpUnauthorizedResponse(scope.originalRequest, db, scope.failure)
    : mcpUnauthorizedResponse(request, db)
}

export const readMcpRouteJsonBody: typeof readJsonBody = (request, errors) => readJsonBody(request, errors)

// Keep adoption at each fenced write, not around an entire multi-write handler.
// The existing helper owns token-fenced finally cleanup and success preservation.
export const withMcpRouteMutationLease: typeof withAdoptedAgentMutationLease = (db, actor, run) =>
  withAdoptedAgentMutationLease(db, actor, run)
