const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const jwt = require('jsonwebtoken')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const testSecret = 'htpr-7032-unit-test-signing-key'

function loadTs(relativePath, aliases = {}) {
  if (/src\/lib\/flags\/(?:keys|definitions)\.ts$/.test(relativePath)) return require("./helpers/flag-files.cjs").load(relativePath);
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const module_ = { exports: {} }
  new Function('require', 'module', 'exports', 'process', javascript)(
    specifier => aliases[specifier] ?? require(specifier),
    module_,
    module_.exports,
    { env: { JWT_SECRET: testSecret, RESEND_API_KEY: 'unit-test-no-network' } },
  )
  return module_.exports
}

function harness(t, { existingUser = null, modes = {} } = {}) {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  t.mock.method(console, 'log', () => {})
  const sent = []
  const records = new Map()
  const lookups = []
  const flagReads = []
  const prisma = {
    user: {
      findFirst: async args => {
        lookups.push(args)
        return existingUser
      },
      findUnique: async ({ where }) => {
        if (where.id === 6) return { email: 'valentin.yeo@gmail.com' }
        if (where.id === 985) return { email: 'valentin@hypertask.ai' }
        return null
      },
    },
    featureFlag: {
      findUnique: async ({ where }) => {
        flagReads.push(where.key)
        return modes[where.key] ? { mode: modes[where.key] } : null
      },
    },
    verificationCode: {
      upsert: async ({ where, create, update }) => {
        const record = records.get(where.email)
        records.set(where.email, record ? { ...record, ...update } : create)
      },
    },
  }
  const keys = loadTs('src/lib/flags/keys.ts')
  const flags = loadTs('src/lib/flags.ts', {
    '@/lib/prisma': { default: prisma, __esModule: true },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6 }) },
    '@/lib/flags/keys': keys,
    '@/lib/flags/definitions': loadTs('src/lib/flags/definitions.ts', {
      '@/lib/flags/keys': keys,
      '@/lib/agentRuns/model': { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: 'htpr-6282-agent-chat-stop-timeout' },
    }),
    '@/lib/agentRuns/model': { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: 'htpr-6282-agent-chat-stop-timeout' },
  })
  const { POST } = loadTs('src/app/api/auth/send-email-link/route.ts', {
    '@/lib/prisma': { default: prisma, __esModule: true },
    '@/lib/flags': flags,
    '@/lib/services/verificationCodeService': loadTs('src/lib/services/verificationCodeService.ts', {
      '@/lib/prisma': { default: prisma, __esModule: true },
    }),
    '@/lib/auth/safeReturnTo': loadTs('src/lib/auth/safeReturnTo.ts'),
    '@/lib/auth/requestBaseUrl': loadTs('src/lib/auth/requestBaseUrl.ts'),
    '@/lib/email/sendEmail': { sendEmail: async email => sent.push(email) },
  })
  return {
    sent, records, lookups, flagReads,
    advance: milliseconds => { now += milliseconds },
    send: (body = {}) => POST(new NextRequest('https://app.hypertask.ai/api/auth/send-email-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': 'app.hypertask.ai' },
      body: JSON.stringify({ email: ' Hyperreview7032@Yopmail.com ', ...body }),
    })),
  }
}

function emailLink(email) {
  return new URL(email.html.match(/<a href="([^"]+)"/)[1])
}

function assertSafeLink(url) {
  const allowed = new Set(['token', 'utm_source', 'utm_medium', 'utm_campaign', 'project', 'key', 'projectId', 'returnTo'])
  for (const key of url.searchParams.keys()) assert.ok(allowed.has(key), `Unexpected link parameter: ${key}`)
}

test('email copy matches signed JWT and persisted code TTLs, including resend', async t => {
  const h = harness(t)
  for (let send = 0; send < 2; send++) {
    const before = Date.now()
    assert.equal((await h.send()).status, 200)
    const email = h.sent.at(-1)
    const token = emailLink(email).searchParams.get('token')
    const payload = jwt.verify(token, testSecret, { issuer: 'hypertask', audience: 'email-link' })
    const record = h.records.get('hyperreview7032@yopmail.com')
    const linkMinutes = (payload.exp - payload.iat) / 60
    const codeMinutes = (record.expiresAt.getTime() - before) / 60_000
    assert.equal(linkMinutes, 15)
    assert.equal(codeMinutes, 30)
    assert.equal(Number(email.html.match(/This link expires in (\d+) minutes/)[1]), linkMinutes)
    assert.equal(Number(email.html.match(/This code expires in (\d+) minutes/)[1]), codeMinutes)
    assert.ok(email.html.includes(record.code))
    assert.equal(payload.sub, 'hyperreview7032@yopmail.com')
    assert.ok(payload.jti)
    assert.doesNotThrow(() => jwt.verify(token, testSecret, { clockTimestamp: payload.exp - 1 }))
    assert.throws(() => jwt.verify(token, testSecret, { clockTimestamp: payload.exp }), /jwt expired/)
    h.advance(60_000)
  }
  assert.notEqual(emailLink(h.sent[0]).searchParams.get('token'), emailLink(h.sent[1]).searchParams.get('token'))
  assert.deepEqual(h.lookups[0], { where: { email: 'hyperreview7032@yopmail.com' }, select: { id: true } })
})

test('expiry flag Off preserves legacy copy without changing TTLs or privacy', async t => {
  const h = harness(t, { modes: { 'htpr-7032-email-expiry-copy': 'OFF' } })
  assert.equal((await h.send({ utmData: { ip: '203.0.113.3', userAgent: 'fixture-agent', utm_timestamp: 'stale' } })).status, 200)
  assert.match(h.sent[0].html, /This link expires in 30 minutes/)
  assert.match(h.sent[0].html, /This code expires in 15 minutes/)
  const link = emailLink(h.sent[0])
  assertSafeLink(link)
  const payload = jwt.verify(link.searchParams.get('token'), testSecret)
  assert.equal(payload.exp - payload.iat, 15 * 60)
  assert.equal(h.records.get('hyperreview7032@yopmail.com').expiresAt.getTime() - Date.now(), 30 * 60_000)
})

test('initial and resent links allow only campaign attribution and auth/invite fields', async t => {
  const h = harness(t)
  const body = {
    utmData: {
      utm_source: 'qa', utm_medium: 'email', utm_campaign: 'onboarding',
      ip: '203.0.113.3', userAgent: 'fixture-agent', utm_timestamp: '2020-01-01',
      targetUrl: 'https://example.test/private', utm_fbclid: 'tracking-id', other: 'metadata',
      token: 'attacker-token', returnTo: 'https://evil.test',
    },
    inviteData: {
      project: 'QA Board', key: 'invite-key', projectId: '123',
      ip: '203.0.113.4', userAgent: 'invite-agent', utm_timestamp: 'stale', token: 'attacker-token',
    },
    returnTo: '/cli-auth/callback?code=fixture',
  }
  // Prove the absence checker rejects the former leaky link shape.
  assert.throws(() => assertSafeLink(new URL('https://app.hypertask.ai/login?token=fixture&ip=203.0.113.3')), /Unexpected link parameter/)
  for (let send = 0; send < 2; send++) {
    assert.equal((await h.send(body)).status, 200)
    const link = emailLink(h.sent.at(-1))
    assertSafeLink(link)
    assert.equal(link.pathname, '/login')
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) assert.equal(link.searchParams.get(key), body.utmData[key])
    for (const key of ['project', 'key', 'projectId']) assert.equal(link.searchParams.get(key), body.inviteData[key])
    assert.equal(link.searchParams.get('returnTo'), body.returnTo)
    assert.equal(jwt.verify(link.searchParams.get('token'), testSecret).sub, 'hyperreview7032@yopmail.com')
    h.advance(60_000)
  }
})

test('first-time variant is off for anonymous recipients under default Owner + QA, irrespective of sender session', async t => {
  const h = harness(t)
  assert.equal((await h.send({ firstTime: true, userId: 6 })).status, 200)
  assert.equal(h.sent[0].subject, 'Sign in to Hypertask')
  assert.match(h.sent[0].html, /Choose your preferred sign-in method below/)
  assert.doesNotMatch(h.sent[0].html, /people and AI agents work together/)
  assert.ok(h.flagReads.includes('htpr-7032-first-time-email'))
})

test('first-time variant renders on first send and resend only when owner releases it to Everyone', async t => {
  const h = harness(t, { modes: { 'htpr-7032-first-time-email': 'EVERYONE' } })
  for (let send = 0; send < 2; send++) {
    assert.equal((await h.send()).status, 200)
    assert.equal(h.sent.at(-1).subject, 'Confirm your email to open your Hypertask board')
    assert.match(h.sent.at(-1).html, /Confirm your email to land on your board, where people and AI agents work together\./)
    assert.match(h.sent.at(-1).html, /This link expires in 15 minutes/)
    assert.match(h.sent.at(-1).html, /This code expires in 30 minutes/)
    h.advance(60_000)
  }
})

test('first-time variant respects Off', async t => {
  const h = harness(t, { modes: { 'htpr-7032-first-time-email': 'OFF' } })
  assert.equal((await h.send()).status, 200)
  assert.equal(h.sent[0].subject, 'Sign in to Hypertask')
})

test('existing accounts including owner retain normal sign-in email even with first-time flag Everyone', async t => {
  const h = harness(t, { existingUser: { id: 6 }, modes: { 'htpr-7032-first-time-email': 'EVERYONE' } })
  assert.equal((await h.send()).status, 200)
  assert.equal(h.sent[0].subject, 'Sign in to Hypertask')
  assert.match(h.sent[0].html, /Choose your preferred sign-in method below/)
  assert.doesNotMatch(h.sent[0].html, /people and AI agents work together/)
  assert.ok(!h.flagReads.includes('htpr-7032-first-time-email'))
})

test('invalid external returnTo stays excluded and immediate resend remains rate limited', async t => {
  const h = harness(t)
  assert.equal((await h.send({ returnTo: 'https://evil.test/cli-auth' })).status, 200)
  assert.equal(emailLink(h.sent[0]).searchParams.has('returnTo'), false)
  assert.equal((await h.send()).status, 429)
  assert.equal(h.sent.length, 1)
})
