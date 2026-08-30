const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')

function loadTypescriptModule(relativePath, aliases = {}) {
  const filename = path.join(root, relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const module_ = { exports: {} }
  const localRequire = (specifier) => aliases[specifier] ?? require(specifier)
  new Function('require', 'module', 'exports', javascript)(
    localRequire,
    module_,
    module_.exports,
  )
  return module_.exports
}

function makeVerificationCodeStore() {
  const record = {
    code: '123456',
    email: 'owner@example.test',
    used: false,
    expiresAt: new Date(Date.now() + 60_000),
  }
  const calls = []
  return {
    record,
    calls,
    prisma: {
      verificationCode: {
        updateMany: async (args) => {
          calls.push(args)
          const matches =
            record.code === args.where.code &&
            record.email === args.where.email &&
            record.used === args.where.used &&
            record.expiresAt > args.where.expiresAt.gt
          if (!matches) return { count: 0 }
          record.used = true
          return { count: 1 }
        },
      },
    },
  }
}

test('verification codes are generated through crypto.randomInt', () => {
  const calls = []
  const { VerificationCodeService } = loadTypescriptModule(
    'src/lib/services/verificationCodeService.ts',
    {
      '@/lib/prisma': {},
      'node:crypto': {
        randomInt: (minimum, maximum) => {
          calls.push([minimum, maximum])
          return 654321
        },
      },
    },
  )

  assert.equal(VerificationCodeService.generateCode(), '654321')
  assert.deepEqual(calls, [[100000, 1000000]])
})

test('send-email-link never returns authentication secrets', async () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousJwtSecret = process.env.JWT_SECRET
  const previousResendKey = process.env.RESEND_API_KEY
  const storedCodes = []

  process.env.NODE_ENV = 'development'
  process.env.JWT_SECRET = 'test-only-email-link-secret'
  delete process.env.RESEND_API_KEY

  try {
    const { POST } = loadTypescriptModule(
      'src/app/api/auth/send-email-link/route.ts',
      {
        '@/lib/services/verificationCodeService': {
          VerificationCodeService: {
            generateCode: () => '123456',
            isRateLimited: () => ({ limited: false, waitTime: 0 }),
            storeCode: async (...args) => storedCodes.push(args),
          },
        },
        '@/lib/auth/safeReturnTo': { parseSafeReturnTo: () => null },
        '@/lib/auth/requestBaseUrl': {
          getRequestBaseUrl: () => 'https://app.hypertask.ai',
        },
        '@/lib/email/sendEmail': { sendEmail: async () => {} },
      },
    )
    const response = await POST(
      new NextRequest('https://app.hypertask.ai/api/auth/send-email-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ' Owner@Example.Test ' }),
      }),
    )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(Object.hasOwn(body, 'verificationCode'), false)
    assert.equal(Object.hasOwn(body, 'devLink'), false)
    assert.deepEqual(storedCodes, [['123456', 'owner@example.test', 30]])
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousJwtSecret
    if (previousResendKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousResendKey
  }
})

test('verification atomically binds a code to its normalized email', async () => {
  const store = makeVerificationCodeStore()
  const { VerificationCodeService } = loadTypescriptModule(
    'src/lib/services/verificationCodeService.ts',
    { '@/lib/prisma': store.prisma },
  )

  const result = await VerificationCodeService.verifyCode(
    store.record.code,
    ' Owner@Example.Test '
  )

  assert.equal(result, store.record.email)
  assert.equal(store.record.used, true)
  assert.equal(store.calls.length, 1)
  assert.deepEqual(store.calls[0].data, { used: true })
  assert.deepEqual(
    {
      code: store.calls[0].where.code,
      email: store.calls[0].where.email,
      used: store.calls[0].where.used,
    },
    {
      code: store.record.code,
      email: store.record.email,
      used: false,
    }
  )
  assert.ok(store.calls[0].where.expiresAt.gt instanceof Date)
})

test('another email cannot redeem a live code and concurrent reuse has one winner', async () => {
  const wrongEmailStore = makeVerificationCodeStore()
  const wrongEmailService = loadTypescriptModule(
    'src/lib/services/verificationCodeService.ts',
    { '@/lib/prisma': wrongEmailStore.prisma },
  ).VerificationCodeService

  assert.equal(
    await wrongEmailService.verifyCode('123456', 'attacker@example.test'),
    null
  )
  assert.equal(wrongEmailStore.record.used, false)

  const concurrentStore = makeVerificationCodeStore()
  const concurrentService = loadTypescriptModule(
    'src/lib/services/verificationCodeService.ts',
    { '@/lib/prisma': concurrentStore.prisma },
  ).VerificationCodeService
  const results = await Promise.all([
    concurrentService.verifyCode('123456', concurrentStore.record.email),
    concurrentService.verifyCode('123456', concurrentStore.record.email),
  ])

  assert.deepEqual(results.sort(), [null, concurrentStore.record.email].sort())
  assert.equal(concurrentStore.calls.length, 2)
})

function makeRedis() {
  const counts = new Map()
  const commandLog = []
  return {
    counts,
    commandLog,
    async eval(_script, keyCount, ipKey, emailKey, windowSeconds, ipLimit) {
      commandLog.push([
        'eval',
        keyCount,
        ipKey,
        emailKey,
        windowSeconds,
        ipLimit,
      ])
      const ipCount = (counts.get(ipKey) ?? 0) + 1
      counts.set(ipKey, ipCount)
      if (ipCount > Number(ipLimit)) return [-1, ipCount]

      const emailCount = (counts.get(emailKey) ?? 0) + 1
      counts.set(emailKey, emailCount)
      return [emailCount, ipCount]
    },
  }
}

test('attempt limits expose a soft email budget and a hard IP budget', async () => {
  const redis = makeRedis()
  const security = loadTypescriptModule('src/lib/auth/emailCodeRateLimit.ts', {
    '@/lib/redis': { getRedis: async () => redis },
  })
  const now = 1_786_215_000_000

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const decision = await security.claimEmailCodeAttempt(
      'owner@example.test',
      `198.51.100.${attempt}`,
      now
    )
    assert.equal(decision.allowed, attempt <= 5)
    assert.equal(decision.emailAllowed, attempt <= 5)
    assert.equal(decision.ipAllowed, true)
  }

  for (let attempt = 1; attempt <= 51; attempt += 1) {
    const decision = await security.claimEmailCodeAttempt(
      `person-${attempt}@example.test`,
      '203.0.113.9',
      now
    )
    assert.equal(decision.allowed, attempt <= 50)
    assert.equal(decision.ipAllowed, attempt <= 50)
  }

  const keyCountAfterIpLockout = redis.counts.size
  for (let attempt = 52; attempt <= 60; attempt += 1) {
    await security.claimEmailCodeAttempt(
      `person-${attempt}@example.test`,
      '203.0.113.9',
      now
    )
  }
  assert.equal(
    redis.counts.size,
    keyCountAfterIpLockout,
    'an IP lockout must not create unbounded per-email keys'
  )
})

test('rate-limit keys hide email and IP values and malformed Redis counts fail closed', () => {
  const security = loadTypescriptModule('src/lib/auth/emailCodeRateLimit.ts', {
    '@/lib/redis': { getRedis: async () => makeRedis() },
  })
  const keys = security.getEmailCodeAttemptKeys(
    'owner@example.test',
    '203.0.113.9',
    1_786_215_000_000
  )

  assert.equal(JSON.stringify(keys).includes('owner@example.test'), false)
  assert.equal(JSON.stringify(keys).includes('203.0.113.9'), false)
  assert.equal(security.decideEmailCodeAttempt(Number.NaN, 1).allowed, false)
  assert.equal(security.decideEmailCodeAttempt(1, Number.NaN).allowed, false)
  assert.equal(security.decideEmailCodeAttempt(Number.NaN, 1).ipAllowed, false)
  assert.equal(security.decideEmailCodeAttempt(1, Number.NaN).emailAllowed, false)
  assert.equal(
    security.getEmailCodeClientIp(
      new Request('https://app.hypertask.ai/api/auth/verify-code', {
        headers: {
          'x-forwarded-for': '198.51.100.99',
          'x-real-ip': '198.51.100.4',
        },
      })
    ),
    '198.51.100.4'
  )
  assert.equal(
    security.getEmailCodeClientIp(
      new Request('https://app.hypertask.ai/api/auth/verify-code', {
        headers: { 'x-forwarded-for': '198.51.100.99' },
      })
    ),
    null
  )
  assert.equal(
    security.getEmailCodeClientIp(
      new Request('https://app.hypertask.ai/api/auth/verify-code', {
        headers: { 'x-real-ip': 'not-an-ip-address' },
      })
    ),
    null
  )
  assert.equal(
    security.getEmailCodeClientIp(
      new Request('https://app.hypertask.ai/api/auth/verify-code', {
        headers: { 'x-real-ip': '   ' },
      })
    ),
    null
  )
})

test('verify-code requires email, reserves capacity, and verifies the bound pair', async () => {
  const calls = { claims: [], verifications: [] }
  let clientIp = '198.51.100.4'
  let decision = {
    allowed: true,
    emailAllowed: true,
    ipAllowed: true,
    emailCount: 1,
    ipCount: 1,
  }
  let claimError = null
  let verificationResult = null
  const aliases = {
    '@/lib/services/verificationCodeService': {
      VerificationCodeService: {
        verifyCode: async (...args) => {
          calls.verifications.push(args)
          return verificationResult
        },
      },
    },
    '@/utils/controllers/users/update_or_create_user': async (email) => ({
      status: 200,
      res: {
        user: { id: 6, email, UserSetting: null },
        isNewUser: false,
      },
    }),
    '@/models/model': {},
    '@/lib/configs/auth.config': {
      onboarding: { shouldSkipInteractive: false, skipOnboarding: false },
      cookies: { theme: 'theme', defaultTheme: 'system' },
    },
    '@/lib/auth/themeCookie': { seedResponseThemeCookie: () => {} },
    '@/lib/themePreferences': loadTypescriptModule('src/lib/themePreferences.ts'),
    '@/utils/controllers/users/autoJoinByEmailDomain': async () => {},
    '@/utils/controllers/users/completeOnboardingStep': {
      CompleteOnboardingFirstStep: async () => {},
    },
    '@/lib/constants/constants': { companyRoleOptions: [], companySizeOptions: [] },
    '@/lib/prisma': {
      user: {
        findFirst: async () => null,
      },
    },
    '@/lib/auth/requestBaseUrl': { getRequestBaseUrl: () => 'https://app.hypertask.ai' },
    '@/lib/auth/session': {
      SESSION_COOKIE: 'ht_session',
      SESSION_TTL_SECONDS: 1,
      clearBetterAuthSessionCookies: () => {},
      sessionCookieOptions: () => ({}),
      signSession: () => 'session',
    },
    '@/utils/controllers/demo/adoptGuestBoards': { adoptGuestBoards: async () => {} },
    '@/lib/auth/slimUserCookie': loadTypescriptModule('src/lib/auth/slimUserCookie.ts'),
    '@/lib/auth/emailCodeRateLimit': {
      getEmailCodeClientIp: () => clientIp,
      claimEmailCodeAttempt: async (...args) => {
        calls.claims.push(args)
        if (claimError) throw claimError
        return decision
      },
    },
  }
  const { POST } = loadTypescriptModule(
    'src/app/api/auth/verify-code/route.ts',
    aliases
  )
  const request = (body) =>
    new NextRequest('https://app.hypertask.ai/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  let response = await POST(request({ code: '123456' }))
  assert.equal(response.status, 400)
  assert.equal(calls.claims.length, 0)
  assert.equal(calls.verifications.length, 0)

  clientIp = null
  response = await POST(
    request({ code: '123456', email: 'owner@example.test' })
  )
  assert.equal(response.status, 503)
  assert.equal(calls.claims.length, 0)
  assert.equal(calls.verifications.length, 0)
  clientIp = '198.51.100.4'

  response = await POST(
    request({ code: '123456', email: ' Owner@Example.Test ' })
  )
  assert.equal(response.status, 400)
  assert.deepEqual(calls.claims[0].slice(0, 2), [
    'owner@example.test',
    '198.51.100.4',
  ])
  assert.deepEqual(calls.verifications[0], [
    '123456',
    'owner@example.test',
  ])

  decision = {
    allowed: false,
    emailAllowed: false,
    ipAllowed: true,
    emailCount: 6,
    ipCount: 2,
  }
  response = await POST(
    request({ code: '654321', email: 'owner@example.test' })
  )
  assert.equal(response.status, 429)
  assert.equal(calls.verifications.length, 2)

  verificationResult = 'owner@example.test'
  const originalFetch = global.fetch
  global.fetch = async () => ({ ok: true, json: async () => [] })
  try {
    response = await POST(
      request({ code: '123456', email: 'owner@example.test' })
    )
  } finally {
    global.fetch = originalFetch
  }
  assert.equal(response.status, 200)
  assert.equal((await response.json()).success, true)
  assert.equal(calls.verifications.length, 3)

  verificationResult = null
  decision = {
    allowed: false,
    emailAllowed: true,
    ipAllowed: false,
    emailCount: 1,
    ipCount: 51,
  }
  response = await POST(
    request({ code: '654321', email: 'owner@example.test' })
  )
  assert.equal(response.status, 429)
  assert.equal(calls.verifications.length, 3)

  claimError = new Error('redis unavailable')
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    response = await POST(
      request({ code: '654321', email: 'owner@example.test' })
    )
  } finally {
    console.error = originalConsoleError
  }
  assert.equal(response.status, 500)
  assert.equal(calls.verifications.length, 3)
})

test('legacy clients submit email and production paths do not log raw credentials', () => {
  const emailAuth = fs.readFileSync(
    path.join(root, 'src/app/login/EmailAuth/useEmailAuth.ts'),
    'utf8'
  )
  const guestLogin = fs.readFileSync(
    path.join(root, 'src/components/Modals/GuestLoginModal/index.tsx'),
    'utf8'
  )
  const verifyRoute = fs.readFileSync(
    path.join(root, 'src/app/api/auth/verify-code/route.ts'),
    'utf8'
  )
  const sendRoute = fs.readFileSync(
    path.join(root, 'src/app/api/auth/send-email-link/route.ts'),
    'utf8'
  )

  assert.match(emailAuth, /code: verificationCode,\s+email,/)
  assert.match(guestLogin, /code,\s+email,/)
  assert.doesNotMatch(verifyRoute, /Verifying code:/)
  assert.doesNotMatch(sendRoute, /Sign-in link with UTM params:/)
  assert.doesNotMatch(sendRoute, /Sign-in link \(no Resend configured\):/)
})
