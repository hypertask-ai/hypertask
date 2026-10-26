const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
const { Pool } = require('pg')
const jwt = require('jsonwebtoken')
const { NextRequest } = require('next/server')
const { load } = require('./task-route-loader.cjs')
const root = path.resolve(__dirname, '..')

function timingHarness() {
  let now = 0
  let clocks = 0
  const clients = []
  class FakeClient extends EventEmitter {
    constructor() { super(); this._queryable = true; clients.push(this) }
    connect(done) { this.connected = done }
    end(done) { this.emit('end'); done?.() }
  }
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/mcp/dbTiming.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'performance', source)(
    name => name === 'pg' ? { Pool, Client: FakeClient } : require(name), mod, mod.exports,
    { now: () => { clocks++; return now } },
  )
  return { timing: mod.exports, clients, advance: ms => { now += ms }, clocks: () => clocks }
}

function prismaHook(timing) {
  let hook
  const tracked = []
  const previous = globalThis.prismaGlobal
  delete globalThis.prismaGlobal
  load('src/lib/prisma.ts', {
    '@prisma/client': { PrismaClient: class { $extends(extension) { hook = extension.query.$allOperations; return this } } },
    '@prisma/adapter-pg': { PrismaPg: class {} },
    '@/lib/mcp/dbTiming': { ...timing, createMcpTimingPool: () => ({}) },
    '@/lib/queryCountTracker': { trackPrismaQuery: model => tracked.push(model) },
    '@/lib/apiKeyExpiry': { isApiKeyAuthLookup: () => false },
  })
  if (previous === undefined) delete globalThis.prismaGlobal
  else globalThis.prismaGlobal = previous
  return { hook, tracked }
}

function wrapped(timing) {
  return load('src/lib/mcp/routeWrapper.ts', {
    './dbTiming': timing,
    './operationContext': { getMcpOperationContext: () => undefined },
    '@/lib/mcp/auth': {}, '@/lib/mcp/readJsonBody': {}, '@/lib/mcp/tasks/agentMutationLeaseAdoption': {},
  }).wrapMcpRoute
}
const request = bearer => new NextRequest('http://local.test/api/mcp/tasks/mine', {
  headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
})
const token = jwt.sign({ userId: 7136 }, 'test-only')
const tick = () => new Promise(resolve => process.nextTick(resolve))

test('header includes summed operation duration/count, slowest Model.operation, connection count/duration and wait', async () => {
  const { timing } = timingHarness()
  const response = await wrapped(timing)(async () => {
    Object.assign(timing.mcpDbTimings.getStore(), { queries: 3, queryMs: 12.34, maxMs: 8.76, maxOperation: 'User.findUnique', connections: 2, connectMs: 6.54, waitMs: 2.34 })
    return new Response('{}')
  })(request(token))
  assert.match(response.headers.get('server-timing'), /, db_q;dur=12\.3;desc="3", db_max;dur=8\.8;desc="User.findUnique", db_conn;dur=6\.5;desc="2", db_wait;dur=2\.3$/)
})

test('concurrent wrapped requests and operation completions retain separate stores', async () => {
  const { timing } = timingHarness()
  const { hook } = prismaHook(timing)
  let releaseA, releaseB
  const a = new Promise(resolve => { releaseA = resolve })
  const b = new Promise(resolve => { releaseB = resolve })
  let storeA, storeB
  const wrap = wrapped(timing)
  const first = wrap(async () => {
    storeA = timing.mcpDbTimings.getStore()
    await hook({ model: 'User', operation: 'findUnique', args: {}, query: () => a })
    return new Response('{}')
  })(request(token))
  const second = wrap(async () => {
    storeB = timing.mcpDbTimings.getStore()
    await hook({ model: 'Agent', operation: 'findFirst', args: {}, query: () => b })
    await hook({ model: 'Agent', operation: 'count', args: {}, query: async () => 1 })
    return new Response('{}')
  })(request(token))
  await tick()
  assert.notEqual(storeA, storeB)
  releaseB('b')
  const responseB = await second
  releaseA('a')
  const responseA = await first
  assert.match(responseA.headers.get('server-timing'), /db_q;dur=[\d.]+;desc="1", db_max;dur=[\d.]+;desc="User.findUnique"/)
  assert.match(responseB.headers.get('server-timing'), /db_q;dur=[\d.]+;desc="2", db_max;dur=[\d.]+;desc="Agent\.(findFirst|count)"/)
  assert.equal(timing.mcpDbTimings.getStore(), undefined)
})

test('raw SQL, parameters and ids never enter labels, and rejected operations retain timing and error identity', async () => {
  const { timing } = timingHarness()
  const { hook, tracked } = prismaHook(timing)
  const store = timing.createMcpDbTiming()
  const sql = 'SELECT private_secret FROM "User" WHERE id = 987654321'
  const error = new Error(sql)
  await timing.mcpDbTimings.run(store, () => assert.rejects(hook({
    model: undefined, operation: '$queryRaw', args: [sql, 'private-param'], query: async () => { throw error },
  }), actual => actual === error))
  const header = timing.mcpDbTimingHeader(store)
  assert.match(header, /db_max;dur=[\d.]+;desc="Prisma\.\$queryRaw"/)
  const privateHeader = value => assert.doesNotMatch(value, /SELECT|private_secret|987654321|private-param/)
  privateHeader(header)
  assert.throws(() => privateHeader(`${header}, bad;desc="${sql}"`), assert.AssertionError)
  assert.equal(store.queries, 1)
  assert.deepEqual(tracked, [], 'raw queries must not change existing query-count tracking')
})

test('without a store, operation results are unchanged and pool connection clocks are not read', async () => {
  const h = timingHarness()
  const { hook } = prismaHook(h.timing)
  const value = { id: 'private-id' }
  assert.equal(await hook({ model: 'User', operation: 'findUnique', args: {}, query: async () => value }), value)
  const pool = h.timing.createMcpTimingPool({ idleTimeoutMillis: 0 })
  const acquire = pool.connect()
  h.clients[0].connected(null)
  const client = await acquire
  assert.equal(h.clocks(), 0)
  assert.equal(h.timing.mcpDbTimings.getStore(), undefined)
  client.release()
  await pool.end()
})

test('opaque keys and absent Bearer emit no timings and activate no database store', async () => {
  const { timing } = timingHarness()
  for (const bearer of [undefined, 'htk_secret', 'htmk_secret', 'httk_secret']) {
    const response = await wrapped(timing)(async () => {
      assert.equal(timing.mcpDbTimings.getStore(), undefined)
      return new Response('{}')
    })(request(bearer))
    assert.equal(response.headers.get('server-timing'), null)
  }
})

test('fresh parallel connects are summed and warm reuse is not counted as a new connection', async () => {
  const h = timingHarness()
  const pool = h.timing.createMcpTimingPool({ max: 2, idleTimeoutMillis: 0 })
  const store = h.timing.createMcpDbTiming()
  const pending = h.timing.mcpDbTimings.run(store, () => [pool.connect(), pool.connect()])
  h.advance(10)
  h.clients[0].connected(null)
  h.advance(5)
  h.clients[1].connected(null)
  const clients = await Promise.all(pending)
  assert.equal(store.connections, 2)
  assert.equal(store.connectMs, 25)
  assert.equal(store.waitMs, 0)
  clients.forEach(client => client.release())
  const warm = h.timing.createMcpDbTiming()
  const reused = await h.timing.mcpDbTimings.run(warm, () => pool.connect())
  assert.equal(warm.connections, 0)
  assert.equal(warm.connectMs, 0)
  reused.release()
  await pool.end()
})

test('saturated pool wait belongs to the acquiring request, not the releasing request', async () => {
  const h = timingHarness()
  const pool = h.timing.createMcpTimingPool({ max: 1, idleTimeoutMillis: 0 })
  const first = h.timing.createMcpDbTiming()
  const second = h.timing.createMcpDbTiming()
  const pending = h.timing.mcpDbTimings.run(first, () => pool.connect())
  h.advance(8)
  h.clients[0].connected(null)
  const client = await pending
  const waiting = h.timing.mcpDbTimings.run(second, () => pool.connect())
  h.advance(42)
  h.timing.mcpDbTimings.run(first, () => client.release())
  const acquired = await waiting
  assert.equal(first.connections, 1)
  assert.equal(first.connectMs, 8)
  assert.equal(first.waitMs, 0)
  assert.equal(second.connections, 0)
  assert.equal(second.waitMs, 42)
  acquired.release()
  await pool.end()
})

test('queued replacement connection is attributed to its caller even when a non-MCP request releases', async () => {
  const h = timingHarness()
  const pool = h.timing.createMcpTimingPool({ max: 1, idleTimeoutMillis: 0 })
  const pending = pool.connect()
  h.clients[0].connected(null)
  const client = await pending
  const store = h.timing.createMcpDbTiming()
  const waiting = h.timing.mcpDbTimings.run(store, () => pool.connect())
  h.advance(30)
  client.release(true)
  h.advance(12)
  h.clients[1].connected(null)
  const acquired = await waiting
  assert.equal(store.connections, 1)
  assert.equal(store.connectMs, 12)
  assert.equal(store.waitMs, 30)
  acquired.release()
  await pool.end()
})

test('callback acquisition API preserves client, release and error identity', async () => {
  const h = timingHarness()
  const pool = h.timing.createMcpTimingPool({ idleTimeoutMillis: 0 })
  const store = h.timing.createMcpDbTiming()
  const success = new Promise(resolve => h.timing.mcpDbTimings.run(store, () => pool.connect((err, client, release) => {
    assert.equal(err, undefined)
    assert.equal(typeof release, 'function')
    release()
    resolve(client)
  })))
  h.clients[0].connected(null)
  assert.ok(await success)
  await pool.end()
  const failedPool = h.timing.createMcpTimingPool({ idleTimeoutMillis: 0 })
  const error = new Error('connection failed')
  const failed = new Promise(resolve => h.timing.mcpDbTimings.run(store, () => failedPool.connect((err, client) => {
    assert.equal(err, error)
    assert.equal(client, undefined)
    resolve()
  })))
  h.clients[1].connected(error)
  await failed
  await failedPool.end()
})

test('non-MCP queued startup is discarded before a diagnostic caller reuses that client', async () => {
  const h = timingHarness()
  const pool = h.timing.createMcpTimingPool({ max: 1, idleTimeoutMillis: 0 })
  const initial = pool.connect()
  h.clients[0].connected(null)
  const held = await initial
  const ordinary = pool.connect()
  const store = h.timing.createMcpDbTiming()
  const diagnostic = h.timing.mcpDbTimings.run(store, () => pool.connect())
  h.advance(20)
  held.release(true)
  h.advance(15)
  h.clients[1].connected(null)
  const unmeasured = await ordinary
  h.advance(25)
  unmeasured.release()
  const measured = await diagnostic
  assert.equal(store.connections, 0)
  assert.equal(store.connectMs, 0)
  assert.equal(store.waitMs, 60)
  measured.release()
  await pool.end()
})

test('promise acquisition failures preserve rejection and do not label startup time as queue wait', async () => {
  const h = timingHarness()
  const pool = h.timing.createMcpTimingPool({ idleTimeoutMillis: 0 })
  const store = h.timing.createMcpDbTiming()
  const pending = h.timing.mcpDbTimings.run(store, () => pool.connect())
  const error = new Error('startup failed')
  h.advance(50)
  h.clients[0].connected(error)
  await assert.rejects(pending, actual => actual === error)
  assert.equal(store.connections, 0)
  assert.equal(store.waitMs, 0)
  await pool.end()
})
