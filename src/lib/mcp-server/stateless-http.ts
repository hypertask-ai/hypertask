import crypto from 'node:crypto'
import { z } from 'zod'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

export const MCP_SERVER_INFO = {
  name: 'hyperTask',
  version: '1.0.0',
} as const

export const STATELESS_PROTOCOL_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
  '2025-03-26',
] as const

export const DEFAULT_PROTOCOL_VERSION = '2025-03-26'

const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'

export type PortableTool = {
  name: string
  description: string
  parameters: z.ZodObject<z.ZodRawShape>
  execute: (
    args: unknown,
    token: string,
    invocation?: { requestId: string; clientFingerprint: string; sessionId?: string }
  ) => Promise<string>
}

export type StatelessMcpAuth = {
  token: string
  clientId: string
}

type JsonRpcId = string | number | null

type JsonRpcMessage = {
  jsonrpc?: unknown
  id?: JsonRpcId
  method?: unknown
  params?: unknown
  result?: unknown
  error?: unknown
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Accept, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version, WWW-Authenticate',
}

export function mcpUnauthorizedResponse(request: Request): Response {
  const resourceUrl = new URL(RESOURCE_METADATA_PATH, request.url).href
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authentication required. Send a bearer token on every request.',
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="hypertask-mcp", error="invalid_token", resource_metadata="${resourceUrl}"`,
      },
    }
  )
}

function protocolVersionFrom(request: Request, requested?: unknown): string {
  if (typeof requested === 'string' && (STATELESS_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested
  }
  const header = request.headers.get('mcp-protocol-version')
  if (header && (STATELESS_PROTOCOL_VERSIONS as readonly string[]).includes(header)) {
    return header
  }
  return DEFAULT_PROTOCOL_VERSION
}

function jsonSchemaFor(parameters: z.ZodType): Record<string, unknown> {
  try {
    const schema = z.toJSONSchema(parameters, { target: 'draft-7' }) as Record<string, unknown>
    delete schema.$schema
    return schema
  } catch {
    return { type: 'object', additionalProperties: true }
  }
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  }
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result }
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNotification(message: JsonRpcMessage): boolean {
  return message.id === undefined && typeof message.method === 'string'
}

function objectParams(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function methodNotAllowed(): Response {
  return new Response('Method not allowed. This MCP server is stateless.', {
    status: 405,
    headers: {
      ...CORS_HEADERS,
      Allow: 'POST, OPTIONS',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

function acceptsSseOnly(accept: string | null): boolean {
  if (!accept) return false
  const wantsSse = accept.includes('text/event-stream')
  const wantsJson = accept.includes('application/json')
  return wantsSse && !wantsJson
}

function respond(
  request: Request,
  body: unknown,
  status: number,
  protocolVersion: string
): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'MCP-Protocol-Version': protocolVersion,
  }
  if (status === 202) {
    return new Response(null, { status, headers })
  }
  const payload = JSON.stringify(body)
  if (acceptsSseOnly(request.headers.get('accept'))) {
    return new Response(`event: message\ndata: ${payload}\n\n`, {
      status,
      headers: {
        ...headers,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  }
  return new Response(payload, {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  })
}

async function dispatchMethod(
  message: JsonRpcMessage,
  request: Request,
  auth: StatelessMcpAuth,
  tools: readonly PortableTool[]
): Promise<unknown> {
  const id = (message.id ?? null) as JsonRpcId
  const method = typeof message.method === 'string' ? message.method : ''
  const params = objectParams(message.params)

  switch (method) {
    case 'initialize': {
      const protocolVersion = protocolVersionFrom(request, params.protocolVersion)
      return jsonRpcResult(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: MCP_SERVER_INFO,
      })
    }
    case 'ping':
      return jsonRpcResult(id, {})
    case 'tools/list':
      return jsonRpcResult(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: jsonSchemaFor(tool.parameters),
        })),
      })
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const tool = tools.find((candidate) => candidate.name === name)
      if (!tool) {
        return jsonRpcError(id, -32602, `Unknown tool: ${name || '(missing)'}`)
      }
      const rawArgs = params.arguments === undefined ? {} : params.arguments
      const parsed = tool.parameters.safeParse(rawArgs)
      if (!parsed.success) {
        return jsonRpcError(id, -32602, 'Invalid tool arguments', parsed.error.flatten())
      }
      const requestId = id === null ? crypto.randomUUID() : String(id)
      try {
        const text = await tool.execute(parsed.data, auth.token, {
          requestId,
          clientFingerprint: crypto.createHash('sha256').update(auth.token).digest('hex'),
        })
        return jsonRpcResult(id, {
          content: [{ type: 'text', text }],
        })
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'Tool failed'
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: messageText }],
          isError: true,
        })
      }
    }
    case 'resources/list':
      return jsonRpcResult(id, { resources: [] })
    case 'resources/templates/list':
      return jsonRpcResult(id, { resourceTemplates: [] })
    case 'prompts/list':
      return jsonRpcResult(id, { prompts: [] })
    case 'logging/setLevel':
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method || '(missing)'}`)
  }
}

export async function handleStatelessMcpRequest(
  request: Request,
  auth: StatelessMcpAuth | AuthInfo | null,
  tools: readonly PortableTool[]
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    if ((request.method === 'GET' || request.method === 'DELETE') && !auth?.token) {
      return mcpUnauthorizedResponse(request)
    }
    return methodNotAllowed()
  }

  if (!auth?.token) return mcpUnauthorizedResponse(request)
  const caller: StatelessMcpAuth = {
    token: auth.token,
    clientId: String(auth.clientId ?? ''),
  }

  const protocolVersion = protocolVersionFrom(request)
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return respond(
      request,
      jsonRpcError(null, -32700, 'Parse error'),
      400,
      protocolVersion
    )
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return respond(
        request,
        jsonRpcError(null, -32600, 'Invalid Request'),
        400,
        protocolVersion
      )
    }
  } else if (!isJsonRpcMessage(parsed)) {
    return respond(
      request,
      jsonRpcError(null, -32600, 'Invalid Request'),
      400,
      protocolVersion
    )
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed]
  const responses: unknown[] = []
  for (const candidate of messages) {
    if (!isJsonRpcMessage(candidate)) {
      responses.push(jsonRpcError(null, -32600, 'Invalid Request'))
      continue
    }
    if (candidate.jsonrpc !== '2.0' || typeof candidate.method !== 'string') {
      if (!isNotification(candidate)) {
        responses.push(jsonRpcError((candidate.id ?? null) as JsonRpcId, -32600, 'Invalid Request'))
      }
      continue
    }
    if (isNotification(candidate)) {
      await dispatchMethod(candidate, request, caller, tools)
      continue
    }
    const result = await dispatchMethod(candidate, request, caller, tools)
    if (result !== null) responses.push(result)
  }

  if (responses.length === 0) {
    return respond(request, null, 202, protocolVersion)
  }

  const firstMessage = messages.find(isJsonRpcMessage)
  return respond(
    request,
    Array.isArray(parsed) ? responses : responses[0],
    200,
    protocolVersionFrom(request, objectParams(firstMessage?.params).protocolVersion)
  )
}
