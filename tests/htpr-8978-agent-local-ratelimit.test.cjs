const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { loadModule } = require('./helpers/loadModule.cjs')

function harness(t, { enabled = true } = {}) {
  t.mock.method(Date, 'now', () => 120_000)
  const previousLimit = process.env.MCP_AGENT_RATE_LIMIT_PER_MINUTE
  process.env.MCP_AGENT_RATE_LIMIT_PER_MINUTE = '2'
  t.after(() => {
    if (previousLimit === undefined) delete process.env.MCP_AGENT_RATE_LIMIT_PER_MINUTE
    else process.env.MCP_AGENT_RATE_LIMIT_PER_MINUTE = previousLimit
  })
  const redisCalls = []
  const scopes = []
  let audience
  let checked = false
  const rate = loadModule('src/lib/mcp/auth/rateLimit.ts', {
    '@/lib/flags': {
      isFeatureEnabled: async (key, userId) => {
        assert.equal(key, 'htpr-8978-upstash-traffic')
        assert.equal(userId, 0)
        assert.equal(audience, 'agent', 'the switch must not read the human Redis cache')
        return enabled
      },
      featureFlagCandidateUserIds: async () => [],
    },
    '@/lib/flags/modeCache': {
      withFeatureFlagSnapshot: async (run, scope) => {
        audience = scope
        scopes.push(scope)
        try { return await run() } finally { audience = undefined }
      },
    },
    '@/lib/redis': { getRedis: async () => {
      redisCalls.push('getRedis')
      return {
        incr: async () => 1,
        incrby: async () => 1,
        decrby: async () => 0,
        expire: async () => 1,
      }
    } },
    './session': {
      extractBearerToken: value => value?.replace(/^Bearer /, '') ?? null,
      validateMcpAuth: async () => { throw new Error('low counts must not authenticate') },
    },
    '../operationContext': { getMcpOperationContext: () => checked ? { rateLimitChecked: true } : undefined },
  })
  return {
    rate, redisCalls, scopes,
    checked: () => { checked = true },
    call: token => rate.checkMcpRateLimit(new NextRequest('http://fixture.test/api/mcp/tasks', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })),
  }
}

function agentJwt() {
  const payload = Buffer.from(JSON.stringify({ agentId: 'runner-4' })).toString('base64url')
  return `eyJhbGciOiJub25lIn0.${payload}.sig`
}

test('htk_ and agent JWTs count in memory and never acquire Redis', async t => {
  const h = harness(t)
  for (const token of ['htk_cli', agentJwt()]) {
    assert.equal(await h.call(token), null)
    assert.equal(await h.call(token), null)
    const refused = await h.call(token)
    assert.equal(refused.status, 429)
    assert.equal(refused.headers.get('Retry-After'), '60')
  }
  assert.deepEqual(h.redisCalls, [])
  assert.equal(h.scopes.length, 6)
  t.mock.method(Date, 'now', () => 180_000)
  assert.equal(await h.call('htk_cli'), null, 'a fresh minute restores the allowance')
  assert.deepEqual(h.redisCalls, [])
})

test('human tokens and malformed JWTs keep the shared Redis window', async t => {
  const h = harness(t)
  for (const token of ['htmk_human', 'httk_human', 'fixture-token', 'a.invalid.c']) {
    assert.equal(h.rate.agentShapedMcpToken(token), false)
    assert.equal(await h.call(token), null)
  }
  assert.equal(h.redisCalls.length, 4)
  assert.deepEqual(h.scopes, [])
})

test('flag off restores Redis counting for agent tokens', async t => {
  const h = harness(t, { enabled: false })
  assert.equal(await h.call('htk_cli'), null)
  assert.equal(await h.call(agentJwt()), null)
  assert.equal(h.redisCalls.length, 2)
})

test('missing tokens and already-counted operations skip the flag and Redis', async t => {
  const h = harness(t)
  assert.equal(await h.call(null), null)
  h.checked()
  assert.equal(await h.call('htk_cli'), null)
  assert.deepEqual(h.redisCalls, [])
  assert.deepEqual(h.scopes, [])
})
