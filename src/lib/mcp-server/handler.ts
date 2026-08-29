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

  if (bearerToken.startsWith('htmk_')) {
    const request = new NextRequest(_request.url, {
      method: _request.method,
      headers: _request.headers,
    })
    const ctx = await validateMcpAuth(request, {
      deferManagementPermissionCheck: true,
    })
    if (
      !ctx?.management ||
      !hasAnyManagementPermission(ctx.management.permissions)
    ) return undefined

    return {
      token: bearerToken,
      clientId: String(ctx.user.id),
      scopes: ['mcp:management'],
    }
  }

  const secret = process.env.JWT_SECRET
  if (!secret) return undefined

  try {
    // Mirror validateMcpAuth's acceptance chain (src/lib/mcp/auth.ts): its final
    // fallback verifies signature + any known issuer with NO audience check, so
    // one permissive verify here matches it exactly. OAuth access tokens from the
    // claude.ai connector carry a different audience and MUST pass this gate;
    // strict per-audience auth (+ DB revocation) happens downstream in /api/mcp/*.
    const decoded = jwt.verify(bearerToken, secret, {
      issuer: [
        'hypertasks',
        process.env.JWT_ISSUER || 'hypertask',
        process.env.JWT_ISSUER || 'https://app.hypertask.ai',
      ],
    }) as jwt.JwtPayload

    const clientId =
      typeof decoded.userId === 'number'
        ? String(decoded.userId)
        : typeof decoded.sub === 'string'
          ? decoded.sub
          : undefined
    if (!clientId) return undefined

    return {
      token: bearerToken,
      clientId,
      scopes: ['mcp:full'],
      expiresAt: decoded.exp,
    }
  } catch {
    return undefined
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
