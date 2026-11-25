import { withAgentScopeRequest, prepareAgentScope } from "@/lib/auth/agentScope";
import { queueRestFailure } from '@/lib/aiFeedback/automatic'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { NextRequest, NextResponse } from 'next/server'
import { refusalOf, refusalResponse } from '@/lib/api/refusal'
import {
  checkMcpRateLimit,
  mcpUnauthorizedResponse,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import type { McpAuthContext, McpAuthFailureSnapshot, McpAuthTimings, ValidateMcpAuthOptions } from './auth/types'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { getMcpOperationContext } from './operationContext'
import { withAdoptedAgentMutationLease } from '@/lib/mcp/tasks/agentMutationLeaseAdoption'
import { createMcpDbTiming, mcpDbTimings, mcpDbTimingHeader } from './dbTiming'
import { reportMcpOperationCrash, reportUnexplainedMcpServerError } from './operationCrashReport'

const instanceStarted = performance.now()
const instanceId = randomBytes(4).toString('hex')
const instanceRegion = (process.env.VERCEL_REGION || 'unknown')
  .replace(/[^ -~]/g, '')
  .replace(/["\\]/g, '\\$&') || 'unknown'

export function shouldUseMcpRouteWrapper(request: NextRequest): boolean {
  const token = request.headers?.get?.('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token || /^(htk_|htmk_|httk_)/.test(token)) return false
  let candidate: unknown
  try {
    candidate = (jwt.decode(token) as jwt.JwtPayload | null)?.userId
  } catch {
    return false
  }
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0
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

function serverTimingHeader(timings: RouteScope['timings'], started: number, wrappedStarted: number, finished: number): string {
  const handlerMs = Math.max(0, finished - wrappedStarted - (timings.authMs ?? 0) - (timings.rateMs ?? 0))
  return [
    ['auth', timings.authMs],
    ['auth_jwt', timings.jwtMs],
    ['auth_db', timings.dbMs],
    ['ratelimit', timings.rateMs],
    ['handler', handlerMs],
    ['wrap_flag', wrappedStarted - started],
    ['total', finished - started],
    ['age', finished - instanceStarted],
  ]
    .filter((phase): phase is [string, number] => phase[1] !== undefined)
    .map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
    .join(', ') + `, inst;desc="${instanceId}", region;desc="${instanceRegion}"`
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

const reportedServerFaults = new WeakSet<Request>()

export function reportServerFault(request: Request, error: unknown): void {
  if (reportedServerFaults.has(request)) return
  reportedServerFaults.add(request)
  console.error('[MCP] operation failed', error)
  reportMcpOperationCrash(request, error)
  try { queueRestFailure(request, 500) } catch {}
}

export function wrapMcpRoute<Args extends unknown[], Result>(
  legacy: (request: NextRequest, ...args: Args) => Promise<Result>,
): (request: NextRequest, ...args: Args) => Promise<Result | NextResponse> {
  return (request, ...args) => withAgentScopeRequest(request, async () => {
    const started = performance.now()
    const operationContext = getMcpOperationContext(request)
    const execute = async (input: NextRequest) => {
      try {
        if (operationContext) await prepareAgentScope(operationContext.auth.user.id, operationContext.auth.agentId)
        const result = await legacy(input, ...args)
        if (result instanceof Response && result.status >= 500 && !reportedServerFaults.has(input)) {
          try { queueRestFailure(request, result.status) } catch {}
          reportUnexplainedMcpServerError(input, result.status)
        }
        return result
      } catch (error) {
        const refusal = refusalOf(error)
        if (refusal) {
          console.warn('[MCP] caller refusal', refusal)
          return refusalResponse(refusal)
        }
        reportServerFault(input, error)
        throw error
      }
    }
    if (operationContext || !shouldUseMcpRouteWrapper(request)) return execute(request)
    const wrappedStarted = performance.now()
    const scope: RouteScope = { originalRequest: request, request, failure: {}, timings: {} }
    const wrappedRequest = new Proxy(request, {
      get(target, property) {
        if (property === 'json') return () => scope.json ??= target.json()
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    scope.request = wrappedRequest
    const dbTiming = createMcpDbTiming()
    const result = await mcpDbTimings.run(dbTiming, () => routeScopes.run(scope, () => execute(wrappedRequest)))
    try {
      if (result instanceof Response) {
        result.headers.set('Server-Timing', serverTimingHeader(scope.timings, started, wrappedStarted, performance.now()) + `, ${mcpDbTimingHeader(dbTiming)}`)
      }
    } catch {
    }
    return result
  })
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

export const withMcpRouteMutationLease: typeof withAdoptedAgentMutationLease = (db, actor, run) =>
  withAdoptedAgentMutationLease(db, actor, run)
