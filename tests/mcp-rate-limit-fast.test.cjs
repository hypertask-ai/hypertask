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

function harness({ mode = 'EVERYONE', initial = 0, env = {}, agent = true, store = new Map() } = {}) {
  let now = 120_000
  let hold = false
  let checked = false
  let authCalls = 0
  let flagCalls = 0
  let flagFails = false
  let connectionWait
  let connectionFails = false
  let expiryFails = false
  const increments = []
  const expires = []
  const pending = []
  const warnings = []
  class Clock extends Date { static now() { return now } }
  const increment = (key, amount, method) => {
    increments.push({ key, amount, method })
    const result = (store.get(key) ?? initial) + amount
    store.set(key, result)
    return hold ? new Promise((resolve, reject) => pending.push({ resolve, reject, result })) : Promise.resolve(result)
  }
  const redis = {
    incr: key => increment(key, 1, 'incr'),
    incrby: (key, amount) => increment(key, amount, 'incrby'),
    expire: async (...args) => {
      expires.push(args)
      if (expiryFails) throw new Error('Fixture expiry failure')
      return 1
    },
  }
  const rate = load('src/lib/mcp/auth/rateLimit.ts', {
    'next/server': { NextRequest, NextResponse },
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
      if (connectionFails) throw new Error('Fixture connection failure')
      return redis
    } },
    '@/lib/mcp/rateLimitDecision': decision,
    './session': {
      extractBearerToken: value => value?.replace(/^Bearer /, '') ?? null,
      validateMcpAuth: async () => { authCalls++; return { agentId: agent ? 'fixture-agent' : null } },
    },
    '../operationContext': { getMcpOperationContext: () => checked ? { rateLimitChecked: true } : undefined },
  }, { Date: Clock, process: { env }, console: { warn: (...args) => warnings.push(args) } },
  `module.exports.__counts = typeof localCounts === 'undefined' ? undefined : localCounts;
  module.exports.__seedCount = (key, count, windowStart) => {
    localWindowStart = windowStart;
    localCounts.set(key, { count, reserved: 0, leasing: false });
  };`)
  const request = (token = 'fixture-token') => new NextRequest('http://fixture.test/api/mcp/tasks', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return {
    rate, request, increments, expires, pending, warnings, store,
    call: token => rate.checkMcpRateLimit(request(token)),
    hold: () => { hold = true },
    release: (index = 0) => { const [item] = pending.splice(index, 1); item.resolve(item.result) },
    reject: () => { pending.shift().reject(new Error('Fixture Redis failure')) },
    advance: ms => { now += ms },
    jump: value => { store.set(increments[0].key, value) },
    count: () => store.get(increments[0].key),
    setMode: value => { mode = value },
    failFlag: () => { flagFails = true },
    failExpiry: () => { expiryFails = true },
    failConnection: () => { connectionFails = true },
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

const state = h => h.rate.__counts.values().next().value

test('first call awaits plain INCR and sets expiry before returning', async () => {
  const h = harness()
  h.hold()
  const first = await observe(h.call())
  assert.equal(first.settled, false)
  assert.deepEqual(h.increments.map(({ method, amount }) => [method, amount]), [['incr', 1]])
  h.release()
  assert.equal(await first.result, null)
  assert.deepEqual(h.expires, [[h.increments[0].key, 60]])
  assert.deepEqual(state(h), { count: 1, reserved: 0, leasing: false })
})

test('second call awaits INCRBY 10, nine prepaid calls skip Redis, then exhaustion awaits again', async () => {
  const h = harness()
  let admitted = 0
  const allow = async result => {
    assert.equal(await result, null)
    admitted++
    assert.ok(h.count() >= admitted, 'Redis has already counted every admitted call')
  }
  await allow(h.call())
  h.hold()
  const lease = await observe(h.call())
  assert.equal(lease.settled, false)
  assert.deepEqual(h.increments.map(({ method, amount }) => [method, amount]), [['incr', 1], ['incrby', 10]])
  h.release()
  await allow(lease.result)
  assert.deepEqual(state(h), { count: 11, reserved: 9, leasing: false })
  for (let i = 0; i < 9; i++) {
    const prepaid = await observe(h.call())
    assert.equal(prepaid.settled, true, 'prepaid calls make no Redis call')
    await allow(prepaid.result)
    assert.equal(h.increments.length, 2)
    assert.equal(state(h).reserved, 8 - i)
  }
  const exhausted = await observe(h.call())
  assert.equal(exhausted.settled, false)
  assert.equal(h.increments.length, 3)
  assert.equal(h.increments[2].method, 'incrby')
  h.release()
  await allow(exhausted.result)
  assert.equal(h.stats().flagCalls, 1, 'flag modes are cached off the hot path')
})

for (const leaseFirst of [true, false]) {
  test(`five concurrent calls preserve one lease and nine reservations with lease reply ${leaseFirst ? 'first' : 'last'}`, async () => {
    const h = harness()
    const hash = require('node:crypto').createHash('sha256').update('fixture-token').digest('hex')
    const key = `mcp:ratelimit:${hash}:120`
    h.rate.__seedCount(key, 0, 120)
    const entry = state(h)
    h.hold()
    let admitted = 0
    const allow = async call => {
      assert.equal(await call, null)
      admitted++
      assert.ok(h.count() >= admitted, 'Redis covers every admitted call')
    }
    const calls = await Promise.all(Array.from({ length: 5 }, () => observe(h.call())))
    assert.ok(calls.every(call => !call.settled), 'every call awaits its own prepayment')
    assert.deepEqual(h.increments.map(({ method, amount }) => [method, amount]), [
      ['incrby', 10], ['incr', 1], ['incr', 1], ['incr', 1], ['incr', 1],
    ])
    assert.equal(entry.leasing, true)
    const replyOrder = leaseFirst ? [0, 4, 3, 2, 1] : [4, 3, 2, 1, 0]
    for (const index of replyOrder) {
      h.release(index === 0 ? 0 : h.pending.length - 1)
      await allow(calls[index].result)
      assert.equal(state(h), entry, 'replies update the original entry in place')
    }
    assert.equal(h.count(), 14)
    assert.deepEqual(entry, { count: 14, reserved: 9, leasing: false })
    for (let i = 0; i < 9; i++) {
      const prepaid = await observe(h.call())
      assert.equal(prepaid.settled, true)
      await allow(prepaid.result)
      assert.equal(h.increments.length, 5, 'all nine reservations survive concurrent replies')
      assert.equal(entry.reserved, 8 - i)
    }
    assert.equal(admitted, 14)
  })
}

test('a call delayed on the Redis connection uses an existing prepaid slot instead of leasing again', async () => {
  const h = harness()
  assert.equal(await h.call(), null)
  const entry = state(h)
  const connect = h.holdConnection()
  const delayed = await observe(h.call())
  assert.equal(delayed.settled, false)
  assert.equal(await h.call(), null)
  assert.equal(entry.reserved, 9)
  connect()
  assert.equal(await delayed.result, null)
  assert.equal(state(h), entry)
  assert.deepEqual(entry, { count: 11, reserved: 8, leasing: false })
  assert.equal(h.increments.length, 2, 'the delayed call made no second lease')
  for (let admitted = 4; admitted <= 11; admitted++) {
    assert.equal(await h.call(), null)
    assert.ok(h.count() >= admitted)
    assert.equal(h.increments.length, 2)
  }
})

test('known count over 50 uses plain INCR and awaits near the limit', async () => {
  const h = harness({ initial: 50 })
  await h.call()
  assert.equal(state(h).count, 51)
  h.hold()
  for (let i = 0; i < 2; i++) {
    const next = await observe(h.call())
    assert.equal(next.settled, false)
    assert.equal(h.increments.at(-1).method, 'incr')
    h.release()
    assert.equal(await next.result, null)
  }
})

test('known count exactly 50 can reserve through half the anonymous limit', async () => {
  const h = harness({ initial: 49 })
  await h.call()
  assert.equal(await h.call(), null)
  assert.equal(h.increments[1].method, 'incrby')
  assert.deepEqual(state(h), { count: 60, reserved: 9, leasing: false })
})

test('shared jump to 699 blocks the lease and every later call synchronously with unchanged 429', async () => {
  const h = harness()
  await h.call()
  h.jump(699)
  h.hold()
  for (let i = 0; i < 3; i++) {
    const next = await observe(h.call())
    assert.equal(next.settled, false)
    assert.equal(h.increments.at(-1).method, i === 0 ? 'incrby' : 'incr')
    h.release()
    const response = await next.result
    assert.equal(response.status, 429)
    assert.equal(response.headers.get('Retry-After'), '60')
    assert.deepEqual(await response.json(), { message: 'Rate limit exceeded. Please slow down and try again shortly.' })
    assert.equal(state(h).reserved, 0)
  }
})

test('two instances sharing Redis admit at most 120 of 130 interleaved anonymous calls, never overshooting', async () => {
  const store = new Map()
  const instances = [harness({ store, agent: false }), harness({ store, agent: false })]
  let admitted = 0
  let blocked = 0
  for (let i = 0; i < 130; i++) {
    const h = instances[i % 2]
    const result = await h.call()
    if (result === null) admitted++
    else { assert.equal(result.status, 429); blocked++ }
    assert.ok(h.count() >= admitted, `shared count covers ${admitted} admitted calls`)
    assert.ok(admitted <= 120)
  }
  assert.ok(admitted >= 120 - 2 * 9, 'only unused prepaid slots may block early')
  assert.ok(blocked >= 10)
  assert.equal(admitted + blocked, 130)
  assert.notEqual(instances[0].rate.__counts, instances[1].rate.__counts)
})

test('raced lease above half-limit creates no reservation and classifies the returned count', async () => {
  const h = harness({ agent: false })
  await h.call()
  h.jump(115)
  assert.equal((await h.call()).status, 429)
  assert.deepEqual(state(h), { count: 125, reserved: 0, leasing: false })
  assert.equal((await h.call()).status, 429)
  assert.equal(h.increments.at(-1).method, 'incr')
})

test('new window clears prepaid reservations and awaits its first plain INCR', async () => {
  const h = harness()
  await h.call()
  await h.call()
  assert.equal(state(h).reserved, 9)
  h.advance(60_000)
  h.hold()
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  assert.notEqual(h.increments[0].key, h.increments[2].key)
  assert.equal(h.increments[2].method, 'incr')
  h.release()
  assert.equal(await next.result, null)
  assert.equal(h.rate.__counts.size, 1)
  assert.deepEqual(state(h), { count: 1, reserved: 0, leasing: false })
  assert.equal(h.expires.length, 2)
})

test('old-window lease replies cannot repopulate reservations in the new window', async () => {
  const h = harness()
  await h.call()
  h.hold()
  const old = await observe(h.call())
  h.advance(60_000)
  const next = await observe(h.call())
  h.release(1)
  assert.equal(await next.result, null)
  h.release()
  assert.equal(await old.result, null)
  assert.equal(h.rate.__counts.size, 1)
  assert.match([...h.rate.__counts.keys()][0], /:180$/)
  assert.deepEqual(state(h), { count: 1, reserved: 0, leasing: false })
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

test('awaited Redis and first-write expiry errors clear entries and fail open', async () => {
  const h = harness()
  await h.call()
  h.hold()
  const lease = await observe(h.call())
  h.reject()
  assert.equal(await lease.result, null)
  assert.equal(h.warnings.length, 1)
  assert.equal(h.rate.__counts.size, 0)
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  assert.equal(h.increments.at(-1).method, 'incr')
  h.release()
  assert.equal(await next.result, null)
  const expiry = harness()
  expiry.failExpiry()
  assert.equal(await expiry.call(), null)
  assert.equal(expiry.warnings.length, 1)
  assert.equal(expiry.rate.__counts.size, 0)
})

test('a failed concurrent INCR deletes the entry and an old lease cannot reserve on its replacement', async () => {
  const h = harness()
  await h.call()
  const original = state(h)
  h.hold()
  const lease = await observe(h.call())
  const single = await observe(h.call())
  assert.equal(original.leasing, true)
  h.pending.splice(1, 1)[0].reject(new Error('Fixture concurrent failure'))
  assert.equal(await single.result, null)
  assert.equal(h.rate.__counts.size, 0)
  const replacement = await observe(h.call())
  assert.equal(h.increments.at(-1).method, 'incr')
  h.release(1)
  assert.equal(await replacement.result, null)
  const entry = state(h)
  assert.notEqual(entry, original)
  h.release()
  assert.equal(await lease.result, null)
  assert.equal(original.leasing, false)
  assert.equal(state(h), entry)
  assert.deepEqual(entry, { count: 13, reserved: 0, leasing: false })
  assert.equal(h.warnings.length, 1)
})

test('connection errors clear known entries and fail open', async () => {
  const h = harness({ initial: 50 })
  await h.call()
  h.failConnection()
  assert.equal(await h.call(), null)
  assert.equal(h.rate.__counts.size, 0)
  assert.equal(h.warnings.length, 1)
})

test('a lease recreating an expired Redis key sets expiry when returned count equals increment', async () => {
  const h = harness()
  await h.call()
  h.store.clear()
  assert.equal(await h.call(), null)
  assert.equal(h.count(), 10)
  assert.equal(h.expires.length, 2)
  assert.deepEqual(state(h), { count: 10, reserved: 9, leasing: false })
})

for (const mode of ['OFF', 'OWNER_ONLY', 'OWNER_AND_QA']) {
  test(`${mode} uses the legacy always-await plain INCR path without reservations`, async () => {
    const h = harness({ mode })
    await h.call()
    h.hold()
    for (let i = 0; i < 3; i++) {
      const next = await observe(h.call())
      assert.equal(next.settled, false)
      assert.equal(h.increments.at(-1).method, 'incr')
      assert.equal(h.rate.__counts.size, 0)
      h.release()
      assert.equal(await next.result, null)
    }
    assert.equal(h.increments.length, 4)
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
  assert.ok(h.increments.every(write => write.method === 'incr'))
})

test('turning the flag off clears reservations and turning it on awaits a fresh count', async () => {
  const h = harness()
  await h.call()
  await h.call()
  assert.equal(state(h).reserved, 9)
  h.setMode('OFF')
  h.advance(30_001)
  await h.call()
  assert.equal(h.increments.at(-1).method, 'incr')
  assert.equal(h.rate.__counts.size, 0)
  h.setMode('EVERYONE')
  h.advance(30_001)
  h.hold()
  const next = await observe(h.call())
  assert.equal(next.settled, false)
  assert.equal(h.increments.at(-1).method, 'incr')
  h.release()
  await next.result
})

for (const waitFor of ['connection', 'increment']) {
  test(`turning the flag off during an awaited ${waitFor} prevents old calls repopulating the cache`, async () => {
    const h = harness()
    await h.call()
    const entry = state(h)
    const connect = waitFor === 'connection' ? h.holdConnection() : undefined
    h.hold()
    const old = await observe(h.call())
    assert.equal(old.settled, false)
    h.setMode('OFF')
    h.advance(30_001)
    const disabled = await observe(h.call())
    assert.equal(h.rate.__counts.size, 0)
    h.release(waitFor === 'increment' ? 1 : 0)
    assert.equal(await disabled.result, null)
    if (connect) {
      connect()
      await tick()
      assert.equal(h.increments.at(-1).method, 'incr')
    }
    h.release()
    assert.equal(await old.result, null)
    assert.equal(entry.leasing, false)
    assert.equal(h.rate.__counts.size, 0)
    const next = await observe(h.call())
    assert.equal(next.settled, false)
    assert.equal(h.increments.at(-1).method, 'incr')
    h.release()
    assert.equal(await next.result, null)
  })
}

test('bounded map evicts reservations conservatively and never stores raw tokens', async () => {
  const h = harness()
  await h.call('fixture-token-0')
  await h.call('fixture-token-0')
  for (let i = 1; i < 1_001; i++) await h.call(`fixture-token-${i}`)
  assert.equal(h.rate.__counts.size, 1_000)
  for (const key of h.rate.__counts.keys()) assert.match(key, /^mcp:ratelimit:[a-f0-9]{64}:120$/)
  h.hold()
  const evicted = await observe(h.call('fixture-token-0'))
  assert.equal(evicted.settled, false)
  assert.equal(h.increments.at(-1).method, 'incr')
  h.release()
  await evicted.result
  assert.equal(h.rate.__counts.size, 1_000)
})

test('an evicted in-flight lease cannot attach reservations to a replacement entry', async () => {
  const h = harness()
  for (let i = 0; i < 1_000; i++) await h.call(`fixture-token-${i}`)
  const key = h.increments[0].key
  const original = h.rate.__counts.get(key)
  h.hold()
  const lease = await observe(h.call('fixture-token-0'))
  assert.equal(original.leasing, true)
  const overflow = await observe(h.call('fixture-overflow'))
  h.release(1)
  assert.equal(await overflow.result, null)
  assert.equal(h.rate.__counts.has(key), false)
  const replacement = await observe(h.call('fixture-token-0'))
  assert.equal(h.increments.at(-1).method, 'incr')
  h.release(1)
  assert.equal(await replacement.result, null)
  const entry = h.rate.__counts.get(key)
  h.release()
  assert.equal(await lease.result, null)
  assert.equal(original.leasing, false)
  assert.notEqual(entry, original)
  assert.equal(h.rate.__counts.get(key), entry)
  assert.deepEqual(entry, { count: 12, reserved: 0, leasing: false })
  assert.equal(h.rate.__counts.size, 1_000)
})

test('custom anonymous limit controls whether a ten-slot lease fits below half-limit', async () => {
  for (const [limit, expected] of [['10', 'incr'], ['22', 'incrby']]) {
    const h = harness({ env: { MCP_RATE_LIMIT_PER_MINUTE: limit } })
    await h.call()
    h.hold()
    const next = await observe(h.call())
    assert.equal(next.settled, false)
    assert.equal(h.increments[1].method, expected)
    h.release()
    assert.equal(await next.result, null)
  }
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
