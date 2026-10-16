const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')
process.env.JWT_SECRET = 'test-only-signup-identity-secret'
process.env.RESEND_API_KEY = ''
const root = path.resolve(__dirname, '..')

function loader(aliases = {}, transform = (_file, source) => source) {
  const cache = new Map()
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports
    const loaded = { exports: {} }
    cache.set(relative, loaded)
    const javascript = ts.transpileModule(transform(relative, fs.readFileSync(path.join(root, relative), 'utf8')), {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    new Function('require', 'module', 'exports', javascript)((specifier) => {
      if (specifier in aliases) return aliases[specifier]
      let local
      if (specifier.startsWith('@/')) local = `src/${specifier.slice(2)}`
      else if (specifier.startsWith('.')) local = path.join(path.dirname(relative), specifier)
      if (local) {
        const filename = ['', '.ts', '.tsx'].map((suffix) => local + suffix).find((file) => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile())
        if (filename) return load(filename)
      }
      return require(specifier)
    }, loaded, loaded.exports)
    return loaded.exports
  }
  return load
}

function harness({ enabled = true, redisFailure = false, existing = false } = {}) {
  const values = new Map()
  const calls = { flags: [], captures: [], events: [], warnings: [], provision: [], redis: [], code: null, jwt: null }
  const user = { id: 123, uid: 'email_test', email: 'new@example.test', displayName: 'New' }
  let codeAttempt = { code: '123456', createdAt: new Date(), used: false }
  let codeConsumed = false
  let accountExists = existing
  const redis = {
    set: async (key, value, ex, ttl) => { calls.redis.push(['set', key, ex, ttl]); values.set(key, { value, expires: Date.now() + ttl * 1000 }); return 'OK' },
    getdel: async (key) => { calls.redis.push(['getdel', key]); const record = values.get(key); values.delete(key); return record && record.expires > Date.now() ? record.value : null },
  }
  const aliases = {
    '@/lib/redis': { getRedis: async () => { if (redisFailure) throw new Error('Redis down'); return redis } },
    '@/lib/flags': { isFeatureEnabled: async (key, id) => { calls.flags.push([key, id]); return enabled } },
    '@/lib/prisma': {
      user: { create: async () => { accountExists = true; return user }, findFirst: async () => accountExists ? user : null, findUnique: async () => user, update: async () => user },
      googleAccount: { findFirst: async () => null },
      verificationCode: { findUnique: async () => codeAttempt },
    },
    '@/lib/configs/auth.config': { onboarding: { shouldSkipInteractive: false, skipOnboarding: false } },
    '@/lib/configs/general.config': { generalConfig: { defaultPhotoURL: 'photo' } },
    '@/utils/controllers/users/findUserByEmail': { findUserByEmail: async () => accountExists ? user : null },
    '@/utils/controllers/users/provisionNewUser': { provisionNewUser: async (data) => { calls.provision.push(data); return user }, updateUserProfilePicture: async () => {} },
    '@/lib/telemetry/signupAnalytics': {
      recordServerCapture: (capture) => calls.captures.push(capture),
      recordUserSignedUp: (event) => calls.events.push(event),
      signupAttributionFromHeaders: () => ({ signupMethod: 'email' }),
    },
    '@/lib/services/verificationCodeService': { VerificationCodeService: {
      isRateLimited: () => ({ limited: false }), generateCode: () => codeAttempt.code,
      storeCode: async (code) => { calls.code = code },
      verifyCode: async () => { if (codeConsumed) return null; codeConsumed = true; codeAttempt.used = true; return user.email },
    } },
    '@/lib/auth/emailCodeRateLimit': { claimEmailCodeAttempt: async () => ({ ipAllowed: true, emailAllowed: true }), getEmailCodeClientIp: () => '127.0.0.1' },
    '@/lib/auth/emailLinkToken': { consumeEmailLinkToken: async () => true },
    '@/lib/auth/requestBaseUrl': { getRequestBaseUrl: () => 'https://app.hypertask.ai' },
    '@/lib/auth/session': { SESSION_COOKIE: 'ht_session', SESSION_TTL_SECONDS: 3600, signSession: () => 'session', sessionCookieOptions: () => ({}), clearBetterAuthSessionCookies: () => {} },
    '@/lib/auth/slimUserCookie': { slimUserForCookie: (value) => value },
    '@/lib/auth/themeCookie': { seedResponseThemeCookie: () => {} },
    '@/utils/controllers/demo/adoptGuestBoards': { adoptGuestBoards: async () => {} },
    '@/utils/controllers/demo/resolveLoginBoard': { resolveLoginBoard: async () => ({ id: 42 }) },
    '@/utils/controllers/users/autoJoinByEmailDomain': async () => {},
    '@/utils/controllers/users/provisionFirstWorkspace': { provisionFirstWorkspace: async () => {} },
    '@/lib/constants/constants': { companySizeOptions: [], companyRoleOptions: [] },
    '@/lib/onboarding/emails/welcome': { maybeSendWelcomeEmail: async () => {} },
    '@/lib/onboarding/emails/agentNudge': { maybeScheduleAgentNudge: async () => {} },
    '@vercel/functions': { waitUntil: () => {} },
    '@/lib/email/sendEmail': { sendEmail: async () => {} },
    jsonwebtoken: { sign: (payload) => { calls.jwt = payload; return 'signed-token' }, verify: () => ({ sub: user.email, signupContextId: calls.jwt?.signupContextId }) },
  }
  aliases['./provisionNewUser'] = aliases['@/utils/controllers/users/provisionNewUser']
  aliases['./findUserByEmail'] = aliases['@/utils/controllers/users/findUserByEmail']
  aliases['./signupAnalytics'] = aliases['@/lib/telemetry/signupAnalytics']
  const load = loader(aliases)
  const context = load('src/lib/auth/signupAttributionContext.ts')
  const identity = load('src/lib/telemetry/signupIdentityLink.ts')
  const pure = load('src/lib/analytics/signupIdentity.ts')
  aliases['@/utils/controllers/users/update_or_create_user'] = load('src/utils/controllers/users/update_or_create_user.ts').default
  return { load, context, identity, pure, aliases, calls, values, user, setAttempt: (attempt) => { codeAttempt = attempt } }
}
function betterAuthHarness(h) {
  const plugin = () => ({})
  Object.assign(h.aliases, {
    'better-auth': { betterAuth: (options) => options },
    'better-auth/api': { createAuthMiddleware: (handler) => handler },
    'better-auth/adapters/prisma': { prismaAdapter: plugin },
    'better-auth/plugins': { emailOTP: plugin, magicLink: plugin, multiSession: plugin },
    '@better-auth/api-key': { apiKey: () => ({ schema: { apikey: { fields: { referenceId: {} } } } }) },
    '@better-auth/infra': { dash: plugin }, '@better-auth/passkey': { passkey: plugin },
    '@/lib/auth/bridgePlugin': { bridgeSessionPlugin: plugin },
    '@/lib/auth/legacyCookiePlugin': { legacyCookiePlugin: plugin, newGoogleSignupRequests: new WeakMap() },
    '@/lib/mcp/managementPermissions': { MANAGEMENT_KEY_PERMISSIONS: {} },
  })
  return h.load('src/lib/auth/betterAuth.ts').auth
}
const allowedCookie = 'ht_cookie_consent=all'
const input = { anonymousId: 'anon-visitor-abc', consent: 'all', attribution: { utm_source: 'website' } }
function request(url, body, headers = {}) {
  return new NextRequest(`https://app.hypertask.ai${url}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: allowedCookie, ...headers }, body: JSON.stringify(body) })
}

async function quiet(work) {
  const original = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  try { return await work(warnings) } finally { console.warn = original }
}

test('consented anonymous signup links once; retries reuse a deterministic UUID', async () => {
  const h = harness()
  const id = await h.context.createSignupContext(input, 1800, allowedCookie)
  assert.match(id, /^[0-9a-f-]{36}$/)
  const stored = [...h.values.values()][0]
  assert.deepEqual(Object.keys(JSON.parse(stored.value)).sort(), ['v', 'consent', 'anonymousId', 'reason', 'attribution', 'attributionStatus', 'createdAt'].sort())
  assert.equal(h.calls.redis[0][3], 1800)
  const consumed = await h.context.consumeSignupContext(id)
  await h.identity.recordSignupIdentityLink(123, true, consumed, allowedCookie)
  assert.equal(h.calls.captures.length, 1)
  assert.deepEqual(h.calls.captures[0], { distinctId: '123', event: '$identify', properties: { $anon_distinct_id: input.anonymousId }, uuid: h.identity.signupIdentityUuid(123) })
  await h.identity.recordSignupIdentityLink(123, true, consumed, allowedCookie)
  assert.equal(h.calls.captures[0].uuid, h.calls.captures[1].uuid)
  assert.match(h.calls.captures[0].uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(h.identity.signupIdentityUuid(124), h.identity.signupIdentityUuid(123))
  assert.deepEqual(h.calls.flags.map(([, id]) => id), [0, 123, 123])
})

test('essential consent strips identity and attribution, and never identifies', async () => quiet(async () => {
  const h = harness()
  const id = await h.context.createSignupContext({ ...input, consent: 'essential' }, 1800, allowedCookie)
  const stored = JSON.parse([...h.values.values()][0].value)
  assert.equal(stored.anonymousId, null)
  assert.deepEqual(stored.attribution, {})
  const decision = await h.identity.recordSignupIdentityLink(123, true, id, allowedCookie)
  assert.equal(decision.link, false)
  assert.equal(decision.reason, 'consent_denied')
  assert.equal(decision.attributionStatus, 'withheld')
  assert.deepEqual(h.calls.captures, [])
}))

test('opt-in only: a missing consent choice is denied, like a rejection (Valentin, MARK-164)', () => {
  const h = harness()
  assert.equal(h.pure.consentAllowsLinking(null), false)
  assert.equal(h.pure.consentAllowsLinking('essential'), false)
  const missing = h.pure.normalizeSignupContext({ ...input, consent: null })
  assert.equal(missing.anonymousId, null)
  assert.deepEqual(missing.attribution, {})
  assert.equal(missing.attributionStatus, 'withheld')
  assert.equal(h.pure.decideSignupIdentityLink(123, missing).reason, 'consent_denied')
  assert.deepEqual(h.pure.readSignupBrowserIdentity({ get_property: () => undefined, get_distinct_id: () => 'anon' }, null), { anonymousId: null, consent: null, reason: 'consent_denied' })
})

test('still allowed: accepted consent links the visit', () => {
  const h = harness()
  assert.equal(h.pure.consentAllowsLinking('all'), true)
  assert.equal(h.pure.decideSignupIdentityLink(123, h.pure.normalizeSignupContext(input)).link, true)
})

test('server consent cookie overrides the browser report only towards denial', async () => {
  const h = harness()
  for (const cookie of ['ht_cookie_consent=essential', 'a=1; ht_cookie_consent=essential', 'ht_cookie_consent=bogus']) {
    assert.equal(h.pure.strictestConsent('all', cookie), 'essential')
  }
  assert.equal(h.pure.strictestConsent('all', 'ht_cookie_consent=all'), 'all')
  assert.equal(h.pure.strictestConsent(null, 'ht_cookie_consent=all'), null)
  assert.equal(h.pure.strictestConsent('all', null), 'essential')
  assert.equal(h.pure.strictestConsent('all', 'other=1'), 'essential')
  const id = await h.context.createSignupContext(input, 1800, 'ht_cookie_consent=essential')
  const stored = await h.context.consumeSignupContext(id)
  assert.equal(stored.consent, 'essential')
  assert.equal(stored.anonymousId, null)
  assert.deepEqual(stored.attribution, {})
  assert.equal(stored.attributionStatus, 'withheld')
})

test('browser only uses loaded anonymous SDK identity, never a guest or previous account', () => {
  const h = harness()
  const sdk = (state, id) => ({ get_property: (key) => key === '$user_state' ? state : id, get_distinct_id: () => 'anon-visitor' })
  assert.deepEqual(h.pure.readSignupBrowserIdentity(null, 'all'), { anonymousId: null, consent: 'all', reason: 'sdk_not_ready' })
  for (const [state, id] of [['identified', '900'], ['identified', undefined], [undefined, '123']]) {
    assert.equal(h.pure.readSignupBrowserIdentity(sdk(state, id), 'all').reason, 'already_identified')
  }
  assert.equal(h.pure.readSignupBrowserIdentity(sdk('anonymous'), 'all').anonymousId, 'anon-visitor')
  assert.equal(h.pure.readSignupBrowserIdentity(sdk(undefined), 'all').anonymousId, 'anon-visitor')
  for (const reason of ['already_identified', 'sdk_not_ready']) {
    const decision = h.pure.decideSignupIdentityLink(123, h.pure.normalizeSignupContext({ consent: 'all', reason }))
    assert.equal(decision.reason, reason)
  }
  for (const anonymousId of ['123', '900']) assert.equal(h.pure.decideSignupIdentityLink(123, h.pure.normalizeSignupContext({ ...input, anonymousId })).reason, 'already_identified')
})

test('replayed, expired and malformed contexts cannot identify and have unknown attribution', async () => quiet(async () => {
  const h = harness()
  const id = await h.context.createSignupContext(input, 1800, allowedCookie)
  const winners = await Promise.all([h.context.consumeSignupContext(id), h.context.consumeSignupContext(id)])
  assert.equal(winners.filter(Boolean).length, 1)
  assert.equal(await h.context.consumeSignupContext(id), null)
  const decision = await h.identity.recordSignupIdentityLink(123, true, id, allowedCookie)
  assert.equal(decision.link, false)
  assert.equal(decision.attributionStatus, 'unknown')
  const expired = await h.context.createSignupContext(input, 1800, allowedCookie)
  for (const value of h.values.values()) value.expires = 0
  assert.equal(await h.context.consumeSignupContext(expired), null)
  const redisCalls = h.calls.redis.length
  for (const invalid of ['bad', 'a'.repeat(300), undefined, { id }]) assert.equal(await h.context.consumeSignupContext(invalid), null)
  assert.equal(h.calls.redis.length, redisCalls)
  assert.deepEqual(h.calls.captures, [])
}))

test('existing login discards its context; feature off creates nothing and preserves signup event', async () => {
  const h = harness({ existing: true })
  const id = await h.context.createSignupContext(input, 1800, allowedCookie)
  const result = await h.aliases['@/utils/controllers/users/update_or_create_user']('new@example.test', { displayName: 'New' }, false, false, true, { signupMethod: 'email' }, id)
  assert.equal(result.status, 200)
  assert.equal(await h.context.consumeSignupContext(id), null)
  assert.equal(h.calls.captures.length, 0)
  assert.equal(h.calls.events.length, 0)
  const off = harness({ enabled: false })
  assert.equal(await off.context.createSignupContext(input, 1800, allowedCookie), null)
  await off.aliases['@/utils/controllers/users/update_or_create_user']('new@example.test', {}, false, false, true)
  assert.equal(off.calls.redis.length, 0)
  assert.equal(off.calls.captures.length, 0)
  assert.equal(off.calls.events.length, 1)
  assert.equal(off.calls.events[0].signupMethod, 'email')
})

test('Redis failure is non-fatal at account insert and reports only context_unavailable', async () => quiet(async (warnings) => {
  const h = harness({ redisFailure: true })
  assert.equal(await h.context.createSignupContext(input, 1800, allowedCookie), null)
  const result = await h.aliases['@/utils/controllers/users/update_or_create_user']('new@example.test', {}, false, false, true, { signupMethod: 'email' }, 'c32c4a49-423a-4cf0-a487-b28f788166a6', allowedCookie)
  assert.equal(result.status, 200)
  assert.equal(h.calls.events.length, 1)
  assert.equal(h.calls.captures.length, 0)
  const context = await h.context.consumeSignupContext('c32c4a49-423a-4cf0-a487-b28f788166a6')
  assert.equal(h.pure.decideSignupIdentityLink(123, context).reason, 'context_unavailable')
  assert.ok(warnings.length > 0)
  for (const warning of warnings) {
    assert.deepEqual(warning, ['[signup-identity] unlinked', { reason: 'context_unavailable' }])
  }
}))

test('attribution is allowlisted, capped and external-only; direct is not unknown', async () => {
  const h = harness()
  const attribution = h.pure.sanitizeSignupAttribution({ utm_source: ` ${'x'.repeat(240)} `, utm_medium: ' email ', utm_campaign: 42, utm_term: 'term', utm_content: 'content', email: 'private@example.test', inviteKey: 'secret', initial_referrer: 'https://external.test/path?email=secret#token' })
  assert.deepEqual(attribution, { utm_source: 'x'.repeat(200), utm_medium: 'email', utm_term: 'term', utm_content: 'content', initial_referrer: 'https://external.test/path' })
  for (const referrer of ['https://app.hypertask.ai/invite?token=secret', 'javascript:alert(1)', 'not-url']) {
    assert.deepEqual(h.pure.sanitizeSignupAttribution({ initial_referrer: referrer }), {})
  }
  assert.equal(h.pure.normalizeSignupContext({ consent: 'all' }).attributionStatus, 'direct')
  assert.equal(h.pure.decideSignupIdentityLink(123, null).attributionStatus, 'unknown')
  assert.equal(h.pure.normalizeSignupContext(input).attributionStatus, 'known')
})

test('browser payload with denied consent has no anonymous id or free-form attribution', () => {
  const load = loader({ '@/lib/cookieConsent': { getCookieConsent: () => 'essential' }, '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({ email: 'private', utm_source: 'web' }) } })
  const client = load('src/lib/analytics/signupIdentityClient.ts')
  client.setSignupIdentitySdk({ get_property: () => 'anonymous', get_distinct_id: () => { throw new Error('must not read ID') } })
  assert.deepEqual(client.getSignupContextInput(), { consent: 'essential', reason: 'consent_denied', attribution: {} })
})

test('Google cookie route stores only opaque id with 10 minute secure HttpOnly options, then consumes and clears', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const h = harness()
    const { POST } = h.load('src/app/api/auth/signup-context/route.ts')
    const response = await POST(request('/api/auth/signup-context', input, { origin: 'https://app.hypertask.ai' }))
    assert.equal(response.status, 204)
    const cookie = response.cookies.get('ht_signup_ctx')
    assert.match(cookie.value, /^[0-9a-f-]{36}$/)
    assert.match(response.headers.get('set-cookie'), /HttpOnly/)
    assert.match(response.headers.get('set-cookie'), /Secure/)
    assert.match(response.headers.get('set-cookie'), /SameSite=lax/)
    assert.match(response.headers.get('set-cookie'), /Max-Age=600/)
    assert.equal(h.calls.redis[0][3], 600)
    assert.ok(!response.headers.get('set-cookie').includes(input.anonymousId))
    const clears = []
    const consumed = await h.context.consumeSignupCookie({ request: new Request('https://app.hypertask.ai/api/auth/callback/google', { headers: { cookie: `ht_signup_ctx=${cookie.value}` } }), setCookie: (...args) => clears.push(args) })
    assert.equal(consumed.anonymousId, input.anonymousId)
    assert.deepEqual(clears, [['ht_signup_ctx', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 }]])
    assert.equal(await h.context.consumeSignupContext(cookie.value), null)
    assert.equal((await POST(request('/api/auth/signup-context', input, { origin: 'https://evil.test' }))).status, 403)
    const off = harness({ enabled: false })
    assert.equal((await off.load('src/app/api/auth/signup-context/route.ts').POST(request('/api/auth/signup-context', input))).cookies.get('ht_signup_ctx').value, '')
    assert.equal(off.calls.redis.length, 0)
  } finally { process.env.NODE_ENV = previous }
})

test('email code and signed link share the same attempt-bound single-use context', async () => quiet(async () => {
  for (const completion of ['verify-code', 'verify-email-token']) {
    const h = harness()
    const sent = await h.load('src/app/api/auth/send-email-link/route.ts').POST(request('/api/auth/send-email-link', { email: h.user.email, signupContext: input }))
    assert.equal(sent.status, 200)
    const id = h.calls.jwt.signupContextId
    assert.match(id, /^[0-9a-f-]{36}$/)
    assert.deepEqual(Object.keys(h.calls.jwt).sort(), ['signupContextId', 'sub'])
    assert.ok(h.calls.redis.every(([, key]) => !key.includes(h.user.email) && !key.includes(h.calls.code)))
    const completed = await h.load(`src/app/api/auth/${completion}/route.ts`).POST(request(`/api/auth/${completion}`, { email: h.user.email, code: h.calls.code, token: 'signed-token' }))
    assert.equal(completed.status, 200, await completed.text())
    assert.equal(h.calls.captures.length, 1)
    assert.equal(h.calls.events.length, 1)
    assert.equal(await h.context.consumeSignupContext(id), null)
    assert.equal(h.calls.captures[0].event, '$identify')
    const other = completion === 'verify-code' ? 'verify-email-token' : 'verify-code'
    const second = await h.load(`src/app/api/auth/${other}/route.ts`).POST(request(`/api/auth/${other}`, { email: h.user.email, code: h.calls.code, token: 'signed-token' }))
    assert.equal(second.status, 200, await second.text())
    assert.equal(h.calls.captures.length, 1)
    assert.equal(h.calls.events.length, 1)
  }
}))

test('email binding refuses wrong email/code and a later reused-code attempt', async () => {
  const h = harness()
  const attempt = { code: '123456', createdAt: new Date('2026-10-16T01:00:00Z'), used: false }
  h.setAttempt(attempt)
  const id = await h.context.createSignupContext(input, 1800, allowedCookie)
  await h.context.bindSignupCodeContext('new@example.test', '123456', id)
  assert.equal(await h.context.takeSignupCodeContext('new@example.test', '999999'), null)
  h.setAttempt({ ...attempt, used: true, createdAt: new Date('2026-10-16T01:01:00Z') })
  assert.equal(await h.context.takeSignupCodeContext('new@example.test', '123456'), null)
  h.setAttempt({ ...attempt, used: true })
  assert.equal(await h.context.takeSignupCodeContext('other@example.test', '123456'), null)
  assert.equal(await h.context.takeSignupCodeContext(' New@Example.Test ', '123456'), id)
  assert.equal(await h.context.takeSignupCodeContext('new@example.test', '123456'), null)
})

test('instant signup consumes at insert; existing login discards with no second identify', async () => {
  for (const existing of [false, true]) {
    const h = harness({ existing })
    const response = await h.load('src/app/api/auth/instant-signup/route.ts').POST(request('/api/auth/instant-signup', { email: h.user.email, signupContext: input }))
    assert.equal(response.status, 200)
    assert.equal(h.calls.captures.length, existing ? 0 : 1)
    assert.ok([...h.values.keys()].every((key) => !key.startsWith('auth:signup-context:')))
    assert.equal(h.calls.events.length, existing ? 0 : 1)
  }
})

test('Better Auth new-user hook links and clears; existing-session hook only discards', async () => {
  for (const isNew of [false, true]) {
    const h = harness()
    const auth = betterAuthHarness(h)
    const id = await h.context.createSignupContext({ ...input, method: 'google' }, 600, allowedCookie)
    const clears = []
    const context = { request: new Request('https://app.hypertask.ai/api/auth/callback/google', { headers: { cookie: `${allowedCookie}; ht_signup_ctx=${id}` } }), path: '/callback/google', setCookie: (...args) => clears.push(args), context: { newSession: { user: h.user } } }
    if (isNew) await auth.databaseHooks.user.create.after({ ...h.user, name: 'New' }, context)
    await auth.hooks.after(context)
    assert.equal(h.calls.captures.length, isNew ? 1 : 0)
    assert.equal(h.calls.events.length, isNew ? 1 : 0)
    assert.ok(clears.every(([, value, options]) => value === '' && options.maxAge === 0))
    assert.equal(await h.context.consumeSignupContext(id), null)
  }
})

test('all browser auth starts carry context before sign-in; identify and reset calls stay in place', () => {
  for (const file of ['src/hooks/General/useAuth.tsx', 'src/app/login/LoginButton.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const calls = source.match(/if \(signupIdentityLinkEnabled\) await prepareSignupContext\("google"\);\s*(?:const \{ error \} = await|void) authClient\.signIn\.social\(/g)
    assert.equal(calls.length, file.includes('useAuth') ? 2 : 1)
  }
  const email = fs.readFileSync(path.join(root, 'src/app/login/EmailAuth/useEmailAuth.ts'), 'utf8')
  assert.equal((email.match(/signupIdentityLinkEnabled \? \{ signupContext: getSignupContextInput\(\) \} : \{\}/g) || []).length, 3)
  assert.match(email, /signupIdentityLinkEnabled \? prepareSignupContext.bind\(null, 'magic_link', email\) : null/)
  assert.equal((email.match(/await prepareSignupAttempt\?\.\(\)\s*const \{ error \} = await authClient.signIn.magicLink/g) || []).length, 2)
})

test('installed posthog-node accepts $identify and preserves the UUID on the wire', async () => {
  const { PostHog } = require('posthog-node')
  const bodies = []
  const client = new PostHog('test-token', { flushAt: 1, flushInterval: 0, disableGeoip: true, disableCompression: true, fetchRetryCount: 0, fetch: async (_url, options) => {
    bodies.push(JSON.parse(options.body))
    return { status: 200, text: async () => '{}', json: async () => ({}) }
  } })
  const { signupIdentityUuid } = harness().identity
  const capture = { distinctId: '123', event: '$identify', properties: { $anon_distinct_id: 'anon-test' }, uuid: signupIdentityUuid(123) }
  await client.captureImmediate(capture)
  await client.captureImmediate(capture)
  const events = bodies.flatMap((body) => body.batch ?? [body])
  assert.equal(events.length, 2)
  assert.equal(events[0].event, '$identify')
  assert.equal(events[0].distinct_id, '123')
  assert.equal(events[0].properties.$anon_distinct_id, 'anon-test')
  assert.equal(events[0].uuid, capture.uuid)
  assert.equal(events[1].uuid, capture.uuid)
  await client.shutdown()
})


test('missing SDK and persisted identity report their reasons without a server identify', async () => quiet(async () => {
  for (const reason of ['sdk_not_ready', 'already_identified']) {
    const h = harness()
    const id = await h.context.createSignupContext({ anonymousId: null, consent: 'all', reason, attribution: {} }, 1800, allowedCookie)
    const decision = await h.identity.recordSignupIdentityLink(123, true, id, allowedCookie)
    assert.equal(decision.reason, reason)
    assert.equal(decision.attributionStatus, 'direct')
    assert.equal(h.calls.captures.length, 0)
  }
}))

test('commit-time flag still refuses linking after an enabled auth start', async () => {
  const h = harness()
  const id = await h.context.createSignupContext(input, 1800, allowedCookie)
  h.aliases['@/lib/flags'].isFeatureEnabled = async (_key, id) => { assert.equal(id, 123); return false }
  assert.equal(await h.identity.recordSignupIdentityLink(123, true, id, allowedCookie), null)
  assert.equal(await h.context.consumeSignupContext(id), null)
  assert.equal(h.calls.captures.length, 0)
})

test('registry defaults remain Owner + QA and unsupported consent creates no context', async () => {
  const h = harness()
  const definition = h.load('src/lib/flags/definitions/htpr-7269-signup-identity-link.ts').default
  assert.equal(definition.kind, 'feature')
  assert.equal(definition.defaultMode, 'OWNER_AND_QA')
  assert.equal(definition.shippedOn, '2026-10-16')
  assert.ok(definition.releaseRisk.risk && definition.releaseRisk.reason)
  for (const invalid of [null, {}, { consent: 'invalid', anonymousId: input.anonymousId }]) assert.equal(await h.context.createSignupContext(invalid), null)
  assert.equal(h.calls.redis.length, 0)
})

test('browser preparation reads current UTM storage only and network failure cannot block auth', async () => {
  const load = loader({ '@/lib/cookieConsent': { getCookieConsent: () => 'all' }, '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({ utm_source: 'web', utm_content: 'button', email: 'private', inviteKey: 'private' }) } })
  const client = load('src/lib/analytics/signupIdentityClient.ts')
  assert.equal(client.getSignupBrowserIdentity().reason, 'sdk_not_ready')
  client.setSignupIdentitySdk({ get_property: (key) => key === '$user_state' ? 'anonymous' : undefined, get_distinct_id: () => 'anon-browser' })
  const previousFetch = global.fetch
  let sent
  global.fetch = async (url, options) => { sent = { url, ...options }; throw new Error('network unavailable') }
  try {
    await client.prepareSignupContext("google")
    assert.equal(sent.url, '/api/auth/signup-context')
    assert.equal(sent.credentials, 'same-origin')
    assert.ok(sent.signal instanceof AbortSignal)
    assert.deepEqual(JSON.parse(sent.body), { consent: 'all', reason: null, anonymousId: 'anon-browser', attribution: { utm_source: 'web', utm_content: 'button' }, method: 'google' })
    client.setSignupIdentitySdk(null)
    assert.equal(client.getSignupBrowserIdentity().anonymousId, null)
  } finally { global.fetch = previousFetch }
})

test('server opt-in requires both the request cookie and browser report', async () => {
  for (const cookie of [null, '', 'other=1', 'ht_cookie_consent=essential', allowedCookie]) {
    for (const consent of ['all', 'essential', null]) {
      const h = harness()
      const id = await h.context.createSignupContext({ ...input, consent }, 1800, cookie)
      const context = await h.context.consumeSignupContext(id)
      const allowed = cookie === allowedCookie && consent === 'all'
      assert.equal(context.anonymousId, allowed ? input.anonymousId : null)
      assert.deepEqual(context.attribution, allowed ? input.attribution : {})
      assert.equal(context.attributionStatus, allowed ? 'known' : 'withheld')
      assert.equal(h.pure.decideSignupIdentityLink(123, context).link, allowed)
    }
  }
})

test('UUID is derived from SHA-256 with version 8 and RFC 4122 variant bits', () => {
  const { createHash } = require('node:crypto')
  const { signupIdentityUuid } = harness().identity
  for (const userId of [1, 123, 124]) {
    const actual = Buffer.from(signupIdentityUuid(userId).replaceAll('-', ''), 'hex')
    const expected = createHash('sha256').update(`hypertask:signup-identity:${userId}`).digest().subarray(0, 16)
    expected[6] = (expected[6] & 0x0f) | 0x80
    expected[8] = (expected[8] & 0x3f) | 0x80
    assert.deepEqual(actual, expected)
  }
})

test('email completions veto withdrawn or missing consent and preserve accepted consent', async () => quiet(async (warnings) => {
  for (const completion of ['verify-code', 'verify-email-token']) {
    for (const cookie of ['', 'ht_cookie_consent=essential', allowedCookie]) {
      const h = harness()
      await h.load('src/app/api/auth/send-email-link/route.ts').POST(request('/api/auth/send-email-link', { email: h.user.email, signupContext: input }))
      const id = h.calls.jwt.signupContextId
      warnings.length = 0
      const completed = await h.load(`src/app/api/auth/${completion}/route.ts`).POST(request(`/api/auth/${completion}`, { email: h.user.email, code: h.calls.code, token: 'signed-token' }, { cookie }))
      assert.equal(completed.status, 200)
      assert.equal(h.calls.captures.length, cookie === allowedCookie ? 1 : 0)
      assert.equal(h.calls.events.length, 1)
      assert.equal(await h.context.consumeSignupContext(id), null)
      if (cookie !== allowedCookie) assert.deepEqual(warnings, [['[signup-identity] unlinked', { reason: 'consent_withdrawn' }]])
    }
  }
}))

test('completion consent cannot upgrade a previously denied context', async () => quiet(async () => {
  const h = harness()
  const id = await h.context.createSignupContext(input, 1800, null)
  const decision = await h.identity.recordSignupIdentityLink(123, true, id, allowedCookie)
  assert.equal(decision.link, false)
  assert.equal(decision.reason, 'consent_denied')
  assert.equal(decision.attributionStatus, 'withheld')
  assert.deepEqual(decision.attribution, {})
  assert.equal(h.calls.captures.length, 0)
}))

test('Google completion vetoes consent withdrawal, withholds attribution, and consumes context', async () => quiet(async (warnings) => {
  for (const cookie of ['', 'ht_cookie_consent=essential', allowedCookie]) {
    const h = harness()
    const auth = betterAuthHarness(h)
    const id = await h.context.createSignupContext({ ...input, method: 'google' }, 600, allowedCookie)
    warnings.length = 0
    const context = { request: new Request('https://app.hypertask.ai/api/auth/callback/google', { headers: { cookie: `${cookie}; ht_signup_ctx=${id}` } }), path: '/callback/google' }
    await auth.databaseHooks.user.create.after(h.user, context)
    assert.equal(h.calls.captures.length, cookie === allowedCookie ? 1 : 0)
    assert.equal(await h.context.consumeSignupContext(id), null)
    if (cookie !== allowedCookie) assert.deepEqual(warnings, [['[signup-identity] unlinked', { reason: 'consent_withdrawn' }]])
  }
  const h = harness()
  const decision = await h.identity.recordSignupIdentityLink(123, true, h.pure.normalizeSignupContext(input))
  assert.equal(decision.reason, 'consent_withdrawn')
  assert.equal(decision.attributionStatus, 'withheld')
  assert.deepEqual(decision.attribution, {})
}))

test('Better Auth cookie context is bound to the flow and normalized email hash, never raw email', async () => quiet(async (warnings) => {
  for (const [method, email, flow, allowed] of [
    ['magic_link', 'new@example.test', '/callback/google', false],
    ['google', undefined, '/magic-link/verify', false],
    ['magic_link', 'other@example.test', '/magic-link/verify', false],
    ['magic_link', ' New@Example.Test ', '/magic-link/verify', true],
    ['google', undefined, '/callback/google', true],
    [undefined, undefined, '/callback/google', false],
  ]) {
    const h = harness()
    const auth = betterAuthHarness(h)
    const response = await h.load('src/app/api/auth/signup-context/route.ts').POST(request('/api/auth/signup-context', { ...input, method, email }))
    const id = response.cookies.get('ht_signup_ctx').value
    const stored = JSON.parse([...h.values.values()][0].value)
    assert.equal(stored.method, method)
    assert.equal(stored.email, undefined)
    if (method === 'magic_link') assert.equal(stored.emailHash, require('node:crypto').createHash('sha256').update(email.trim().toLowerCase()).digest('hex'))
    else assert.equal(stored.emailHash, undefined)
    warnings.length = 0
    const clears = []
    await auth.databaseHooks.user.create.after(h.user, { path: flow, request: new Request(`https://app.hypertask.ai/api/auth${flow}`, { headers: { cookie: `${allowedCookie}; ht_signup_ctx=${id}` } }), setCookie: (...args) => clears.push(args) })
    assert.equal(h.calls.captures.length, allowed ? 1 : 0)
    assert.equal(h.calls.events.length, 1)
    assert.equal(await h.context.consumeSignupContext(id), null)
    assert.equal(clears.length, 1)
    assert.equal(clears[0][2].maxAge, 0)
    if (!allowed) assert.deepEqual(warnings, [['[signup-identity] unlinked', { reason: 'attempt_mismatch' }]])
  }
}))

test('browser magic-link preparation includes the method and sign-in email', async () => {
  const client = loader({ '@/lib/cookieConsent': { getCookieConsent: () => 'all' }, '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({}) } })('src/lib/analytics/signupIdentityClient.ts')
  const previous = global.fetch
  let payload
  global.fetch = async (_url, options) => { payload = JSON.parse(options.body) }
  try {
    await client.prepareSignupContext('magic_link', ' New@Example.Test ')
    assert.equal(payload.method, 'magic_link')
    assert.equal(payload.email, ' New@Example.Test ')
  } finally { global.fetch = previous }
})

test('email browser starts omit signupContext and preparation when the feature flag is off', async () => {
  const previous = { fetch: global.fetch, sessionStorage: global.sessionStorage, betterAuth: process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL }
  try {
    global.sessionStorage = { setItem: () => {} }
    for (const enabled of [false, true]) {
      for (const betterAuth of [false, true]) {
        process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = betterAuth ? '1' : '0'
        const payloads = [], prepared = [], signIns = []
        global.fetch = async (_url, options) => { payloads.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ success: true }) } }
        const load = loader({
          react: { useState: (value) => [value, () => {}], useEffect: () => {}, useRef: (current) => ({ current }) },
          '@/hooks/useFlag': { useFlag: (key) => { assert.equal(key, 'htpr-7269-signup-identity-link'); return enabled } },
          '@/lib/flags/keys': { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG: 'htpr-7269-signup-identity-link' },
          '@/hooks/General/useAuth': { useAuth: () => ({ loginWithEmail: () => {} }) },
          '@/hooks/General/useUTMs': { useUTM: () => ({ getUTMData: () => ({}) }) },
          'next/navigation': { useSearchParams: () => new URLSearchParams() },
          '@/lib/configs/auth.config': { abTest: {}, redirect: { afterLogin: '/app' } },
          '@/lib/auth/safeReturnTo': { parseSafeReturnTo: () => null },
          '@/lib/analytics/signupIdentityClient': {
            getSignupContextInput: () => { assert.equal(enabled, true); return input },
            prepareSignupContext: async (...args) => { assert.equal(enabled, true); prepared.push(args) },
          },
          '@/lib/auth/betterAuthClient': { authClient: { signIn: { magicLink: async (options) => { signIns.push(options); return {} } } } },
        })
        const hook = load('src/app/login/EmailAuth/useEmailAuth.ts').useEmailAuth('new@example.test')
        await hook.handlers.handleSubmit({ preventDefault: () => {} })
        if (betterAuth) {
          assert.equal(signIns.length, 1)
          assert.deepEqual(prepared, enabled ? [['magic_link', 'new@example.test']] : [])
          assert.equal(payloads.length, 0)
        } else {
          assert.equal(payloads.length, 1)
          assert.equal(Object.hasOwn(payloads[0], 'signupContext'), enabled)
          assert.deepEqual(prepared, [])
        }
      }
    }
  } finally {
    global.fetch = previous.fetch
    global.sessionStorage = previous.sessionStorage
    if (previous.betterAuth === undefined) delete process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL
    else process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = previous.betterAuth
  }
})

test('all four UI entries use the recognized ticket flag; SDK registration is guarded and cleared on disable', () => {
  for (const file of ['src/hooks/General/useAuth.tsx', 'src/app/login/LoginButton.tsx', 'src/app/login/EmailAuth/useEmailAuth.ts', 'src/components/Analytics/PostHogAnalytics.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.match(source, /useFlag\(HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG\)/)
    assert.match(source, /import \{ HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG \} from ["']@\/lib\/flags\/keys["']/)
  }
  const source = fs.readFileSync(path.join(root, 'src/components/Analytics/PostHogAnalytics.tsx'), 'utf8')
  assert.match(source, /if \(signupIdentityLinkEnabledRef.current\) setSignupIdentitySdk\(loadedPostHog\)/)
  const effect = source.match(/useLayoutEffect\((signupIdentityLinkEnabled \? \(\) => \{[\s\S]*?)\n  \}, \[signupIdentityLinkEnabled\]\)/)[1] + '\n  }'
  const calls = [], ref = { current: false }, sdk = {}
  const selectEffect = new Function('signupIdentityLinkEnabled', 'signupIdentityLinkEnabledRef', 'posthogRef', 'setSignupIdentitySdk', `return (${effect})`)
  const apply = (enabled) => selectEffect(enabled, ref, { current: sdk }, (value) => calls.push(value))()
  assert.equal(apply(false), undefined)
  assert.deepEqual(calls, [])
  const cleanup = apply(true)
  assert.deepEqual(calls, [sdk])
  cleanup()
  apply(false)
  assert.deepEqual(calls, [sdk, null])
  assert.equal(ref.current, false)
})
