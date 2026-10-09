import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import Module from 'node:module'
import path from 'node:path'
import { z } from 'zod'
import Redis from 'ioredis'

const require = createRequire(import.meta.url)
const ts = require('typescript') as typeof import('typescript')
const root = process.cwd()
const token = 'transport-test-token'
const flags = { stateless: false, deferred: false, catalog: false }
const echoCalls: unknown[] = []
const echoTool = {
  name: 'echo',
  description: 'Repeat the text',
  parameters: z.object({ text: z.string() }),
  execute: async (args: unknown, bearer: string, invocation: unknown) => {
    echoCalls.push({ args, bearer, invocation })
    return JSON.stringify({ args, bearer, invocation })
  },
}

// Exercise the actual route, auth wrapper and transports; only product data,
// credential validation and flag storage are replaced with local fixtures.
function loadRoutes() {
  const cache = new Map<string, any>()
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file)
    const javascript = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const loaded = new Module(file) as any
    loaded.filename = file
    loaded.paths = (Module as any)._nodeModulePaths(path.dirname(file))
    loaded.require = (request: string) => {
      if (request === '@/lib/telemetry/mcpSseAnalytics') return { recordLegacyMcpRequest: () => {} }
      if (request === './tools') return { MCP_TOOLS: [echoTool] }
      if (request === './consolidated-tools') return {
        selectMcpTools: (tools: typeof echoTool[], enabled: boolean, caller: { managementPermissions?: unknown } = {}) => {
          if (!enabled) return tools
          const permitted = !caller.managementPermissions
          const execute = async (...args: Parameters<typeof echoTool.execute>) => {
            if (!permitted) throw new Error('This action is not allowed by this credential')
            return echoTool.execute(...args)
          }
          return [
            ...(permitted ? [{ ...echoTool, name: 'consolidated_echo',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
              outputSchema: { type: 'object' }, execute }] : []),
            { ...echoTool, hidden: true, outputSchema: { type: 'object' }, execute },
          ]
        },
      }
      if (request === '@/lib/mcp/auth') return {
        extractBearerToken: (header: string | null) => header?.match(/^Bearer (.+)$/)?.[1] ?? null,
        validateMcpAuth: async (request: Request) => {
          const bearer = request.headers.get('authorization')
          if (bearer === 'Bearer restricted-owner') {
            return { user: { id: 6 }, management: { permissions: { management: ['read'] } } }
          }
          return bearer === `Bearer ${token}` || bearer === 'Bearer another-user'
            ? { user: { id: bearer === `Bearer ${token}` ? 6 : 7 } }
            : null
        },
      }
      if (request === '@/lib/flags') return {
        HTPR_6530_MCP_LIST_QUERY_FLAG: 'list-query',
        HTPR_6531_DEFERRED_MCP_TOOLS_FLAG: 'deferred',
        HTPR_6532_STATELESS_MCP_FLAG: 'stateless',
        HTPR_6804_MCP_TOOLS_FLAG: 'catalog',
        isFeatureEnabled: async (flag: string) => flags[flag as keyof typeof flags] ?? false,
      }
      if (request.startsWith('.') || request.startsWith('@/')) {
        const resolved = request.startsWith('@/')
          ? path.join(root, 'src', request.slice(2))
          : path.resolve(path.dirname(file), request)
        if (existsSync(`${resolved}.ts`)) return load(`${resolved}.ts`)
      }
      return createRequire(file)(request)
    }
    loaded._compile(javascript, file)
    cache.set(file, loaded.exports)
    return loaded.exports
  }
  return {
    sse: load(path.join(root, 'src/app/sse/route.ts')),
    message: load(path.join(root, 'src/app/message/route.ts')),
    mcp: load(path.join(root, 'src/app/mcp/route.ts')),
  }
}

function request(url: string, method = 'GET', body?: unknown, bearer: string | null = token, signal?: AbortSignal) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: {
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-03-26',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal,
  })
}

const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
}

function frames(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  return {
    reader,
    async next() {
      while (!buffered.includes('\n\n')) {
        const chunk = await reader.read()
        assert.equal(chunk.done, false, 'SSE closed unexpectedly')
        buffered += decoder.decode(chunk.value, { stream: true })
      }
      const end = buffered.indexOf('\n\n')
      const frame = buffered.slice(0, end)
      buffered = buffered.slice(end + 2)
      return {
        event: frame.match(/^event: (.+)$/m)?.[1],
        data: frame.match(/^data: (.+)$/m)?.[1]!,
      }
    },
  }
}

async function payload(response: Response) {
  const text = await response.text()
  return JSON.parse(response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').find((line) => line.startsWith('data:'))!.slice(5)
    : text)
}

test('actual routes preserve legacy SSE across instances and support MCP 2 streamable HTTP', { timeout: 60000 }, async (t) => {
  const port = await new Promise<number>((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
  const redisArgs = ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no']
  const nativeRedis = spawnSync('redis-server', ['--version']).status === 0
  const redis = nativeRedis
    ? spawn('redis-server', redisArgs, { signal: t.signal })
    : spawn('docker', ['run', '--rm', '--network', 'host',
      'public.ecr.aws/docker/library/redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf',
      'redis-server', ...redisArgs], { signal: t.signal })
  t.diagnostic(`Redis fixture: ${nativeRedis ? 'local binary' : 'disposable Docker container'}`)
  const previousUrl = process.env.REDIS_URL
  process.env.REDIS_URL = `redis://127.0.0.1:${port}`
  let inspector: Redis | undefined
  const streams: Array<ReturnType<typeof frames>> = []
  try {
    await new Promise<void>((resolve, reject) => {
      let output = ''
      redis.stdout.on('data', (chunk) => {
        output += chunk
        if (output.includes('Ready to accept connections')) resolve()
      })
      redis.once('error', reject)
      redis.once('exit', (code) => reject(new Error(`Redis exited ${code}`)))
    })
    const first = loadRoutes()
    const second = loadRoutes()
    for (const bearer of [null, 'wrong-token']) {
      for (const [route, url, method, body] of [
        [first.sse, '/sse', 'GET', undefined],
        [second.message, '/message?sessionId=unknown', 'POST', initialize],
        [first.mcp, '/mcp', 'POST', initialize],
      ] as const) {
        const response = await route[method](request(url, method, body, bearer))
        assert.equal(response.status, 401)
        assert.match(response.headers.get('www-authenticate')!, /Bearer.*resource_metadata=/)
      }
    }

    for (const enabled of [false, true]) {
      flags.stateless = enabled
      flags.deferred = enabled
      const response = await first.sse.GET(request('/sse'))
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type')!, /text\/event-stream/)
      const stream = frames(response)
      streams.push(stream)
      const endpoint = await stream.next()
      assert.equal(endpoint.event, 'endpoint')
      assert.match(endpoint.data, /^\/message\?sessionId=/)
      const session = new URL(endpoint.data, 'http://localhost').searchParams.get('sessionId')!
      const post = (body: unknown, bearer = token) => second.message.POST(request(endpoint.data, 'POST', body, bearer))
      assert.equal((await post(initialize)).status, 202)
      assert.equal(JSON.parse((await stream.next()).data).result.serverInfo.name, 'hyperTask')
      assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
      assert.equal((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).status, 202)
      const listed = JSON.parse((await stream.next()).data)
      assert.equal(listed.result.tools[0].name, 'echo')
      assert.equal(listed.result.tools[0].inputSchema.properties.text.type, 'string')
      assert.equal((await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'legacy works' } } })).status, 202)
      const called = JSON.parse((await stream.next()).data)
      assert.equal(called.error, undefined)
      const result = JSON.parse(called.result.content[0].text)
      assert.equal(result.args.text, 'legacy works')
      assert.equal(result.bearer, token)
      assert.equal(result.invocation.requestId, '3')
      assert.equal(result.invocation.sessionId, session)
      assert.equal(result.invocation.clientFingerprint.length, 64)
      assert.equal((await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, 'another-user')).status, 403)
      assert.equal((await post({ invalid: true })).status, 400)
      assert.equal((await post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { text: 42 } } })).status, 202)
      const invalid = JSON.parse((await stream.next()).data)
      assert.ok(invalid.error || invalid.result.isError)
      await stream.reader.cancel()
      assert.equal((await post({ jsonrpc: '2.0', id: 6, method: 'tools/list' })).status, 404)
    }

    await t.test('open SSE sessions use the live catalog flag and each relayed credential scope', async () => {
      flags.catalog = true
      const stream = frames(await first.sse.GET(request('/sse')))
      streams.push(stream)
      try {
        const endpoint = await stream.next()
        const session = new URL(endpoint.data, 'http://localhost').searchParams.get('sessionId')!
        const post = (body: unknown, bearer = token) => second.message.POST(request(endpoint.data, 'POST', body, bearer))
        const rpc = async (id: number, method: string, params?: unknown, bearer = token) => {
          assert.equal((await post({ jsonrpc: '2.0', id, method, params }, bearer)).status, 202)
          return JSON.parse((await stream.next()).data)
        }
        assert.equal((await post(initialize)).status, 202)
        await stream.next()
        assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
        const listed = await rpc(10, 'tools/list')
        assert.deepEqual(listed.result.tools.map((tool: { name: string }) => tool.name), ['consolidated_echo'])
        assert.equal(listed.result.tools[0].outputSchema.type, 'object')
        for (const name of ['consolidated_echo', 'echo']) {
          const called = await rpc(11, 'tools/call', { name, arguments: { text: 'flagged works' } })
          assert.equal(called.result.structuredContent.args.text, 'flagged works')
          assert.equal(called.result.structuredContent.invocation.sessionId, session)
          assert.equal(called.result.structuredContent.invocation.requestId, '11')
        }
        flags.catalog = false
        const disabled = await rpc(12, 'tools/list')
        assert.deepEqual(disabled.result.tools.map((tool: { name: string }) => tool.name), ['echo'])
        const callsBeforeDenied = echoCalls.length
        const rejected = await rpc(13, 'tools/call', { name: 'consolidated_echo', arguments: { text: 'must not execute' } })
        assert.ok(rejected.error || rejected.result.isError)
        assert.equal(echoCalls.length, callsBeforeDenied)
        const legacy = await rpc(14, 'tools/call', { name: 'echo', arguments: { text: 'legacy restored' } })
        assert.equal(JSON.parse(legacy.result.content[0].text).args.text, 'legacy restored')
        flags.catalog = true
        assert.deepEqual((await rpc(15, 'tools/list')).result.tools.map((tool: { name: string }) => tool.name), ['consolidated_echo'])
        assert.deepEqual((await rpc(16, 'tools/list', undefined, 'restricted-owner')).result.tools, [])
        for (const name of ['consolidated_echo', 'echo']) {
          const denied = await rpc(17, 'tools/call', { name, arguments: { text: 'restricted' } }, 'restricted-owner')
          assert.ok(denied.error || denied.result.isError)
        }
        assert.equal(echoCalls.length, callsBeforeDenied + 1)
        assert.equal((await post({ jsonrpc: '2.0', id: 18, method: 'tools/list' }, 'another-user')).status, 403)
        assert.equal((await rpc(19, 'tools/call', { name: 'consolidated_echo', arguments: { text: 'owner restored' } })).result.isError, undefined)
      } finally {
        await stream.reader.cancel()
        flags.catalog = false
      }
    })

    flags.stateless = false
    flags.deferred = false
    for (const body of [initialize, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'streamable works' } },
    }]) {
      const response = await second.mcp.POST(request('/mcp', 'POST', body))
      assert.equal(response.status, 200)
      const result = await payload(response)
      assert.equal(result.error, undefined)
      if (body.method === 'tools/list') assert.equal(result.result.tools[0].name, 'echo')
      if (body.method === 'tools/call') {
        const called = JSON.parse(result.result.content[0].text)
        assert.equal(called.args.text, 'streamable works')
        assert.equal(called.bearer, token)
        assert.equal(called.invocation.requestId, '3')
        assert.equal(called.invocation.clientFingerprint.length, 64)
      }
    }
    assert.equal((await second.message.POST(request('/message', 'POST', initialize))).status, 400)
    assert.equal((await first.sse.POST(request('/sse', 'POST', initialize))).status, 405)
    const controller = new AbortController()
    const aborted = frames(await first.sse.GET(request('/sse', 'GET', undefined, token, controller.signal)))
    streams.push(aborted)
    await aborted.next()
    controller.abort()
    assert.equal((await aborted.reader.read()).done, true)
    inspector = new Redis(process.env.REDIS_URL!)
    const clients = await inspector.client('LIST') as string
    assert.equal(clients.trim().split('\n').length, 1, 'Redis subscribers and publishers must be released')
  } finally {
    flags.stateless = false
    flags.deferred = false
    flags.catalog = false
    if (previousUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = previousUrl
    await Promise.all(streams.map((stream) => stream.reader.cancel().catch(() => {})))
    inspector?.disconnect()
    if (redis.pid && redis.exitCode === null && redis.signalCode === null) {
      const stopped = new Promise((resolve) => redis.once('exit', resolve))
      redis.kill('SIGTERM')
      await stopped
    }
  }
})
