import { STATUS_CODES } from 'node:http'
import { NextRequest } from 'next/server'
import type { IApiClient } from '@/lib/mcp-server/types'
import { generateCorrelationId } from '@/lib/mcp-server/utils/correlation'
import { ApiError, mapHttpErrorToMcpError } from '@/lib/mcp-server/utils/errors'
import { validateMcpAuth, checkMcpRateLimit } from './auth'
import type { McpAuthContext } from './auth/types'
import { bindMcpOperationContext, getMcpExecutionContext } from './operationContext'
import { executeMcpOperation } from './operations'

const OPERATION_ORIGIN = 'http://mcp.internal'

export async function createInProcessMcpClient(token: string): Promise<{
  client: IApiClient
  auth: McpAuthContext
}> {
  const auth = getMcpExecutionContext(token) ?? await validateMcpAuth(
    new NextRequest(`${OPERATION_ORIGIN}/mcp`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    { deferManagementPermissionCheck: true },
  )
  if (!auth) throw new Error('Unauthorized. Invalid or missing authentication token.')

  let rateLimitCheck: Promise<Response | null> | undefined
  const client: IApiClient = {
    async makeRequest<T>(endpoint: string, options: RequestInit = {}, correlationId?: string): Promise<T> {
      const url = new URL(endpoint, OPERATION_ORIGIN)
      if (url.origin !== OPERATION_ORIGIN || !url.pathname.startsWith('/mcp/')) {
        throw new ApiError('Invalid MCP operation endpoint')
      }
      const headers = new Headers(options.headers)
      headers.set('Authorization', `Bearer ${token}`)
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      const requestCorrelationId = correlationId ?? generateCorrelationId()
      headers.set('X-Correlation-ID', requestCorrelationId)
      const request = new NextRequest(url, { ...options, headers, signal: options.signal ?? undefined })
      bindMcpOperationContext(request, auth, false)

      // A compound tool can invoke several operations, but consumes one rate-limit slot.
      rateLimitCheck ??= checkMcpRateLimit(request)
      const limited = await rateLimitCheck
      bindMcpOperationContext(request, auth, true)
      let response: Response
      try {
        response = limited ? limited.clone() : await executeMcpOperation(request)
      } catch {
        // Next's REST boundary masked uncaught handler errors. Keep internal details private.
        throw mapHttpErrorToMcpError(500, 'HTTP 500: Internal Server Error', requestCorrelationId)
      }
      const text = await response.text()
      let data: unknown = text
      try { data = JSON.parse(text) } catch { /* Match the previous client's non-JSON response handling. */ }
      if (!response.ok) {
        const body = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
        const message = typeof body.message === 'string' && body.message ? body.message
          : typeof body.error === 'string' && body.error ? body.error
            : `HTTP ${response.status}: ${response.statusText || STATUS_CODES[response.status] || ''}`
        throw mapHttpErrorToMcpError(response.status, message, requestCorrelationId, data)
      }
      return data as T
    },
  }
  return { client, auth }
}
