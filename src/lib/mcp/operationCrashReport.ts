import { waitUntil } from '@vercel/functions'
import { prismaErrorDiagnostics } from '@/lib/errors/prismaErrorDiagnostics'

const reportedRequests = new WeakSet<Request>()

const OPAQUE_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,35}|[A-Za-z0-9_-]{20,}|[A-Z][A-Z0-9]*-\d+)$/i

export function mcpRouteTemplate(request: Request): string {
  let pathname: string
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return 'unknown'
  }
  return pathname
    .split('/')
    .map(segment => (OPAQUE_SEGMENT.test(segment) ? ':id' : segment))
    .join('/')
}

function errorNameOf(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error'
  return error === null ? 'null' : typeof error
}

function stackFramesOnly(error: unknown, headline: string): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined
  const frames = error.stack.split('\n').filter(line => /^\s+at\s/.test(line))
  return [headline, ...frames].join('\n')
}

export function buildMcpCrashReport(request: Request, error: unknown) {
  const route = mcpRouteTemplate(request)
  const errorName = errorNameOf(error)
  const message = `MCP ${request.method} ${route} failed with ${errorName}`
  return {
    message,
    stack: stackFramesOnly(error, message),
    url: route,
    source: 'server' as const,
    fingerprintKey: `mcp:${request.method}:${route}:${errorName}`,
    extra: {
      route,
      method: request.method,
      errorName,
      ...prismaErrorDiagnostics(error),
    },
  }
}

function sendInBackground(report: ReturnType<typeof buildMcpCrashReport>) {
  const delivery = import('@/lib/errors/reportError').then(({ reportError }) => reportError(report)).catch(reportingError => {
    console.error('[MCP] crash report failed', reportingError)
  })
  try {
    waitUntil(delivery)
  } catch {
  }
}

export function reportMcpOperationCrash(request: Request, error: unknown): void {
  if (reportedRequests.has(request)) return
  reportedRequests.add(request)
  try {
    sendInBackground(buildMcpCrashReport(request, error))
  } catch (buildError) {
    console.error('[MCP] crash report failed', buildError)
  }
}

export function reportUnexplainedMcpServerError(request: Request, status: number): void {
  if (status !== 500 || reportedRequests.has(request)) return
  reportMcpOperationCrash(request, new McpServerErrorWithoutCause(status))
}

export class McpServerErrorWithoutCause extends Error {
  constructor(status: number) {
    super(`MCP route answered ${status} without reporting its cause`)
    this.name = 'McpServerErrorWithoutCause'
  }
}
