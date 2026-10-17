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
    set: async (key, value, ex, ttl, nx) => { calls.redis.push(['set', key, ex, ttl]); if (nx === 'NX' && values.get(key)?.expires > Date.now()) return null; values.set(key, { value, expires: Date.now() + ttl * 1000 }); return 'OK' },
    ttl: async (key) => { const record = values.get(key); return !record ? -2 : record.expires === Infinity ? -1 : Math.ceil((record.expires - Date.now()) / 1000) },
    expire: async (key, ttl) => { const record = values.get(key); if (record) record.expires = Date.now() + ttl * 1000; return 1 },
    incr: async (key) => { const record = values.get(key); const next = Number(record?.value ?? 0) + 1; values.set(key, { value: String(next), expires: record?.expires ?? Infinity }); return next },
    getdel: async (key) => { calls.redis.push(['getdel', key]); const record = values.get(key); values.delete(key); return record && record.expires > Date.now() ? record.value : null },
  }
  const aliases = {
    '@/lib/flags/keys': { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG: 'htpr-7269-signup-identity-link' },
    '@/lib/redis': { getRedis: async () => { if (redisFailure) throw new Error('Redis down'); return redis } },
    '@/lib/flags': { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG: 'htpr-7269-signup-identity-link', isFeatureEnabled: async (key, id) => { calls.flags.push([key, id]); return enabled } },
    '@/lib/prisma': {
      user: { create: async () => { accountExists = true; return user }, findFirst: async () => accountExists ? user : null, findUnique: async () => user, update: async () => user },
      googleAccount: { findFirst: async () => null },
      verificationCode: { findUnique: async () => codeAttempt },
    },
    '@/lib/configs/auth.config': { onboarding: { shouldSkipInteractive: false, skipOnboarding: false } },
    '@/lib/configs/general.config': { generalConfig: { defaultPhotoURL: 'photo' } },
    '@/utils/controllers/users/findUserByEmail': { findUserByEmail: async () => accountExists ? user : null },
    '@/utils/controllers/users/provisionNewUser': { provisionNewUser: async (data) => { calls.provision.push(data); return user }, updateUserProfilePicture: async () => {} },
    '@/lib/telemetry/signupCompleted': { recordSignupCompleted: ({ decision, cookieHeader, ...event }) => calls.events.push({ isNewUser: true, ...event }) },
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
  aliases['./resumeIncompleteSignup'] = { resumeIncompleteSignup: async () => false }
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
    'better-auth/api': { createAuthMiddleware: (handler) => handler, getOAuthState: async () => h.oauthState ?? null },
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
  assert.deepEqual(h.calls.flags.map(([, id]) => id), [123, 123])
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

for (const consent of ['essential', null]) {
  test(`browser payload with ${consent} consent never imports PostHog or reads attribution`, async () => {
    let imports = 0
    const client = loader({
      '@/lib/cookieConsent': { getCookieConsent: () => consent },
      '@/lib/utils/utm/client': { getUTMDataFromCookies: () => { throw new Error('must not read attribution') } },
      get 'posthog-js/dist/module.slim'() { imports++; throw new Error('must not import PostHog') },
    })('src/lib/analytics/signupIdentityClient.ts')
    assert.deepEqual(await client.getSignupContextInput(), { consent, reason: 'consent_denied', attribution: {} })
    assert.equal(imports, 0)
  })
}

for (const loaded of [true, false, undefined]) {
  test(`accepted consent reads the shared PostHog singleton only when __loaded is true (${loaded})`, async () => {
    let imports = 0, reads = 0
    const client = loader({
      '@/lib/cookieConsent': { getCookieConsent: () => 'all' },
      '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({}) },
      get 'posthog-js/dist/module.slim'() {
        imports++
        return { __loaded: loaded, get_property: () => { reads++; return 'anonymous' }, get_distinct_id: () => 'anon-browser' }
      },
    })('src/lib/analytics/signupIdentityClient.ts')
    assert.deepEqual(await client.getSignupContextInput(), {
      consent: 'all', reason: loaded === true ? null : 'sdk_not_ready',
      anonymousId: loaded === true ? 'anon-browser' : null, attribution: {},
    })
    assert.equal(imports, 1)
    assert.equal(reads, loaded === true ? 2 : 0)
  })
}

test('PostHog import failure is treated as an unavailable SDK', async () => {
  let imports = 0
  const client = loader({
    '@/lib/cookieConsent': { getCookieConsent: () => 'all' },
    '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({}) },
    get 'posthog-js/dist/module.slim'() { imports++; throw new Error('import unavailable') },
  })('src/lib/analytics/signupIdentityClient.ts')
  assert.deepEqual(await client.getSignupContextInput(), { consent: 'all', reason: 'sdk_not_ready', anonymousId: null, attribution: {} })
  assert.equal(imports, 1)
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
    h.oauthState = { signupContextId: id }
    const context = { request: new Request('https://app.hypertask.ai/api/auth/callback/google', { headers: { cookie: allowedCookie } }), path: '/callback/google', setCookie: (...args) => clears.push(args), context: { newSession: { user: h.user } } }
    if (isNew) await auth.databaseHooks.user.create.after({ ...h.user, name: 'New' }, context)
    await auth.hooks.after(context)
    assert.equal(h.calls.captures.length, isNew ? 1 : 0)
    assert.equal(h.calls.events.length, isNew ? 1 : 0)
    assert.ok(clears.every(([, value, options]) => value === '' && options.maxAge === 0))
    assert.equal(await h.context.consumeSignupContext(id), null)
  }
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

test('browser preparation sends allowlisted current UTM data and tolerates network failure', async () => {
  const client = loader({
    '@/lib/cookieConsent': { getCookieConsent: () => 'all' },
    '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({ utm_source: 'web', utm_content: 'button', email: 'private', inviteKey: 'private' }) },
    'posthog-js/dist/module.slim': { __loaded: true, get_property: () => 'anonymous', get_distinct_id: () => 'anon-browser' },
  })('src/lib/analytics/signupIdentityClient.ts')
  const previousFetch = global.fetch
  let sent
  global.fetch = async (url, options) => { sent = { url, ...options }; throw new Error('network unavailable') }
  try {
    assert.equal(await client.prepareSignupContext('google'), null)
    assert.equal(sent.url, '/api/auth/signup-context')
    assert.equal(sent.method, 'POST')
    assert.equal(sent.credentials, 'same-origin')
    assert.equal(sent.headers['Content-Type'], 'application/json')
    assert.ok(sent.signal instanceof AbortSignal)
    assert.deepEqual(JSON.parse(sent.body), { consent: 'all', reason: null, anonymousId: 'anon-browser', attribution: { utm_source: 'web', utm_content: 'button' }, method: 'google' })
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
    h.oauthState = { signupContextId: id }
    const context = { request: new Request('https://app.hypertask.ai/api/auth/callback/google', { headers: { cookie } }), path: '/callback/google' }
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
    const id = method === 'google' ? (await response.json()).signupContextId : response.cookies.get('ht_signup_ctx').value
    const stored = JSON.parse([...h.values.values()][0].value)
    assert.equal(stored.method, method)
    assert.equal(stored.email, undefined)
    if (method === 'magic_link') assert.equal(stored.emailHash, require('node:crypto').createHash('sha256').update(email.trim().toLowerCase()).digest('hex'))
    else assert.equal(stored.emailHash, undefined)
    warnings.length = 0
    const clears = []
    const viaOAuthState = flow === '/callback/google'
    h.oauthState = viaOAuthState ? { signupContextId: id } : null
    const cookie = viaOAuthState ? allowedCookie : `${allowedCookie}; ht_signup_ctx=${id}`
    await auth.databaseHooks.user.create.after(h.user, { path: flow, request: new Request(`https://app.hypertask.ai/api/auth${flow}`, { headers: { cookie } }), setCookie: (...args) => clears.push(args) })
    assert.equal(h.calls.captures.length, allowed ? 1 : 0)
    assert.equal(h.calls.events.length, 1)
    assert.equal(await h.context.consumeSignupContext(id), null)
    assert.equal(clears.length, viaOAuthState ? 0 : 1)
    if (!viaOAuthState) assert.equal(clears[0][2].maxAge, 0)
    if (!allowed) assert.deepEqual(warnings, [['[signup-identity] unlinked', { reason: 'attempt_mismatch' }]])
  }
}))

test('Better Auth client registers signup context as its request hook', () => {
  const attachSignupContext = () => {}
  const plugin = () => ({})
  const { authClient } = loader({
    '@/lib/analytics/signupIdentityClient': { attachSignupContext },
    'better-auth/react': { createAuthClient: (options) => options },
    'better-auth/client/plugins': { emailOTPClient: plugin, magicLinkClient: plugin, multiSessionClient: plugin },
    '@better-auth/passkey/client': { passkeyClient: plugin },
  })('src/lib/auth/betterAuthClient.ts')
  assert.equal(authClient.fetchOptions.onRequest, attachSignupContext)
  assert.equal(authClient.plugins.length, 4)
})

test('email browser starts always prepare legacy payloads without consulting client flags', async () => {
  const previous = { fetch: global.fetch, sessionStorage: global.sessionStorage, alert: global.alert, betterAuth: process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL }
  try {
    global.sessionStorage = { setItem: () => {} }
    global.alert = () => {}
    for (const betterAuth of [false, true]) {
      process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = betterAuth ? '1' : '0'
      const payloads = [], signIns = []
      let prepared = 0
      global.fetch = async (url, options) => { payloads.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ success: true }) } }
      const hook = loader({
        react: { useState: (value) => [value, () => {}], useEffect: () => {}, useRef: (current) => ({ current }) },
        '@/hooks/useFlag': { useFlag: () => { throw new Error('logged-out flags are unavailable') } },
        '@/hooks/General/useAuth': { useAuth: () => ({ loginWithEmail: () => {} }) },
        '@/hooks/General/useUTMs': { useUTM: () => ({ getUTMData: () => ({}) }) },
        'next/navigation': { useSearchParams: () => new URLSearchParams() },
        '@/lib/configs/auth.config': { abTest: {}, redirect: { afterLogin: '/app' } },
        '@/lib/auth/safeReturnTo': { parseSafeReturnTo: () => null },
        '@/lib/analytics/signupIdentityClient': { getSignupContextInput: async () => { prepared++; return input } },
        '@/lib/auth/betterAuthClient': { authClient: { signIn: { magicLink: async (options) => { signIns.push(options); return {} } } } },
      })('src/app/login/EmailAuth/useEmailAuth.ts').useEmailAuth('new@example.test')
      await hook.handlers.handleSubmit({ preventDefault: () => {} })
      await hook.handlers.resendLink()
      if (betterAuth) {
        assert.equal(signIns.length, 2)
        assert.equal(prepared, 0)
        assert.equal(payloads.length, 0)
      } else {
        assert.equal(payloads.length, 2)
        assert.equal(prepared, 2)
        for (const payload of payloads) {
          assert.equal(payload.url, '/api/auth/send-email-link')
          assert.deepEqual(payload.body.signupContext, input)
        }
      }
    }
  } finally {
    global.fetch = previous.fetch
    global.sessionStorage = previous.sessionStorage
    global.alert = previous.alert
    if (previous.betterAuth === undefined) delete process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL
    else process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = previous.betterAuth
  }
})

test('one IP gets at most 30 signup contexts per 10 minutes; other IPs still get theirs', async () => {
  const h = harness()
  const { POST } = h.load('src/app/api/auth/signup-context/route.ts')
  const ask = (ip) => POST(request('/api/auth/signup-context', { ...input, method: 'google' }, { origin: 'https://app.hypertask.ai', 'x-forwarded-for': `${ip}, 10.0.0.1` })).then((response) => response.json())
  for (let i = 0; i < 30; i++) assert.match((await ask('203.0.113.7')).signupContextId, /^[0-9a-f-]{36}$/)
  assert.equal((await ask('203.0.113.7')).signupContextId, null)
  assert.match((await ask('198.51.100.9')).signupContextId, /^[0-9a-f-]{36}$/)
  const counters = [...h.values].filter(([key]) => key.startsWith('auth:signup-context-ip:'))
  assert.equal(counters.length, 2)
  for (const [, record] of counters) assert.ok(record.expires <= Date.now() + 600_000)
  assert.equal(h.calls.redis.filter(([op, key]) => op === 'set' && key.startsWith('auth:signup-context:')).length, 31)
  const [stuckKey, stuck] = counters[0]
  stuck.expires = Infinity
  await ask('203.0.113.7')
  await ask('198.51.100.9')
  assert.ok(h.values.get(stuckKey).expires <= Date.now() + 600_000)
})

test('Google context id travels in the OAuth state, never in a cookie, and only once', async () => {
  const h = harness()
  const { POST } = h.load('src/app/api/auth/signup-context/route.ts')
  const response = await POST(request('/api/auth/signup-context', { ...input, method: 'google' }, { origin: 'https://app.hypertask.ai' }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('set-cookie'), null)
  const { signupContextId } = await response.json()
  assert.match(signupContextId, /^[0-9a-f-]{36}$/)
  const first = await h.context.consumeGoogleSignupContext({ signupContextId })
  assert.equal(first.anonymousId, input.anonymousId)
  assert.equal(await h.context.consumeGoogleSignupContext({ signupContextId }), null)
  assert.equal(await h.context.consumeGoogleSignupContext(null), null)
})

test('social request hook preserves Google fields and existing additionalData', async () => {
  const client = loader({
    '@/lib/cookieConsent': { getCookieConsent: () => 'essential' },
    '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({}) },
  })('src/lib/analytics/signupIdentityClient.ts')
  const previous = global.fetch
  const calls = []
  const signupContextId = 'c32c4a49-423a-4cf0-a487-b28f788166a6'
  global.fetch = async (url, options) => { calls.push({ url, ...options }); return Response.json({ signupContextId }) }
  try {
    for (const url of ['/api/auth/sign-in/social', new URL('https://app.hypertask.ai/api/auth/sign-in/social?redirect=1')]) {
      const body = { provider: 'google', callbackURL: '/app', disableRedirect: true, additionalData: { invite: 'keep', signupContextId: 'old' } }
      const context = { url, body: JSON.stringify(body), headers: new Headers(), method: 'POST' }
      const before = { ...context }
      const result = await client.attachSignupContext(context)
      assert.deepEqual(JSON.parse(result.body), { ...body, additionalData: { ...body.additionalData, signupContextId } })
      assert.deepEqual(context, before)
      assert.equal(calls.at(-1).url, '/api/auth/signup-context')
      assert.equal(JSON.parse(calls.at(-1).body).method, 'google')
    }
    const result = await client.attachSignupContext({ url: '/api/auth/sign-in/social', body: JSON.stringify({ provider: 'google' }) })
    assert.deepEqual(JSON.parse(result.body), { provider: 'google', additionalData: { signupContextId } })
  } finally { global.fetch = previous }
})

test('signup request hook leaves requests unchanged on a null id or any preparation error', async () => {
  const client = loader({
    '@/lib/cookieConsent': { getCookieConsent: () => 'essential' },
    '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({}) },
  })('src/lib/analytics/signupIdentityClient.ts')
  const previous = global.fetch
  try {
    for (const fetch of [
      async () => Response.json({ signupContextId: null }),
      async () => Response.json({ signupContextId: 42 }),
      async () => Response.json({ signupContextId: 'ignored' }, { status: 500 }),
      async () => new Response('invalid JSON'),
      async () => { throw new Error('offline') },
    ]) {
      global.fetch = fetch
      const context = { url: '/api/auth/sign-in/social', body: JSON.stringify({ provider: 'google', additionalData: { invite: 'keep' } }) }
      const before = { ...context }
      assert.equal(await client.attachSignupContext(context), undefined)
      assert.deepEqual(context, before)
    }
  } finally { global.fetch = previous }
})

test('signup request hook never prepares other providers, unrelated paths or malformed bodies', async () => {
  const client = loader({
    '@/lib/cookieConsent': { getCookieConsent: () => 'essential' },
    '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({}) },
  })('src/lib/analytics/signupIdentityClient.ts')
  const previous = global.fetch
  let calls = 0
  global.fetch = async () => { calls++; throw new Error('must not fetch') }
  try {
    for (const context of [
      { url: '/api/auth/sign-in/social', body: JSON.stringify({ provider: 'github' }) },
      { url: '/api/auth/sign-in/social/extra', body: JSON.stringify({ provider: 'google' }) },
      { url: '/api/auth/get-session', body: JSON.stringify({ provider: 'google' }) },
      { url: '/api/auth/sign-in/social', body: 'invalid JSON' },
      { url: '/api/auth/sign-in/social', body: 'null' },
      { url: '/api/auth/sign-in/social', body: { provider: 'google' } },
      { url: '/api/auth/sign-in/social' },
      { url: '/api/auth/sign-in/magic-link', body: JSON.stringify({ email: 123 }) },
    ]) {
      const before = { ...context }
      assert.equal(await client.attachSignupContext(context), undefined)
      assert.deepEqual(context, before)
    }
    assert.equal(calls, 0)
  } finally { global.fetch = previous }
})

test('magic-link request hook prepares the cookie context with that email and never changes the body', async () => {
  const client = loader({
    '@/lib/cookieConsent': { getCookieConsent: () => 'essential' },
    '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({}) },
  })('src/lib/analytics/signupIdentityClient.ts')
  const previous = global.fetch
  const calls = []
  global.fetch = async (url, options) => { calls.push({ url, ...options }); return new Response(null, { status: 204 }) }
  try {
    const context = { url: '/api/auth/sign-in/magic-link', body: JSON.stringify({ email: ' New@Example.Test ', callbackURL: '/app' }) }
    const before = { ...context }
    assert.equal(await client.attachSignupContext(context), undefined)
    assert.deepEqual(context, before)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/auth/signup-context')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].credentials, 'same-origin')
    assert.deepEqual(JSON.parse(calls[0].body), { consent: 'essential', reason: 'consent_denied', attribution: {}, method: 'magic_link', email: ' New@Example.Test ' })
    global.fetch = async () => { throw new Error('offline') }
    assert.equal(await client.attachSignupContext(context), undefined)
    assert.deepEqual(context, before)
  } finally { global.fetch = previous }
})

for (const route of ['signup-context', 'send-email-link', 'instant-signup']) {
  for (const enabled of [false, true]) {
    test(`${route}: still allowed with signup linking ${enabled ? 'on creates one context' : 'off creates no context'}`, async () => {
      const h = harness({ enabled })
      const created = []
      h.aliases['@/lib/auth/signupAttributionContext'] = {
        ...h.context,
        createSignupContext: async (...args) => { created.push(args); return h.context.createSignupContext(...args) },
      }
      const body = { email: h.user.email, signupContext: input, ...input, method: 'google' }
      const response = await h.load(`src/app/api/auth/${route}/route.ts`).POST(request(`/api/auth/${route}`, body))
      assert.equal(response.status, 200)
      assert.equal(created.length, enabled ? 1 : 0)
      assert.ok(h.calls.flags.some(([key, id]) => key === 'htpr-7269-signup-identity-link' && id === 0))
      assert.equal(h.calls.redis.filter(([op, key]) => op === 'set' && key.startsWith('auth:signup-context:')).length, enabled ? 1 : 0)
      const result = await response.json()
      if (route === 'signup-context') {
        if (enabled) assert.match(result.signupContextId, /^[0-9a-f-]{36}$/)
        else assert.deepEqual(result, { signupContextId: null })
        assert.equal(response.headers.get('set-cookie'), null)
      } else if (route === 'send-email-link') {
        assert.deepEqual(result, { success: true, message: 'Sign-in email sent with both link and code!' })
        assert.ok(h.calls.code)
        if (enabled) assert.match(h.calls.jwt.signupContextId, /^[0-9a-f-]{36}$/)
        else assert.deepEqual(h.calls.jwt, { sub: h.user.email })
      } else {
        assert.deepEqual(result, { success: true, message: 'Account created successfully! Please check your email to verify your account.' })
        assert.equal(h.calls.provision.length, 1)
        assert.equal(h.calls.events.length, 1)
        assert.equal(h.calls.captures.length, enabled ? 1 : 0)
      }
    })
  }
}

test('magic-link context route still succeeds with the flag off and clears any previous cookie', async () => {
  const h = harness({ enabled: false })
  const response = await h.load('src/app/api/auth/signup-context/route.ts').POST(request('/api/auth/signup-context', { ...input, method: 'magic_link', email: h.user.email }))
  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
  assert.equal(response.cookies.get('ht_signup_ctx').value, '')
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal(h.calls.redis.length, 0)
})

test('email code context consumption retains its own feature flag check', async () => {
  const h = harness()
  const attempt = { code: '123456', createdAt: new Date(), used: false }
  h.setAttempt(attempt)
  const id = await h.context.createSignupContext(input, 1800, allowedCookie)
  await h.context.bindSignupCodeContext(h.user.email, attempt.code, id)
  h.setAttempt({ ...attempt, used: true })
  h.aliases['@/lib/flags'].isFeatureEnabled = async (key, userId) => { assert.equal(key, 'htpr-7269-signup-identity-link'); assert.equal(userId, 0); return false }
  assert.equal(await h.context.takeSignupCodeContext(h.user.email, attempt.code), null)
  h.aliases['@/lib/flags'].isFeatureEnabled = async () => true
  assert.equal(await h.context.takeSignupCodeContext(h.user.email, attempt.code), id)
})

test('logged-out account recovery always includes awaited signup context in instant signup', async () => {
  const previous = { fetch: global.fetch, window: global.window, sessionStorage: global.sessionStorage, betterAuth: process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL }
  try {
    process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = '0'
    global.window = { location: { search: '?authError=account_not_found', pathname: '/login' }, history: { replaceState: () => {} } }
    global.sessionStorage = { getItem: () => 'new@example.test', removeItem: () => {} }
    const effects = []
    let resolveSent
    const sent = new Promise((resolve) => { resolveSent = resolve })
    global.fetch = async (url, options) => { resolveSent({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ success: true }) } }
    const hook = loader({
      react: { useState: (value) => [value, () => {}], useEffect: (effect) => effects.push(effect), useRef: (current) => ({ current }) },
      '@/hooks/useFlag': { useFlag: () => { throw new Error('logged-out flags are unavailable') } },
      '@/hooks/General/useAuth': { useAuth: () => ({ loginWithEmail: () => {} }) },
      '@/hooks/General/useUTMs': { useUTM: () => ({ getUTMData: () => ({}) }) },
      'next/navigation': { useSearchParams: () => new URLSearchParams() },
      '@/lib/configs/auth.config': { abTest: {}, redirect: { afterLogin: '/app' } },
      '@/lib/auth/safeReturnTo': { parseSafeReturnTo: () => null },
      '@/lib/analytics/signupIdentityClient': { getSignupContextInput: async () => input },
      '@/lib/auth/betterAuthClient': { authClient: {} },
    })('src/app/login/EmailAuth/useEmailAuth.ts')
    hook.useEmailAuth()
    for (const effect of effects) effect()
    assert.deepEqual(await sent, { url: '/api/auth/instant-signup', body: { email: 'new@example.test', utmData: {}, signupContext: input } })
  } finally {
    global.fetch = previous.fetch
    global.window = previous.window
    global.sessionStorage = previous.sessionStorage
    if (previous.betterAuth === undefined) delete process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL
    else process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = previous.betterAuth
  }
})

test('installed Better Fetch applies the signup hook after serializing the social request body', async () => {
  const { betterFetch } = require('@better-fetch/fetch')
  const client = loader({
    '@/lib/cookieConsent': { getCookieConsent: () => 'essential' },
    '@/lib/utils/utm/client': { getUTMDataFromCookies: () => ({}) },
  })('src/lib/analytics/signupIdentityClient.ts')
  const previous = global.fetch
  const signupContextId = 'c32c4a49-423a-4cf0-a487-b28f788166a6'
  const requests = []
  global.fetch = async (url, options) => {
    requests.push({ ...options, url: String(url) })
    return Response.json(String(url) === '/api/auth/signup-context' ? { signupContextId } : { url: 'https://accounts.google.com/' })
  }
  try {
    const result = await betterFetch('https://app.hypertask.ai/api/auth/sign-in/social', {
      method: 'POST', body: { provider: 'google', callbackURL: '/app', additionalData: { invite: 'keep' } },
      onRequest: client.attachSignupContext,
    })
    assert.equal(result.error, null)
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, '/api/auth/signup-context')
    assert.equal(requests[1].url, 'https://app.hypertask.ai/api/auth/sign-in/social')
    assert.deepEqual(JSON.parse(requests[1].body), { provider: 'google', callbackURL: '/app', additionalData: { invite: 'keep', signupContextId } })
    assert.equal(requests[1].headers.get('content-type'), 'application/json')
    assert.equal(requests[1].method, 'POST')
    assert.ok(requests[1].signal instanceof AbortSignal)
  } finally { global.fetch = previous }
})
