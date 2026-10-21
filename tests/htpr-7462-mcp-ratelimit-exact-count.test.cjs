const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest, NextResponse } = require('next/server')
const root = path.resolve(__dirname, '..')
const fastFlagKey = 'htpr-7133-mcp-ratelimit-fast'
const exactCountFlagKey = 'htpr-7462-mcp-ratelimit-exact-count'

function load(file, stubs, extras = {}, append = '') {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', ...Object.keys(extras), code + '\n' + append)(
    mod, mod.exports, name => {
      assert.ok(name in stubs, `Unexpected import ${name}`)
      return stubs[name]
    }, ...Object.values(extras),
  )
  return mod.exports
}

const decision = load('src/lib/mcp/rateLimitDecision.ts', {})

function harness({ mode = 'EVERYONE', agent = false, redisFails = false, flagFails = false, flagLookup } = {}) {
  const store = new Map()
  const writes = []
  const expiries = []
  const flagCalls = []
  const warnings = []
  let now = 120_000
  let checked = false
  class Clock extends Date { static now() { return now } }
  const increment = (key, amount, method) => {
    writes.push({ key, amount, method })
    if (redisFails) throw new Error('Fixture Redis increment failure')
    const count = (store.get(key) ?? 0) + amount
    store.set(key, count)
    return count
  }
  const redis = {
    incr: async key => increment(key, 1, 'incr'),
    incrby: async (key, amount) => increment(key, amount, 'incrby'),
    decrby: async (key, amount) => increment(key, -amount, 'decrby'),
    expire: async (...args) => { expiries.push(args); return 1 },
  }
  const instances = Array.from({ length: 8 }, () => load('src/lib/mcp/auth/rateLimit.ts', {
    'next/server': { NextRequest, NextResponse },
    crypto: require('node:crypto'),
    '@/lib/flags/keys': {
      HTPR_7133_MCP_RATELIMIT_FAST_FLAG: fastFlagKey,
      HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG: exactCountFlagKey,
    },
    '@/lib/flags': { featureFlagCandidateUserIds: async (...args) => {
      assert.equal(args.length, 1, 'global selection must not use an identity')
      const [key] = args
      assert.ok(key === fastFlagKey || key === exactCountFlagKey, 'only known flags are queried')
      flagCalls.push(key)
      if (key === fastFlagKey) return null
      if (flagFails) throw new Error('Fixture flag lookup failure')
      if (flagLookup) await flagLookup()
      return mode === 'EVERYONE' ? null : mode === 'OFF' ? [] : [6, 985]
    } },
    '@/lib/redis': { getRedis: async () => redis },
    '@/lib/mcp/rateLimitDecision': decision,
    './session': {
      extractBearerToken: value => value?.replace(/^Bearer /, '') ?? null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: agent ? 'fixture-agent' : null }),
    },
    '../operationContext': { getMcpOperationContext: () => checked ? { rateLimitChecked: true } : undefined },
  }, { Date: Clock, process: { env: {} }, console: { warn: (...args) => warnings.push(args) } },
  'module.exports.__counts = localCounts;'))
  const request = token => new NextRequest('http://fixture.test/api/mcp/tasks', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return {
    instances, store, writes, expiries, flagCalls, warnings,
    call: (instance = 5, token = 'shared-user-jwt') => instances[instance].checkMcpRateLimit(request(token)),
    advance: ms => { now += ms },
    setMode: value => { mode = value },
    setFlagFails: value => { flagFails = value },
    setChecked: () => { checked = true },
  }
}

async function earlyHoldersIdle(h, limit) {
  assert.equal(h.instances.length, 8)
  let allowed = 0
  for (let instance = 0; instance < 5; instance++) {
    for (let request = 0; request < 2; request++) {
      assert.equal(await h.call(instance), null)
      allowed++
    }
  }
  while (allowed <= limit) {
    const response = await h.call(5)
    if (response) return { allowed, response }
    allowed++
  }
  assert.fail('the next request above the tier limit must be refused')
}

async function assertRefused(response) {
  assert.equal(response.status, 429, 'now refused')
  assert.equal(response.headers.get('Retry-After'), '60')
  assert.deepEqual(await response.json(), {
    message: 'Rate limit exceeded. Please slow down and try again shortly.',
  })
}

test('exact count ON: idle holders allow exactly 120 user requests and request 121 is now refused', async () => {
  const h = harness()
  const { allowed, response } = await earlyHoldersIdle(h, 120)
  assert.equal(allowed, 120)
  await assertRefused(response)
  assert.equal(h.store.size, 1, 'all instances share one token and fixed window')
  assert.equal([...h.store.values()][0], 121)
  assert.equal(h.writes.length, 121)
  assert.ok(h.writes.every(({ method, amount }) => method === 'incr' && amount === 1))
  assert.equal(h.expiries.length, 1)
  assert.equal(h.expiries[0][1], 60)
  assert.ok(h.instances.every(instance => instance.__counts.size === 0), 'no local reservations')
})

test('exact count OFF: idle holders reproduce the early refusal after only 75 user requests', async () => {
  const h = harness({ mode: 'OFF' })
  const { allowed, response } = await earlyHoldersIdle(h, 120)
  assert.equal(allowed, 75)
  assert.ok(allowed < 120)
  await assertRefused(response)
  assert.ok(h.writes.some(({ method }) => method === 'incrby'))
  for (let instance = 0; instance < 5; instance++) {
    assert.equal(h.instances[instance].__counts.values().next().value.reserved, 9)
  }
})

test('exact count ON: agent tier is still allowed 600 requests and request 601 is refused', async () => {
  const h = harness({ agent: true })
  const { allowed, response } = await earlyHoldersIdle(h, 600)
  assert.equal(allowed, 600, 'still allowed: the agent quota is unchanged')
  await assertRefused(response)
  assert.equal(h.writes.length, 601)
  assert.ok(h.writes.every(({ method }) => method === 'incr'))
})

test('exact count ON: Redis increment failure still fails open', async () => {
  const h = harness({ redisFails: true })
  assert.equal(await h.call(), null)
  assert.deepEqual(h.writes.map(({ method }) => method), ['incr'])
  assert.equal(h.warnings.length, 1)
  assert.match(h.warnings[0][0], /failing open/)
})

for (const mode of ['OWNER_ONLY', 'OWNER_AND_QA']) {
  test(`exact count ${mode}: only Everyone enables the global gate`, async () => {
    const h = harness({ mode })
    const { allowed, response } = await earlyHoldersIdle(h, 120)
    assert.equal(allowed, 75)
    await assertRefused(response)
  })
}

test('exact-count lookup failure safely enables exact counting instead of leasing', async () => {
  const h = harness({ flagFails: true })
  const { allowed, response } = await earlyHoldersIdle(h, 120)
  assert.equal(allowed, 120)
  await assertRefused(response)
  assert.ok(h.writes.every(({ method }) => method === 'incr'))
  assert.equal(h.flagCalls.filter(key => key === exactCountFlagKey).length, 6)
})

test('exact-count on and off decisions are cached for 30 seconds and enabling clears reservations', async () => {
  const h = harness({ mode: 'OFF' })
  await h.call()
  await h.call()
  assert.equal(h.instances[5].__counts.values().next().value.reserved, 9)
  h.setMode('EVERYONE')
  h.advance(29_999)
  await h.call()
  assert.equal(h.writes.length, 2)
  assert.equal(h.flagCalls.filter(key => key === exactCountFlagKey).length, 1)
  h.advance(1)
  await h.call()
  assert.equal(h.writes.at(-1).method, 'incr')
  assert.equal(h.instances[5].__counts.size, 0)
  h.setMode('OFF')
  h.advance(29_999)
  await h.call()
  assert.equal(h.instances[5].__counts.size, 0)
  assert.equal(h.flagCalls.filter(key => key === exactCountFlagKey).length, 2)
  h.advance(1)
  await h.call()
  await h.call()
  assert.equal(h.writes.at(-1).method, 'incrby')
  assert.equal(h.flagCalls.filter(key => key === exactCountFlagKey).length, 3)
})

test('concurrent calls after exact-count decision expiry share one lookup and each count exactly once', async () => {
  let lookupWait
  const h = harness({ mode: 'OFF', flagLookup: () => lookupWait })
  assert.equal(await h.call(), null)
  const lookupsBefore = h.flagCalls.filter(key => key === exactCountFlagKey).length
  const writesBefore = h.writes.length
  h.setMode('EVERYONE')
  h.advance(30_000)
  let release
  lookupWait = new Promise(resolve => { release = resolve })
  const calls = Array.from({ length: 20 }, () => h.call())
  await new Promise(resolve => setImmediate(resolve))
  const lookups = h.flagCalls.filter(key => key === exactCountFlagKey).length - lookupsBefore
  const writesWhilePending = h.writes.length
  release()
  assert.deepEqual(await Promise.all(calls), Array(20).fill(null))
  assert.equal(lookups, 1)
  assert.equal(writesWhilePending, writesBefore)
  const writes = h.writes.slice(writesBefore)
  assert.equal(writes.length, 20)
  assert.ok(writes.every(({ method, amount }) => method === 'incr' && amount === 1))
  assert.equal(h.flagCalls.filter(key => key === exactCountFlagKey).length - lookupsBefore, 1)
})

test('failed exact-count lookups are cached ON and retried after 30 seconds', async () => {
  const h = harness({ mode: 'OFF', flagFails: true })
  await h.call()
  h.setFlagFails(false)
  h.advance(29_999)
  await h.call()
  assert.equal(h.flagCalls.length, 1)
  assert.ok(h.writes.every(({ method }) => method === 'incr'))
  h.advance(1)
  await h.call()
  await h.call()
  assert.equal(h.flagCalls.filter(key => key === exactCountFlagKey).length, 2)
  assert.equal(h.writes.at(-1).method, 'incrby')
})

test('missing tokens and rateLimitChecked still skip all counting and flag lookups', async () => {
  const h = harness()
  assert.equal(await h.call(5, null), null)
  h.setChecked()
  assert.equal(await h.call(), null)
  assert.equal(h.writes.length, 0)
  assert.equal(h.flagCalls.length, 0)
})

test('exact-count bugfix defaults to Everyone and is registered through the generated exports', () => {
  const definition = load(`src/lib/flags/definitions/${exactCountFlagKey}.ts`, {}).default
  assert.equal(definition.key, exactCountFlagKey)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
  assert.equal(definition.shippedOn, '2026-10-21')
  assert.equal(definition.description, 'Every MCP call counts once against the per-minute limit, so slots pre-paid by idle server instances no longer refuse light reads early.')
  assert.equal(definition.releaseRisk.risk, 'small')
  assert.ok(definition.releaseRisk.reason)
  const flags = load('src/lib/flags.ts', {
    '@/lib/prisma': {}, react: { cache: run => run },
    '@/lib/auth/getSessionUser': {},
    '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: [definition] },
    '@/lib/flags/keys': {},
  })
  assert.equal(flags.defaultFeatureFlagMode(exactCountFlagKey), 'EVERYONE')
  const generated = fs.readFileSync(path.join(root, 'src/lib/flags/definitions/index.generated.ts'), 'utf8')
  assert.ok(generated.includes(`export { HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG } from "./${exactCountFlagKey}";`))
  const registeredImport = generated.match(/import (flag\d+) from "\.\/htpr-7462-mcp-ratelimit-exact-count";/)
  assert.ok(registeredImport)
  assert.ok(generated.includes(`  ${registeredImport[1]},`))
  assert.match(fs.readFileSync(path.join(root, 'src/lib/flags/keys.ts'), 'utf8'), /export \* from "\.\/definitions\/index\.generated"/)
})
