const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { createJiti } = require('jiti')

const root = path.resolve(__dirname, '..')
const pings = []
let flagOn = true

function stub(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
function source(file, exports) {
  stub(path.join(root, file), exports)
}

class FakeRedis {
  constructor() { this.handlers = {} }
  on(event, handler) { this.handlers[event] = handler; return this }
  async connect() {}
  async subscribe() {}
  async publish() { return 1 }
  async ping() { pings.push(Date.now()); return 'PONG' }
  disconnect() {}
}
stub(require.resolve('ioredis'), { __esModule: true, default: FakeRedis })
source('src/lib/flags.ts', {
  HTPR_7203_MCP_FLAT_SCHEMA_FLAG: 'htpr-7203-mcp-flat-schema',
  isFeatureEnabled: async (key) => key === 'htpr-7220-legacy-sse-keepalive' && flagOn,
})
source('src/lib/aiFeedback/enabled.ts', { aiFeedbackEnabled: async () => false })
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
  return { LEGACY_SSE_KEEPALIVE_MS, read: () => text, pump }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('a quiet legacy SSE stream sends a keep-alive and pings Redis every minute', async (t) => {
  pings.length = 0
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
  assert.equal(pings.length, 2, 'both the subscriber and the publisher are pinged')
  t.mock.timers.tick(60000 * 4)
  await tick()
  assert.equal(stream.read().match(/: keepalive\n\n/g)?.length, 5)
  assert.equal(pings.length, 10)
})

test('with the flag off the stream stays as before', async (t) => {
  pings.length = 0
  flagOn = false
  t.mock.timers.enable({ apis: ['setInterval'] })
  const stream = await openStream(t)
  t.mock.timers.tick(60000 * 6)
  await tick()
  assert.doesNotMatch(stream.read(), /keepalive/)
  assert.equal(pings.length, 0)
})
