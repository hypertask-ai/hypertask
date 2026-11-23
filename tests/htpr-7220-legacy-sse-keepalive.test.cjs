const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { createJiti } = require('jiti')

const root = path.resolve(__dirname, '..')
let flagOn = true

function stub(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
function source(file, exports) {
  stub(path.join(root, file), exports)
}

source('src/lib/flags.ts', {
  HTPR_7203_MCP_FLAT_SCHEMA_FLAG: 'htpr-7203-mcp-flat-schema',
  isFeatureEnabled: async (key) => key === 'htpr-7220-legacy-sse-keepalive' && flagOn,
})
source('src/lib/aiFeedback/automatic.ts', { observeFeedbackTools: (tools) => tools })
source('src/lib/aiFeedback/clientInfo.ts', { rememberFeedbackClient: () => {} })
source('src/lib/mcp-server/stateless-http.ts', {
  handleStatelessMcpRequest: async () => new Response(null, { status: 202 }),
  MCP_SERVER_INFO: { name: 'test', version: '0.0.0' },
})
source('src/lib/mcp-server/consolidated-tools.ts', { selectMcpTools: (tools) => tools })
source('src/lib/mcp/agents/scopes.ts', { getAgentRole: async () => undefined })
source('src/lib/mcp/operationContext.ts', { withMcpExecutionContext: (_token, _ctx, fn) => fn() })

const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})
const { handleLegacySseRequest, LEGACY_SSE_KEEPALIVE_MS } = jiti(path.join(root, 'src/lib/mcp-server/legacy-sse.ts'))

async function openStream(t) {
  process.env.REDIS_URL = 'redis://fake'
  delete globalThis.__hypertaskLegacySseRelay
  delete globalThis.__hypertaskLegacySseRelayLive
  delete globalThis.__hypertaskLegacySsePublisher
  delete globalThis.__hypertaskLegacySsePublisherLive
  delete globalThis.__hypertaskLegacySseRelayDown
  delete globalThis.__hypertaskLegacySseBus
  const ioredisPath = require.resolve('ioredis')
  const previousIoredis = require.cache[ioredisPath]
  const clients = []
  require.cache[ioredisPath] = {
    id: ioredisPath,
    filename: ioredisPath,
    loaded: true,
    exports: {
      default: class {
        constructor() { clients.push(this); this.commands = [] }
        on() { return this }
        connect() { this.commands.push('connect'); return Promise.resolve() }
        subscribe() { this.commands.push('subscribe'); return Promise.resolve() }
        unsubscribe() { return Promise.resolve() }
        publish() { this.commands.push('publish'); return Promise.resolve(0) }
        quit() { return Promise.resolve() }
        disconnect() {}
      },
    },
  }
  t.after(() => {
    if (previousIoredis) require.cache[ioredisPath] = previousIoredis
    else delete require.cache[ioredisPath]
  })
  const abort = new AbortController()
  t.after(() => abort.abort())
  const response = await handleLegacySseRequest(
    new Request('https://app.hypertask.ai/sse', { headers: { accept: 'text/event-stream' }, signal: abort.signal }),
    { clientId: '985', token: 'test', scopes: [] },
    [],
  )
  assert.equal(response.status, 200)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      text += decoder.decode(value)
    }
  })()
  return { LEGACY_SSE_KEEPALIVE_MS, read: () => text, pump, commands: () => clients.flatMap((client) => client.commands) }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('a quiet legacy SSE stream sends a keep-alive every minute without Redis', async (t) => {
  flagOn = true
  t.mock.timers.enable({ apis: ['setInterval'] })
  const stream = await openStream(t)
  assert.equal(stream.LEGACY_SSE_KEEPALIVE_MS, 60000)
  await tick()
  assert.match(stream.read(), /event: endpoint/)
  assert.doesNotMatch(stream.read(), /keepalive/)
  t.mock.timers.tick(60000)
  await tick()
  assert.equal(stream.read().match(/: keepalive\n\n/g)?.length, 1)
  t.mock.timers.tick(60000 * 4)
  await tick()
  assert.equal(stream.read().match(/: keepalive\n\n/g)?.length, 5)
  assert.equal(stream.commands().includes('ping'), false)
  assert.equal(stream.commands().includes('publish'), false)
})

test('with the flag off the stream stays as before', async (t) => {
  flagOn = false
  t.mock.timers.enable({ apis: ['setInterval'] })
  const stream = await openStream(t)
  t.mock.timers.tick(60000 * 6)
  await tick()
  assert.doesNotMatch(stream.read(), /keepalive/)
})
