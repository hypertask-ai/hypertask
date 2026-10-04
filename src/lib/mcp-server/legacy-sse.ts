import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { ServerResponse } from 'node:http'
import { PassThrough, Readable } from 'node:stream'
import crypto from 'node:crypto'
import Redis from 'ioredis'
import { handleStatelessMcpRequest, MCP_SERVER_INFO, type PortableTool } from './stateless-http'
import { selectMcpTools } from './consolidated-tools'
import { HTPR_6804_MCP_TOOLS_FLAG, isFeatureEnabled } from '@/lib/flags'
import type { ManagementPermissions } from '@/lib/mcp/managementPermissions'

type RelayMessage = {
  replyChannel: string
  body: unknown
  authInfo: AuthInfo
}

function redisConnection(url: string) {
  return new Redis(url, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  })
}

export function isLegacySseRequest(request: Request): boolean {
  return ['/sse', '/message'].includes(new URL(request.url).pathname)
}

/** Redis routes POSTs to the instance holding the original SSE connection. */
export async function handleLegacySseRequest(
  request: Request,
  authInfo: AuthInfo,
  tools: readonly PortableTool[]
): Promise<Response> {
  const url = new URL(request.url)
  const isStream = url.pathname === '/sse'
  if (request.method !== (isStream ? 'GET' : 'POST')) {
    return new Response('Method Not Allowed', { status: 405 })
  }
  if (isStream) {
    const accept = request.headers.get('accept')
    if (accept && !['text/event-stream', '*/*', 'text/*'].some((type) => accept.includes(type))) {
      return new Response('Not Acceptable', { status: 406 })
    }
  }
  const sessionId = url.searchParams.get('sessionId')
  if (!isStream && !sessionId) {
    return new Response('No sessionId provided', { status: 400 })
  }
  if (!isStream && !request.headers.get('content-type')?.split(';')[0].trim().includes('application/json')) {
    return new Response('Expected application/json', { status: 400 })
  }
  let body: unknown
  if (!isStream) {
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
  }
  const redisUrl = process.env.REDIS_URL ?? process.env.KV_URL
  if (!redisUrl) return new Response('Legacy SSE requires Redis', { status: 503 })
  const subscriber = redisConnection(redisUrl)
  const publisher = redisConnection(redisUrl)
  const disconnect = () => {
    subscriber.disconnect()
    publisher.disconnect()
  }
  try {
    await Promise.all([subscriber.connect(), publisher.connect()])
    if (!isStream) {
      const replyChannel = `mcp:legacy:reply:${crypto.randomUUID()}`
      let timer: ReturnType<typeof setTimeout> | undefined
      let aborted: (() => void) | undefined
      try {
        let settle!: (response: Response) => void
        const response = new Promise<Response>((resolve) => { settle = resolve })
        subscriber.on('message', (channel, message) => {
          if (channel !== replyChannel) return
          try {
            const result = JSON.parse(message) as { status: number; body: string }
            settle(new Response(result.body, { status: result.status }))
          } catch {
            settle(new Response('Invalid relay response', { status: 502 }))
          }
        })
        await subscriber.subscribe(replyChannel)
        timer = setTimeout(() => settle(new Response('Request timed out', { status: 408 })), 10000)
        aborted = () => settle(new Response('Request cancelled', { status: 408 }))
        request.signal.addEventListener('abort', aborted, { once: true })
        if (request.signal.aborted) aborted()
        else {
          const listeners = await publisher.publish(`mcp:legacy:session:${sessionId}`, JSON.stringify({
            replyChannel, body, authInfo,
          } satisfies RelayMessage))
          if (!listeners) settle(new Response('SSE session not found', { status: 404 }))
        }
        return await response
      } finally {
        if (timer) clearTimeout(timer)
        if (aborted) request.signal.removeEventListener('abort', aborted)
        disconnect()
      }
    }

    const stream = new PassThrough()
    // The SDK only needs the Node response's writeHead/write/end/close surface.
    const response = Object.assign(stream, { writeHead: () => response })
    const transport = new SSEServerTransport('/message', response as unknown as ServerResponse)
    const server = new McpServer(MCP_SERVER_INFO)
    for (const tool of tools) {
      server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: tool.parameters,
      }, async (args, extra) => {
        const token = extra.authInfo?.token
        if (!token) throw new Error('Missing MCP bearer token')
        return {
          content: [{ type: 'text', text: await tool.execute(args, token, {
            requestId: String(extra.requestId),
            sessionId: transport.sessionId,
            clientFingerprint: crypto.createHash('sha256').update(token).digest('hex'),
          }) }],
        }
      })
    }
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (closed) return
      closed = true
      if (timer) clearTimeout(timer)
      request.signal.removeEventListener('abort', cleanup)
      disconnect()
      void server.close().catch(() => {})
      stream.destroy()
    }
    stream.once('close', cleanup)
    stream.once('error', cleanup)
    request.signal.addEventListener('abort', cleanup, { once: true })
    subscriber.on('error', cleanup)
    publisher.on('error', cleanup)
    const channel = `mcp:legacy:session:${transport.sessionId}`
    subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel !== channel || closed) return
      void (async () => {
        const incoming = JSON.parse(message) as RelayMessage
        let status = 202
        let result = 'Accepted'
        if (incoming.authInfo.clientId !== authInfo.clientId) {
          status = 403
          result = 'SSE session belongs to another user'
        } else {
          try {
            const method = (incoming.body as { method?: unknown } | null)?.method
            const userId = Number(incoming.authInfo.clientId)
            const enabled = (method === 'tools/list' || method === 'tools/call') &&
              Number.isFinite(userId) && await isFeatureEnabled(HTPR_6804_MCP_TOOLS_FLAG, userId)
            if (enabled) {
              // Resolve per message; flag changes and same-owner credentials must not reuse the opening scope.
              const catalog = selectMcpTools(tools, true, {
                managementPermissions: incoming.authInfo.extra?.managementPermissions as ManagementPermissions | undefined,
                teamScoped: incoming.authInfo.extra?.teamScoped === true,
                agent: incoming.authInfo.extra?.agent === true,
              })
              const rpcResponse = await handleStatelessMcpRequest(new Request('http://localhost/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(incoming.body),
              }), incoming.authInfo, catalog, { sessionId: transport.sessionId })
              if (rpcResponse.status !== 202) await transport.send(await rpcResponse.json())
            } else {
              await transport.handleMessage(incoming.body, { authInfo: incoming.authInfo })
            }
          } catch {
            status = 400
            result = 'Invalid message'
          }
        }
        await publisher.publish(incoming.replyChannel, JSON.stringify({ status, body: result }))
      })().catch(() => cleanup())
    })
    try {
      await subscriber.subscribe(channel)
      await server.connect(transport)
      timer = setTimeout(cleanup, 800 * 1000)
      if (request.signal.aborted) cleanup()
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      })
    } catch (error) {
      cleanup()
      throw error
    }
  } catch {
    disconnect()
    return new Response('Legacy SSE service unavailable', { status: 503 })
  }
}
