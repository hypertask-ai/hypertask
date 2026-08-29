import { createApiClient } from '../lib/api-client'
import type { IApiClient } from '../types/index'
import { sanitizeResponse } from './serialization'

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

  const service = new ServiceClass(createApiClient(token))
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
}
