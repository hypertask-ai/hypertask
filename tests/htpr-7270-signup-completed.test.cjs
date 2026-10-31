const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')
process.env.JWT_SECRET = 'test-only-signup-identity-secret'
process.env.RESEND_API_KEY = ''
const root = path.resolve(__dirname, '..')
process.env.POSTHOG_SERVER_PROJECT_TOKEN = 'test-only'

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

function harness({ enabled = true, redisFailure = false, existing = false, completedEnabled = true } = {}) {
  const values = new Map()
  const jobs = [], captures = [], attempts = [], logs = [], locks = []
  let failure = null
  let transactionTail = Promise.resolve()
  const calls = { flags: [], captures: [], events: [], warnings: [], provision: [], redis: [], code: null, jwt: null }
  const user = { id: 123, uid: 'email_test', email: 'new@example.test', displayName: 'New', joinedAt: new Date('2026-10-16T09:00:00Z') }
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
    '@/lib/flags': { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG: 'htpr-7269-signup-identity-link', isFeatureEnabled: async (key, id) => { if (key === 'htpr-7290-durable-signup-identify') return false; calls.flags.push([key, id]); return key === 'htpr-7270-signup-completed' ? completedEnabled : enabled }, HTPR_7270_SIGNUP_COMPLETED_FLAG: 'htpr-7270-signup-completed', HTPR_7292_SHARED_ACCOUNT_CATEGORY_FLAG: 'htpr-7292-shared-account-category', FEATURE_FLAG_QA_USER_ID: 985, FEATURE_FLAG_OWNER_USER_ID: 6 },
    '@/lib/prisma': {
      user: { create: async () => { accountExists = true; return user }, findFirst: async () => accountExists ? user : null, findUnique: async () => user, update: async () => user },
      googleAccount: { findFirst: async () => null },
      verificationCode: { findUnique: async () => codeAttempt },
    },
    '@/lib/configs/auth.config': { onboarding: { shouldSkipInteractive: false, skipOnboarding: false } },
    '@/lib/configs/general.config': { generalConfig: { defaultPhotoURL: 'photo' } },
    '@/utils/controllers/users/findUserByEmail': { findUserByEmail: async () => accountExists ? user : null },
    '@/utils/controllers/users/provisionNewUser': { provisionNewUser: async (data) => { calls.provision.push(data); return user }, updateUserProfilePicture: async () => {} },
    'server-only': {},
    '@/lib/telemetry/activationOccurrences': {},
    './analyticsOutbox': { isAnalyticsOutboxEnabled: async () => false, deliverAnalyticsOutbox: async () => 'skipped' },
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
    '@vercel/functions': { waitUntil: (promise) => { jobs.push(promise); if (failure === 'schedule') throw Error('scheduler unavailable') } },
    'posthog-node': { PostHog: class {
      constructor() { if (failure === 'constructor') throw Error('PostHog constructor failed') }
      async captureImmediate(capture) { attempts.push(capture); if (failure === 'capture') throw Error('PostHog failed'); captures.push(capture) }
    } },
    '@/lib/email/sendEmail': { sendEmail: async () => {} },
    jsonwebtoken: { sign: (payload) => { calls.jwt = payload; return 'signed-token' }, verify: () => ({ sub: user.email, signupContextId: calls.jwt?.signupContextId }) },
  }
  aliases['./provisionNewUser'] = aliases['@/utils/controllers/users/provisionNewUser']
  aliases['./resumeIncompleteSignup'] = { resumeIncompleteSignup: async () => false }
  aliases['./findUserByEmail'] = aliases['@/utils/controllers/users/findUserByEmail']
  const prisma = aliases['@/lib/prisma']
  prisma.team = { findFirst: async ({ where, orderBy, select }) => {
    assert.deepEqual(where, { googleAccount: { userId: user.id } })
    assert.deepEqual(orderBy, { createdAt: 'asc' })
    assert.deepEqual(select, { id: true })
    return { id: 'personal-team' }
  } }
  prisma.logs = {
    findFirst: async ({ where }) => logs.find((row) => row.log === where.log && row.LoggedById === where.LoggedById) ?? null,
    create: async ({ data }) => { logs.push(data); return data },
  }
  prisma.$executeRaw = async (...args) => { locks.push(args) }
  prisma.$transaction = (work) => {
    const result = transactionTail.then(() => work(prisma))
    transactionTail = result.catch(() => undefined)
    return result
  }
  const findUnique = prisma.user.findUnique
  prisma.user.findUnique = async (...args) => { if (failure === 'database') throw Error('database unavailable'); return findUnique(...args) }

  const intents = []
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value instanceof Date) return row[key]?.getTime() === value.getTime()
    if (value && typeof value === 'object') {
      if ('lte' in value) return row[key] != null && row[key] <= value.lte
      if ('lt' in value) return row[key] != null && row[key] < value.lt
    }
    return row[key] === value
  })
  prisma.analyticsIntent = {
    createMany: async ({ data }) => { for (const row of data) if (!intents.some(({ key }) => key === row.key)) intents.push({ ...row, payload: JSON.parse(JSON.stringify(row.payload)), attempts: 0, processedAt: null, nextAttemptAt: new Date(), createdAt: new Date() }) },
    findUniqueOrThrow: async ({ where }) => ({ ...intents.find((row) => matches(row, where)) }),
    findMany: async ({ where }) => intents.filter((row) => matches(row, where)),
    updateMany: async ({ where, data }) => {
      const rows = intents.filter((row) => matches(row, where))
      for (const row of rows) for (const [key, value] of Object.entries(data)) row[key] = value?.increment ? row[key] + value.increment : value
      return { count: rows.length }
    },
    deleteMany: async () => ({ count: 0 }),
  }
  const load = loader(aliases)
  const context = load('src/lib/auth/signupAttributionContext.ts')
  const identity = load('src/lib/telemetry/signupIdentityLink.ts')
  const pure = load('src/lib/analytics/signupIdentity.ts')
  aliases['@/utils/controllers/users/update_or_create_user'] = load('src/utils/controllers/users/update_or_create_user.ts').default
  return { intents, load, context, identity, pure, aliases, calls, values, user, jobs, captures, attempts, logs, locks, prisma, setFailure: (value) => { failure = value }, drain: async () => { for (let i = 0; i < jobs.length; i++) await jobs[i] }, setAttempt: (attempt) => { codeAttempt = attempt } }
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
    '@/lib/auth/oauthTokenCipher': { preflightOAuthTokenKey: () => {} },
    '@/lib/auth/oauthTokenStorage': { withOAuthTokenStorage: (adapter) => adapter },
    '@/lib/auth/bridgePlugin': { bridgeSessionPlugin: plugin },
    '@/lib/auth/legacyCookiePlugin': { legacyCookiePlugin: plugin, newGoogleSignupRequests: new WeakMap() },
    '@/lib/mcp/managementPermissions': { MANAGEMENT_KEY_PERMISSIONS: {} },
  })
  return h.load('src/lib/auth/betterAuth.ts').auth
}

const allowedCookie = 'ht_cookie_consent=all'
const input = { anonymousId: 'anon-visitor-abc', consent: 'all', attribution: { utm_source: 'website', utm_medium: 'social', utm_campaign: 'launch', initial_referrer: 'https://example.test/start?private=removed' } }
const linked = { link: true, anonymousId: input.anonymousId, attribution: { ...input.attribution, initial_referrer: 'https://example.test/start' }, attributionStatus: 'known' }
function request(url, body, headers = {}) {
  return new NextRequest(`https://app.hypertask.ai${url}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: allowedCookie, ...headers }, body: JSON.stringify(body) })
}
function record(h, overrides = {}) {
  const work = h.load('src/lib/telemetry/signupCompleted.ts').enqueueSignupCompleted(h.prisma, { userId: h.user.id, signupMethod: 'email', utmSource: ' legacy ', decision: null, cookieHeader: allowedCookie, ...overrides }).then((key) => h.load('src/lib/telemetry/analyticsIntents.ts').processAnalyticsIntentSoon(key))
  h.jobs.push(work)
  return work
}
function signupEvents(h) { return h.captures.filter(({ event }) => event === 'signup_completed' || event === 'user_signed_up') }
function controller(h) { return h.aliases['@/utils/controllers/users/update_or_create_user'] }
async function quiet(work) {
  const previous = { warn: console.warn, log: console.log, error: console.error }
  console.warn = console.log = console.error = () => {}
  try { return await work() } finally { Object.assign(console, previous) }
}

test('flag defaults to Owner + QA', () => {
  const flag = loader()('src/lib/flags/definitions/htpr-7270-signup-completed.ts')
  assert.equal(flag.HTPR_7270_SIGNUP_COMPLETED_FLAG, 'htpr-7270-signup-completed')
  assert.equal(flag.default.kind, 'feature')
  assert.equal(flag.default.defaultMode, 'OWNER_AND_QA')
  assert.equal(flag.default.shippedOn, '2026-10-16')
  assert.equal(flag.default.releaseRisk.risk, 'new')
  assert.ok(flag.default.releaseRisk.reason)
})

test('flag off still allows exactly one unchanged user_signed_up and no signup_completed', async () => {
  const h = harness({ completedEnabled: false })
  record(h, { decision: linked })
  await h.drain()
  assert.deepEqual(h.captures, [{ distinctId: '123', event: 'user_signed_up', properties: { signup_method: 'email', utm_source: 'legacy' } }])
  assert.deepEqual(h.logs, [])
  assert.deepEqual(h.calls.flags, [['htpr-7270-signup-completed', 123]])
})

test('flag off user_signed_up carries no source without analytics consent', async () => {
  const h = harness({ completedEnabled: false })
  record(h, { decision: linked, cookieHeader: null })
  await h.drain()
  assert.deepEqual(h.captures, [{ distinctId: '123', event: 'user_signed_up', properties: { signup_method: 'email' } }])
  assert.deepEqual(h.calls.flags, [['htpr-7270-signup-completed', 123]])
})

test('flag on sends only signup_completed with the complete contract, consented identity and attribution', async () => {
  const h = harness()
  record(h, { decision: linked })
  await h.drain()
  assert.equal(h.captures.length, 1)
  const capture = h.captures[0]
  assert.equal(capture.event, 'signup_completed')
  assert.equal(capture.distinctId, '123')
  assert.match(capture.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.deepEqual(capture.properties, {
    user_id: '123', workspace_id: 'personal-team', board_id: null, source: 'server', event_id: 'signup_completed:123',
    occurred_at: h.user.joinedAt.toISOString(), environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    utm_source: 'website', utm_medium: 'social', utm_campaign: 'launch', initial_referrer: 'https://example.test/start',
    is_seeded: null, account_category: 'customer', attribution_status: 'known', signup_method: 'email', signup_at: h.user.joinedAt.toISOString(), anonymous_id: 'anon-visitor-abc',
  })
  assert.deepEqual(h.logs, [{ log: 'analytics:signup_completed', LoggedById: 123, type: 'Signup', status: 'Normal' }])
  assert.equal(h.locks.length, 1)
  assert.equal(JSON.stringify(capture.properties).includes(h.user.email), false)
  assert.equal(JSON.stringify(capture.properties).includes(h.user.displayName), false)
})

test('concurrent attempts and successful replays emit once per user, not once globally', async () => {
  const h = harness()
  record(h); record(h)
  await h.drain()
  record(h)
  await h.drain()
  assert.equal(h.captures.length, 1)
  assert.equal(h.logs.length, 1)
  h.user.id = 124
  record(h)
  await h.drain()
  assert.equal(h.captures.length, 2)
  assert.notEqual(h.captures[0].uuid, h.captures[1].uuid)
})

test('a pre-existing marker blocks capture, but unrelated markers do not', async () => {
  const h = harness()
  h.logs.push({ LoggedById: 124, log: 'analytics:signup_completed' }, { LoggedById: 123, log: 'activation:board_created:15' })
  record(h); await h.drain()
  assert.equal(h.captures.length, 1)
  const replay = harness()
  replay.logs.push({ LoggedById: 123, log: 'analytics:signup_completed' })
  record(replay); await replay.drain()
  assert.deepEqual(replay.captures, [])
})

for (const cookieHeader of [null, '', 'ht_cookie_consent=essential', 'ht_cookie_consent=ALL']) {
  for (const decision of [null, linked]) {
    test(`consent ${JSON.stringify(cookieHeader)}, decision ${!!decision}: event survives with all attribution withheld`, async () => {
      const h = harness()
      record(h, { decision, cookieHeader })
      await h.drain()
      assert.equal(h.captures.length, 1)
      assert.equal(h.captures[0].event, 'signup_completed')
      const props = h.captures[0].properties
      assert.equal(props.attribution_status, 'withheld')
      assert.equal('anonymous_id' in props, false)
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'initial_referrer']) assert.equal(props[key], null)
    })
  }
}

for (const utmSource of [undefined, '', '   ', ' source ', 'a'.repeat(240)]) {
  test(`consent all without a decision cleans fallback source length ${utmSource?.length}`, async () => {
    const h = harness()
    record(h, { utmSource })
    await h.drain()
    const props = h.captures[0].properties
    assert.equal(props.utm_source, utmSource?.trim().slice(0, 200) || null)
    assert.equal(props.attribution_status, utmSource?.trim() ? 'known' : 'unknown')
    assert.equal('anonymous_id' in props, false)
    for (const key of ['utm_medium', 'utm_campaign', 'initial_referrer']) assert.equal(props[key], null)
  })
}

test('an unlinked decision preserves its status and attribution without inferring an anonymous ID or fallback source', async () => {
  for (const attributionStatus of ['direct', 'unknown', 'withheld', 'known']) {
    const h = harness()
    record(h, { decision: { link: false, reason: 'sdk_not_ready', attribution: { utm_medium: 'social' }, attributionStatus } })
    await h.drain()
    assert.equal(h.captures[0].properties.attribution_status, attributionStatus)
    assert.equal(h.captures[0].properties.utm_source, null)
    assert.equal(h.captures[0].properties.utm_medium, 'social')
    assert.equal('anonymous_id' in h.captures[0].properties, false)
  }
})

test('a missing personal team is null and needs no fabricated workspace', async () => {
  const h = harness()
  h.prisma.team.findFirst = async () => null
  record(h); await h.drain()
  assert.equal(h.captures[0].properties.workspace_id, null)
  assert.ok(h.intents[0].processedAt)
})

for (const scenario of ['guest', 'missing', 'zero', 'fractional']) {
  test(`${scenario} user is excluded without consuming the occurrence`, async () => {
    const h = harness()
    if (scenario === 'guest') h.user.uid = 'guest_123'
    if (scenario === 'missing') h.prisma.user.findUnique = async () => null
    if (scenario === 'zero') h.user.id = 0
    if (scenario === 'fractional') h.user.id = 1.5
    record(h); await h.drain()
    assert.deepEqual(h.captures, [])
    assert.deepEqual(h.logs, [])
  })
}

for (const [id, email, category] of [[985, 'qa@example.test', 'qa'], [6, 'owner@example.test', 'internal'], [123, 'staff@hypertask.ai', 'internal'], [123, 'member@example.test', 'customer']]) {
  test(`${category} signup is categorized without activation flag gating (${id})`, async () => {
    const h = harness({ enabled: false })
    Object.assign(h.user, { id, email })
    record(h); await h.drain()
    assert.equal(h.captures[0].properties.account_category, category)
    assert.deepEqual(h.calls.flags, [['htpr-7270-signup-completed', id], ['htpr-7292-shared-account-category', id]])
  })
}

test('existing-user controller login schedules neither signup event', async () => quiet(async () => {
  const h = harness({ existing: true })
  const result = await controller(h)(h.user.email, { displayName: 'New' })
  assert.equal(result.status, 200)
  await h.drain()
  assert.deepEqual(signupEvents(h), [])
  assert.deepEqual(h.calls.provision, [])
  assert.deepEqual(h.jobs, [])
}))

for (const completion of ['verify-code', 'verify-email-token']) {
  for (const invited of [false, true]) {
    test(`${invited ? 'invite' : 'email'} ${completion} creates one completion and subsequent login sends none`, async () => quiet(async () => {
      const h = harness()
      const headers = invited ? { cookie: `${allowedCookie}; inviteKey=invite; projectInvite=15` } : {}
      const sent = await h.load('src/app/api/auth/send-email-link/route.ts').POST(request('/api/auth/send-email-link', { email: h.user.email, signupContext: input }, headers))
      assert.equal(sent.status, 200)
      const response = await h.load(`src/app/api/auth/${completion}/route.ts`).POST(request(`/api/auth/${completion}`, { email: h.user.email, code: h.calls.code, token: 'signed-token' }, headers))
      assert.equal(response.status, 200, await response.text())
      await h.drain()
      assert.deepEqual(signupEvents(h).map(({ event }) => event), ['signup_completed'])
      assert.equal(signupEvents(h)[0].properties.signup_method, invited ? 'invite' : 'email')
      assert.equal(signupEvents(h)[0].properties.anonymous_id, input.anonymousId)
      assert.equal(signupEvents(h)[0].properties.utm_source, 'website')
      const next = completion === 'verify-code' ? 'verify-email-token' : 'verify-code'
      const login = await h.load(`src/app/api/auth/${next}/route.ts`).POST(request(`/api/auth/${next}`, { email: h.user.email, code: h.calls.code, token: 'signed-token' }, headers))
      assert.equal(login.status, 200, await login.text())
      await h.drain()
      assert.equal(signupEvents(h).length, 1)
      assert.equal(h.calls.provision.length, 1)
    }))
  }
}

test('instant signup fires at account creation, later verification and repeated instant signup emit nothing more', async () => quiet(async () => {
  const h = harness()
  const instant = h.load('src/app/api/auth/instant-signup/route.ts').POST
  assert.equal((await instant(request('/api/auth/instant-signup', { email: h.user.email, signupContext: input }))).status, 200)
  await h.drain()
  assert.deepEqual(signupEvents(h).map(({ event }) => event), ['signup_completed'])
  assert.equal(signupEvents(h)[0].properties.anonymous_id, input.anonymousId)
  const verification = await h.load('src/app/api/auth/verify-email-token/route.ts').POST(request('/api/auth/verify-email-token', { token: 'signed-token' }))
  assert.equal(verification.status, 200, await verification.text())
  assert.equal((await instant(request('/api/auth/instant-signup', { email: h.user.email }))).status, 200)
  await h.drain()
  assert.equal(signupEvents(h).length, 1)
  assert.equal(h.calls.provision.length, 1)
}))

for (const flow of ['/callback/google', '/magic-link/verify']) {
  test(`Better Auth ${flow} create hook forwards decision and cookie and dedupes replay`, async () => quiet(async () => {
    const h = harness()
    const auth = betterAuthHarness(h)
    const method = flow === '/callback/google' ? 'google' : 'magic_link'
    const id = await h.context.createSignupContext({ ...input, method, email: h.user.email }, 600, allowedCookie)
    h.oauthState = { signupContextId: id }
    const context = { path: flow, request: new Request(`https://app.hypertask.ai/api/auth${flow}`, { headers: { cookie: `${allowedCookie}; ht_signup_ctx=${id}` } }), setCookie: () => {} }
    await auth.databaseHooks.user.create.after({ ...h.user, name: 'New' }, context)
    await h.drain()
    assert.deepEqual(signupEvents(h).map(({ event }) => event), ['signup_completed'])
    const props = signupEvents(h)[0].properties
    assert.equal(props.signup_method, method === 'google' ? 'google' : 'email')
    assert.equal(props.anonymous_id, input.anonymousId)
    assert.equal(props.utm_source, 'website')
    await auth.databaseHooks.user.create.after(h.user, context)
    await h.drain()
    assert.equal(signupEvents(h).length, 1)
    await auth.hooks.after({ ...context, context: { newSession: { user: h.user } } })
    await h.drain()
    assert.equal(signupEvents(h).length, 1)
  }))
}

for (const failure of ['capture', 'database', 'constructor', 'schedule']) {
  test(`analytics ${failure} failure never breaks committed signup`, async () => quiet(async () => {
    const h = harness({ enabled: false })
    h.setFailure(failure)
    const result = await controller(h)(h.user.email, {})
    assert.equal(result.status, 200)
    assert.equal(h.calls.provision.length, 1)
    await assert.doesNotReject(h.drain())
    assert.equal(h.logs.length, failure === 'schedule' ? 1 : 0)
    if (failure === 'capture') {
      const uuid = h.attempts[0].uuid
      h.setFailure(null)
      h.intents[0].nextAttemptAt = new Date(0)
      await h.load('src/lib/telemetry/analyticsIntents.ts').retryAnalyticsIntents()
      assert.equal(h.captures.length, 1)
      assert.equal(h.captures[0].uuid, uuid)
    }
  }))
}

test('signup response does not wait for an unresolved analytics flag lookup', async () => quiet(async () => {
  const h = harness({ enabled: false })
  let release
  let started
  const checking = new Promise((resolve) => { started = resolve })
  const check = h.aliases['@/lib/flags'].isFeatureEnabled
  h.aliases['@/lib/flags'].isFeatureEnabled = (key, id) => key === 'htpr-7270-signup-completed' ? new Promise((resolve) => { release = resolve; started() }) : check(key, id)
  const result = await controller(h)(h.user.email, {})
  assert.equal(result.status, 200)
  assert.deepEqual(h.captures, [])
  await checking
  assert.equal(typeof release, 'function')
  release(true)
  await h.drain()
  assert.equal(h.captures[0].event, 'signup_completed')
}))
