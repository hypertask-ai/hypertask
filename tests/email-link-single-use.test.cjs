const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')
const jwt = require('jsonwebtoken')
const React = require('react')
const { renderToString } = require('react-dom/server')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
process.env.JWT_SECRET = 'email-link-single-use-test-secret-not-a-real-credential'
process.env.SESSION_SECRET = 'email-link-single-use-session-test-secret'
process.env.RESEND_API_KEY = 'email-link-test-key'
process.env.NEXT_PUBLIC_BETTER_AUTH_EMAIL = '0'

function loadTs(relativePath, aliases = {}) {
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', javascript)(
    (specifier) => {
      const value = aliases[specifier] ?? require(specifier)
      return value?.default ? { __esModule: true, ...value } : value
    }, loaded, loaded.exports,
  )
  return loaded.exports
}

function makeRedis() {
  const values = new Map()
  const calls = []
  return {
    calls,
    values,
    set: async (key, value, expiryMode, ttl, condition) => {
      calls.push([key, value, expiryMode, ttl, condition])
      assert.equal(expiryMode, 'EX')
      assert.equal(condition, 'NX')
      assert.ok(Number.isInteger(ttl) && ttl > 0)
      if (values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
  }
}

function makeHarness(redis = makeRedis()) {
  const calls = { updates: [], verifications: [], emails: [] }
  const user = {
    id: 100, uid: 'email-test-user', email: 'owner@example.test', displayName: 'Owner',
    UserSetting: { id: 101, isVerified: false, onboardingTourStatus: true },
  }
  const prisma = {
    user: {
      findFirst: async () => user,
      update: async (args) => { calls.verifications.push(args); return user },
      findUnique: async () => user,
    },
    userSetting: { update: async (args) => { calls.verifications.push(args); return user.UserSetting } },
  }
  const updateUser = async (...args) => {
    calls.updates.push(args)
    return { status: 200, res: { user, isNewUser: false } }
  }
  const aliases = {
    '@/lib/prisma': prisma,
    '@/utils/controllers/users/update_or_create_user': updateUser,
    '@/lib/configs/auth.config': { onboarding: { shouldSkipInteractive: true, skipOnboarding: true } },
    '@/utils/controllers/users/autoJoinByEmailDomain': { default: async () => {} },
    '@/utils/controllers/users/completeOnboardingStep': { CompleteOnboardingFirstStep: async () => {} },
    '@/lib/constants/constants': { companyRoleOptions: ['Founder'], companySizeOptions: ['Just me'] },
    '@/lib/auth/session': loadTs('src/lib/auth/session.ts'),
    '@/lib/auth/requestBaseUrl': { getRequestBaseUrl: () => 'https://app.hypertask.ai' },
    '@/utils/controllers/demo/adoptGuestBoards': { adoptGuestBoards: async () => {} },
    '@/lib/auth/slimUserCookie': loadTs('src/lib/auth/slimUserCookie.ts'),
    '@/lib/auth/themeCookie': { seedResponseThemeCookie: () => {} },
    '@/lib/telemetry/signupAnalytics': { signupAttributionFromHeaders: () => ({}) },
    '@/lib/services/verificationCodeService': { VerificationCodeService: {
      generateCode: () => '123456', isRateLimited: () => ({ limited: false }), storeCode: async () => {},
    } },
    '@/lib/auth/safeReturnTo': loadTs('src/lib/auth/safeReturnTo.ts'),
    '@/lib/email/sendEmail': { sendEmail: async (args) => { calls.emails.push(args) } },
  }
  // The pre-fix route does not import the consumer; the same harness runs on both revisions.
  if (fs.existsSync(path.join(root, 'src/lib/auth/emailLinkToken.ts'))) {
    aliases['@/lib/auth/emailLinkToken'] = loadTs('src/lib/auth/emailLinkToken.ts', {
      '@/lib/redis': { getRedis: async () => redis },
    })
  }
  const route = loadTs('src/app/api/auth/verify-email-token/route.ts', aliases)
  const redeem = (token) => route.POST(new NextRequest('https://app.hypertask.ai/api/auth/verify-email-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  }))
  const issue = async (type) => {
    const routePath = type === 'login' ? 'send-email-link' : 'instant-signup'
    const originalFindFirst = prisma.user.findFirst
    if (type === 'signup-new') prisma.user.findFirst = async () => null
    try {
      const issuer = loadTs(`src/app/api/auth/${routePath}/route.ts`, aliases)
      const response = await issuer.POST(new NextRequest(`https://app.hypertask.ai/api/auth/${routePath}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email }),
      }))
      assert.equal(response.status, 200)
      assert.equal(response.cookies.get('ht_session'), undefined)
      const body = await response.json()
      assert.equal(body.token, undefined)
      const link = calls.emails.at(-1).html.match(/href="([^"]+)"/)[1]
      const token = new URL(link).searchParams.get('token')
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: process.env.JWT_ISSUER || 'hypertask',
        audience: type === 'login' ? (process.env.JWT_AUDIENCE || 'email-link') : (process.env.JWT_VERIFICATION_AUDIENCE || 'email-verification'),
      })
      assert.equal(typeof decoded.jti, 'string')
      assert.ok(decoded.exp > decoded.iat)
      calls.updates.length = 0
      return token
    } finally {
      prisma.user.findFirst = originalFindFirst
    }
  }
  return { redis, calls, aliases, route, redeem, issue }
}

async function withQuietSideEffects(fn) {
  const original = { log: console.log, error: console.error, fetch: global.fetch }
  console.log = () => {}
  console.error = () => {}
  global.fetch = async () => new Response(JSON.stringify([{ id: 102 }]), { status: 200 })
  try { return await fn() } finally { Object.assign(console, { log: original.log, error: original.error }); global.fetch = original.fetch }
}

function assertSession(response) {
  assert.equal(response.status, 200)
  const session = response.cookies.get('ht_session')
  assert.ok(session, 'first redemption must mint the signed session')
  const { verifySession, SESSION_TTL_SECONDS } = loadTs('src/lib/auth/session.ts')
  assert.equal(verifySession(session.value).id, 100)
  const claims = JSON.parse(Buffer.from(session.value.split('.')[0], 'base64url').toString())
  assert.equal(claims.exp - claims.iat, SESSION_TTL_SECONDS)
}

async function assertRejected(response) {
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { success: false, error: 'Invalid or expired token' })
  assert.equal(response.cookies.get('ht_session'), undefined)
}

for (const type of ['login', 'signup-existing', 'signup-new']) {
  test(`${type}: first emailed token redemption succeeds and second redemption fails`, () => withQuietSideEffects(async () => {
    const harness = makeHarness()
    const token = await harness.issue(type)
    const first = await harness.redeem(token)
    assertSession(first)
    assert.equal((await first.json()).success, true)
    assert.equal(harness.calls.updates.length, 1)
    assert.equal(harness.calls.verifications.length, type === 'login' ? 0 : 2)
    const before = harness.calls.verifications.length
    await assertRejected(await harness.redeem(token))
    assert.equal(harness.calls.updates.length, 1, 'used links must not update users again')
    assert.equal(harness.calls.verifications.length, before)
    const exp = jwt.decode(token).exp
    assert.ok(harness.redis.calls[0][3] >= exp - Date.now() / 1000, 'claim must survive token expiry')
  }))

  test(`${type}: simultaneous redemptions allow exactly one session`, () => withQuietSideEffects(async () => {
    const harness = makeHarness()
    const token = await harness.issue(type)
    const responses = await Promise.all([harness.redeem(token), harness.redeem(token)])
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400])
    assert.equal(responses.filter((response) => response.cookies.get('ht_session')).length, 1)
    assert.equal(harness.calls.updates.length, 1)
  }))
}

function signToken(payload = {}, options = {}) {
  const defined = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
  return jwt.sign(defined({ sub: 'owner@example.test', ...payload }), process.env.JWT_SECRET, defined({
    expiresIn: '15m', issuer: process.env.JWT_ISSUER || 'hypertask',
    audience: process.env.JWT_AUDIENCE || 'email-link', jwtid: crypto.randomUUID(), ...options,
  }))
}

test('legacy missing-jti, malformed claims, expired and wrong-contract tokens fail before side effects', () => withQuietSideEffects(async () => {
  const tokens = [
    signToken({}, { jwtid: undefined }),
    signToken({}, { jwtid: '' }),
    signToken({}, { jwtid: '   ' }),
    signToken({}, { expiresIn: undefined }),
    signToken({}, { expiresIn: -1 }),
    signToken({}, { issuer: 'other-app' }),
    signToken({}, { audience: 'mcp-api' }),
    signToken({ sub: undefined }),
    'not-a-token',
  ]
  for (const token of tokens) {
    const harness = makeHarness()
    const response = await harness.redeem(token)
    assert.equal(response.status, 400)
    assert.equal(response.cookies.get('ht_session'), undefined)
    assert.equal(harness.calls.updates.length, 0)
    assert.equal(harness.redis.calls.length, 0)
  }
}))

test('Redis errors fail closed without minting a session or mutating a user', () => withQuietSideEffects(async () => {
  const harness = makeHarness({ set: async () => { throw new Error('Redis unavailable') } })
  const response = await harness.redeem(signToken())
  assert.equal(response.status, 500)
  assert.equal(response.cookies.get('ht_session'), undefined)
  assert.equal(harness.calls.updates.length, 0)
}))

function makeClientAliases(harness, token) {
  const aliases = {
    react: React,
    'next/navigation': { useSearchParams: () => new URLSearchParams({ token }) },
    '@/hooks/General/useAuth': { useAuth: () => ({ loginWithEmail: async () => {} }) },
    '@/hooks/General/useUTMs': { useUTM: () => ({ getUTMData: () => ({}) }) },
    '@/lib/auth/betterAuthClient': { authClient: {} },
    '@/lib/configs/auth.config': { onboarding: {}, emailLink: { verifyTokenApi: '/api/auth/verify-email-token' } },
    '@/lib/auth/safeReturnTo': harness.aliases['@/lib/auth/safeReturnTo'],
    '@/lib/state': { useRecoilState: () => [null, () => {}] },
    '@/store': { currentUserAtom: {} },
    axios: { post: async (_url, { token: value }) => {
      const response = await harness.redeem(value)
      const data = await response.json()
      if (response.status !== 200) throw { response: { data } }
      return { data }
    } },
  }
  aliases['@/hooks/useEmailVerificationStatus'] = loadTs('src/hooks/useEmailVerificationStatus.ts', aliases)
  aliases['@/hooks/useResendVerificationEmail'] = { useResendVerificationEmail: () => ({}) }
  aliases['@/components/EmailVerification/EmailVerificationContent'] = { EmailVerificationContent: () => React.createElement('div', null, 'Pending') }
  aliases['@/components/EmailVerification/VerificationStatusDisplay'] = { VerificationStatusDisplay: ({ status }) => React.createElement('div', null, status) }
  return aliases
}

test('server rendering the link pages does not redeem; the first subsequent POST still succeeds', () => withQuietSideEffects(async () => {
  for (const type of ['login', 'signup-existing']) {
    const harness = makeHarness()
    const token = await harness.issue(type)
    const aliases = makeClientAliases(harness, token)
    let Page
    if (type === 'login') {
      const { useEmailAuth } = loadTs('src/app/login/EmailAuth/useEmailAuth.ts', aliases)
      aliases['./LoginComponent'] = { default: () => {
        const { step } = useEmailAuth()
        return React.createElement('div', null, step)
      } }
      aliases['@/components/analytics/StoreUTM'] = { default: () => null }
      Page = loadTs('src/app/login/page.tsx', aliases).default
    } else {
      Page = loadTs('src/app/verify-email/page.tsx', aliases).default
    }
    assert.ok(renderToString(React.createElement(Page)).length > 0)
    assert.equal(harness.redis.calls.length, 0)
    assert.equal(harness.calls.updates.length, 0)
    assert.equal(harness.route.GET, undefined, 'the redemption API must remain POST-only')
    assertSession(await harness.redeem(token))
  }
}))

test('verification page redeems only once across effect reruns and still verifies normally', () => withQuietSideEffects(async () => {
  const { JSDOM } = require('jsdom')
  const { createRoot } = require('react-dom/client')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.hypertask.ai/verify-email' })
  const original = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT }
  global.window = dom.window
  global.document = dom.window.document
  global.IS_REACT_ACT_ENVIRONMENT = true
  const harness = makeHarness()
  const token = await harness.issue('signup-existing')
  const aliases = makeClientAliases(harness, token)
  // Deliberately unstable state setter: callback changes must not consume again.
  const Page = loadTs('src/app/verify-email/page.tsx', aliases).default
  const mounted = createRoot(dom.window.document.getElementById('root'))
  try {
    await React.act(async () => { mounted.render(React.createElement(React.StrictMode, null, React.createElement(Page))) })
    assert.equal(harness.calls.updates.length, 1)
    assert.equal(harness.redis.calls.length, 1)
    assert.equal(dom.window.document.getElementById('root').textContent, 'verified')
  } finally {
    await React.act(async () => { mounted.unmount() })
    dom.window.close()
    global.window = original.window
    global.document = original.document
    global.IS_REACT_ACT_ENVIRONMENT = original.act
  }
}))

test('login page JS posts once and completes normal sign-in after the link is opened', () => withQuietSideEffects(async () => {
  const { JSDOM } = require('jsdom')
  const { createRoot } = require('react-dom/client')
  const harness = makeHarness()
  const token = await harness.issue('login')
  const dom = new JSDOM('<div id="root"></div>', { url: `https://app.hypertask.ai/login?token=${token}` })
  const original = { window: global.window, document: global.document, storage: global.sessionStorage, act: global.IS_REACT_ACT_ENVIRONMENT }
  global.window = dom.window
  global.document = dom.window.document
  global.sessionStorage = dom.window.sessionStorage
  global.IS_REACT_ACT_ENVIRONMENT = true
  const aliases = makeClientAliases(harness, token)
  const signedIn = []
  aliases['@/hooks/General/useAuth'] = { useAuth: () => ({ loginWithEmail: async (args) => { signedIn.push(args) } }) }
  const { useEmailAuth } = loadTs('src/app/login/EmailAuth/useEmailAuth.ts', aliases)
  const Page = () => {
    useEmailAuth()
    return React.createElement('div', null, 'Login')
  }
  const fallbackFetch = global.fetch
  global.fetch = (url, options) => url === '/api/auth/verify-email-token'
    ? harness.redeem(JSON.parse(options.body).token)
    : fallbackFetch(url, options)
  const mounted = createRoot(dom.window.document.getElementById('root'))
  try {
    await React.act(async () => { mounted.render(React.createElement(React.StrictMode, null, React.createElement(Page))) })
    assert.equal(harness.calls.updates.length, 1)
    assert.equal(harness.redis.calls.length, 1)
    assert.equal(signedIn.length, 1)
    assert.equal(signedIn[0].userData.id, 100)
    assert.equal(signedIn[0].skipDatabaseUpdate, true)
  } finally {
    await React.act(async () => { mounted.unmount() })
    dom.window.close()
    global.window = original.window
    global.document = original.document
    global.sessionStorage = original.storage
    global.IS_REACT_ACT_ENVIRONMENT = original.act
  }
}))

test('downstream failures never release a consumed link, and distinct links for one mailbox stay usable', () => withQuietSideEffects(async () => {
  const harness = makeHarness()
  harness.aliases['@/lib/prisma'].user.findFirst = async () => { throw new Error('Database unavailable') }
  const token = signToken()
  assert.equal((await harness.redeem(token)).status, 500)
  await assertRejected(await harness.redeem(token))
  assert.equal(harness.redis.values.size, 1)
  const normal = makeHarness()
  assertSession(await normal.redeem(signToken()))
  assertSession(await normal.redeem(signToken()))
  assert.equal(normal.redis.values.size, 2)
}))

test('real isolated Redis admits only one concurrent redemption and retains the claim past JWT expiry', {
  skip: process.env.RUN_EMAIL_LINK_REDIS_TEST !== '1',
}, () => withQuietSideEffects(async () => {
  const { spawn } = require('node:child_process')
  const os = require('node:os')
  const Redis = require('ioredis')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htpr-6632-redis-'))
  const socket = path.join(dir, 'redis.sock')
  const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let client
  try {
    await new Promise((resolve, reject) => {
      let output = ''
      server.stdout.on('data', (chunk) => {
        output += chunk.toString()
        if (output.includes('ready to accept connections')) resolve()
      })
      server.once('error', reject)
      server.once('exit', (code) => reject(new Error(`isolated Redis exited ${code}`)))
    })
    client = new Redis(socket, { protocol: 2 })
    for (const type of ['login', 'signup-existing', 'signup-new']) {
      const harness = makeHarness(client)
      const token = await harness.issue(type)
      const responses = await Promise.all([harness.redeem(token), harness.redeem(token)])
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400])
      assert.equal(responses.filter((response) => response.cookies.get('ht_session')).length, 1)
      const key = `auth:email-link:consumed:${crypto.createHash('sha256').update(jwt.decode(token).jti).digest('hex')}`
      const ttl = await client.ttl(key)
      assert.ok(ttl >= jwt.decode(token).exp - Date.now() / 1000)
      await assertRejected(await harness.redeem(token))
      assert.ok(await client.ttl(key) <= ttl, 'replay must not reset expiry')
    }
  } finally {
    if (client) await client.quit()
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve))
      server.kill('SIGTERM')
      await exited
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}))
