import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import jwt from 'jsonwebtoken'
import { MCP_TOOLS } from './tools'
import { handleLegacySseRequest, isLegacySseRequest } from './legacy-sse'
import { recordLegacyMcpRequest } from '@/lib/telemetry/mcpSseAnalytics'
import {
  McpAttachmentRequestBodyError,
  readRequestBytesWithCap,
} from '@/lib/mcp/attachments/readRequestBody'
import { MCP_ATTACHMENT_MAX_REQUEST_BYTES } from '@/lib/mcp/attachments/constants'
import { extractBearerToken, validateMcpAuth } from '@/lib/mcp/auth'
import { hasAnyManagementPermission } from '@/lib/mcp/managementPermissions'
import { resolvePortableTools } from './listQueryContract'
import { NextRequest } from 'next/server'
import { handleMcpHttp } from './mcp-http'
import {
  handleStatelessMcpRequest,
  mcpUnauthorizedResponse,
  type PortableTool,
} from './stateless-http'

async function verifyToken(_request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined

  const headers = new Headers(_request.headers)
  headers.set('Authorization', `Bearer ${bearerToken}`)
  const request = new NextRequest(_request.url, {
    method: _request.method,
    headers,
  })
  const ctx = await validateMcpAuth(request, {
    deferManagementPermissionCheck: true,
  })
  if (!ctx) return undefined

  if (ctx.management) {
    if (!hasAnyManagementPermission(ctx.management.permissions)) return undefined
    return {
      token: bearerToken,
      clientId: String(ctx.user.id),
      scopes: ['mcp:management'],
    }
  }

  const decoded = jwt.decode(bearerToken)
  const expiresAt =
    decoded && typeof decoded !== 'string' && typeof decoded.exp === 'number'
      ? decoded.exp
      : undefined
  return {
    token: bearerToken,
    clientId: String(ctx.user.id),
    scopes: ['mcp:full'],
    expiresAt,
  }
}

async function boundMcpRequest(request: Request): Promise<Request> {
  if (request.method !== 'POST' || !request.body) return request
  const body = await readRequestBytesWithCap(
    request,
    MCP_ATTACHMENT_MAX_REQUEST_BYTES
  )
  // Rebuild from the URL instead of using the now-consumed request as the
  // constructor input. The latter works in Undici locally but throws in the
  // Vercel runtime after readRequestBytesWithCap has drained the body.
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

const portableTools = MCP_TOOLS as PortableTool[]
function optionsPortableTools() {
  return portableTools
}

/** Bound JSON-RPC transport bytes before the MCP handler parses tool arguments. */
export async function mcpHandler(request: Request): Promise<Response> {
  const timestamp = new Date()
  let telemetryUserId: number | undefined
  try {
    let working = request
    try {
      working = await boundMcpRequest(request)
    } catch (error) {
      if (!(error instanceof McpAttachmentRequestBodyError)) throw error
      return Response.json(
        {
          jsonrpc: '2.0',
          error: { code: -32600, message: error.message },
          id: null,
        },
        { status: error.status }
      )
    }

    if (working.method === 'OPTIONS') {
      return handleStatelessMcpRequest(working, null, optionsPortableTools())
    }

    const bearer = extractBearerToken(working.headers.get('Authorization'))
    const authInfo = await verifyToken(working, bearer ?? undefined)
    if (!authInfo) {
      return mcpUnauthorizedResponse(working)
    }

    const userId = Number(authInfo.clientId)
    if (Number.isFinite(userId)) telemetryUserId = userId
    const portableTools = resolvePortableTools(MCP_TOOLS as PortableTool[])
    if (isLegacySseRequest(working)) {
      return handleLegacySseRequest(working, authInfo, portableTools)
    }

    return handleMcpHttp(working, {
      authenticate: async () => authInfo,
      tools: portableTools,
    })
  } finally {
    recordLegacyMcpRequest(request, telemetryUserId, timestamp)
  }
}
