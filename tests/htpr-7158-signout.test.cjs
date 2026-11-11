const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest, NextResponse } = require('next/server')
const cookieHelpers = require('better-auth/cookies')

function load(relativePath, imports = {}) {
  const javascript = ts.transpileModule(readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', javascript)(mod, mod.exports, (name) => {
    if (name in imports) return imports[name]
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

function harness() {
  const store = new Map()
  const events = []
  const redis = {
    set: async (key, value) => { events.push('revoke'); store.set(key, value); return 'OK' },
    get: async (key) => store.get(key) ?? null,
  }
  const revocation = load('src/lib/auth/sessionRevocation.ts', {
    '@/lib/auth/session': session, '@/lib/redis': { getRedis: async () => redis },
  })
  return {
    events, store, redis, revocation,
    imports: {
      'next/server': { NextRequest, NextResponse },
      'better-auth/cookies': cookieHelpers,
      '@/lib/auth/session': session,
      '@/lib/auth/sessionRevocation': revocation,
      '@/lib/auth/betterAuth': { auth: { api: { signOut: async () => NextResponse.json({ success: true }) } } },
    },
  }
}

function request(route, token, body) {
  return new NextRequest(`http://localhost${route}`, {
    method: body === undefined && route === '/api/demo/reset' ? 'GET' : 'POST',
    headers: { cookie: `ht_session=${token}; nookies_user=%7B%22id%22%3A7%7D; signup_source=demo` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function assertCleared(response) {
  for (const name of ['ht_session', 'nookies_user', 'better-auth.session_token', '__Secure-better-auth.session_token']) {
    assert.equal(response.cookies.get(name)?.value, '')
    assert.equal(response.cookies.get(name)?.maxAge, 0)
  }
}

test('force-signout revokes the presented cookie before clearing all auth cookies', async () => {
  const h = harness()
  const { POST } = load('src/app/api/auth/force-signout/route.ts', h.imports)
  const token = session.signSession({ id: 7 })
  const response = await POST(request('/api/auth/force-signout', token))
  assert.equal(response.status, 200)
  assert.deepEqual(h.events, ['revoke'])
  assertCleared(response)
  assert.equal(await h.revocation.isSessionTokenRevoked(token, { failClosed: false }), true)
})

test('force-signout still clears after a failed Redis write and invalid request JSON', async (t) => {
  const h = harness()
  const errors = []
  t.mock.method(console, 'error', (...args) => errors.push(args))
  let attempts = 0
  h.redis.set = async () => { attempts++; throw new Error('fake outage') }
  const { POST } = load('src/app/api/auth/force-signout/route.ts', h.imports)
  const response = await POST(new Request('http://localhost/api/auth/force-signout', {
    method: 'POST', headers: { cookie: `ht_session=${session.signSession({ id: 7 })}` }, body: 'not-json',
  }))
  assertCleared(response)
  assert.equal(attempts, 2)
  assert.equal(errors.length, 1)
})

test('demo reset revokes guests before clearing, but leaves real users untouched', async () => {
  for (const isGuest of [true, false]) {
    const h = harness()
    const { GET } = load('src/app/api/demo/reset/route.ts', {
      ...h.imports, '@/lib/demo/guestGuard': { isGuestRequest: async () => isGuest },
    })
    const token = session.signSession({ id: 7 })
    const response = await GET(request('/api/demo/reset', token))
    assert.equal(response.status, 307)
    assert.equal(response.headers.get('location'), 'http://localhost/demo')
    assert.equal(await h.revocation.isSessionTokenRevoked(token, { failClosed: false }), isGuest)
    if (isGuest) {
      assertCleared(response)
      assert.equal(response.cookies.get('signup_source')?.maxAge, 0)
    } else assert.equal(response.headers.has('set-cookie'), false)
  }
})

test('delete-account revokes and clears only after a successful authorized reset', async () => {
  for (const status of [200, 500, 401]) {
    const h = harness()
    const token = session.signSession({ id: 7 })
    const { POST } = load('src/app/api/users/delete-account/route.ts', {
      ...h.imports,
      '@/lib/auth/serverUser': { getServerCookieUser: async () => status === 401 ? null : { id: 7 } },
      '@/utils/controllers/users/resetUserAccount': {
        resetUserAccount: async (id) => { assert.equal(id, 7); h.events.push('reset'); return { status, json: { error: 'fixture' } } },
      },
    })
    const response = await POST(request('/api/users/delete-account', token))
    assert.equal(response.status, status)
    assert.equal(await h.revocation.isSessionTokenRevoked(token, { failClosed: false }), status === 200)
    if (status === 200) {
      assert.deepEqual(h.events, ['reset', 'revoke'])
      assertCleared(response)
    } else assert.equal(response.headers.has('set-cookie'), false)
  }
})

test('the actual Better Auth sign-out dispatch and multi-session after-hook retain the incoming legacy cookie', async () => {
  const h = harness()
  const api = await import('better-auth/api')
  const { multiSession } = await import('better-auth/plugins')
  const token = session.signSession({ id: 7 })
  const unavailable = () => { throw new Error('sign-out must not run login work') }
  const { legacyCookiePlugin } = load('src/lib/auth/legacyCookiePlugin.ts', {
    ...h.imports, 'better-auth/api': api,
    '@vercel/functions': { waitUntil: unavailable },
    '@/lib/onboarding/emails/welcome': { maybeSendWelcomeEmail: unavailable },
    '@/lib/onboarding/emails/agentNudge': { maybeScheduleAgentNudge: unavailable },
    '@/lib/auth/slimUserCookie': { slimUserForCookie: unavailable },
    '@/lib/auth/themeCookie': {}, '@/lib/configs/auth.config': {}, '@/lib/themePreferences': {},
    '@/lib/prisma': { default: { user: { findUnique: unavailable } } },
    '@/utils/controllers/demo/adoptGuestBoards': { adoptGuestBoards: unavailable },
    '@/utils/controllers/demo/resolveLoginBoard': {}, '@/utils/controllers/users/provisionFirstWorkspace': {},
    '@/lib/constants/constants': {}, '@/lib/flags': {},
  })
  const legacy = legacyCookiePlugin()
  const hook = legacy.hooks.after.find((entry) => entry.matcher({ path: '/sign-out' }) && !entry.matcher({ path: '/sign-in/email' }))
  assert.ok(hook)
  assert.equal(hook.matcher({ path: '/multi-session/set-active' }), true)
  assert.equal(hook.matcher({ path: '/sign-out/other' }), false)
  const options = { baseURL: 'http://localhost', plugins: [multiSession(), legacy] }
  const incoming = request('/api/auth/sign-out', token)
  const { serializeSignedCookie } = require('better-call')
  const deviceCookie = await serializeSignedCookie('better-auth.session_token_multi-fixture', 'device-fixture', 'local-better-auth-fixture')
  incoming.headers.append('cookie', deviceCookie.split(';')[0])
  const response = await api.dispatchAuthEndpoint(api.signOut, {
    request: incoming,
    headers: incoming.headers,
    context: {
      options, authCookies: cookieHelpers.getCookies(options), secret: 'local-better-auth-fixture',
      oauthConfig: { storeStateStrategy: 'database' }, logger: { level: 'error', error: unavailable },
      internalAdapter: { deleteSession: async () => {}, deleteSessions: async (tokens) => { assert.deepEqual(tokens, ['device-fixture']); h.events.push('multi-revoke') } },
    },
  })
  assert.equal(response.status, 200, response.status === 200 ? '' : (await response.json()).message)
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith('better-auth.session_token=;')))
  assert.deepEqual(h.events, ['multi-revoke', 'revoke'])
  assert.equal(await h.revocation.isSessionTokenRevoked(token, { failClosed: false }), true)
})


function legacyHook(h) {
  const unavailable = () => { throw new Error('the revocation hook must not run login work') }
  const { legacyCookiePlugin } = load('src/lib/auth/legacyCookiePlugin.ts', {
    ...h.imports, 'better-auth/api': require('better-auth/api'),
    '@vercel/functions': { waitUntil: unavailable },
    '@/lib/onboarding/emails/welcome': {}, '@/lib/onboarding/emails/agentNudge': {},
    '@/lib/auth/slimUserCookie': {}, '@/lib/auth/themeCookie': {}, '@/lib/configs/auth.config': {}, '@/lib/themePreferences': {},
    '@/lib/prisma': { default: {} },
    '@/utils/controllers/demo/adoptGuestBoards': {}, '@/utils/controllers/demo/resolveLoginBoard': {},
    '@/utils/controllers/users/provisionFirstWorkspace': {}, '@/lib/constants/constants': {}, '@/lib/flags': {},
  })
  return legacyCookiePlugin().hooks.after.find((entry) => entry.matcher({ path: '/multi-session/set-active' }) && !entry.matcher({ path: '/sign-in/email' }))
}

test('a successful account switch revokes the outgoing cookie; a failed one keeps it working', async () => {
  const h = harness()
  const hook = legacyHook(h)
  const outgoing = session.signSession({ id: 7 })
  const ctx = (newSession) => ({ path: '/multi-session/set-active', context: { newSession }, headers: new Headers({ cookie: `ht_session=${outgoing}` }) })

  await hook.handler(ctx(null))
  assert.equal(await h.revocation.isSessionTokenRevoked(outgoing, { failClosed: true }), false)

  await hook.handler(ctx({ user: { id: '8' }, session: {} }))
  assert.equal(await h.revocation.isSessionTokenRevoked(outgoing, { failClosed: false }), true)
})

test('account-specific sign-out makes no client revocation call and a failed switch revokes nothing', async (t) => {
  const h = harness()
  t.mock.method(global, 'fetch', async () => { throw new Error('signOutCurrentAccount must not call fetch') })
  global.window = { location: { assign: (url) => h.events.push(`navigate:${url}`) } }
  const { signOutCurrentAccount } = load('src/lib/auth/accounts.ts', {
    nookies: {}, '@/lib/configs/auth.config': {},
    '@/lib/auth/betterAuthClient': { authClient: {
      getSession: async () => ({ data: { session: { token: 'A' } } }),
      multiSession: {
        setActive: async ({ sessionToken }) => { h.events.push(`activate:${sessionToken}`); return { error: { message: 'fake failure' } } },
        revoke: async () => { throw new Error('must not remove A after a failed switch') },
      },
    } },
  })
  assert.equal(await signOutCurrentAccount('B'), false)
  assert.deepEqual(h.events, ['activate:B'])
  assert.equal(h.store.size, 0)
})
