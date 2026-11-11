const test = require('node:test')
const assert = require('node:assert/strict')
const { loader } = require('./htpr-6927-fixtures.cjs')
const { load } = require('./helpers/flag-files.cjs')
const { stubFlags } = load('tests/helpers/flags.ts')

const CACHE_FLAG = 'htpr-7042-neon-work-avoidance'
const TEST_FLAG = 'htpr-7203-mcp-flat-schema'

function harness() {
  let load
  let mode = 'EVERYONE'
  let snapshots = 0
  const redisCalls = []
  const authScopes = []
  const overrides = {
    react: { cache: fn => fn },
    '@/lib/flags/definitions': stubFlags({
      [CACHE_FLAG]: { defaultMode: 'EVERYONE' },
      [TEST_FLAG]: { defaultMode: 'EVERYONE' },
    }),
    '@/lib/prisma': { __esModule: true, default: {
      featureFlag: {
        findMany: async () => { snapshots++; return [{ key: CACHE_FLAG, mode: 'EVERYONE' }, { key: TEST_FLAG, mode }] },
        findUnique: async ({ where }) => ({ mode: where.key === TEST_FLAG ? mode : 'EVERYONE' }),
      },
      user: { findUnique: async () => ({ email: 'member@example.com' }) },
      agent: { findUnique: async () => ({ permissions: { role: 'write' } }) },
    } },
    '@/lib/redis': { getRedis: async () => {
      redisCalls.push('connect')
      return {
        mget: async () => { redisCalls.push('mget'); return [null, null, null] },
        eval: async () => { redisCalls.push('eval'); return 'OK' },
      }
    } },
    './tools': { MCP_TOOLS: [] },
    './board-access-catalog': { boardAccessCatalog: async tools => tools },
    './tools/agent-presence.tool': { getAgentPresenceTool: async () => ({ name: 'presence' }) },
    './tools/chat-inbox.tool': { appendAgentChatTools: async tools => tools },
    './utils/actAsAgentCatalog': { actAsAgentAvailable: async () => false },
    './listQueryContract': { resolvePortableTools: tools => tools },
    './consolidated-tools': { selectMcpTools: tools => tools },
    '@/lib/aiFeedback/automatic': { observeFeedbackTools: tools => tools, queueAiFeedback: () => {}, queueMcpAuthFailure: () => {} },
    '@/lib/telemetry/mcpSseAnalytics': { recordLegacyMcpRequest: () => {} },
    '@/lib/mcp/auth': {
      extractBearerToken: value => value?.replace(/^Bearer /, '') ?? null,
      validateMcpAuth: async request => {
        authScopes.push(load('src/lib/flags/modeCache.ts').flagModeScope.getStore())
        await load('src/lib/flags.ts').isFeatureEnabled(TEST_FLAG, 7)
        return request.headers.get('Authorization') === 'Bearer valid' ? { user: { id: 7 }, agentId: 'agent-fixture' } : null
      },
    },
    './legacy-sse': {
      isLegacySseRequest: request => ['/sse', '/message'].includes(new URL(request.url).pathname),
      handleLegacySseRequest: async () => Response.json({ enabled: await load('src/lib/flags.ts').isFeatureEnabled(TEST_FLAG, 7) }),
    },
    './mcp-http': { handleMcpHttp: async () => Response.json({ enabled: await load('src/lib/flags.ts').isFeatureEnabled(TEST_FLAG, 7) }) },
  }
  load = loader(overrides)
  const { mcpHandler } = load('src/lib/mcp-server/handler.ts')
  const cache = load('src/lib/flags/modeCache.ts')
  return {
    redisCalls, authScopes, cache,
    snapshots: () => snapshots,
    setMode: value => { mode = value; cache.clearProcessFlagCache() },
    humanFlag: () => load('src/lib/flags.ts').isFeatureEnabled(TEST_FLAG, 7),
    call: (endpoint = '/mcp', token = 'valid', method = 'POST') => mcpHandler(new Request(`https://fixture.invalid${endpoint}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) } : {}),
    })),
  }
}

test.beforeEach(t => {
  const previous = process.env.REDIS_URL
  process.env.REDIS_URL = 'redis://fixture.invalid'
  t.after(() => { if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous })
})

for (const endpoint of ['/mcp', '/sse', '/message']) {
  test(`${endpoint}: cold authentication and catalog flags never acquire Redis; requests receive fresh snapshots`, async () => {
    const h = harness()
    assert.equal((await h.call(endpoint)).status, 200)
    h.setMode('OFF')
    const response = await h.call(endpoint)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { enabled: false })
    assert.deepEqual(h.redisCalls, [])
    assert.equal(h.snapshots(), 2)
    assert.equal(h.authScopes.length, 2)
    assert.equal(h.authScopes[0].audience, 'agent')
    assert.equal(h.authScopes[1].audience, 'agent')
    assert.notEqual(h.authScopes[0], h.authScopes[1])
    assert.equal(h.cache.flagModeScope.getStore(), undefined)
  })
}

test('human flag reads still use the shared cache; the zero-command agent check has a positive control', async () => {
  const h = harness()
  assert.equal(await h.humanFlag(), true)
  assert.deepEqual(h.redisCalls, ['connect', 'mget', 'eval'])
  h.redisCalls.length = 0
  h.setMode('EVERYONE')
  assert.deepEqual(await (await h.call()).json(), { enabled: true })
  assert.deepEqual(h.redisCalls, [])
})

test('a rejected bearer retains its 401 challenge and does not leak the agent snapshot', async () => {
  const h = harness()
  const response = await h.call('/mcp', 'rejected')
  assert.equal(response.status, 401)
  assert.match(response.headers.get('WWW-Authenticate'), /invalid_token/)
  assert.equal(h.authScopes[0].audience, 'agent')
  assert.equal(h.cache.flagModeScope.getStore(), undefined)
  assert.deepEqual(h.redisCalls, [])
})

test('an MCP request nested in a human snapshot cannot inherit its cache audience', async () => {
  const h = harness()
  await h.cache.withFeatureFlagSnapshot(async () => {
    const human = h.cache.flagModeScope.getStore()
    assert.deepEqual(await (await h.call()).json(), { enabled: true })
    assert.equal(h.cache.flagModeScope.getStore(), human)
    assert.equal(human.audience, undefined)
  })
  assert.deepEqual(h.redisCalls, [])
})
