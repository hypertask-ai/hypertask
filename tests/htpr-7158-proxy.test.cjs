const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest, NextResponse } = require('next/server')

function load(relativePath, imports = {}) {
  const javascript = ts.transpileModule(readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', javascript)(mod, mod.exports, (name) => {
    if (name in imports) return imports[name]
    if (name === '@/lib/auth/agentCookieBridgeRoutes') return load('src/lib/auth/agentCookieBridgeRoutes.ts')
    if (name === '@/lib/telemetry/signupAnalytics') return { recordServerCapture: () => {} }
    if (name === 'crypto') return require('node:crypto')
    throw new Error(`Unexpected import: ${name}`)
  })
  return mod.exports
}

const originalSecret = process.env.SESSION_SECRET
process.env.SESSION_SECRET = 'htpr-7158-local-session-fixture'
test.after(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET
  else process.env.SESSION_SECRET = originalSecret
})
const session = load('src/lib/auth/session.ts')
const edge = load('src/lib/auth/sessionEdge.ts')
const identity = load('src/lib/auth/cookieIdentity.ts', { '@/lib/auth/sessionEdge': edge })

function harness() {
  const store = new Map()
  const calls = []
  const redis = {
    set: async (key, value) => { store.set(key, value); return 'OK' },
    get: async (key) => { calls.push(key); return store.get(key) ?? null },
  }
  const imports = { '@/lib/auth/session': session, '@/lib/redis': { getRedis: async () => redis } }
  const revocation = load('src/lib/auth/sessionRevocation.ts', imports)
  const writer = load('src/lib/auth/sessionRevocation.ts', imports)
  const { default: proxy } = load('src/proxy.ts', {
    'next/server': { NextRequest, NextResponse },
    './utils/edgeHelpers': { isValidUser: (value) => {
      try { const user = JSON.parse(value); return { isValid: !!user?.id, user } }
      catch { return { isValid: false, user: null } }
    } },
    './utils/serverActions': { isMobileDevice: () => false },
    './utils/helperFunctions/helperFunctions': { canAccessTrialPage: () => true },
    '@/lib/net/contentEncoding': { refusedContentEncoding: () => undefined },
    '@/lib/auth/safeReturnTo': { parseSafeReturnTo: () => null },
    '@/lib/auth/sessionEdge': edge, '@/lib/auth/cookieIdentity': identity,
    '@/lib/auth/sessionRevocation': revocation,
    '@/lib/routing/detailWithoutTicket': { detailWithoutTicketRedirect: () => null },
    '@/lib/tutorial/keyboardShortcutTutorial': {
      isKeyboardShortcutTutorialPath: () => false, hasKeyboardShortcutTutorialQuery: () => false,
    },
  })
  return { proxy, writer, redis, calls }
}

function request(route, token, { user = true, bearer = false } = {}) {
  const cookie = [
    ...(token ? [`ht_session=${token}`] : []),
    ...(user ? [`nookies_user=${encodeURIComponent(JSON.stringify({ id: 7, UserSetting: { onboardingTourStatus: true } }))}`] : []),
  ].join('; ')
  return new NextRequest(`http://localhost${route}`, { headers: { cookie, ...(bearer ? { Authorization: 'Bearer fake-independent-credential' } : {}) } })
}

test('revoked cookies get SESSION_REQUIRED on API requests with or without unsigned identity', async () => {
  const h = harness()
  const token = session.signSession({ id: 7 })
  await h.writer.revokeSessionToken(token)
  for (const route of ['/api/projects', '/api/mcp/token', '/api/v1/token', '/api/tasks.json']) {
    for (const user of [false, true]) {
      const response = await h.proxy(request(route, token, { user }))
      assert.equal(response.status, 401)
      assert.deepEqual(await response.json(), { error: 'Unauthorized', code: 'SESSION_REQUIRED' })
    }
  }
})

test('revoked page cookies reload the same URL signed out, keeping login link tokens', async () => {
  const h = harness()
  const token = session.signSession({ id: 7 })
  await h.writer.revokeSessionToken(token)
  for (const route of ['/inbox', '/login?token=fresh-link-value']) {
    const response = await h.proxy(request(route, token))
    assert.equal(response.status, 307)
    assert.equal(response.headers.get('location'), `http://localhost${route}`)
    for (const name of ['ht_session', 'nookies_user']) {
      assert.equal(response.cookies.get(name)?.value, '')
      assert.equal(response.cookies.get(name)?.expires.getTime(), 0)
    }
  }
  const reload = await h.proxy(request('/inbox', undefined, { user: false }))
  assert.match(reload.headers.get('location') ?? '', /\/login/)
})

test('cookie-free machine endpoints are not blocked by a revoked incidental cookie', async () => {
  const h = harness()
  const token = session.signSession({ id: 7 })
  await h.writer.revokeSessionToken(token)
  for (const route of ['/oauth/token', '/oauth/register', '/oauth/revoke', '/mcp', '/sse', '/message', '/mcp-health', '/.well-known/oauth-authorization-server']) {
    const response = await h.proxy(request(route, token))
    assert.equal(response.headers.get('x-middleware-next'), '1', route)
  }
})

test('cookie-authenticated OAuth pages refuse a revoked cookie', async () => {
  const h = harness()
  const token = session.signSession({ id: 7 })
  await h.writer.revokeSessionToken(token)
  const response = await h.proxy(request('/oauth/authorize?client_id=c', token))
  assert.equal(response.status, 307)
  assert.equal(response.cookies.get('ht_session')?.value, '')
})

test('a valid cookie still passes API and page handling without a negative cache', async () => {
  const h = harness()
  const token = session.signSession({ id: 7 })
  for (const route of ['/api/projects', '/inbox']) {
    const response = await h.proxy(request(route, token))
    assert.equal(response.headers.get('x-middleware-next'), '1')
    assert.equal(response.headers.has('location'), false)
  }
  assert.equal(h.calls.length, 2)
  await h.writer.revokeSessionToken(token)
  assert.equal((await h.proxy(request('/api/projects', token))).status, 401)
})

test('a Redis outage fails open for otherwise-valid API and page cookies', async () => {
  const h = harness()
  h.redis.get = async () => { throw new Error('fake outage') }
  for (const route of ['/api/projects', '/inbox']) {
    const response = await h.proxy(request(route, session.signSession({ id: 7 })))
    assert.equal(response.headers.get('x-middleware-next'), '1')
  }
})

test('a hanging Redis read is bounded and fails open at the proxy', async () => {
  const h = harness()
  h.redis.get = () => new Promise(() => {})
  const start = performance.now()
  const response = await h.proxy(request('/api/projects', session.signSession({ id: 7 })))
  assert.equal(response.headers.get('x-middleware-next'), '1')
  assert.ok(performance.now() - start < 1000)
})

test('invalid or absent cookies do not cause a Redis lookup', async () => {
  const h = harness()
  assert.equal((await h.proxy(request('/api/projects', 'invalid', { user: false }))).status, 200)
  assert.equal((await h.proxy(request('/api/projects', undefined, { user: false }))).status, 200)
  assert.deepEqual(h.calls, [])
})

test('MCP Bearer requests stay untouched even with a revoked incidental cookie', async () => {
  const h = harness()
  const token = session.signSession({ id: 7 })
  await h.writer.revokeSessionToken(token)
  for (const route of ['/api/mcp/projects', '/api/mcp/token', '/api/v1/token']) {
    const response = await h.proxy(request(route, token, { bearer: true }))
    assert.equal(response.headers.get('x-middleware-next'), '1')
    assert.equal(response.headers.get('x-cli-latest-version'), '1.10.2')
  }
  assert.deepEqual(h.calls, [])
})

test('auth cleanup and independently credentialed logins remain reachable with a revoked cookie', async () => {
  const h = harness()
  const token = session.signSession({ id: 7 })
  await h.writer.revokeSessionToken(token)
  for (const route of ['/api/auth/sign-out', '/api/auth/force-signout', '/api/auth/verify-code', '/api/auth/verify-email-token', '/api/auth/sign-in/email', '/api/auth/bridge-session']) {
    assert.equal((await h.proxy(request(route, token))).headers.get('x-middleware-next'), '1')
  }
})
