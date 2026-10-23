const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest, NextResponse } = require('next/server')
const cookieHelpers = require('better-auth/cookies')

function load(relativePath, imports = {}) {
  imports = { '@/lib/auth/agentScope': require('./helpers/agent-board-scope.cjs').enforcedScope, ...imports }
  const javascript = ts.transpileModule(readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', javascript)(mod, mod.exports, (name) => {
    if (name in imports) return imports[name]
    if (name === '@/lib/mcp/routeWrapper') return require('./helpers/mcp-route-wrapper.cjs').loadRouteWrapper({ ...imports, '@/lib/aiFeedback/automatic': { queueRestFailure: () => {} } })
    if (name === 'crypto') return require('node:crypto')
    throw new Error(`Unexpected import: ${name}`)
  })
  return mod.exports
}

const savedEnv = Object.fromEntries(['SESSION_SECRET', 'BETTER_AUTH_ENABLED', 'AUTH_LEGACY_FAST_PATH'].map((key) => [key, process.env[key]]))
process.env.SESSION_SECRET = 'htpr-7158-local-session-fixture'
test.after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})
const session = load('src/lib/auth/session.ts')

async function harness(state) {
  const token = session.signSession({ id: 7 })
  const store = new Map()
  const events = []
  const redis = {
    get: async (key) => {
      if (state === 'outage') throw new Error('fake outage')
      return store.get(key) ?? null
    },
    set: async (key, value) => { store.set(key, value); return 'OK' },
  }
  const dependencies = { '@/lib/auth/session': session, '@/lib/redis': { getRedis: async () => redis } }
  const revocation = load('src/lib/auth/sessionRevocation.ts', dependencies)
  if (state === 'revoked') await load('src/lib/auth/sessionRevocation.ts', dependencies).revokeSessionToken(token)
  const values = { ht_session: token, nookies_user: JSON.stringify({ id: 7 }) }
  const imports = {
    '@/lib/auth/session': session, '@/lib/auth/sessionRevocation': revocation,
    'next/server': { NextRequest, NextResponse },
    'next/headers': { cookies: async () => ({ get: (name) => values[name] === undefined ? undefined : { value: values[name] } }) },
  }
  return { token, values, events, redis, imports }
}

test('bridge-session rejects revoked and outage cookies before any DB access, bootstrap, or credential minting', async () => {
  for (const state of ['valid', 'revoked', 'outage']) {
    const h = await harness(state)
    const { bridgeSessionPlugin } = load('src/lib/auth/bridgePlugin.ts', {
      ...h.imports,
      'better-auth/api': {
        APIError: { fromStatus: (status) => Object.assign(new Error(status), { status }) },
        createAuthEndpoint: (_path, _options, handler) => handler,
        getSessionFromCtx: async () => null,
      },
      'better-auth/cookies': { setSessionCookie: async () => h.events.push('cookie') },
      '@/lib/appShellBootstrap/server': { getAppShellBootstrap: async () => { h.events.push('bootstrap'); return {} } },
    })
    const ctx = {
      getCookie: () => h.token, setHeader: () => {}, json: (body) => body,
      context: { internalAdapter: {
        findUserById: async () => { h.events.push('read'); return { id: '7' } },
        createSession: async () => { h.events.push('mint'); return { token: 'fresh-fixture' } },
      } },
    }
    const handler = bridgeSessionPlugin().endpoints.bridgeSession
    if (state === 'valid') {
      assert.deepEqual(await handler(ctx), { ok: true, bootstrap: {} })
      assert.deepEqual(h.events, ['bootstrap', 'read', 'mint', 'cookie'])
    } else {
      await assert.rejects(handler(ctx), { status: 'UNAUTHORIZED' })
      assert.deepEqual(h.events, [])
    }
  }
})

test('MCP token GET and POST reject revoked and outage cookies, including dummy Bearer and rewritten v1 aliases', async () => {
  for (const state of ['valid', 'revoked', 'outage']) {
    const h = await harness(state)
    const handlers = load('src/app/api/mcp/token/route.ts', {
      ...h.imports,
      jsonwebtoken: { decode: () => ({ exp: Math.floor(Date.now() / 1000) + 3600 }) },
      '@/lib/mcp/auth': {
        createMcpToken: () => { h.events.push('mint'); return 'fresh-fixture' },
        revokeTokenByJti: async () => h.events.push('revoke-mcp'),
      },
      '@/lib/prisma': { __esModule: true, default: { user: { findUnique: async () => { h.events.push('read'); return { email: 'fixture@example.test' } } } } },
    })
    for (const route of ['/api/mcp/token', '/api/v1/token']) {
      for (const bearer of [false, true]) {
        for (const method of ['GET', 'POST']) {
          h.events.length = 0
          const response = await handlers[method](new NextRequest(`http://localhost${route}`, {
            method, headers: bearer ? { Authorization: 'Bearer invalid-fixture' } : {},
          }))
          assert.equal(response.status, state === 'valid' ? 200 : 401)
          assert.deepEqual(h.events, state === 'valid' && method === 'POST' ? ['read', 'mint'] : [])
          if (state !== 'valid') assert.equal(response.headers.has('set-cookie'), false)
        }
      }
    }
  }
  const config = readFileSync(path.join(__dirname, '../next.config.js'), 'utf8')
  assert.match(config, /source: "\/api\/v1\/:path\*",\s+destination: "\/api\/mcp\/:path\*"/)
})

test('guest adoption rejects revoked and outage cookies before any DB read or mutation, with a valid transfer control', async () => {
  for (const state of ['valid', 'revoked', 'outage']) {
    const h = await harness(state)
    const mutation = async () => { h.events.push('write'); return { count: 1 } }
    const table = { updateMany: mutation, deleteMany: mutation, update: mutation }
    const { adoptGuestBoards } = load('src/utils/controllers/demo/adoptGuestBoards.ts', {
      ...h.imports, '@prisma/client': { Status: { Normal: 'Normal' } },
      '@/lib/demo/guest': { GUEST_UID_PREFIX: 'guest_' },
      '@/lib/telemetry/activationOccurrences': { captureActivationOccurrence: () => h.events.push('telemetry') },
      '@/lib/telemetry/savedWork': { enqueueBoardCreated: async () => 'board-key', processAnalyticsIntentSoon: () => h.events.push('telemetry') },
      '@/lib/prisma': { __esModule: true, default: {
        user: { findUnique: async ({ where }) => { h.events.push('read'); return where.id === 7 ? { id: 7, uid: 'guest_fixture' } : { accountId: 10 } } },
        project: { count: async () => 0, findMany: async () => [{ id: 42 }] }, member: { count: async () => 0 },
        $transaction: async (callback) => { h.events.push('transaction'); return callback({ team: table, project: table, member: table, member_Team: table, assignees: table, user: table }) },
      } },
    })
    assert.equal(await adoptGuestBoards(h.token, 8), state === 'valid' ? 1 : 0)
    if (state === 'valid') {
      assert.ok(h.events.includes('transaction'))
      assert.equal(h.events.filter((event) => event === 'write').length, 8)
    } else assert.deepEqual(h.events, [])
  }
})

test('getSessionUser refuses revoked cookies in both fast-path modes and fails open on Redis outage', async () => {
  process.env.BETTER_AUTH_ENABLED = '1'
  for (const flag of ['0', '1']) {
    process.env.AUTH_LEGACY_FAST_PATH = flag
    for (const state of ['valid', 'revoked', 'outage']) {
      const h = await harness(state)
      const { getSessionUser } = load('src/lib/auth/getSessionUser.ts', {
        ...h.imports, 'better-auth/cookies': cookieHelpers,
        '@/lib/prisma': { default: {} }, '@/lib/auth/agentTeamScope': {},
        '@/lib/auth/betterAuth': { auth: { api: { getSession: async () => { h.events.push('better-auth'); return { user: { id: '8' } } } } } },
      })
      const result = await getSessionUser(new Headers({ cookie: `ht_session=${h.token}` }))
      if (state === 'revoked') {
        assert.equal(result, null)
        assert.deepEqual(h.events, [])
      } else {
        assert.equal(result.userId, 7)
        assert.deepEqual(h.events, flag === '0' ? ['better-auth'] : [])
      }
      if (state === 'revoked') {
        assert.deepEqual(await getSessionUser(new Headers()), { userId: 8, source: 'better-auth', teamScope: null })
      }
    }
  }
})

test('serverUser guards proxy-skipped dotted pages before reading data and fails open on outage', async () => {
  for (const state of ['valid', 'revoked', 'outage']) {
    const h = await harness(state)
    const { getServerCookieUser, requireServerCookieUser } = load('src/lib/auth/serverUser.ts', {
      ...h.imports, '@/lib/configs/auth.config': { __esModule: true, default: { cookies: { user: 'nookies_user' } } },
      'next/navigation': { redirect: (url) => { h.events.push(`redirect:${url}`); throw new Error(`redirect:${url}`) } },
      '@/lib/prisma': { __esModule: true, default: { user: { findUnique: async () => { h.events.push('read'); return { id: 7 } } } } },
    })
    assert.deepEqual(await getServerCookieUser(), state === 'revoked' ? null : { id: 7 })
    if (state === 'revoked') {
      assert.deepEqual(h.events, [])
      await assert.rejects(requireServerCookieUser(), /redirect:\/login/)
      assert.deepEqual(h.events, ['redirect:/login'])
    } else assert.deepEqual(h.events, ['read'])
  }
})
