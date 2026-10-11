const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')
const jwt = require('jsonwebtoken')
const { NextRequest, NextResponse } = require('next/server')
const root = path.resolve(__dirname, '..')

function load(file, stubs, extra = '', env = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'process', code + '\n' + extra)(mod, mod.exports, name => {
    assert.ok(name in stubs, `Unexpected import ${name} in ${file}`)
    return stubs[name]
  }, { env })
  return mod.exports
}

function harness({ enabled = true, count = 1, revoked = false, agent = false } = {}) {
  const events = []
  const secret = crypto.randomBytes(32).toString('hex')
  const user = { id: 6, email: 'fixture@example.test', mcpTokensRevokedAt: null }
  const authContext = { user, agentId: null }
  let flagCalls = 0
  let authCalls = 0
  let verifyCalls = 0
  let connections = 0
  const flags = { HTPR_6926_MCP_ROUTE_WRAPPER_FLAG: 'htpr-6926-mcp-route-wrapper', isFeatureEnabled: async () => { flagCalls++; return enabled } }
  const context = load('src/lib/mcp/operationContext.ts', { 'node:async_hooks': require('node:async_hooks') })
  const permissions = load('src/lib/mcp/managementPermissions.ts', {})
  const oauth = load('src/lib/mcp/oauthTokenContract.ts', { jsonwebtoken: jwt })
  const db = {
    user: { findUnique: async ({ where }) => { events.push('user'); return { ...user, id: where.id } }, findFirst: async () => user },
    revokedToken: { findFirst: async () => { events.push('revocation'); return revoked ? { jti: 'fixture' } : null } },
    oAuthClient: { findUnique: async () => ({ client_id: 'fixture' }) },
    agent: { findFirst: async () => agent ? { id: 'agent-fixture', mcpTokenHash: verify.hashAgentToken(token), mcpTokenJti: 'fixture', runtimeGeneration: 7 } : null },
  }
  const verify = load('src/lib/mcp/auth/verifyJwt.ts', {
    '@/lib/prisma': db, jsonwebtoken: jwt, crypto,
    '@/utils/controllers/logs/createLog': async () => { connections++ },
    '@prisma/client': { LogType: { Signup: 'Signup' }, Status: { Normal: 'Normal' } },
    '@/lib/mcp/oauthTokenContract': oauth, '@/lib/flags': flags,
    '@/lib/mcp/managementKeyTeamScope': {},
  }, 'module.exports.__maps = { boundedJwtLogThrottle, boundedConnectionLogThrottle, mcpConnectionLogThrottle };', { JWT_SECRET: secret })
  const telemetry = load('src/lib/mcp/clientTelemetry.ts', { crypto })
  const session = load('src/lib/mcp/auth/session.ts', {
    '@/lib/telemetry/activationOccurrences': { recordAuthenticatedConnection: () => {} },
    'next/server': { NextRequest }, '@/lib/prisma': db, jsonwebtoken: jwt,
    '@/lib/apiKeys': {}, '@/lib/auth/betterAuth': {}, '@/lib/auth/getSessionUser': {},
    '@/lib/mcp/managementPermissions': permissions, '@/lib/mcp/clientTelemetry': telemetry,
    '@/lib/flags': flags,
    '@/lib/mcp/managementKeyTeamScope': { ACCOUNT_MANAGEMENT_KEY_PREFIX: 'htmk_', TEAM_MANAGEMENT_KEY_PREFIX: 'httk_' },
    './verifyJwt': verify, '../operationContext': context,
  })
  const errors = load('src/lib/mcp/auth/mcpAuthErrors.ts', {
    'next/server': { NextRequest, NextResponse }, '@/lib/prisma': db, jsonwebtoken: jwt,
    '@/lib/mcp/managementPermissions': permissions, '@/lib/mcp/oauthTokenContract': oauth,
    './session': session, './verifyJwt': { ...verify, verifyMcpJwtToken: token => { verifyCalls++; return verify.verifyMcpJwtToken(token) } },
  })
  const decision = load('src/lib/mcp/rateLimitDecision.ts', {})
  const rate = load('src/lib/mcp/auth/rateLimit.ts', {
    'next/server': { NextRequest, NextResponse }, crypto,
    '@/lib/redis': { getRedis: async () => ({ incr: async () => { events.push('rate'); return count }, expire: async () => {} }) },
    '@/lib/mcp/rateLimitDecision': decision, './session': { ...session, validateMcpAuth: async request => { authCalls++; return session.validateMcpAuth(request) } },
    '../operationContext': context,
  })
  const fieldError = load('src/lib/mcp/fieldError.ts', {})
  const json = load('src/lib/mcp/readJsonBody.ts', { 'next/server': { NextResponse }, '@/lib/mcp/fieldError': fieldError })
  const lease = load('src/lib/mcp/tasks/agentMutationLeaseAdoption.ts', {
    'node:async_hooks': require('node:async_hooks'), './lease': { MIN_LEASE_TTL_SECONDS: 30, clampLeaseTtlSeconds: n => n },
  })
  const auth = { ...session, ...rate, ...errors, validateMcpAuth: async (request, options) => { authCalls++; events.push('auth'); return session.validateMcpAuth(request, options) } }
  const wrapper = load('src/lib/mcp/routeWrapper.ts', {
    'node:async_hooks': require('node:async_hooks'), jsonwebtoken: jwt, '@/lib/flags': flags, '@/lib/flags/keys': flags,
    './operationContext': context, '@/lib/mcp/auth': auth, '@/lib/mcp/readJsonBody': json, '@/lib/mcp/tasks/agentMutationLeaseAdoption': lease,
  }, 'module.exports.__flags = flagDecisions;')
  const token = jwt.sign({ userId: user.id, aud: 'mcp-api', iss: 'hypertask', jti: 'fixture', ...(agent ? { agentId: 'agent-fixture' } : {}) }, secret)
  const request = (body = '{}', bearer = token) => new NextRequest('http://mcp.test/api/mcp/tasks/create', {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body,
  })
  return { wrapper, auth, errors, session, context, verify, telemetry, lease, db, request, events, authContext,
    setEnabled: value => { enabled = value }, counts: () => ({ flagCalls, authCalls, verifyCalls, connections }) }
}

async function quiet(run) {
  const original = { log: console.log, info: console.info, error: console.error }
  console.log = console.info = console.error = () => {}
  try { return await run() } finally { Object.assign(console, original) }
}

function scaffold(h, run = async () => NextResponse.json({ success: true })) {
  return h.wrapper.wrapMcpRoute(async request => {
    const limited = await h.wrapper.checkMcpRouteRateLimit(request)
    if (limited) return limited
    const ctx = await h.wrapper.validateMcpRouteAuth(request)
    if (!ctx) return h.wrapper.mcpRouteUnauthorizedResponse(request)
    const parsed = await h.wrapper.readMcpRouteJsonBody(request)
    if (!parsed.ok) return parsed.response
    try { return await run(ctx, parsed.body, request) }
    catch { return NextResponse.json({ error: 'domain failure' }, { status: 500 }) }
  })
}

test('flag off calls the verbatim legacy handler with the original request and no wrapper auth or counters', async () => {
  const h = harness({ enabled: false })
  const req = h.request()
  let calls = 0
  const response = await h.wrapper.wrapMcpRoute(async received => { calls++; assert.equal(received, req); return NextResponse.json({ legacy: true }) })(req)
  assert.deepEqual(await response.json(), { legacy: true })
  assert.equal(calls, 1)
  assert.deepEqual(h.events, [])
  assert.equal(h.counts().authCalls, 0)
})

test('opaque keys, missing bearer, email-only and ambiguous claims never authenticate or evaluate the flag during selection', async () => {
  const h = harness()
  const candidates = ['htk_fixture', 'htmk_fixture', 'httk_fixture', 'garbage', jwt.sign({ userId: '6' }, 'fixture'), jwt.sign({ sub: 'fixture@example.test' }, 'fixture')]
  for (const bearer of candidates) assert.equal(await h.wrapper.shouldUseMcpRouteWrapper(h.request('{}', bearer)), false)
  assert.equal(await h.wrapper.shouldUseMcpRouteWrapper(new NextRequest('http://mcp.test')), false)
  assert.equal(h.counts().flagCalls, 0)
  assert.deepEqual(h.events, [])
})

test('flag on authenticates and consumes rate exactly once, including tier resolution and repeated scaffold calls', () => quiet(async () => {
  const h = harness({ count: 121 })
  const response = await scaffold(h)(h.request())
  assert.equal(response.status, 429)
  assert.equal(h.counts().authCalls, 1)
  assert.deepEqual(h.events.filter(e => e === 'rate'), ['rate'])
  const low = harness()
  await low.wrapper.wrapMcpRoute(async request => {
    await low.wrapper.checkMcpRouteRateLimit(request)
    await low.wrapper.checkMcpRouteRateLimit(request)
    const a = await low.wrapper.validateMcpRouteAuth(request)
    assert.equal(await low.wrapper.validateMcpRouteAuth(request), a)
    assert.ok(a)
    return NextResponse.json({ success: true })
  })(low.request())
  assert.equal(low.counts().authCalls, 1)
  assert.deepEqual(low.events.filter(e => ['rate', 'auth'].includes(e)), ['rate', 'auth'])
}))

test('new path preserves guarded JSON error mapping and parses the body once', () => quiet(async () => {
  const h = harness()
  const response = await scaffold(h)(h.request('{bad'))
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /not valid JSON/)
  let parses = 0
  const req = h.request()
  req.json = async () => { parses++; return { fixture: true } }
  await h.wrapper.wrapMcpRoute(async request => {
    assert.equal(await request.json(), await request.json())
    return NextResponse.json({ success: true })
  })(req)
  assert.equal(parses, 1)
}))

test('forged unsigned owner JWT selects the new path but fails full auth with byte-identical legacy 401 body and headers', () => quiet(async () => {
  const h = harness()
  const forged = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ userId: 6, aud: 'mcp-api', iss: 'hypertask' })).toString('base64url') + '.'
  assert.equal(await h.wrapper.shouldUseMcpRouteWrapper(h.request('{}', forged)), true)
  const response = await scaffold(h)(h.request('{}', forged))
  const before = h.counts()
  assert.equal(before.authCalls, 1)
  assert.equal(before.verifyCalls, 0, 'failure classification must reuse verification even when it failed')
  const req = h.request('{}', forged)
  assert.equal(await h.session.validateMcpAuth(req), null)
  const legacy = await h.errors.mcpUnauthorizedResponse(req)
  assert.equal(response.status, 401)
  assert.equal(await response.text(), await legacy.text())
  assert.deepEqual([...response.headers], [...legacy.headers])
  assert.equal(h.events.includes('user'), false, 'a forged JWT must not probe the claimed user')
}))

test('failed authenticated revocation classification reuses the JWT verification, not another auth pass', () => quiet(async () => {
  const h = harness({ revoked: true })
  const response = await scaffold(h)(h.request())
  assert.equal(response.status, 401)
  assert.equal((await response.json()).reason, 'token_revoked')
  assert.equal(h.counts().authCalls, 1)
  assert.equal(h.counts().verifyCalls, 0)
  assert.equal(h.events.filter(e => e === 'user').length, 1)
  assert.equal(h.events.filter(e => e === 'revocation').length, 1)
}))

test('auth is isolated across requests and trusted internal contexts survive wrapping', () => quiet(async () => {
  const h = harness()
  await Promise.all([scaffold(h)(h.request()), scaffold(h)(h.request())])
  assert.equal(h.counts().authCalls, 2)
  const req = h.request()
  h.context.bindMcpOperationContext(req, h.authContext, true)
  const before = h.events.length
  assert.equal((await scaffold(h)(req)).status, 200)
  assert.equal(h.events.slice(before).includes('rate'), false)
  assert.equal(h.events.slice(before).includes('user'), false)
}))

test('adopted lease cleanup runs on throw and cleanup failure cannot overwrite success', () => quiet(async () => {
  const h = harness()
  const releases = []
  const db = { $executeRaw: async (strings, ...values) => { releases.push({ sql: strings.join('?'), values }) } }
  const response = await scaffold(h, async ctx => h.wrapper.withMcpRouteMutationLease(db, { agentId: 'agent', userId: ctx.user.id }, async () => {
    assert.ok(h.lease.consumeAgentMutationLeaseAdoption('agent', ctx.user.id, 123))
    h.lease.recordAgentMutationLeaseToken('agent', ctx.user.id, 123, 'lease-fixture', 'reference-fixture')
    throw new Error('write failure')
  }))(h.request())
  assert.equal(response.status, 500)
  assert.equal(releases.length, 2)
  assert.ok(releases.every(r => r.values.includes('lease-fixture')))
  const value = await h.wrapper.withMcpRouteMutationLease({ $executeRaw: async () => { throw new Error('cleanup failed') } }, { agentId: 'agent', userId: 6 }, async () => {
    h.lease.consumeAgentMutationLeaseAdoption('agent', 6, 123)
    h.lease.recordAgentMutationLeaseToken('agent', 6, 123, 'lease-fixture', 'reference-fixture')
    return 'committed'
  })
  assert.equal(value, 'committed')
}))

test('flag memo has a 30 second TTL, caches off decisions, bounds entries and evicts oldest', async () => {
  const h = harness({ enabled: false })
  const now = Date.now
  let time = 10_000
  Date.now = () => time
  try {
    await h.wrapper.shouldUseMcpRouteWrapper(h.request())
    time += 29_999
    await h.wrapper.shouldUseMcpRouteWrapper(h.request())
    assert.equal(h.counts().flagCalls, 1)
    h.setEnabled(true)
    assert.equal(await h.wrapper.shouldUseMcpRouteWrapper(h.request()), false)
    time++
    assert.equal(await h.wrapper.shouldUseMcpRouteWrapper(h.request()), true)
    assert.equal(h.counts().flagCalls, 2)
    for (let userId = 10; userId < 1011; userId++) {
      const token = jwt.sign({ userId }, 'fixture')
      await h.wrapper.shouldUseMcpRouteWrapper(h.request('{}', token))
    }
    assert.equal(h.wrapper.__flags.size, 1000)
    assert.equal(h.wrapper.__flags.has('htpr-6926-mcp-route-wrapper:6'), false)
    assert.equal(h.wrapper.__flags.has('htpr-6926-mcp-route-wrapper:10'), false)
  } finally { Date.now = now }
})

test('flag lookup failure falls back without authentication, rate consumption or logging', async () => {
  const wrapper = load('src/lib/mcp/routeWrapper.ts', {
    'node:async_hooks': require('node:async_hooks'), jsonwebtoken: jwt,
    '@/lib/flags/keys': { HTPR_6926_MCP_ROUTE_WRAPPER_FLAG: 'htpr-6926-mcp-route-wrapper' },
    '@/lib/flags': { HTPR_6926_MCP_ROUTE_WRAPPER_FLAG: 'htpr-6926-mcp-route-wrapper', isFeatureEnabled: async () => { throw new Error('offline') } },
    './operationContext': { getMcpOperationContext: () => undefined }, '@/lib/mcp/auth': { extractBearerToken: header => header?.slice(7) }, '@/lib/mcp/readJsonBody': {}, '@/lib/mcp/tasks/agentMutationLeaseAdoption': {},
  })
  const request = new NextRequest('http://mcp.test', { headers: { Authorization: `Bearer ${jwt.sign({ userId: 6 }, 'fixture')}` } })
  let called = false
  assert.equal(await wrapper.wrapMcpRoute(async req => { assert.equal(req, request); called = true; return 'legacy' })(request), 'legacy')
  assert.equal(called, true)
})

test('bounded auth logs cap unverified strings and arrays, throttle identical JWT failures, expire and evict', async () => {
  const h = harness()
  const original = console.log
  const output = []
  console.log = (...args) => output.push(args)
  try {
    h.verify.boundedMcpAuthLog('fixture', { sub: 's'.repeat(1000), aud: Array(100).fill('a'.repeat(1000)) })
    assert.equal(output[0][1].sub.length, 200)
    assert.equal(output[0][1].aud.length, 10)
    assert.equal(output[0][1].aud[0].length, 200)
    h.verify.boundedMcpAuthLog('fixture', { sub: 's'.repeat(1000), aud: Array(100).fill('a'.repeat(1000)) })
    assert.equal(output.length, 1)
    const invalid = jwt.sign({ userId: 6, sub: 'u'.repeat(1000), iss: 'i'.repeat(1000), aud: 'a'.repeat(1000) }, 'wrong-fixture')
    h.verify.verifyMcpJwtToken(invalid, { boundedLogging: true })
    const first = output.length
    h.verify.verifyMcpJwtToken(invalid, { boundedLogging: true })
    assert.equal(output.length, first)
    for (let i = 0; i <= 1000; i++) h.verify.boundedMcpAuthLog('eviction', i)
    assert.equal(h.verify.__maps.boundedJwtLogThrottle.size, 1000)
    const before = output.length
    h.verify.boundedMcpAuthLog('fixture', { sub: 's'.repeat(1000), aud: Array(100).fill('a'.repeat(1000)) })
    assert.equal(output.length, before + 1)
    const now = Date.now
    Date.now = () => now() + 30_001
    try {
      h.verify.boundedMcpAuthLog('fixture', { sub: 's'.repeat(1000), aud: Array(100).fill('a'.repeat(1000)) })
      assert.equal(output.length, before + 2)
    } finally { Date.now = now }
    h.verify.verifyMcpJwtToken(invalid)
    assert.ok(output.some(args => args[1]?.sub?.length === 1000), 'legacy logging must remain uncapped')
  } finally { console.log = original }
})

test('bounded connection audit map evicts while the legacy map and throttle stay unchanged', () => quiet(async () => {
  const h = harness()
  const valid = userId => jwt.sign({ userId, aud: 'mcp-api', iss: 'hypertask', jti: 'fixture' }, 'fixture')
  const decode = jwt.verify
  jwt.verify = token => jwt.decode(token)
  try {
    for (let userId = 1; userId <= 1001; userId++) await h.verify.validateJwtToken(valid(userId), { boundedLogging: true })
    assert.equal(h.verify.__maps.boundedConnectionLogThrottle.size, 1000)
    assert.equal(h.verify.__maps.boundedConnectionLogThrottle.has(1), false)
    assert.equal(h.verify.__maps.mcpConnectionLogThrottle.size, 0)
    assert.equal(h.counts().connections, 1001)
    await h.verify.validateJwtToken(valid(1001), { boundedLogging: true })
    assert.equal(h.counts().connections, 1001)
    await h.verify.validateJwtToken(valid(1), { boundedLogging: true })
    assert.equal(h.counts().connections, 1002)
    await h.verify.validateJwtToken(valid(1))
    assert.equal(h.verify.__maps.mcpConnectionLogThrottle.size, 1)
    assert.equal(h.counts().connections, 1003)
  } finally { jwt.verify = decode }
}))

test('CLI auth telemetry string fields are bounded only when explicitly opted in', async () => {
  const h = harness()
  const output = []
  const req = new NextRequest('http://mcp.test/' + 'p'.repeat(1000), { headers: { 'User-Agent': 'hypertask-cli/1.2.3-' + 'v'.repeat(1000) } })
  const original = console.log
  console.log = (...args) => output.push(args)
  try {
    h.telemetry.logMcpCliUsage(req, 'fixture', h.authContext, h.verify.boundedMcpAuthLog)
    assert.equal(output[0][1].version.length, 200)
    assert.equal(output[0][1].path.length, 200)
  } finally { console.log = original }
})

test('all adopted REST methods preserve legacy wire results and scaffold order with the flag off and on', async () => {
  const cp = require('node:child_process')
  const { loadRouteWrapper } = require('./helpers/mcp-route-wrapper.cjs')
  const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(dir + '/' + entry.name) : [dir + '/' + entry.name])
  const files = [...walk('src/lib/mcp/operations'), ...walk('src/app/api/mcp')].filter(file => file.endsWith('.ts') && fs.readFileSync(path.join(root, file), 'utf8').includes('return wrapMcpRoute('))
  let compared = 0
  const compiled = new Map()
  let activeAuth
  const json = require('./task-route-loader.cjs').load('src/lib/mcp/readJsonBody.ts', {})
  const lease = require('./task-route-loader.cjs').load('src/lib/mcp/tasks/agentMutationLeaseAdoption.ts', {})
  const authForwarder = Object.fromEntries(['checkMcpRateLimit', 'validateMcpAuth', 'mcpUnauthorizedResponse', 'createUnauthorizedResponse'].map(name => [name, (...args) => activeAuth[name](...args)]))
  const wrappers = Object.fromEntries(['off', 'on'].map(mode => [mode, loadRouteWrapper({ '@/lib/mcp/auth': authForwarder, '@/lib/mcp/readJsonBody': json, '@/lib/mcp/tasks/agentMutationLeaseAdoption': lease })]))
  const originalMode = process.env.HTPR_6926_TEST_FLAG
  let legacyBase = null
  try { legacyBase = cp.execFileSync('git', ['merge-base', 'HEAD', 'origin/production'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null } catch {}
  await quiet(async () => {
    for (const file of files) {
      const current = fs.readFileSync(path.join(root, file), 'utf8')
      // Compare against the pre-wrapper source when the merge base is available (local runs). CI checks out
      // one commit, so there the verbatim legacy body inside the current file (the flag-off branch) is the reference.
      let original = current
      if (legacyBase) {
        try { original = cp.execFileSync('git', ['show', `${legacyBase}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch {}
      }
      const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true)
      const methods = sf.statements.filter(s => ts.isFunctionDeclaration(s) && s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && /^(GET|POST|PATCH|PUT|DELETE)$/.test(s.name.text)).map(s => s.name.text)
      for (const method of methods) {
        for (const scenario of ['limited', 'unauthorized', 'malformed', 'scalar']) {
          function execute(source, mode) {
            const events = []
            let initializing = true
            const opaque = new Proxy(function () {
              if (!initializing) throw new Error('mocked domain boundary')
              return opaque
            }, { get: (_target, key) => key === 'then' ? undefined : key === '__esModule' ? true : opaque })
            const auth = {
              checkMcpRateLimit: async () => { events.push('rate'); return scenario === 'limited' ? NextResponse.json({ limited: true }, { status: 429, headers: { 'Retry-After': '31' } }) : null },
              validateMcpAuth: async () => { events.push('auth'); return scenario === 'unauthorized' ? null : { user: { id: 42, email: 'fixture@example.test' }, agentId: null } },
              mcpUnauthorizedResponse: async () => NextResponse.json({ unauthorized: true }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }),
              createUnauthorizedResponse: () => NextResponse.json({ unauthorized: true }, { status: 401 }),
              extractBearerToken: header => header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null,
              isManagementKeyToken: token => /^(htmk_|httk_)/.test(token),
            }
            const mocks = Object.fromEntries(sf.statements.filter(ts.isImportDeclaration).map(s => [s.moduleSpecifier.text, opaque]))
            Object.assign(mocks, {
              'next/server': { NextRequest, NextResponse },
              '@/lib/mcp/auth': auth,
              '@/lib/flags': { isFeatureEnabled: async () => false },
              '@/lib/flags/keys': {},
              '@/lib/mcp/agents/scopes': { requireRole: async () => null },
              '@/lib/mcp/readJsonBody': json,
              '@/lib/mcp/tasks/agentMutationLeaseAdoption': lease,
            })
            process.env.HTPR_6926_TEST_FLAG = mode
            activeAuth = auth
            const wrapper = wrappers[mode]
            mocks['@/lib/mcp/routeWrapper'] = wrapper
            if (!compiled.has(source)) compiled.set(source, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText)
            const code = compiled.get(source)
            const mod = { exports: {} }
            new Function('module', 'exports', 'require', code)(mod, mod.exports, name => mocks[name] ?? opaque)
            initializing = false
            const request = new NextRequest('http://mcp.test/api/mcp/' + file, {
              method: method === 'GET' ? 'GET' : method,
              headers: { Authorization: `Bearer ${jwt.sign({ userId: 6 }, 'fixture')}` },
              ...(method === 'GET' ? {} : { body: scenario === 'scalar' ? 'null' : '{bad' }),
            })
            return Promise.resolve().then(() => mod.exports[method](request, { params: Promise.resolve({ projectId: '15', taskId: '123', fieldId: 'field', comment_id: '1', draft_id: 'draft', id: '1', roomId: 'room', sessionId: 'session', skill_id: 'skill', viewId: '1', sectionId: '1' }) })).then(async response => ({ status: response.status, headers: [...response.headers], body: await response.text(), events }), error => ({ thrown: error.message, events }))
          }
          const legacy = await execute(original, 'off')
          assert.deepEqual(await execute(current, 'off'), legacy, `${file}:${method}:${scenario}:off`)
          assert.deepEqual(await execute(current, 'on'), legacy, `${file}:${method}:${scenario}:on`)
        }
        compared++
      }
    }
  }).finally(() => {
    if (originalMode === undefined) delete process.env.HTPR_6926_TEST_FLAG
    else process.env.HTPR_6926_TEST_FLAG = originalMode
  })
  assert.equal(files.length, 69)
  assert.equal(compared, 97)
})


test('successful agent-tier requests reuse the authenticated context while legacy still performs both auth passes', () => quiet(async () => {
  const on = harness({ count: 121, agent: true })
  const off = harness({ enabled: false, count: 121, agent: true })
  const a = await scaffold(on)(on.request())
  const b = await scaffold(off)(off.request())
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(await a.text(), await b.text())
  assert.deepEqual([...a.headers], [...b.headers])
  assert.equal(on.counts().authCalls, 1)
  assert.equal(off.counts().authCalls, 2)
  assert.equal(on.events.filter(e => e === 'rate').length, 1)
  assert.equal(off.events.filter(e => e === 'rate').length, 1)
}))
