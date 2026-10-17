const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function loader(aliases) {
  const cache = new Map()
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports
    const loaded = { exports: {} }
    cache.set(relative, loaded)
    const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    new Function('require', 'module', 'exports', javascript)((specifier) => {
      if (specifier in aliases) return aliases[specifier]
      let local
      if (specifier.startsWith('@/')) local = `src/${specifier.slice(2)}`
      else if (specifier.startsWith('.')) local = path.join(path.dirname(relative), specifier)
      if (local) {
        const filename = ['.ts', '.tsx', ''].map((suffix) => local + suffix).find((file) => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile())
        if (filename) return load(filename)
      }
      return require(specifier)
    }, loaded, loaded.exports)
    return loaded.exports
  }
  return load
}

const DAY = 24 * 60 * 60 * 1000

function database({ user, googleAccounts = [], userSetting = null, userPicture = null, activity = null, signupLog = null }) {
  const rows = { user: { ...user }, googleAccounts: googleAccounts.map((row) => ({ ...row })), userSetting, userPicture, activity, signupLog, announcements: [] }
  const writes = []
  const upsert = (name) => async ({ create }) => {
    if (!rows[name]) { rows[name] = { id: `${name}-1`, ...create }; writes.push(`create ${name}`) }
    return rows[name]
  }
  const client = {
    user: {
      findUnique: async () => ({ ...rows.user }),
      update: async ({ data }) => { Object.assign(rows.user, data); return { ...rows.user } },
    },
    user_Activity: { upsert: upsert('activity') },
    userSetting: { upsert: upsert('userSetting') },
    userPicture: { upsert: upsert('userPicture') },
    logs: { findFirst: async () => rows.signupLog },
    announcments: { findMany: async () => [{ id: 1 }, { id: 2 }] },
    userAnnouncement: { createMany: async ({ data, skipDuplicates }) => { rows.announcements.push({ data, skipDuplicates }); return { count: data.length } } },
    googleAccount: {
      findFirst: async ({ where }) => rows.googleAccounts.find((row) => (!where.id || row.id === where.id) && row.userId === where.userId) ?? null,
      create: async ({ data }) => { const row = { id: `ga-${rows.googleAccounts.length + 1}`, ...data }; rows.googleAccounts.push(row); writes.push('create googleAccount'); return row },
      updateMany: async ({ where, data }) => { const row = rows.googleAccounts.find((item) => item.id === where.id && item.stripe_customer_id === where.stripe_customer_id); if (row) Object.assign(row, data); return { count: row ? 1 : 0 } },
    },
  }
  return { rows, writes, client }
}

function stripeFake({ earlier = null } = {}) {
  const calls = { search: [], create: [] }
  return {
    calls,
    stripe: { customers: {
      search: async (query) => { calls.search.push(query); return { data: earlier ? [earlier] : [] } },
      create: async (data, options) => { calls.create.push({ data, options }); return { id: 'cus_new' } },
    } },
  }
}

function loadProvisioning(db, stripe) {
  const created = []
  const load = loader({
    '@prisma/client': { LogType: { Signup: 'Signup' }, Status: { Normal: 'Normal' } },
    '@/lib/prisma': db.client,
    '@/lib/subscription': { stripe },
    '../logs/createLog': (log) => { created.push(log); return Promise.resolve() },
    './autoJoinByEmailDomain': async () => {},
  })
  return { ...load('src/utils/controllers/users/provisionNewUser.ts'), createdLogs: created }
}

const provisionArgs = { userId: 7, email: 'new@example.test', displayName: 'New', photoURL: 'p', stripeCustomerNameEmail: 'new@example.test', shouldSkipInteractive: false, skipOnboarding: false, isVerified: true }

test('a resumed provisioning keeps existing rows and reuses the linked GoogleAccount and its Stripe customer', async () => {
  const db = database({
    user: { id: 7, accountId: 'ga-linked', stripe_customer_id: null },
    googleAccounts: [{ id: 'ga-blank', userId: 7, stripe_customer_id: '' }, { id: 'ga-linked', userId: 7, stripe_customer_id: 'cus_saved' }],
    userSetting: { id: 'setting-old' }, userPicture: { id: 'picture-old' }, activity: { id: 'activity-old' }, signupLog: { id: 1 },
  })
  const fake = stripeFake()
  const { provisionNewUser, createdLogs } = loadProvisioning(db, fake.stripe)
  await provisionNewUser({ ...provisionArgs, resumingEarlierAttempt: true })
  assert.deepEqual(db.writes, [])
  assert.deepEqual(createdLogs, [])
  assert.equal(fake.calls.search.length, 0)
  assert.equal(fake.calls.create.length, 0)
  assert.equal(db.rows.user.stripe_customer_id, 'cus_saved')
  assert.equal(db.rows.user.accountId, 'ga-linked')
  assert.equal(db.rows.user.UserSettingId, 'setting-old')
  assert.deepEqual(db.rows.announcements, [{ data: [{ userId: 7, announcementId: 1 }, { userId: 7, announcementId: 2 }], skipDuplicates: true }])
})

test('a resumed provisioning finds the Stripe customer an earlier attempt created instead of creating a second one', async () => {
  const db = database({ user: { id: 7, accountId: null, stripe_customer_id: null } })
  const fake = stripeFake({ earlier: { id: 'cus_earlier' } })
  const { provisionNewUser } = loadProvisioning(db, fake.stripe)
  await provisionNewUser({ ...provisionArgs, createGoogleAccount: false, resumingEarlierAttempt: true })
  assert.deepEqual(fake.calls.search, [{ query: "metadata['hypertaskUserId']:'7'", limit: 1 }])
  assert.equal(fake.calls.create.length, 0)
  assert.equal(db.rows.user.stripe_customer_id, 'cus_earlier')
})

test('a resumed Google provisioning also finds a customer the old code tagged only with the GoogleAccount id', async () => {
  const db = database({ user: { id: 7, accountId: 'ga-1', stripe_customer_id: null }, googleAccounts: [{ id: 'ga-1', userId: 7, stripe_customer_id: '' }] })
  const fake = stripeFake({ earlier: { id: 'cus_old_code' } })
  const { provisionNewUser } = loadProvisioning(db, fake.stripe)
  await provisionNewUser({ ...provisionArgs, resumingEarlierAttempt: true })
  assert.deepEqual(fake.calls.search, [{ query: "metadata['hypertaskUserId']:'7' OR metadata['googleAccountId']:'ga-1'", limit: 1 }])
  assert.equal(fake.calls.create.length, 0)
  assert.equal(db.rows.googleAccounts[0].stripe_customer_id, 'cus_old_code')
  assert.equal(db.rows.user.stripe_customer_id, 'cus_old_code')
})

test('retries with the same request reuse one Stripe idempotency key, and a changed request gets a different key', async () => {
  const keys = []
  for (const email of ['new@example.test', 'new@example.test', 'other@example.test']) {
    const fake = stripeFake()
    const { provisionNewUser } = loadProvisioning(database({ user: { id: 7, accountId: null, stripe_customer_id: null } }), fake.stripe)
    await provisionNewUser({ ...provisionArgs, createGoogleAccount: false, stripeCustomerNameEmail: email })
    keys.push(fake.calls.create[0].options.idempotencyKey)
  }
  assert.equal(keys[0], keys[1])
  assert.notEqual(keys[0], keys[2])
})

test('a first provisioning creates every row once and one Stripe customer with a per-user idempotency key', async () => {
  const db = database({ user: { id: 7, accountId: null, stripe_customer_id: null } })
  const fake = stripeFake()
  const { provisionNewUser, createdLogs } = loadProvisioning(db, fake.stripe)
  await provisionNewUser(provisionArgs)
  assert.deepEqual(db.writes, ['create activity', 'create userSetting', 'create userPicture', 'create googleAccount'])
  assert.equal(createdLogs.length, 1)
  assert.equal(fake.calls.search.length, 0)
  assert.equal(fake.calls.create.length, 1)
  assert.match(fake.calls.create[0].options.idempotencyKey, /^hypertask-user:7:signup-stripe-customer:[0-9a-f]{16}$/)
  assert.deepEqual(fake.calls.create[0].data.metadata, { hypertaskUserId: '7', googleAccountId: 'ga-1' })
  assert.equal(db.rows.googleAccounts[0].stripe_customer_id, 'cus_new')
  assert.equal(db.rows.user.stripe_customer_id, 'cus_new')
})

function loadResume({ user, enabled = true, provisionError = null }) {
  const calls = { provision: [], signups: [], locks: 0 }
  let current = { ...user }
  const client = { user: { findUnique: async () => current && { ...current } } }
  const prisma = {
    ...client,
    $transaction: async (work) => work({ ...client, $executeRaw: async () => { calls.locks += 1 } }),
  }
  const load = loader({
    '@/lib/prisma': prisma,
    '@/lib/flags': { isFeatureEnabled: async (key) => key === 'htpr-7289-resume-signup-provisioning' && enabled },
    '@/lib/telemetry/signupCompleted': { recordSignupCompleted: (input) => calls.signups.push(input) },
    './provisionNewUser': { provisionNewUser: async (input) => {
      calls.provision.push(input)
      if (provisionError) throw provisionError
      current = { ...current, stripe_customer_id: 'cus_done' }
    } },
  })
  return { ...load('src/utils/controllers/users/resumeIncompleteSignup.ts'), calls }
}

const resumeArgs = {
  userId: 7, displayName: 'New', photoURL: 'p', stripeCustomerNameEmail: 'new@example.test', shouldSkipInteractive: false, skipOnboarding: false,
  isVerified: true, createGoogleAccount: true, signupAttribution: { signupMethod: 'google' }, cookieHeader: 'consent=all',
}
const recent = { uid: 'u7', email: 'new@example.test', stripe_customer_id: null, joinedAt: new Date(Date.now() - DAY) }

test('a sign-in by a recent account whose setup failed finishes setup and records its signup once', async () => {
  const { resumeIncompleteSignup, calls } = loadResume({ user: recent })
  assert.equal(await resumeIncompleteSignup(resumeArgs), true)
  assert.equal(await resumeIncompleteSignup(resumeArgs), false)
  assert.equal(calls.provision.length, 1)
  assert.equal(calls.provision[0].email, 'new@example.test')
  assert.equal(calls.provision[0].resumingEarlierAttempt, true)
  assert.equal(calls.locks, 1)
  assert.deepEqual(calls.signups, [{ decision: null, cookieHeader: 'consent=all', userId: 7, signupMethod: 'google' }])
})

test('established, old, guest and flag-off accounts are never re-provisioned and emit no signup', async () => {
  const cases = [
    { user: { ...recent, stripe_customer_id: 'cus_existing' } },
    { user: { ...recent, joinedAt: new Date(Date.now() - 8 * DAY) } },
    { user: { ...recent, uid: 'guest_abc' } },
    { user: recent, enabled: false },
  ]
  for (const options of cases) {
    const { resumeIncompleteSignup, calls } = loadResume(options)
    assert.equal(await resumeIncompleteSignup(resumeArgs), false)
    assert.deepEqual(calls.provision, [])
    assert.deepEqual(calls.signups, [])
  }
})

test('a resume that fails again leaves the account incomplete, signs in and records no signup', async () => {
  const { resumeIncompleteSignup, calls } = loadResume({ user: recent, provisionError: new Error('Stripe down') })
  const originalError = console.error
  console.error = () => {}
  try {
    assert.equal(await resumeIncompleteSignup(resumeArgs), false)
  } finally {
    console.error = originalError
  }
  assert.equal(calls.provision.length, 1)
  assert.deepEqual(calls.signups, [])
})

test('the legacy sign-in resumes an existing account before its usual updates', async () => {
  const resumed = []
  const user = { id: 7, uid: 'u7', email: 'new@example.test', UserSetting: null }
  const load = loader({
    '@/lib/telemetry/signupIdentityLink': { recordSignupIdentityLink: async () => null },
    '@/lib/prisma': {
      googleAccount: { findFirst: async () => null },
      user: { update: async () => user, findFirst: async () => user },
      userSetting: { update: async () => {} },
    },
    '@/lib/configs/auth.config': { onboarding: { shouldSkipInteractive: false, skipOnboarding: false } },
    '@/lib/configs/general.config': { generalConfig: { defaultPhotoURL: 'photo' } },
    '@/lib/telemetry/signupCompleted': { recordSignupCompleted: () => {} },
    './provisionNewUser': { provisionNewUser: async () => user, updateUserProfilePicture: async () => {} },
    './findUserByEmail': { findUserByEmail: async () => user },
    './resumeIncompleteSignup': { resumeIncompleteSignup: async (input) => { resumed.push(input); return true } },
  })
  const update_or_create_user = load('src/utils/controllers/users/update_or_create_user.ts').default
  const originalLog = console.log
  console.log = () => {}
  try {
    const result = await update_or_create_user('new@example.test', { displayName: 'New', photoURL: 'p', email: 'new@example.test' }, false, false, true, { signupMethod: 'email' }, null, 'consent=all')
    assert.equal(result.status, 200)
    assert.equal(result.res.isNewUser, false)
  } finally {
    console.log = originalLog
  }
  assert.equal(resumed.length, 1)
  assert.equal(resumed[0].userId, 7)
  assert.equal(resumed[0].createGoogleAccount, true)
  assert.deepEqual(resumed[0].signupAttribution, { signupMethod: 'email' })
  assert.equal(resumed[0].cookieHeader, 'consent=all')
})
