const test = require('node:test')
// Built at runtime so secret scanners do not read fixtures as credentials.
const PG = ['postgres', '//'].join(':')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Client } = require('pg')
const { load } = require('./task-route-loader.cjs')
const root = path.resolve(__dirname, '..')
const { normalizeDbConnectionString } = load('src/lib/dbConnectionString.ts', {})
const tick = () => new Promise(resolve => setImmediate(resolve))

function env(t, values) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

for (const mode of ['prefer', 'require', 'verify-ca']) {
  test(`SSL ${mode} becomes verify-full without re-encoding other URL bytes`, () => {
    const url = `${PG}p%40ss@EXAMPLE.test:5432/db?application_name=a%20b&sslmode=${mode}&options=x%2fy#fragment`
    assert.equal(normalizeDbConnectionString(url), url.replace(`sslmode=${mode}`, 'sslmode=verify-full'))
  })
}

test('unaffected SSL modes and every explicit libpq compatibility URL stay byte-identical', () => {
  for (const query of ['', '?application_name=a%20b', '?sslmode=disable', '?sslmode=no-verify', '?sslmode=verify-full', '?sslmode=unknown', '?sslmode=', '?sslmode=REQUIRE', '?sslmode=require&uselibpqcompat=true', '?uselibpqcompat=false&sslmode=prefer', '?sslmode=verify-ca&uselibpqcompat', '?use%6cibpqcompat=&sslmode=require']) {
    const url = `${PG}fake@EXAMPLE.test/db${query}`
    assert.equal(normalizeDbConnectionString(url), url)
  }
  assert.equal(normalizeDbConnectionString(undefined), undefined)
  assert.equal(normalizeDbConnectionString(''), '')
  assert.equal(normalizeDbConnectionString(`${PG}fake@host/db#fragment?sslmode=require`), `${PG}fake@host/db#fragment?sslmode=require`)
  assert.equal(normalizeDbConnectionString(`${PG}fake@host/db?ssl%6dode=re%71uire&keep=a+b`), `${PG}fake@host/db?ssl%6dode=verify-full&keep=a+b`)
})

test('pg parser preserves original SSL config and rewritten URLs emit no warning events', async () => {
  const warnings = []
  const onWarning = warning => warnings.push(warning.message)
  process.on('warning', onWarning)
  try {
    for (const mode of ['prefer', 'require', 'verify-ca']) {
      const file = require.resolve('pg-connection-string')
      delete require.cache[file]
      const { parse } = require('pg-connection-string')
      const url = `${PG}fake@example.test/db?sslmode=${mode}`
      const original = parse(url)
      await tick()
      assert.match(warnings.at(-1), /SECURITY WARNING: The SSL modes/)
      warnings.length = 0
      delete require.cache[file]
      const rewritten = require('pg-connection-string').parse(normalizeDbConnectionString(url))
      await tick()
      assert.deepEqual(rewritten.ssl, original.ssl)
      assert.deepEqual(warnings, [])
    }
  } finally {
    process.off('warning', onWarning)
  }
})

test('Prisma passes the normalized fake DATABASE_URL into its timing pool', t => {
  env(t, { DATABASE_URL: `${PG}fake@example.test/db?sslmode=require`, NODE_ENV: 'test' })
  const previous = globalThis.prismaGlobal
  delete globalThis.prismaGlobal
  let config
  try {
    load('src/lib/prisma.ts', {
      '@prisma/client': { PrismaClient: class { $extends() { return this } } },
      '@prisma/adapter-pg': { PrismaPg: class {} },
      '@/lib/apiKeyExpiry': {}, '@/lib/queryCountTracker': {},
      '@/lib/mcp/dbTiming': { createMcpTimingPool: value => { config = value; return {} } },
    })
    assert.equal(config.connectionString, `${PG}fake@example.test/db?sslmode=verify-full`)
  } finally {
    if (previous === undefined) delete globalThis.prismaGlobal
    else globalThis.prismaGlobal = previous
  }
})

for (const failure of ['none', 'rejection', 'throw']) {
  test(`one TimingClient serializes three concurrent promises and survives ${failure}`, async t => {
    const events = [], warnings = [], active = new WeakSet()
    const results = [{ rows: [1] }, { rows: [2] }, { rows: [3] }]
    const error = new Error('fake query failure')
    t.mock.method(process, 'emitWarning', message => warnings.push(message))
    t.mock.method(Client.prototype, 'query', function (index) {
      if (active.has(this)) process.emitWarning('Calling client.query() when the client is already executing a query is deprecated')
      if (index === 1 && failure === 'throw') throw error
      active.add(this)
      events.push(`start:${index}`)
      return tick().then(() => {
        events.push(`end:${index}`)
        active.delete(this)
        if (index === 1 && failure === 'rejection') throw error
        return results[index]
      })
    })
    // Positive control: the underlying unwrapped client warns on overlapping calls.
    const plain = new Client()
    await Promise.allSettled([plain.query(0), plain.query(2)])
    assert.match(warnings[0], /Calling client.query\(\)/)
    events.length = 0
    warnings.length = 0
    const { createMcpTimingPool } = load('src/lib/mcp/dbTiming.ts', {})
    const pool = createMcpTimingPool({})
    const client = new pool.Client()
    const settled = await Promise.allSettled([client.query(0), client.query(1), client.query(2)])
    assert.deepEqual(events, failure === 'throw'
      ? ['start:0', 'end:0', 'start:2', 'end:2']
      : ['start:0', 'end:0', 'start:1', 'end:1', 'start:2', 'end:2'])
    assert.equal(settled[0].value, results[0])
    assert.equal(settled[2].value, results[2])
    if (failure === 'none') assert.equal(settled[1].value, results[1])
    else assert.equal(settled[1].reason, error)
    assert.deepEqual(warnings, [])
    await pool.end()
  })
}

test('callback and Submittable queries pass through synchronously with exact arguments and return values', async t => {
  const calls = [], sentinel = {}
  t.mock.method(Client.prototype, 'query', function (...args) { calls.push([this, args]); return sentinel })
  const pool = load('src/lib/mcp/dbTiming.ts', {}).createMcpTimingPool({})
  const client = new pool.Client()
  const callback = () => {}
  const stream = { submit() {} }
  for (const args of [['select 1', callback], ['select $1', [1], callback], [stream]]) {
    assert.equal(client.query(...args), sentinel)
    assert.equal(calls.at(-1)[0], client)
    assert.deepEqual(calls.at(-1)[1], args)
  }
  await pool.end()
})

test('different TimingClients can still run in parallel', async t => {
  let started = 0
  t.mock.method(Client.prototype, 'query', () => { started++; return tick() })
  const pool = load('src/lib/mcp/dbTiming.ts', {}).createMcpTimingPool({})
  const first = new pool.Client(), second = new pool.Client()
  const pending = [first.query('one'), second.query('two')]
  await Promise.resolve()
  assert.equal(started, 2)
  await Promise.all(pending)
  await pool.end()
})

for (const outcome of ['gone', 'pending', 'error', 'missing']) {
  test(`QStash cancellation ${outcome} uses quiet bulk cancel and clears the saved message`, async t => {
    env(t, { QSTASH_TOKEN: 'fake-token', QSTASH_URL: 'https://queue.example.test', QSTASH_CALLBACK_BASE_URL: 'https://app.example.test', QSTASH_CURRENT_SIGNING_KEY: 'fake-current', QSTASH_NEXT_SIGNING_KEY: 'fake-next' })
    const calls = [], logs = []
    t.mock.method(console, 'error', (...args) => logs.push(args))
    const redis = { get: async () => outcome === 'missing' ? null : 'fake-id', del: async key => calls.push(['clear', key]) }
    const queue = load('src/lib/qstash.ts', {
      './premergeStubs': { premergeStubEnabled: () => false },
      '@/lib/redis': { getRedis: async () => redis },
      '@upstash/qstash/nextjs': {},
      '@upstash/qstash': { Client: class { messages = {
        cancel: async ids => { calls.push(['cancel', ids]); if (outcome === 'error') throw new Error('fake failure'); return { cancelled: outcome === 'gone' ? 0 : 1 } },
        delete: () => { console.error('DELETE failed with status 404'); throw new Error('wrong endpoint') },
      } } },
    })
    await queue.cancelJobById('job', '/queue')
    assert.deepEqual(calls, outcome === 'missing' ? [] : [['cancel', ['fake-id']], ['clear', 'qstash:msgid:/queue:job']])
    assert.deepEqual(logs, [])
  })
}

test('Next externalizes both legacy URL callers while retaining the sanitizer packages', () => {
  const config = require('../next.config.js')
  for (const name of ['isomorphic-dompurify', 'jsdom', 'pusher', 'aws-sdk']) assert.ok(config.serverExternalPackages.includes(name))
  const defaults = fs.readFileSync(path.join(root, 'node_modules/next/dist/lib/server-external-packages.jsonc'), 'utf8')
  for (const name of ['pusher', 'aws-sdk']) assert.doesNotMatch(defaults, new RegExp(`"${name}"`))
})

for (const [runtime, existing, expected] of [['nodejs', undefined, '1'], ['nodejs', '0', '0'], ['nodejs', '', ''], ['edge', undefined, undefined], [undefined, undefined, undefined]]) {
  test(`register sets the SDK notice opt-out only when unset in runtime ${runtime}`, async t => {
    env(t, { NEXT_RUNTIME: runtime, QSTASH_AUTO_REGISTER_SWEEP: 'false', AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE: existing })
    await load('src/instrumentation.ts', {}).register()
    assert.equal(process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE, expected)
  })
}

test('installed AWS SDK opt-out suppresses the actual maintenance warning', () => {
  const sdkEnv = { ...process.env }
  delete sdkEnv.AWS_EXECUTION_ENV
  delete sdkEnv.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE
  const script = `process.on('warning', w => { if (w.message.includes('AWS SDK for JavaScript (v2)')) console.log('SDK_NOTICE'); }); require('aws-sdk/lib/maintenance_mode_message');`
  const baseline = spawnSync(process.execPath, ['-e', script], { cwd: root, env: sdkEnv, encoding: 'utf8' })
  assert.equal(baseline.status, 0)
  assert.match(baseline.stdout, /SDK_NOTICE/)
  const suppressed = spawnSync(process.execPath, ['-e', script], { cwd: root, env: { ...sdkEnv, AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE: '1' }, encoding: 'utf8' })
  assert.equal(suppressed.status, 0)
  assert.doesNotMatch(suppressed.stdout + suppressed.stderr, /SDK_NOTICE|reached end-of-support/)
})
