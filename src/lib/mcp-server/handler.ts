import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import type { z } from 'zod'
import { MCP_TOOLS } from './tools'
import {
  McpAttachmentRequestBodyError,
  readRequestBytesWithCap,
} from '@/lib/mcp/attachments/readRequestBody'
import { MCP_ATTACHMENT_MAX_REQUEST_BYTES } from '@/lib/mcp/attachments/constants'
import { validateMcpAuth } from '@/lib/mcp/auth'
import { hasAnyManagementPermission } from '@/lib/mcp/managementPermissions'
import { NextRequest } from 'next/server'

type PortableTool = {
  name: string
  description: string
  parameters: z.ZodObject<z.ZodRawShape>
  execute: (
    args: unknown,
    token: string,
    invocation?: { requestId: string; clientFingerprint: string; sessionId?: string }
  ) => Promise<string>
}

function tokenFrom(extra: { authInfo?: AuthInfo }): string {
  const token = extra.authInfo?.token
  if (!token) throw new Error('Missing MCP bearer token')
  return token
}

const handler = createMcpHandler(
  (server) => {
    for (const tool of MCP_TOOLS as PortableTool[]) {
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
    serverInfo: {
      name: 'hyperTask',
      version: '1.0.0',
    },
  },
  {
    basePath: '',
    redisUrl: process.env.REDIS_URL,
    maxDuration: 800,
    verboseLogs: false,
  }
)

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

/** Bound JSON-RPC transport bytes before mcp-handler parses tool arguments. */
export async function mcpHandler(request: Request): Promise<Response> {
  if (request.method !== 'POST' || !request.body) {
    return authenticatedMcpHandler(request)
  }

  try {
    const body = await readRequestBytesWithCap(
      request,
      MCP_ATTACHMENT_MAX_REQUEST_BYTES
    )
    // Rebuild from the URL instead of using the now-consumed request as the
    // constructor input. The latter works in Undici locally but throws in the
    // Vercel runtime after readRequestBytesWithCap has drained the body.
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
      signal: request.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    return authenticatedMcpHandler(boundedRequest)
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
}
