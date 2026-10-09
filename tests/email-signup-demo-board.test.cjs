const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const flagKey = 'htpr-7029-keep-demo-board-on-email-signup'
const guestId = 900
const userId = 100
const demoBoardId = 42
const connectTaskTitle = 'Connect Hypertask to Claude or ChatGPT'

function loadTs(relativePath, aliases) {
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', javascript)(
    (specifier) => aliases[specifier] ?? require(specifier), loaded, loaded.exports,
  )
  return loaded.exports
}

function makeHarness({ guestBoard = true, existing = false, memberships = 0, flagMode = 'EVERYONE', skipOnboarding = true, failProvision = false, failAdoption = false } = {}) {
  const calls = { provision: [], flags: [], mutations: [], emails: [] }
  const user = {
    id: userId, accountId: 'account-new', uid: 'email-test', email: 'new@example.test', displayName: 'New',
    UserSetting: { id: 101, isVerified: true, onboardingTourStatus: true, onboardingTutorialStatus: true },
  }
  const guest = { id: guestId, uid: 'guest_test' }
  const teams = guestBoard ? [{ id: 'team-demo', title: 'Demo team', googleAccountId: 'account-guest' }] : []
  const projects = guestBoard ? [{ id: demoBoardId, title: 'Demo board', ownerId: guestId, status: 'Normal', teamId: 'team-demo', googleAccountId: 'account-guest' }] : []
  const tasks = guestBoard ? [{ id: 500, projectId: demoBoardId, title: 'My demo work' }, { id: 501, projectId: demoBoardId, title: connectTaskTitle }] : []
  if (existing) projects.push({ id: 99, title: 'Existing board', ownerId: userId, status: 'Normal', teamId: 'team-existing' })
  const prisma = {
    user: {
      findFirst: async () => existing ? user : null,
      findUnique: async ({ where }) => where.id === guestId ? guest : user,
      update: async ({ where, data }) => {
        if (where.id === guestId) Object.assign(guest, data)
        return user
      },
    },
    userSetting: { update: async () => user.UserSetting },
    googleAccount: { findFirst: async () => ({ id: user.accountId, stripe_customer_id: 'customer-test' }) },
    team: {
      create: async ({ data }) => {
        const team = { id: `team-${teams.length}`, ...data }
        teams.push(team)
        return team
      },
      updateMany: async ({ data }) => {
        calls.mutations.push('adopt-team')
        teams.forEach((team) => Object.assign(team, data))
      },
    },
    team_Activity: { create: async () => {} },
    user_Activity: { update: async () => {} },
    project: {
      count: async ({ where }) => projects.filter((project) => project.ownerId === where.ownerId && project.status === where.status).length,
      findMany: async ({ where }) => projects.filter((project) => project.ownerId === where.ownerId && project.status === where.status),
      findFirst: async ({ where }) => {
        const project = projects.find((project) => project.ownerId === where.ownerId && project.status === where.status)
        return project ? { ...project, team: teams.find((team) => team.id === project.teamId) } : null
      },
      updateMany: async ({ where, data }) => {
        calls.mutations.push('adopt-board')
        projects.filter((project) => where.id.in.includes(project.id)).forEach((project) => Object.assign(project, data))
      },
    },
    member: { count: async () => memberships, deleteMany: async () => {}, updateMany: async () => {} },
    member_Team: { updateMany: async () => {} },
    assignees: { updateMany: async () => {} },
    section: { create: async ({ data }) => ({ id: 201, ...data }) },
    $transaction: async (callback) => {
      if (failAdoption) throw new Error('test adoption failure')
      return callback(prisma)
    },
    featureFlag: { findUnique: async ({ where }) => {
      calls.flags.push(where.key)
      return flagMode === null ? null : { mode: flagMode }
    } },
  }
  const aliases = {
    '@/lib/prisma': prisma,
    '@/lib/auth/getSessionUser': {},
    '@/lib/agentRuns/model': { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: 'test-agent-flag' },
    '@/lib/flags/keys': loadTs('src/lib/flags/keys.ts', {}),
    '@/lib/auth/session': {
      SESSION_COOKIE: 'ht_session', SESSION_TTL_SECONDS: 3600,
      verifySession: (token) => token === 'guest-session' ? { id: guestId } : null,
      signSession: () => 'new-session', sessionCookieOptions: () => ({}), clearBetterAuthSessionCookies: () => {},
    },
    '@/lib/demo/guest': { GUEST_UID_PREFIX: 'guest_' },
    '@/lib/configs/auth.config': { onboarding: { skipOnboarding, shouldSkipInteractive: true } },
    '@/lib/constants/constants': { companySizeOptions: ['Just me'], companyRoleOptions: ['Founder'] },
    '@/utils/controllers/users/update_or_create_user': async () => ({ status: 200, res: { user, isNewUser: !existing } }),
    '@/utils/controllers/users/autoJoinByEmailDomain': async () => {},
    '@/lib/auth/requestBaseUrl': { getRequestBaseUrl: () => 'https://app.hypertask.ai' },
    '@/lib/auth/slimUserCookie': { slimUserForCookie: (value) => value },
    '@/lib/auth/themeCookie': { seedResponseThemeCookie: () => {} },
    '@/lib/telemetry/signupAnalytics': { signupAttributionFromHeaders: () => ({}) },
    '@/lib/auth/emailLinkToken': { consumeEmailLinkToken: async () => true },
    '@/lib/auth/emailCodeRateLimit': {
      getEmailCodeClientIp: () => '192.0.2.1', claimEmailCodeAttempt: async () => ({ ipAllowed: true, emailAllowed: true }),
    },
    '@/lib/services/verificationCodeService': { VerificationCodeService: {
      verifyCode: async () => user.email, isRateLimited: () => ({ limited: false }),
    } },
    jsonwebtoken: { verify: () => ({ sub: user.email }), sign: () => 'test-verification-token' },
    '@/lib/email/sendEmail': { sendEmail: async (args) => { calls.emails.push(args) } },
    '@/utils/helperFunctions/helperFunctions': { getSequentialLetters: () => 'MB' },
    '@/utils/controllers/logs/createLog': () => {},
    '@/lib/subscription': { stripe: { customers: { retrieve: async () => ({ id: 'customer-test' }) } } },
    '../projects/create': { createProjectViewAndCreateDefault: async () => {} },
    '@/lib/configs/general.config': { generalConfig: { hyperAiId: 1 } },
    '../projects/createProjectWithStableName': { createProjectWithStableName: async (data) => {
      const project = { id: 200, status: 'Normal', ...data }
      projects.push(project)
      return project
    } },
    '../tasks/createTaskCore': { createTaskCore: async (data) => {
      const task = { id: 600 + tasks.length, ...data }
      tasks.push(task)
      return { task }
    } },
    '../assignees/assign': async () => {},
    '@/lib/stripeCustomerName': { stripeCustomerName: () => 'New' },
  }
  aliases['@/lib/flags'] = loadTs('src/lib/flags.ts', aliases)
  aliases['@/lib/onboarding/installCommands'] = loadTs('src/lib/onboarding/installCommands.ts', {})
  const onboarding = loadTs('src/utils/controllers/users/completeOnboardingStep.ts', aliases)
  aliases['@/utils/controllers/users/completeOnboardingStep'] = {
    CompleteOnboardingFirstStep: async (...args) => {
      calls.provision.push(args)
      if (failProvision) throw new Error('test provisioning failure')
      return onboarding.CompleteOnboardingFirstStep(...args)
    },
  }
  aliases['@/utils/controllers/demo/adoptGuestBoards'] = loadTs('src/utils/controllers/demo/adoptGuestBoards.ts', aliases)
  aliases['@/utils/controllers/demo/resolveLoginBoard'] = loadTs('src/utils/controllers/demo/resolveLoginBoard.ts', aliases)
  // Also runs on the pre-fix revision, so a missing helper cannot mask the lost-board assertion.
  const helperPath = 'src/utils/controllers/users/provisionFirstWorkspace.ts'
  if (fs.existsSync(path.join(root, helperPath))) {
    aliases['@/utils/controllers/users/provisionFirstWorkspace'] = loadTs(helperPath, aliases)
  }
  return { calls, user, guest, teams, projects, tasks, aliases }
}

async function runRoute(routeName, options = {}) {
  const harness = makeHarness(options)
  const original = { log: console.log, error: console.error, fetch: global.fetch, jwt: process.env.JWT_SECRET, resend: process.env.RESEND_API_KEY }
  console.log = () => {}
  console.error = () => {}
  process.env.JWT_SECRET = 'test-only-not-a-real-credential'
  process.env.RESEND_API_KEY = 'test-only-not-a-real-credential'
  global.fetch = async () => new Response(JSON.stringify(harness.projects.filter((project) => project.ownerId === userId)))
  try {
    if (routeName === 'completeOnboardingStep1') {
      const { default: handler } = loadTs('src/pages/api/users/completeOnboardingStep1.ts', harness.aliases)
      const response = { status(value) { this.statusCode = value; return this }, json(value) { this.body = value; return this } }
      await handler({ method: 'POST', cookies: { ht_session: options.guestBoard === false ? undefined : 'guest-session' }, body: {
        userId, teamTitle: 'MyTeam', companySize: 'Just me', companyRole: 'Founder',
      } }, response)
      assert.equal(response.statusCode, 200)
      return { ...harness, body: response.body }
    }
    const { POST } = loadTs(`src/app/api/auth/${routeName}/route.ts`, harness.aliases)
    const response = await POST(new NextRequest(`https://app.hypertask.ai/api/auth/${routeName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.guestBoard === false ? {} : { Cookie: 'ht_session=guest-session' }) },
      body: JSON.stringify({ email: harness.user.email, code: '123456', token: 'test-email-token' }),
    }))
    assert.equal(response.status, 200)
    if (routeName === 'instant-signup') {
      assert.equal(response.cookies.get('ht_session'), undefined)
      assert.equal(harness.calls.emails.length, 1)
    } else {
      assert.equal(response.cookies.get('ht_session')?.value, 'new-session')
    }
    return { ...harness, body: await response.json(), response }
  } finally {
    console.log = original.log
    console.error = original.error
    global.fetch = original.fetch
    if (original.jwt === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original.jwt
    if (original.resend === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = original.resend
  }
}

for (const route of ['verify-email-token', 'verify-code', 'instant-signup', 'completeOnboardingStep1']) {
  test(`${route}: adopts the demo workspace before onboarding without duplicate boards or starter tasks`, async () => {
    const result = await runRoute(route)
    assert.equal(result.projects.find((project) => project.id === demoBoardId).ownerId, userId)
    assert.equal(result.guest.uid, 'exguest_test')
    assert.equal(result.projects.length, 1)
    assert.equal(result.teams.length, 1)
    assert.equal(result.tasks.length, 2)
    assert.equal(result.tasks.filter((task) => task.title === connectTaskTitle).length, 1)
    assert.equal(result.calls.provision.length, 0)
    assert.ok(result.calls.flags.includes(flagKey))
    if (route.startsWith('verify-')) {
      assert.equal(result.body.prevBoard.id, demoBoardId)
      assert.equal(result.response.cookies.get('previousBoard')?.value, `project-${demoBoardId}|&|`)
    } else if (route === 'completeOnboardingStep1') {
      assert.equal(result.body.response.Team.id, 'team-demo')
      assert.equal(result.body.response.Project.id, demoBoardId)
    }
  })

  test(`${route}: without a guest board preserves the existing first-workspace contract`, async () => {
    const result = await runRoute(route, { guestBoard: false })
    assert.equal(result.calls.provision.length, 1)
    assert.equal(result.teams.length, 1)
    assert.equal(result.teams[0].title, 'MyTeam')
    const expectsBoard = route !== 'completeOnboardingStep1'
    assert.equal(result.projects.length, expectsBoard ? 1 : 0)
    assert.equal(result.tasks.filter((task) => task.title === connectTaskTitle).length, expectsBoard ? 1 : 0)
    if (expectsBoard) assert.equal(result.projects[0].title, 'MyBoard')
    else assert.equal(result.body.response.Project, null)
  })

  test(`${route}: existing board owners never receive the guest workspace`, async () => {
    const result = await runRoute(route, { existing: true })
    assert.equal(result.projects.find((project) => project.id === demoBoardId).ownerId, guestId)
    assert.equal(result.guest.uid, 'guest_test')
    assert.deepEqual(result.calls.mutations, [])
    assert.equal(result.calls.provision.length, route === 'completeOnboardingStep1' ? 1 : 0)
  })

  test(`${route}: flag Off retains the exact old provisioning/adoption behavior`, async () => {
    const result = await runRoute(route, { flagMode: 'OFF' })
    assert.equal(result.calls.provision.length, 1)
    assert.equal(result.projects.find((project) => project.id === demoBoardId).ownerId, guestId)
    assert.equal(result.guest.uid, 'guest_test')
    assert.deepEqual(result.calls.mutations, [])
    assert.equal(result.teams.length, 2)
    const expectsBoard = route !== 'completeOnboardingStep1'
    assert.equal(result.projects.length, expectsBoard ? 2 : 1)
    assert.equal(result.tasks.filter((task) => task.title === connectTaskTitle).length, expectsBoard ? 2 : 1)
  })
}

for (const route of ['verify-email-token', 'verify-code', 'instant-signup']) {
  test(`${route}: membership-only accounts still refuse adoption`, async () => {
    const result = await runRoute(route, { memberships: 1 })
    assert.equal(result.projects.find((project) => project.id === demoBoardId).ownerId, guestId)
    assert.deepEqual(result.calls.mutations, [])
  })

  test(`${route}: failed adoption still provisions the ordinary starter board`, async () => {
    const result = await runRoute(route, { failAdoption: true })
    assert.equal(result.projects.find((project) => project.id === demoBoardId).ownerId, guestId)
    assert.equal(result.calls.provision.length, 1)
    assert.equal(result.projects.find((project) => project.title === 'MyBoard').ownerId, userId)
  })
}

for (const route of ['verify-email-token', 'verify-code']) {
  test(`${route}: flag Off still adopts after non-fatal provisioning failure`, async () => {
    const result = await runRoute(route, { flagMode: 'OFF', failProvision: true })
    assert.equal(result.projects[0].ownerId, userId)
    assert.equal(result.calls.provision.length, 1)
  })

  test(`${route}: users not auto-provisioned still adopt their demo workspace`, async () => {
    const result = await runRoute(route, { skipOnboarding: false })
    assert.equal(result.projects[0].ownerId, userId)
    assert.equal(result.calls.provision.length, 0)
  })
}

test('the bugfix flag defaults to Everyone when no database row exists', async () => {
  const result = await runRoute('verify-code', { flagMode: null })
  assert.equal(result.projects[0].ownerId, userId)
  assert.equal(result.calls.provision.length, 0)
  assert.equal(result.aliases['@/lib/flags'].defaultFeatureFlagMode(flagKey), 'EVERYONE')
})
