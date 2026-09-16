import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { MCP_TOOLS } from './tools'
import {
  McpAttachmentRequestBodyError,
  readRequestBytesWithCap,
} from '@/lib/mcp/attachments/readRequestBody'
import { MCP_ATTACHMENT_MAX_REQUEST_BYTES } from '@/lib/mcp/attachments/constants'
import { extractBearerToken, validateMcpAuth } from '@/lib/mcp/auth'
import { hasAnyManagementPermission } from '@/lib/mcp/managementPermissions'
import { HTPR_6532_STATELESS_MCP_FLAG, isFeatureEnabled } from '@/lib/flags'
import { HTPR_6531_DEFERRED_MCP_TOOLS_FLAG } from '@/lib/flags'
import { HTPR_6530_MCP_LIST_QUERY_FLAG } from '@/lib/flags'
import { resolvePortableTools } from './listQueryContract'
import { NextRequest } from 'next/server'
import {
  handleStatelessMcpRequest,
  mcpUnauthorizedResponse,
  MCP_SERVER_INFO,
  type PortableTool,
} from './stateless-http'

function tokenFrom(extra: { authInfo?: AuthInfo }): string {
  const token = extra.authInfo?.token
  if (!token) throw new Error('Missing MCP bearer token')
  return token
}

function bindMcpTools(tools: readonly PortableTool[]) {
  return createMcpHandler(
    (server) => {
      for (const tool of tools) {
        server.tool(tool.name, tool.description, tool.parameters.shape, async (args, extra) => {
          const token = tokenFrom(extra)
          return {
            content: [
              {
                type: 'text',
                text: await tool.execute(
                  args,
                  token,
                  extra.requestId === undefined || extra.requestId === null
                    ? undefined
                    : {
                        requestId: String(extra.requestId),
                        sessionId: extra.sessionId,
                        clientFingerprint: crypto
                          .createHash('sha256')
                          .update(token)
                          .digest('hex'),
                      }
                ),
              },
            ],
          }
        })
      }
    },
    {
      serverInfo: MCP_SERVER_INFO,
    },
    {
      basePath: '',
      redisUrl: process.env.REDIS_URL,
      maxDuration: 800,
      verboseLogs: false,
    }
  )
}

const handler = bindMcpTools(MCP_TOOLS as PortableTool[])
const listQueryHandler = bindMcpTools(resolvePortableTools(MCP_TOOLS as PortableTool[], true))

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

const authenticatedMcpHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
})
const authenticatedListQueryHandler = withMcpAuth(listQueryHandler, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
})

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

/** Bound JSON-RPC transport bytes before the MCP handler parses tool arguments. */
export async function mcpHandler(request: Request): Promise<Response> {
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
    return handleStatelessMcpRequest(working, null, portableTools)
  }

  const bearer = extractBearerToken(working.headers.get('Authorization'))
  const authInfo = await verifyToken(working, bearer ?? undefined)
  if (!authInfo) {
    return mcpUnauthorizedResponse(working)
  }

  const userId = Number(authInfo.clientId)
  const listQueryEnabled =
    Number.isFinite(userId) &&
    (await isFeatureEnabled(HTPR_6530_MCP_LIST_QUERY_FLAG, userId).catch(() => false))
  const portableTools = resolvePortableTools(MCP_TOOLS as PortableTool[], listQueryEnabled)
  const stateless =
    Number.isFinite(userId) &&
    (await isFeatureEnabled(HTPR_6532_STATELESS_MCP_FLAG, userId).catch(() => false))
  const deferred =
    Number.isFinite(userId) &&
    (await isFeatureEnabled(HTPR_6531_DEFERRED_MCP_TOOLS_FLAG, userId).catch(() => false))

  if (stateless) {
    if (deferred) {
      return handleStatelessMcpRequest(working, authInfo, portableTools, { deferred: true })
    }
    return handleStatelessMcpRequest(working, authInfo, portableTools)
  }
  if (deferred) {
    return handleStatelessMcpRequest(working, authInfo, portableTools, { deferred: true })
  }

  return listQueryEnabled
    ? authenticatedListQueryHandler(working)
    : authenticatedMcpHandler(working)
}
