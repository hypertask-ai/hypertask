import { NextRequest } from 'next/server'
import { validateMcpAuth } from '@/lib/mcp/auth'
import { createDirectOperationClient } from '@/lib/mcp/directOperationClient'
import { getMcpExecutionContext, withMcpExecutionContext } from '@/lib/mcp/operationContext'
import type { IApiClient } from '../types/index'
import { sanitizeResponse } from './serialization'

const OPERATION_ORIGIN = 'http://mcp.internal'

export async function executeWithService<
  TService extends Record<string, any>,
  TArgs = unknown,
  TResult = unknown,
>(
  token: unknown,
  ServiceClass: new (apiClient: IApiClient) => TService,
  serviceMethod: keyof TService | ((service: TService, args: TArgs) => Promise<TResult>),
  args: TArgs
): Promise<string> {
  if (typeof token !== 'string' || !token) {
    throw new Error('Missing MCP bearer token')
  }

  const auth = getMcpExecutionContext(token) ?? await validateMcpAuth(
    new NextRequest(`${OPERATION_ORIGIN}/mcp`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    { deferManagementPermissionCheck: true },
  )
  if (!auth) throw new Error('Unauthorized. Invalid or missing authentication token.')

  const client = createDirectOperationClient(token, auth)
  return withMcpExecutionContext(token, auth, async () => {
    const service = new ServiceClass(client)
    let result: TResult

    if (typeof serviceMethod === 'function') {
      result = await serviceMethod(service, args)
    } else {
      const method = service[serviceMethod]
      if (typeof method !== 'function') {
        throw new Error(`Method ${String(serviceMethod)} does not exist on service`)
      }
      result = await method.call(service, args)
    }

    return JSON.stringify(sanitizeResponse(result))
  })
}
