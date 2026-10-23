const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

process.env.BETTER_AUTH_SECRET = 'oauth-error-landing-test-only-not-a-real-credential'
process.env.BETTER_AUTH_URL = 'https://app.hypertask.ai'
process.env.GOOGLE_ID = 'oauth-error-landing-test-client'
process.env.GOOGLE_SECRET = 'oauth-error-landing-test-secret'
process.env.NODE_ENV = 'production'

async function makeHarness() {
  const verifications = []
  let nextId = 1
  const matches = (row, where = {}) => Object.entries(where).every(([field, condition]) => {
    if (field === 'AND') return condition.every((clause) => matches(row, clause))
    if (field === 'OR') return condition.some((clause) => matches(row, clause))
    if (condition && typeof condition === 'object') {
      if ('equals' in condition) return row[field] === condition.equals
      if ('lt' in condition) return row[field] < condition.lt
      throw new Error(`Unsupported Prisma filter: ${JSON.stringify(condition)}`)
    }
    return row[field] === condition
  })
  const prisma = {
    BetterAuthVerification: {
      create: async ({ data }) => {
        const row = { id: nextId++, ...data }
        verifications.push(row)
        return { ...row }
      },
      findMany: async ({ where, orderBy, take, skip = 0 }) => {
        const rows = verifications.filter((row) => matches(row, where))
        if (orderBy) {
          const [field, direction] = Object.entries(orderBy)[0]
          rows.sort((a, b) => (a[field] - b[field]) * (direction === 'desc' ? -1 : 1))
        }
        return rows.slice(skip, take === undefined ? undefined : skip + take).map((row) => ({ ...row }))
      },
      deleteMany: async ({ where }) => {
        let count = 0
        for (let index = verifications.length - 1; index >= 0; index--) {
          if (matches(verifications[index], where)) {
            verifications.splice(index, 1)
            count++
          }
        }
        return { count }
      },
    },
  }
  const aliases = {
    '@/lib/prisma': { default: prisma },
    '@/lib/auth/oauthTokenCipher': { preflightOAuthTokenKey: () => {} },
    '@/lib/auth/oauthTokenStorage': { withOAuthTokenStorage: (adapter) => adapter },
    '@/lib/auth/bridgePlugin': { bridgeSessionPlugin: () => ({ id: 'bridge-session' }) },
    '@/lib/auth/legacyCookiePlugin': { legacyCookiePlugin: () => ({ id: 'legacy-cookie' }), newGoogleSignupRequests: new WeakMap() },
    '@/lib/configs/auth.config': { default: { onboarding: {} } },
    '@/lib/email/sendEmail': { sendEmail: async () => {} },
    '@/lib/mcp/managementPermissions': { MANAGEMENT_KEY_PERMISSIONS: {} },
    '@/lib/auth/signupAttributionContext': { consumeGoogleSignupContext: async () => null, consumeSignupCookie: async () => null },
    '@/lib/telemetry/signupIdentityLink': { recordSignupIdentityLink: async () => null },
    '@/lib/telemetry/analyticsIntents': { enqueueOutsideSaveAndProcessSoon: async () => {} },
    '@/lib/telemetry/signupAnalytics': { signupAttributionFromHeaders: () => ({}) },
    '@/lib/telemetry/signupCompleted': { enqueueSignupCompleted: async () => {} },
    '@/utils/controllers/users/provisionNewUser': { provisionNewUser: async () => {} },
    '@better-auth/infra': { dash: () => ({ id: 'dash' }) },
  }
  for (const specifier of ['better-auth', 'better-auth/adapters/prisma', 'better-auth/plugins', 'better-auth/api', '@better-auth/passkey', '@better-auth/api-key']) {
    aliases[specifier] = await import(specifier)
  }
  const javascript = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib/auth/betterAuth.ts'), 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', javascript)(
    (specifier) => {
      const value = aliases[specifier] ?? require(specifier)
      return value?.default ? { __esModule: true, ...value } : value
    }, loaded, loaded.exports,
  )
  return { auth: loaded.exports.auth, verifications }
}

function signIn(auth) {
  return auth.handler(new Request('https://app.hypertask.ai/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.hypertask.ai' },
    body: JSON.stringify({ provider: 'google', callbackURL: '/', errorCallbackURL: '/login?authError=google_signup_disabled' }),
  }))
}

test('now redirected', async () => {
  const { auth, verifications } = await makeHarness()
  const response = await auth.handler(new Request('https://app.hypertask.ai/api/auth/callback/google?state=already-used&code=x'))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/login?error=state_mismatch')
  assert.equal(verifications.length, 0)
})

test('/api/auth/error lands on login', async () => {
  const { auth } = await makeHarness()
  const response = await auth.handler(new Request('https://app.hypertask.ai/api/auth/error?error=state_mismatch'))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/login?error=state_mismatch')
})

test('still allowed', async () => {
  const { auth, verifications } = await makeHarness()
  const response = await signIn(auth)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.url.startsWith('https://accounts.google.com/'))
  assert.equal(verifications.length, 1)
  assert.equal(verifications[0].identifier, new URL(body.url).searchParams.get('state'))
})

test('parsed state keeps its own error page', async () => {
  const { auth, verifications } = await makeHarness()
  const signInResponse = await signIn(auth)
  assert.equal(signInResponse.status, 200)
  const body = await signInResponse.json()
  const state = new URL(body.url).searchParams.get('state')
  assert.ok(state)
  assert.equal(verifications.length, 1)
  const cookie = signInResponse.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  assert.ok(cookie)
  const callbackURL = `https://app.hypertask.ai/api/auth/callback/google?state=${encodeURIComponent(state)}&error=access_denied`
  const response = await auth.handler(new Request(callbackURL, { headers: { cookie } }))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/login?authError=google_signup_disabled&error=access_denied')
  assert.equal(verifications.length, 0, 'a parsed callback consumes its one-time verification')
  const replay = await auth.handler(new Request(callbackURL, { headers: { cookie } }))
  assert.equal(replay.status, 302)
  assert.equal(new URL(replay.headers.get('location'), process.env.BETTER_AUTH_URL).searchParams.get('error'), 'state_mismatch')
  assert.equal(verifications.length, 0, 'replaying a callback must not recreate its state')
})
