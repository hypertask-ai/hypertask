const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.resolve(__dirname, '..')
const flagKey = 'htpr-7030-google-signup-starter-board'
const userId = 100
const guestId = 900
const connectTaskTitle = 'Connect Hypertask to Claude or ChatGPT'

function loadTs(relativePath, aliases) {
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', javascript)(
    (specifier) => aliases[specifier] ?? require(specifier), loaded, loaded.exports,
  )
  return loaded.exports
}

function makeHarness({ guestBoard = false, ownedBoard = false, memberships = 0, teamMemberships = 0, flagMode = 'EVERYONE', failProvision = false, failFlag = false } = {}) {
  const calls = { provision: [], flags: [], errors: [], events: [] }
  const user = { id: userId, uid: 'ba_test', email: 'new@example.test', displayName: 'New', accountId: 'account-new' }
  const guest = { id: guestId, uid: 'guest_test' }
  const teams = guestBoard ? [{ id: 'team-demo', title: 'Demo team' }] : []
  const projects = guestBoard ? [{ id: 42, title: 'Demo board', ownerId: guestId, status: 'Normal', teamId: 'team-demo' }] : []
  const tasks = guestBoard ? [{ id: 501, projectId: 42, title: connectTaskTitle }] : []
  if (ownedBoard) projects.push({ id: 99, title: 'Existing board', ownerId: userId, status: 'Normal', teamId: 'team-existing' })
  const matches = (project, where) => (where.ownerId === undefined || project.ownerId === where.ownerId) && (!where.status || project.status === where.status)
  const prisma = {
    user: {
      findUnique: async ({ where }) => where.id === guestId ? guest : user,
      update: async ({ where, data }) => { if (where.id === guestId) Object.assign(guest, data); return user },
    },
    googleAccount: { findFirst: async () => ({ id: user.accountId, stripe_customer_id: 'customer-test' }) },
    team: {
      create: async ({ data }) => { const team = { id: `team-${teams.length}`, ...data }; teams.push(team); return team },
      updateMany: async () => {},
    },
    team_Activity: { create: async () => {} },
    user_Activity: { update: async () => {} },
    project: {
      count: async ({ where }) => projects.filter((project) => matches(project, where)).length,
      findMany: async ({ where }) => projects.filter((project) => matches(project, where)),
      findFirst: async ({ where }) => {
        const project = projects.find((project) => matches(project, where) && (!where.members || project.ownerId === userId))
        return project ? { ...project, team: teams.find((team) => team.id === project.teamId), _count: { tasks: tasks.filter((task) => task.projectId === project.id).length } } : null
      },
      updateMany: async ({ where, data }) => {
        calls.events.push('adopt')
        projects.filter((project) => where.id.in.includes(project.id)).forEach((project) => Object.assign(project, data))
      },
    },
    member: { count: async () => memberships, deleteMany: async () => {}, updateMany: async () => {} },
    member_Team: { count: async () => teamMemberships, updateMany: async () => {} },
    assignees: { updateMany: async () => {} },
    section: { create: async ({ data }) => ({ id: 201, ...data }) },
    $transaction: async (callback) => callback(prisma),
    featureFlag: {
      findUnique: async ({ where }) => {
        calls.flags.push(where.key)
        if (failFlag) throw new Error('test flag failure')
        return flagMode === null ? null : { mode: flagMode }
      },
      findMany: async () => [],
    },
  }
  const pluginStub = () => ({})
  const aliases = {
    '@/lib/prisma': prisma,
    '@/lib/auth/getSessionUser': {},
    '@/lib/agentRuns/model': { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: 'test-agent-flag' },
    '@/lib/flags/keys': loadTs('src/lib/flags/keys.ts', {}),
    '@/lib/auth/session': {
      SESSION_COOKIE: 'ht_session', SESSION_TTL_SECONDS: 3600,
      verifySession: (token) => token === 'guest-session' ? { id: guestId } : null,
      signSession: () => 'new-session', sessionCookieOptions: () => ({}),
    },
    '@/lib/auth/slimUserCookie': { slimUserForCookie: (value) => value },
    '@/lib/auth/themeCookie': { getThemeCookieOptions: () => ({}) },
    '@/lib/themePreferences': { themeCookieSeedValue: () => undefined },
    '@/lib/demo/guest': { GUEST_UID_PREFIX: 'guest_' },
    '@/lib/configs/auth.config': { cookies: { theme: 'theme' }, onboarding: { skipOnboarding: true, shouldSkipInteractive: true } },
    '@/lib/constants/constants': { companySizeOptions: ['Just me'], companyRoleOptions: ['Founder or leadership team'] },
    '@/utils/helperFunctions/helperFunctions': { getSequentialLetters: () => 'MB' },
    '@/utils/controllers/logs/createLog': () => {},
    '@/lib/subscription': { stripe: { customers: { retrieve: async () => ({ id: 'customer-test' }) } } },
    '../projects/create': { createProjectViewAndCreateDefault: async () => {} },
    '@/lib/configs/general.config': { generalConfig: { hyperAiId: 1 } },
    '../projects/createProjectWithStableName': { createProjectWithStableName: async (data) => {
      const project = { id: 200, status: 'Normal', ...data }; projects.push(project); return project
    } },
    '../tasks/createTaskCore': { createTaskCore: async (data) => {
      const task = { id: 600 + tasks.length, ...data }; tasks.push(task); return { task }
    } },
    '../assignees/assign': async () => {},
    '@/lib/stripeCustomerName': { stripeCustomerName: () => 'New' },
    'better-auth': { betterAuth: (options) => options },
    'better-auth/adapters/prisma': { prismaAdapter: pluginStub },
    'better-auth/plugins': { emailOTP: pluginStub, magicLink: pluginStub, multiSession: pluginStub },
    '@better-auth/api-key': { apiKey: () => ({ schema: { apikey: { fields: { referenceId: {} } } } }) },
    '@better-auth/infra': { dash: pluginStub },
    '@better-auth/passkey': { passkey: pluginStub },
    'better-auth/api': { createAuthMiddleware: (handler) => handler, createAuthEndpoint: (route, options, handler) => handler },
    '@/lib/auth/bridgePlugin': { bridgeSessionPlugin: pluginStub },
    '@/lib/email/sendEmail': {},
    '@/lib/mcp/managementPermissions': { MANAGEMENT_KEY_PERMISSIONS: {} },
    '@/lib/telemetry/signupAnalytics': { recordUserSignedUp: () => {}, signupAttributionFromHeaders: () => ({}) },
    '@/utils/controllers/users/provisionNewUser': { provisionNewUser: async () => { calls.events.push('user-provisioned'); return user } },
  }
  const onboarding = loadTs('src/utils/controllers/users/completeOnboardingStep.ts', aliases)
  aliases['@/utils/controllers/users/completeOnboardingStep'] = { CompleteOnboardingFirstStep: async (...args) => {
    calls.provision.push(args)
    calls.events.push('workspace-provisioned')
    if (failProvision) throw new Error('test provisioning failure')
    return onboarding.CompleteOnboardingFirstStep(...args)
  } }
  aliases['@/utils/controllers/demo/adoptGuestBoards'] = loadTs('src/utils/controllers/demo/adoptGuestBoards.ts', aliases)
  aliases['@/lib/flags'] = loadTs('src/lib/flags.ts', aliases)
  aliases['@/utils/controllers/users/provisionFirstWorkspace'] = loadTs('src/utils/controllers/users/provisionFirstWorkspace.ts', aliases)
  const legacy = loadTs('src/lib/auth/legacyCookiePlugin.ts', aliases)
  aliases['@/lib/auth/legacyCookiePlugin'] = legacy
  const auth = loadTs('src/lib/auth/betterAuth.ts', aliases).auth
  const afterSession = legacy.legacyCookiePlugin().hooks.after[0].handler
  const request = new Request('https://app.hypertask.ai/api/auth/callback/google')
  const cookies = new Map(guestBoard ? [['ht_session', 'guest-session']] : [])
  const ctx = {
    path: '/callback/google', request, context: { newSession: { user: { id: String(userId) } } },
    getCookie: (key) => cookies.get(key),
    setCookie: (key, value) => { calls.events.push(`cookie:${key}`); cookies.set(key, value) },
  }
  const run = async (callback) => {
    const original = { log: console.log, error: console.error }
    console.log = () => {}
    console.error = (...args) => { calls.errors.push(args) }
    try { return await callback() } finally { console.log = original.log; console.error = original.error }
  }
  return { calls, user, guest, teams, projects, tasks, aliases, legacy, auth, ctx, cookies, run, afterSession }
}

async function signup(options = {}) {
  const h = makeHarness(options)
  await h.run(async () => {
    await h.auth.databaseHooks.user.create.after({ id: String(userId), email: h.user.email, name: 'New' }, h.ctx)
    assert.equal(h.projects.filter((project) => project.ownerId === userId).length, options.ownedBoard ? 1 : 0, 'no workspace is created before the adoption hook')
    await h.afterSession(h.ctx)
  })
  return h
}

test('new Google user without a guest receives MyTeam, MyBoard, and one connect task before cookies are bridged', async () => {
  const h = await signup()
  assert.equal(h.calls.provision.length, 1)
  assert.equal(h.teams[0].title, 'MyTeam')
  assert.equal(h.projects[0].title, 'MyBoard')
  assert.equal(h.tasks.filter((task) => task.title === connectTaskTitle).length, 1)
  assert.deepEqual(h.calls.provision[0].slice(2, 5), ['MyBoard', 'Just me', 'Founder or leadership team'])
  assert.equal(h.cookies.get('previousBoard'), 'project-200|&|')
  assert.ok(h.calls.events.indexOf('workspace-provisioned') < h.calls.events.indexOf('cookie:ht_session'))
  await h.run(() => h.afterSession(h.ctx))
  assert.equal(h.calls.provision.length, 1)
  assert.equal(h.projects.length, 1)
})

test('new Google user from demo adopts the demo board and never creates MyBoard or a duplicate connect task', async () => {
  const h = await signup({ guestBoard: true })
  assert.equal(h.projects[0].ownerId, userId)
  assert.equal(h.guest.uid, 'exguest_test')
  assert.equal(h.projects.length, 1)
  assert.equal(h.teams.length, 1)
  assert.equal(h.tasks.filter((task) => task.title === connectTaskTitle).length, 1)
  assert.equal(h.calls.provision.length, 0)
  assert.equal(h.cookies.get('previousBoard'), 'project-42|&|')
  assert.ok(h.calls.events.indexOf('adopt') < h.calls.events.indexOf('cookie:ht_session'))
})

test('Better Auth SDK carries the same request from database creation hooks into session middleware', async () => {
  const h = makeHarness()
  const api = await import('better-auth/api')
  const { pathToFileURL } = require('node:url')
  const { getWithHooks } = await import(new URL('./db/with-hooks.mjs', pathToFileURL(require.resolve('better-auth'))))
  const legacy = loadTs('src/lib/auth/legacyCookiePlugin.ts', { ...h.aliases, 'better-auth/api': api })
  const auth = loadTs('src/lib/auth/betterAuth.ts', { ...h.aliases, '@/lib/auth/legacyCookiePlugin': legacy }).auth
  const adapter = { create: async ({ data }) => ({ ...data, id: String(userId) }) }
  const hooks = getWithHooks(adapter, { options: auth, hooks: [{ source: 'user', hooks: auth.databaseHooks }] })
  const endpoint = api.createAuthEndpoint('/callback/google', { method: 'GET' }, async (ctx) => {
    const user = await hooks.createWithHooks({ email: h.user.email, name: 'New' }, 'user')
    ctx.context.newSession = { user }
    return ctx.json({ ok: true })
  })
  const response = await h.run(() => api.dispatchAuthEndpoint(endpoint, {
    request: h.ctx.request,
    context: { options: { ...auth, plugins: [legacy.legacyCookiePlugin()] }, logger: { level: 'error', error: () => {} } },
  }))
  assert.equal(response.status, 200)
  assert.equal(h.calls.provision.length, 1)
  assert.ok(response.headers.getSetCookie().some((cookie) => decodeURIComponent(cookie).startsWith('previousBoard=project-200|&|')))
})

test('existing boardless Google login never creates a starter workspace or reads the signup flag', async () => {
  const h = makeHarness()
  await h.run(() => h.afterSession(h.ctx))
  assert.equal(h.calls.provision.length, 0)
  assert.equal(h.projects.length, 0)
  assert.deepEqual(h.calls.flags, [])
  assert.equal(h.cookies.get('ht_session'), 'new-session')
})

test('signup marker is tied to the exact request and user, not a timestamp or another login', async () => {
  const h = makeHarness()
  await h.run(async () => {
    await h.auth.databaseHooks.user.create.after({ id: String(userId), email: h.user.email }, h.ctx)
    await h.afterSession({ ...h.ctx, request: new Request(h.ctx.request.url) })
    await h.afterSession({ ...h.ctx, context: { newSession: { user: { id: '101' } } } })
  })
  assert.equal(h.calls.provision.length, 0)
  await h.run(() => h.afterSession(h.ctx))
  assert.equal(h.calls.provision.length, 1)
})

test('duplicate session-hook calls consume the signup marker before awaiting and create only one workspace', async () => {
  const h = makeHarness()
  await h.run(async () => {
    await h.auth.databaseHooks.user.create.after({ id: String(userId), email: h.user.email }, h.ctx)
    await Promise.all([h.afterSession(h.ctx), h.afterSession(h.ctx)])
  })
  assert.equal(h.calls.provision.length, 1)
  assert.equal(h.projects.length, 1)
  assert.equal(h.tasks.filter((task) => task.title === connectTaskTitle).length, 1)
})

test('new non-Google user never receives the Google signup starter workspace', async () => {
  const h = makeHarness()
  h.ctx.path = '/magic-link/verify'
  await h.run(async () => {
    await h.auth.databaseHooks.user.create.after({ id: String(userId), email: h.user.email }, h.ctx)
    await h.afterSession(h.ctx)
  })
  assert.equal(h.calls.provision.length, 0)
  assert.deepEqual(h.calls.flags, [])
})

test('flag Off preserves boardless signup while keeping the original demo adoption', async () => {
  for (const guestBoard of [false, true]) {
    const h = await signup({ flagMode: 'OFF', guestBoard })
    assert.equal(h.calls.provision.length, 0)
    assert.equal(h.projects.length, guestBoard ? 1 : 0)
    if (guestBoard) assert.equal(h.projects[0].ownerId, userId)
  }
})

test('bugfix flag defaults to Everyone without a stored row and is registered as a bugfix', async () => {
  const h = await signup({ flagMode: null })
  assert.equal(h.calls.provision.length, 1)
  assert.ok(h.calls.flags.includes(flagKey))
  const flags = h.aliases['@/lib/flags']
  assert.equal(flags.defaultFeatureFlagMode(flagKey), 'EVERYONE')
  const entry = (await flags.listFeatureFlagModes()).find((entry) => entry.key === flagKey)
  assert.equal(entry.kind, 'bugfix')
})

for (const options of [{ ownedBoard: true }, { memberships: 1 }, { teamMemberships: 1 }]) {
  test(`new signup rechecks emptiness before creating: ${JSON.stringify(options)}`, async () => {
    const h = await signup(options)
    assert.equal(h.calls.provision.length, 0)
    assert.equal(h.projects.length, options.ownedBoard ? 1 : 0)
  })
}

test('repeating the shared workspace provisioner cannot create a second MyBoard', async () => {
  const h = await signup()
  await h.run(() => h.aliases['@/utils/controllers/users/provisionFirstWorkspace'].provisionFirstWorkspace(
    h.user, undefined, 'MyTeam', 'MyBoard', 'Just me', 'Founder or leadership team', { keepDemoBoard: true, onlyIfEmpty: true },
  ))
  assert.equal(h.calls.provision.length, 1)
  assert.equal(h.projects.length, 1)
})

for (const failure of ['failProvision', 'failFlag']) {
  test(`${failure} is logged without breaking Google login or legacy cookies`, async () => {
    const h = await signup({ [failure]: true })
    assert.ok(h.calls.errors.length > 0)
    assert.equal(h.cookies.get('ht_session'), 'new-session')
    assert.ok(h.cookies.get('nookies_user'))
  })
}

function renderLogin(relativePath, authError, showEmailForm = false) {
  const setters = []
  let stateIndex = 0
  const aliases = {
    react: { ...React, useState: (initial) => { const index = stateIndex++; return [index === 0 ? showEmailForm : initial, (value) => setters.push({ index, value })] }, useEffect: () => {}, useLayoutEffect: (effect) => effect(), useMemo: (factory) => factory() },
    'next/navigation': { useSearchParams: () => new URLSearchParams({ authError }), useRouter: () => ({}) },
    'next/image': { __esModule: true, default: () => null },
    '@/utils/undoActions/helperFuncs': { cn: (...args) => args.join(' ') },
    '@/lib/configs/auth.config': {},
    '@/lib/auth/betterAuthClient': {},
    '@/lib/auth/safeReturnTo': {},
    '@/components/analytics/StoreUTM': { __esModule: true, default: () => null },
  }
  for (const specifier of ['./EmailAuth', '../EmailAuth', './LoginButton', '../LoginButton']) aliases[specifier] = { __esModule: true, default: () => null }
  const original = { window: global.window, log: console.log }
  global.window = { location: { search: `?authError=${encodeURIComponent(authError)}`, href: 'https://example.test/login' } }
  console.log = () => {}
  try {
    const loaded = loadTs(relativePath, aliases)
    const element = (loaded.LoginMiddle ?? loaded.default)({ serifClassName: '' })
    return { html: renderToStaticMarkup(element), setters }
  } finally {
    if (original.window === undefined) delete global.window
    else global.window = original.window
    console.log = original.log
  }
}

for (const renderer of ['src/app/login/LoginMiddle.tsx', 'src/app/login/Login-2-AB-test/index.tsx']) {
  test(`login Google authError uses an existing red plain-text alert in ${renderer}, including email view`, () => {
    for (const showEmailForm of [false, true]) {
      const { html } = renderLogin(renderer, 'google_signup_disabled', showEmailForm)
      assert.match(html, /<p[^>]*class="[^"]*text-content text-destructive"[^>]*role="alert"[^>]*>Google sign-in didn&#x27;t work\. Please try again, or sign in with your email\.<\/p>/)
    }
    assert.doesNotMatch(renderLogin(renderer, '<script>bad</script>').html, /role="alert"|<script>bad/)
    assert.doesNotMatch(renderLogin(renderer, 'account_not_found').html, /Google sign-in/)
  })
}

test('login account_not_found still opens the existing email recovery form', () => {
  const { setters } = renderLogin('src/app/login/LoginMiddle.tsx', 'account_not_found')
  assert.ok(setters.some(({ index, value }) => index === 0 && value === true))
})
