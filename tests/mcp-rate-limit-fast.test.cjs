const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest, NextResponse } = require('next/server')
const root = path.resolve(__dirname, '..')
const flagKey = 'htpr-7133-mcp-ratelimit-fast'
const tick = () => new Promise(resolve => setImmediate(resolve))

function load(file, stubs, extras = {}, append = '') {
  const sourcePath = file === 'src/lib/mcp/auth/rateLimit.ts' && process.env.MCP_RATE_LIMIT_TEST_SOURCE
    ? process.env.MCP_RATE_LIMIT_TEST_SOURCE : path.join(root, file)
  const code = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
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

function harness({ mode = 'EVERYONE', initial = 0, env = {}, afterThrows = false, agent = true } = {}) {
  let now = 120_000
  let hold = false
  let checked = false
  let count = initial
  let authCalls = 0
  let flagCalls = 0
  let flagFails = false
  let connectionWait
  let expiryFails = false
  const increments = []
  const expires = []
  const pending = []
  const background = []
  const warnings = []
  class Clock extends Date { static now() { return now } }
  const redis = {
    incr: key => {
      increments.push(key)
      const result = ++count
      return hold ? new Promise((resolve, reject) => pending.push({ resolve, reject, result })) : Promise.resolve(result)
    },
    expire: async (...args) => {
      expires.push(args)
      if (expiryFails) throw new Error('Fixture expiry failure')
      return 1
    },
  }
  const rate = load('src/lib/mcp/auth/rateLimit.ts', {
    'next/server': { NextRequest, NextResponse, after: run => {
      if (afterThrows) throw new Error('No request lifecycle')
      background.push(run)
    } },
    crypto: require('node:crypto'),
    '@/lib/flags/keys': { HTPR_7133_MCP_RATELIMIT_FAST_FLAG: flagKey },
    '@/lib/flags': { featureFlagCandidateUserIds: async (...args) => {
      assert.deepEqual(args, [flagKey], 'flag selection must not use an identity')
      flagCalls++
      if (flagFails) throw new Error('Flag lookup unavailable')
      return mode === 'EVERYONE' ? null : mode === 'OFF' ? [] : [6, 985]
    } },
    '@/lib/redis': { getRedis: async () => {
      const wait = connectionWait
      connectionWait = undefined
      if (wait) await wait
      return redis
    } },
    '@/lib/mcp/rateLimitDecision': decision,
    './session': {
      extractBearerToken: value => value?.replace(/^Bearer /, '') ?? null,
      validateMcpAuth: async () => { authCalls++; return { agentId: agent ? 'fixture-agent' : null } },
    },
    '../operationContext': { getMcpOperationContext: () => checked ? { rateLimitChecked: true } : undefined },
  }, { Date: Clock, process: { env }, console: { warn: (...args) => warnings.push(args) } },
  "module.exports.__counts = typeof localCounts === 'undefined' ? undefined : localCounts;")
  const request = (token = 'fixture-token') => new NextRequest('http://fixture.test/api/mcp/tasks', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return {
    rate, request, increments, expires, pending, background, warnings,
    call: token => rate.checkMcpRateLimit(request(token)),
    hold: () => { hold = true },
    release: (index = 0) => { const [item] = pending.splice(index, 1); item.resolve(item.result) },
    reject: () => { pending.shift().reject(new Error('Fixture Redis failure')) },
    drain: () => Promise.all(background.splice(0).map(run => run())),
    advance: ms => { now += ms },
    jump: value => { count = value },
    setMode: value => { mode = value },
    failFlag: () => { flagFails = true },
    failExpiry: () => { expiryFails = true },
    holdConnection: () => {
      let release
      connectionWait = new Promise(resolve => { release = resolve })
      return () => release()
    },
    setChecked: () => { checked = true },
    stats: () => ({ authCalls, flagCalls }),
  }
}

async function observe(call) {
  let settled = false
  const result = call.then(value => { settled = true; return value })
  await tick()
  return { result, settled }
}

test('first call awaits its INCR and sets expiry before returning', async () => {
  const h = harness()
  h.hold()
  const first = await observe(h.call())
  assert.equal(first.settled, false)
  assert.equal(h.increments.length, 1)
  assert.equal(h.background.length, 0)
  h.release()
  assert.equal(await first.result, null)
  assert.deepEqual(h.expires, [[h.increments[0], 60]])
})

test('later low-count calls return without waiting and increment exactly once per call', async () => {
  const h = harness()
  await h.call()
  h.hold()
  for (let i = 0; i < 4; i++) {
    const next = await observe(h.call())
    assert.equal(next.settled, true)
    assert.equal(await next.result, null)
  }
  assert.equal(h.increments.length, 5)
  assert.equal(h.background.length, 4)
  assert.equal(h.stats().flagCalls, 1, 'flag modes are cached off the hot path')
  while (h.pending.length) h.release()
  await h.drain()
  assert.equal(h.rate.__counts.values().next().value.count, 5)
})

test('unconfirmed calls count toward half-limit and force synchronous fallback', async () => {
  const h = harness({ initial: 58 })
  await h.call() // confirmed 59
  h.hold()
  assert.equal((await observe(h.call())).settled, true) // projected 60
  const threshold = await observe(h.call()) // projected 61
  assert.equal(threshold.settled, false)
  h.release()
  h.release()
  assert.equal(await threshold.result, null)
  await h.drain()
  const next = await observe(h.call())
  assert.equal(next.settled, false, 'confirmed count above 60 always awaits')
  h.release()
  await next.result
})

test('jumping background call is allowed, then the next call awaits and returns unchanged 429', async () => {
  const h = harness()
  await h.call()
  h.jump(699)
  h.hold()
  const jumping = await observe(h.call())
  assert.equal(jumping.settled, true)
  assert.equal(await jumping.result, null)
  h.release()
  await h.drain()
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  h.release()
  const response = await next.result
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('Retry-After'), '60')
  assert.deepEqual(await response.json(), { message: 'Rate limit exceeded. Please slow down and try again shortly.' })
})

test('out-of-order background replies never lower the known shared count', async () => {
  const h = harness()
  await h.call()
  h.hold()
  await h.call()
  h.jump(699)
  await h.call()
  h.release(1)
  await tick()
  h.release()
  await h.drain()
  assert.equal(h.rate.__counts.values().next().value.count, 700)
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  h.release()
  assert.equal((await next.result).status, 429)
})

test('new window drops prior entries and awaits first increment; old replies cannot repopulate it', async () => {
  const h = harness()
  await h.call()
  h.hold()
  await h.call()
  h.advance(60_000)
  h.jump(0)
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  assert.notEqual(h.increments[0], h.increments[2])
  assert.equal(h.rate.__counts.size, 1)
  h.release()
  await h.drain()
  assert.equal(h.rate.__counts.values().next().value.count, undefined)
  h.release()
  assert.equal(await next.result, null)
})

test('a request delayed across the window boundary cannot reinsert an expired entry', async () => {
  const h = harness()
  const connect = h.holdConnection()
  const old = await observe(h.call())
  assert.equal(old.settled, false)
  h.advance(60_000)
  await h.call()
  connect()
  assert.equal(await old.result, null)
  assert.equal(h.rate.__counts.size, 1)
  assert.match([...h.rate.__counts.keys()][0], /:180$/)
})

test('awaited Redis errors and first-count expiry errors retain fail-open behavior', async () => {
  const h = harness()
  h.hold()
  const first = await observe(h.call())
  h.reject()
  assert.equal(await first.result, null)
  assert.equal(h.warnings.length, 1)
  const expiry = harness()
  expiry.failExpiry()
  assert.equal(await expiry.call(), null)
  assert.equal(expiry.warnings.length, 1)
  assert.equal(expiry.rate.__counts.values().next().value.count, undefined)
})

test('background Redis error is swallowed, logged once, and makes the next call await', async () => {
  const h = harness()
  await h.call()
  h.hold()
  assert.equal(await h.call(), null)
  h.reject()
  await h.drain()
  assert.equal(h.warnings.length, 1)
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  h.release()
  assert.equal(await next.result, null)
})

for (const mode of ['OFF', 'OWNER_ONLY', 'OWNER_AND_QA']) {
  test(`${mode} uses the legacy always-await path`, async () => {
    const h = harness({ mode })
    await h.call()
    h.hold()
    const next = await observe(h.call())
    assert.equal(next.settled, false)
    assert.equal(h.background.length, 0)
    h.release()
    assert.equal(await next.result, null)
    assert.equal(h.increments.length, 2)
  })
}

test('flag lookup failure uses always-await and rechecks after the cache expires', async () => {
  const h = harness()
  h.failFlag()
  await h.call()
  h.hold()
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  h.release()
  await next.result
  assert.equal(h.stats().flagCalls, 1)
  h.advance(30_001)
  const retried = await observe(h.call())
  assert.equal(retried.settled, false)
  assert.equal(h.stats().flagCalls, 2)
  h.release()
  await retried.result
})

test('turning the flag off clears stale counts and turning it on awaits a fresh count', async () => {
  const h = harness()
  await h.call()
  h.setMode('OFF')
  h.advance(30_001)
  await h.call()
  assert.equal(h.rate.__counts.size, 0)
  h.setMode('EVERYONE')
  h.advance(30_001)
  h.hold()
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  h.release()
  await next.result
})

test('bounded map evicts old entries conservatively and never stores raw tokens', async () => {
  const h = harness()
  for (let i = 0; i < 1_001; i++) await h.call(`fixture-token-${i}`)
  assert.equal(h.rate.__counts.size, 1_000)
  for (const key of h.rate.__counts.keys()) assert.match(key, /^mcp:ratelimit:[a-f0-9]{64}:120$/)
  h.hold()
  const evicted = await observe(h.call('fixture-token-0'))
  assert.equal(evicted.settled, false)
  assert.equal(h.rate.__counts.size, 1_000)
  h.release()
  await evicted.result
})

test('after registration failure awaits the already-started increment exactly once', async () => {
  const h = harness({ afterThrows: true })
  await h.call()
  h.hold()
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  assert.equal(h.increments.length, 2)
  h.release()
  assert.equal(await next.result, null)
})

test('custom anonymous limit controls the conservative half-limit threshold', async () => {
  const h = harness({ env: { MCP_RATE_LIMIT_PER_MINUTE: '10' }, initial: 3 })
  await h.call()
  h.hold()
  await h.call() // projected 5
  const next = await observe(h.call()) // projected 6
  assert.equal(next.settled, false)
  h.release()
  h.release()
  await next.result
  await h.drain()
})

test('anonymous-tier counts still resolve auth and enforce 120, while agents can reach 600', async () => {
  for (const [agent, limited] of [[false, true], [true, false]]) {
    const h = harness({ agent, initial: 120 })
    const result = await h.call()
    assert.equal(result?.status === 429, limited)
    assert.equal(h.stats().authCalls, 1)
  }
})

test('missing tokens and internally checked calls retain the existing no-increment exemption', async () => {
  const h = harness()
  assert.equal(await h.call(null), null)
  h.setChecked()
  assert.equal(await h.call(), null)
  assert.equal(h.increments.length, 0)
  assert.equal(h.stats().flagCalls, 0)
})

test('flag registry defaults to Everyone and the existing global helper evaluates without a user', async () => {
  const definition = load('src/lib/flags/definitions/htpr-7133-mcp-ratelimit-fast.ts', {}).default
  const flags = load('src/lib/flags.ts', {
    '@/lib/prisma': {}, react: { cache: run => run },
    '@/lib/auth/getSessionUser': {},
    '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: [definition] },
    '@/lib/flags/keys': {},
  })
  assert.equal(definition.key, flagKey)
  assert.equal(definition.kind, 'bugfix')
  assert.ok(definition.releaseRisk.reason)
  assert.equal(flags.defaultFeatureFlagMode(flagKey), 'EVERYONE')
  for (const mode of ['EVERYONE', 'OFF', 'OWNER_ONLY', 'OWNER_AND_QA']) {
    const db = { featureFlag: { findUnique: async () => ({ mode }) }, user: {
      findUnique: () => { throw new Error('Global mode check must not read a user') },
    } }
    assert.equal(await flags.featureFlagCandidateUserIds(flagKey, db) === null, mode === 'EVERYONE')
  }
})
