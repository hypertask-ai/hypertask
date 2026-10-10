const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const flagKey = 'htpr-7035-demo-login-own-board'
const guestId = 900
const userId = 100
const demoBoardId = 42

function loadTs(relativePath, aliases) {
  if (/src\/lib\/flags\/(?:keys|definitions)\.ts$/.test(relativePath)) return require("./helpers/flag-files.cjs").load(relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', javascript)(
    (specifier) => aliases[specifier] ?? require(specifier), loaded, loaded.exports,
  )
  return loaded.exports
}

function makeHarness({ existing = true, membershipOnly = false, flagMode = 'EVERYONE', previousBoard = `project-${demoBoardId}|&|`, extraOwnedBoard = false, archivedLastBoard = false, teamlessLastBoard = false, failFlag = false } = {}) {
  const calls = { flags: [], unauthenticatedBoardRequests: 0 }
  const user = { id: userId, accountId: 'account-user', uid: 'email_test', email: 'user@example.test', UserSetting: { id: 101, onboardingTourStatus: true, onboardingTutorialStatus: true } }
  const guest = { id: guestId, uid: 'guest_test' }
  const projects = [{ id: demoBoardId, ownerId: guestId, status: 'Normal', members: [guestId], team: { id: 'demo-team', title: 'Demo' } }]
  if (existing) projects.push({ id: 99, ownerId: membershipOnly ? 200 : userId, status: 'Normal', members: [userId], team: { id: 'own-team', title: 'Own' } })
  if (extraOwnedBoard) projects.push({ id: 101, ownerId: userId, status: archivedLastBoard ? 'Archive' : 'Normal', members: [userId], team: teamlessLastBoard ? null : { id: 'second-team', title: 'Second' } })
  const matches = (project, where) =>
    (!where.id || project.id === where.id) && (!where.status || project.status === where.status) &&
    (!where.ownerId || project.ownerId === where.ownerId) &&
    (!where.teamId || project.team !== null) &&
    (!where.members || project.members.includes(where.members.some.userId)) &&
    (!where.OR || where.OR.some((branch) => matches(project, branch)))
  const prisma = {
    user: {
      findFirst: async () => existing ? user : null,
      findUnique: async ({ where }) => where.id === guestId ? guest : user,
      update: async ({ where, data }) => { if (where.id === guestId) Object.assign(guest, data); return user },
    },
    userSetting: { update: async () => user.UserSetting },
    project: {
      count: async ({ where }) => projects.filter((project) => matches(project, where)).length,
      findMany: async ({ where }) => projects.filter((project) => matches(project, where)),
      findFirst: async ({ where }) => {
        const project = projects.find((project) => matches(project, where))
        return project ? { ...project, _count: { tasks: 1 } } : null
      },
      updateMany: async ({ where, data }) => projects.filter((project) => where.id.in.includes(project.id)).forEach((project) => Object.assign(project, data)),
    },
    member: {
      count: async () => existing ? 1 : 0,
      deleteMany: async () => {},
      updateMany: async ({ where, data }) => projects.filter((project) => where.projectId.in.includes(project.id)).forEach((project) => { project.members = [data.userId] }),
    },
    team: { updateMany: async () => {} },
    member_Team: { updateMany: async () => {} },
    assignees: { updateMany: async () => {} },
    $transaction: async (callback) => callback(prisma),
    featureFlag: { findUnique: async ({ where }) => {
      calls.flags.push(where.key)
      if (failFlag && where.key === flagKey) throw new Error('test flag read failure')
      return where.key === flagKey && flagMode !== null ? { mode: flagMode } : null
    } },
  }
  const incomingCookies = new Map([['ht_session', 'guest-session'], ...(previousBoard ? [['previousBoard', previousBoard]] : [])])
  const cookies = new Map(incomingCookies)
  const aliases = {
    '@/lib/prisma': prisma,
    '@/lib/auth/getSessionUser': {},
    '@/lib/agentRuns/model': { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: 'test-agent-flag' },
    '@/lib/flags/keys': loadTs('src/lib/flags/keys.ts', {}),
    '@/lib/auth/session': {
      SESSION_COOKIE: 'ht_session', SESSION_TTL_SECONDS: 3600,
      verifySession: (token) => token === 'guest-session' ? { id: guestId } : token === 'new-session' ? { id: userId } : null,
      signSession: () => 'new-session', sessionCookieOptions: () => ({}), clearBetterAuthSessionCookies: () => {},
    },
    '@/lib/demo/guest': { GUEST_UID_PREFIX: 'guest_' },
    '@/lib/configs/auth.config': { cookies: { theme: 'theme' }, onboarding: { skipOnboarding: true, shouldSkipInteractive: true } },
    '@/lib/constants/constants': { companySizeOptions: ['Just me'], companyRoleOptions: ['Founder'] },
    '@/utils/controllers/users/update_or_create_user': async () => ({ status: 200, res: { user, isNewUser: !existing } }),
    '@/utils/controllers/users/autoJoinByEmailDomain': async () => {},
    '@/lib/auth/requestBaseUrl': { getRequestBaseUrl: () => 'https://app.hypertask.ai' },
    '@/lib/auth/slimUserCookie': { slimUserForCookie: (value) => value },
    '@/lib/auth/themeCookie': { seedResponseThemeCookie: () => {}, getThemeCookieOptions: () => ({}) },
    '@/lib/themePreferences': { themeCookieSeedValue: () => undefined },
    '@/lib/telemetry/signupAnalytics': { signupAttributionFromHeaders: () => ({}) },
    '@/lib/onboarding/emails/agentNudge': { maybeScheduleAgentNudge: async () => 'flag_off' },
    '@/lib/telemetry/activationOccurrences': { recordActivationOccurrence: () => {} },
    '@vercel/functions': { waitUntil: () => {} },
    '@/lib/auth/emailLinkToken': { consumeEmailLinkToken: async () => true },
    '@/lib/onboarding/emails/welcome': { maybeSendWelcomeEmail: async () => 'flag_off' },
    '@/lib/auth/emailCodeRateLimit': { getEmailCodeClientIp: () => '192.0.2.1', claimEmailCodeAttempt: async () => ({ ipAllowed: true, emailAllowed: true }) },
    '@/lib/services/verificationCodeService': { VerificationCodeService: { verifyCode: async () => user.email } },
    jsonwebtoken: { verify: () => ({ sub: user.email }) },
    '@/utils/helperFunctions/helperFunctions': { getSequentialLetters: () => 'MB' },
    '@/utils/controllers/logs/createLog': () => {},
    '@/lib/subscription': { stripe: {} },
    '../projects/create': {},
    '@/lib/configs/general.config': { generalConfig: { hyperAiId: 1 } },
    '../projects/createProjectWithStableName': {},
    '../tasks/createTaskCore': {},
    '../assignees/assign': {},
    '@/lib/stripeCustomerName': {},
    'better-auth/api': {
      createAuthMiddleware: (handler) => handler,
      createAuthEndpoint: (route, options, handler) => handler,
      getSessionFromCtx: async () => ({ user: { id: String(userId) } }),
    },
    '@/lib/api/task-writes/route': { withTaskWriteFlag: (handler) => handler },
    '@/utils/controllers/projects/getAll': async (id) => ({ status: 200, json: projects.filter((project) => project.ownerId === id) }),
    './utils/edgeHelpers': { isValidUser: (raw) => ({ isValid: !!raw, user: raw ? JSON.parse(raw) : null }) },
    './utils/serverActions': {},
    './utils/helperFunctions/helperFunctions': {},
    '@/lib/auth/safeReturnTo': { parseSafeReturnTo: () => null },
    '@/lib/auth/sessionEdge': { verifySessionEdge: async () => ({ id: userId }) },
    '@/lib/auth/cookieIdentity': {},
    '@/lib/routing/detailWithoutTicket': { detailWithoutTicketRedirect: () => null },
    '@/lib/tutorial/keyboardShortcutTutorial': { isKeyboardShortcutTutorialPath: () => false, hasKeyboardShortcutTutorialQuery: () => false },
  }
  aliases['@/lib/flags/definitions'] = loadTs('src/lib/flags/definitions.ts', aliases)
  aliases['@/lib/flags'] = loadTs('src/lib/flags.ts', aliases)
  aliases['@/lib/onboarding/installCommands'] = loadTs('src/lib/onboarding/installCommands.ts', {})
  aliases['@/utils/controllers/users/completeOnboardingStep'] = loadTs('src/utils/controllers/users/completeOnboardingStep.ts', aliases)
  aliases['@/utils/controllers/demo/adoptGuestBoards'] = loadTs('src/utils/controllers/demo/adoptGuestBoards.ts', aliases)
  aliases['@/utils/controllers/users/provisionFirstWorkspace'] = loadTs('src/utils/controllers/users/provisionFirstWorkspace.ts', aliases)
  const helper = 'src/utils/controllers/demo/resolveLoginBoard.ts'
  if (fs.existsSync(path.join(root, helper))) aliases['@/utils/controllers/demo/resolveLoginBoard'] = loadTs(helper, aliases)
  return { calls, user, guest, projects, aliases, cookies, incomingCookies }
}

async function login(method, options = {}) {
  const h = makeHarness(options)
  const original = { log: console.log, error: console.error, fetch: global.fetch, jwt: process.env.JWT_SECRET }
  console.log = () => {}
  console.error = () => {}
  process.env.JWT_SECRET = 'test-only-not-a-real-credential'
  try {
    if (method.startsWith('verify-')) {
      const getAll = loadTs('src/pages/api/projects/getAll.ts', h.aliases).default
      global.fetch = async (url, init) => {
        assert.equal(new URL(url).pathname, '/api/projects/getAll')
        const response = { status(value) { this.statusCode = value; return this }, json(value) { this.body = value } }
        const cookie = new Headers(init.headers).get('Cookie')
        if (!cookie) h.calls.unauthenticatedBoardRequests++
        await getAll({ method: 'POST', cookies: cookie ? { ht_session: cookie.split('=')[1] } : {}, body: JSON.parse(init.body) }, response)
        return new Response(JSON.stringify(response.body), { status: response.statusCode })
      }
      const { POST } = loadTs(`src/app/api/auth/${method}/route.ts`, h.aliases)
      const response = await POST(new NextRequest(`https://app.hypertask.ai/api/auth/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: [...h.incomingCookies].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('; ') },
        body: JSON.stringify({ email: h.user.email, code: '123456', token: 'test-email-token' }),
      }))
      assert.equal(response.status, 200)
      h.body = await response.json()
      response.cookies.getAll().forEach(({ name, value }) => value ? h.cookies.set(name, value) : h.cookies.delete(name))
    } else {
      const legacy = loadTs('src/lib/auth/legacyCookiePlugin.ts', h.aliases)
      const plugin = legacy.legacyCookiePlugin()
      const ctx = {
        path: method === 'google' ? '/callback/google' : '/sign-in/passkey',
        context: { newSession: { user: { id: String(userId) } } },
        getCookie: (name) => h.incomingCookies.get(name),
        setCookie: (name, value) => value ? h.cookies.set(name, value) : h.cookies.delete(name),
        json: (value) => value,
      }
      await plugin.hooks.after[0].handler(ctx)
      if (method === 'passkey') {
        // The explicit bridge sees the cookies from the completed passkey sign-in.
        h.incomingCookies = new Map(h.cookies)
        await plugin.endpoints.bridgeLegacySession(ctx)
      }
    }
    const proxy = loadTs('src/proxy.ts', h.aliases).default
    const navigation = await proxy(new NextRequest('https://app.hypertask.ai/', {
      headers: { Cookie: [...h.cookies].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('; ') },
    }))
    h.landing = new URL(navigation.headers.get('location')).pathname + new URL(navigation.headers.get('location')).search
    return h
  } finally {
    console.log = original.log
    console.error = original.error
    global.fetch = original.fetch
    if (original.jwt === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = original.jwt
  }
}

for (const method of ['verify-code', 'verify-email-token', 'google', 'passkey']) {
  test(`${method}: existing demo login lands on the user's board, without adopting the demo`, async () => {
    const h = await login(method)
    assert.equal(h.landing, '/project?id=99')
    assert.equal(h.projects[0].ownerId, guestId)
    assert.ok(h.calls.flags.includes(flagKey))
    if (method.startsWith('verify-')) {
      assert.equal(h.body.prevBoard.id, 99)
      assert.equal(h.body.redirectUrl, '/project?id=99')
      assert.equal(h.calls.unauthenticatedBoardRequests, 0)
    }
  })

  test(`${method}: an empty new account lands on its adopted demo board`, async () => {
    const h = await login(method, { existing: false })
    assert.equal(h.landing, `/project?id=${demoBoardId}`)
    assert.equal(h.projects[0].ownerId, userId)
    assert.equal(h.guest.uid, 'exguest_test')
    assert.equal(h.projects.length, 1)
  })

  test(`${method}: flag Off preserves the old inaccessible demo landing`, async () => {
    const h = await login(method, { flagMode: 'OFF' })
    assert.equal(h.landing, `/project?id=${demoBoardId}`)
    assert.equal(h.projects[0].ownerId, guestId)
    if (method.startsWith('verify-')) assert.equal(h.calls.unauthenticatedBoardRequests, 1)
  })

  test(`${method}: membership-only accounts land on their accessible board and refuse adoption`, async () => {
    const h = await login(method, { membershipOnly: true })
    assert.equal(h.landing, '/project?id=99')
    assert.equal(h.projects[0].ownerId, guestId)
  })
}

for (const method of ['verify-code', 'verify-email-token', 'google', 'passkey']) {
  test(`${method}: a valid last board is retained instead of the first owned board`, async () => {
    const h = await login(method, { previousBoard: 'project-101|&|my-view', extraOwnedBoard: true })
    assert.equal(h.landing, method.startsWith('verify-') ? '/project?id=101' : '/project?id=101&view=my-view')
  })

  test(`${method}: an archived last board is replaced by a normal own board`, async () => {
    const h = await login(method, { previousBoard: 'project-101|&|my-view', extraOwnedBoard: true, archivedLastBoard: true })
    assert.equal(h.landing, '/project?id=99')
  })
}

test('a teamless last board is excluded just like the normal login board list', async () => {
  const h = await login('verify-code', { previousBoard: 'project-101|&|', extraOwnedBoard: true, teamlessLastBoard: true })
  assert.equal(h.landing, '/project?id=99')
})

test('an invalid previous-board cookie cannot choose another account\'s board or an external URL', async () => {
  for (const previousBoard of ['project-500|&|', 'project-NaN|&|', 'project-9007199254740992|&|', 'https://example.test/']) {
    const h = await login('verify-code', { previousBoard })
    assert.equal(h.landing, '/project?id=99')
  }
})

test('a flag-store failure does not break login and preserves the disabled behavior', async () => {
  const h = await login('google', { failFlag: true })
  assert.equal(h.landing, `/project?id=${demoBoardId}`)
  assert.equal(h.cookies.get('ht_session'), 'new-session')
})

test('the default Everyone mode repairs the landing without a stored flag row', async () => {
  const h = await login('verify-code', { flagMode: null })
  assert.equal(h.landing, '/project?id=99')
  assert.equal(h.aliases['@/lib/flags'].defaultFeatureFlagMode(flagKey), 'EVERYONE')
})
