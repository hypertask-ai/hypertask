import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { extractBearerToken } from '@/lib/mcp/auth'
import {
  handleStatelessMcpRequest,
  mcpUnauthorizedResponse,
  type PortableTool,
  type StatelessMcpAuth,
} from './stateless-http'

type McpHttpAuth = StatelessMcpAuth | AuthInfo

/** OPTIONS is CORS and has no session. POST/GET/DELETE follow htpr-6532-stateless-mcp. */
export function usesStatelessMcpTransport(method: string, flagOn: boolean): boolean {
  return method === 'OPTIONS' || flagOn
}

export type McpHttpDeps = {
  authenticate: (
    request: Request,
    bearerToken?: string
  ) => Promise<McpHttpAuth | null | undefined>
  tools: readonly PortableTool[]
  deferredEnabled?: (userId: number) => Promise<boolean>
}

export async function handleMcpHttp(
  request: Request,
  deps: McpHttpDeps
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return handleStatelessMcpRequest(request, null, deps.tools)
  }

  const bearer = extractBearerToken(request.headers.get('Authorization'))
  const authInfo = await deps.authenticate(request, bearer ?? undefined)
  if (!authInfo?.token) {
    return mcpUnauthorizedResponse(request)
  }

  const userId = Number(authInfo.clientId)
  const deferred =
    Number.isFinite(userId) &&
    Boolean(await deps.deferredEnabled?.(userId).catch(() => false))

  return handleStatelessMcpRequest(
    request,
    authInfo,
    deps.tools,
    deferred ? { deferred: true } : {}
  )
}
