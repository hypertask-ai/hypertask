const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest, NextResponse } = require('next/server')
const root = path.resolve(__dirname, '..')
const decision = (() => {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/mcp/rateLimitDecision.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => { throw new Error('decision has no imports') })
  return mod.exports
})()

function load(env) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/mcp/auth/rateLimit.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const redisCalls = []
  let now = 120_000
  class Clock extends Date { static now() { return now } }
  new Function('module', 'exports', 'require', 'Date', 'process', code)(
    mod, mod.exports, name => {
      const stubs = {
        'next/server': { NextRequest, NextResponse },
        crypto: require('node:crypto'),
        '@/lib/flags/keys': { HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG: 'htpr-7462-mcp-ratelimit-exact-count' },
        '@/lib/flags': { featureFlagCandidateUserIds: async () => [] },
        '@/lib/redis': { getRedis: async () => {
          redisCalls.push('getRedis')
          return {
            incr: async () => 1,
            incrby: async () => 1,
            decrby: async () => 0,
            expire: async () => 1,
          }
        } },
        '@/lib/mcp/rateLimitDecision': decision,
        './session': {
          extractBearerToken: value => value?.replace(/^Bearer /, '') ?? null,
          validateMcpAuth: async () => { throw new Error('agent path must not authenticate') },
        },
        '../operationContext': { getMcpOperationContext: () => undefined },
      }
      assert.ok(name in stubs, `Unexpected import ${name}`)
      return stubs[name]
    },
    Clock,
    { env },
  )
  const request = token => new NextRequest('http://fixture.test/api/mcp/tasks', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return {
    rate: mod.exports,
    redisCalls,
    call: token => mod.exports.checkMcpRateLimit(request(token)),
  }
}

function agentJwt() {
  const payload = Buffer.from(JSON.stringify({ agentId: 'runner-3' })).toString('base64url')
  return `eyJhbGciOiJub25lIn0.${payload}.sig`
}

test('htk_ and agent JWTs count in memory and never call Redis', async () => {
  const h = load({ MCP_AGENT_RATE_LIMIT_PER_MINUTE: '2' })
  assert.equal(h.rate.agentShapedMcpToken('htk_cli'), true)
  assert.equal(h.rate.agentShapedMcpToken(agentJwt()), true)
  assert.equal(h.rate.agentShapedMcpToken('htmk_human'), false)
  assert.equal(h.rate.agentShapedMcpToken('httk_human'), false)
  assert.equal(h.rate.agentShapedMcpToken('fixture-token'), false)
  for (const token of ['htk_cli', agentJwt()]) {
    assert.equal(await h.call(token), null)
    assert.equal(await h.call(token), null)
    const refused = await h.call(token)
    assert.equal(refused.status, 429)
    assert.equal(refused.headers.get('Retry-After'), '60')
  }
  assert.deepEqual(h.redisCalls, [])
})

test('human bearer tokens still ask Redis', async () => {
  const h = load({})
  assert.equal(await h.call('fixture-token'), null)
  assert.deepEqual(h.redisCalls, ['getRedis'])
})
