const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')
const { loader } = require('./htpr-6927-fixtures.cjs')

const { AuthorizationError, mapHttpErrorToMcpError } = loader({})('src/lib/mcp-server/utils/errors.ts')

function feedbackSetup({ quiet = true } = {}) {
  const filed = []
  const pending = []
  const loadFeedback = loader({
    '@vercel/functions': { waitUntil: (work) => pending.push(work) },
    '@/lib/flags': { isFeatureEnabled: async (key) => quiet && key === 'htpr-7941-quiet-fixable-reports' },
    './report': { fileAiFeedback: async (input) => { filed.push(input) } },
  })
  return { filed, pending, observeFeedbackTools: loadFeedback('src/lib/aiFeedback/automatic.ts').observeFeedbackTools }
}

async function filedFor(tool, error, options) {
  const setup = feedbackSetup(options)
  const [wrapped] = setup.observeFeedbackTools([{ name: tool, execute: async () => { throw error } }], 42)
  await assert.rejects(wrapped.execute({}, 'token'), (thrown) => thrown === error)
  await Promise.all(setup.pending)
  return { filed: setup.filed, pending: setup.pending }
}

function taskRoutes({ human = false } = {}) {
  const ctx = { user: { id: 6 }, agentId: human ? null : 'agent', teamScope: null }
  const calls = { writes: 0 }
  const auth = { validateMcpAuth: async () => ctx, checkMcpRateLimit: async () => null }
  const stubs = {
    'next/server': { NextResponse: Response },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (fn) => fn, validateMcpRouteAuth: auth.validateMcpAuth, checkMcpRouteRateLimit: auth.checkMcpRateLimit, readMcpRouteJsonBody: async (request) => ({ ok: true, body: await request.json() }) },
    '@/lib/mcp/auth': auth,
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null },
    '@/lib/mcp/tasks/services': {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: 'QA', teamId: null } }),
      getSectionForTask: async () => ({ section: { id: 1, section_title: 'Todo' } }),
      validateParentTask: async () => ({}),
      createTask: async (data) => { calls.writes += 1; return { id: 42, ...data } },
    },
    '@/utils/controllers/agents/boardMembers': { isAgentOnBoard: async () => true },
    '@/lib/mcp/tasks/mappers': { mapTaskToDetail: (task) => task },
    '@/lib/mcp/idempotency/idempotencyStore': { normalizeIdempotencyKey: () => null, withIdempotency: async (_op, _user, _key, _body, write) => write(), IdempotencyAccessError: class extends Error {}, IdempotencyInProgressError: class extends Error {} },
    '@/lib/prisma': { default: { task: { findMany: async () => [{ title: 'Original', description: '', description_: { content: '' } }] }, user: { findUnique: async () => ({ id: 6, email: 'qa@example.com' }) } } },
    '@/lib/flags': { isFeatureEnabled: async (key) => key === 'yper4-910-agent-writing' },
    '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (_request, error) => { throw error } },
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': { withAdoptedAgentMutationLease: async (_db, _actor, execute) => execute() },
    '@/lib/pullRequests/taskPullRequests': {},
    './fields/findTasks': { findTasksByIdentifier: async () => [{ id: 42, status: 'Normal' }] },
    './fields/persist': { persistTaskUpdates: async () => { calls.writes += 1; return { success: true, tasks: [{ id: 42 }] } } },
    '@/lib/auth/session': { SESSION_COOKIE: 'session', signSession: () => 'test-session' },
    '@/lib/auth/slimUserCookie': { slimUserForCookie: (user) => user },
  }
  const create = load('src/lib/mcp/operations/tasks/create/operation.ts', stubs).POST
  const update = load('src/lib/mcp/operations/tasks/update/operation.ts', stubs).POST
  const request = (body) => new Request('https://app.hypertask.ai/api/mcp/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return {
    calls,
    create: (body) => create(request({ project_id: 15, title: 'Short title', ...body })),
    update: (body) => update(request({ task_id: 42, ...body })),
  }
}

async function writingRefusal(action, title) {
  const routes = taskRoutes()
  const response = await routes[action]({ title })
  const body = await response.json()
  assert.equal(response.status, 400, JSON.stringify(body))
  assert.equal(body.field, 'title')
  assert.equal(body.code, 'invalid_field')
  assert.equal(body.details.code, 'agent_writing')
  assert.equal(body.details.field, 'title')
  assert.equal(routes.calls.writes, 0)
  const mapped = mapHttpErrorToMcpError(response.status, body.error, undefined, body)
  assert.equal(mapped.details.code, 'agent_writing')
  assert.equal(mapped.details.field, 'title')
  const quiet = await filedFor(action === 'create' ? 'hypertask_create_task' : 'hypertask_tasks', mapped)
  assert.deepEqual(quiet.filed, [])
  assert.equal(quiet.pending.length, 0)
  const recorded = await filedFor(action === 'create' ? 'hypertask_create_task' : 'hypertask_tasks', mapped, { quiet: false })
  assert.equal(recorded.filed.length, 1)
  assert.equal(recorded.filed[0].tool, action === 'create' ? 'hypertask_create_task' : 'hypertask_tasks')
  assert.equal(recorded.filed[0].status, 400)
  assert.equal(recorded.filed[0].errorCode, 'agent_writing')
  assert.equal(recorded.filed[0].field, 'title')
  const person = taskRoutes({ human: true })
  assert.equal((await person[action]({ title, dry_run: true })).status, 200)
  assert.equal(person.calls.writes, 0)
}

test('hypertask_create_task names a technical title as a writing refusal and does not file it as a product bug', async () => {
  await writingRefusal('create', 'Call hypertask_create_task now')
})

test('hypertask_tasks names a technical title as a writing refusal and does not file it as a product bug', async () => {
  await writingRefusal('update', 'Rename hypertask_tasks today')
})

function tokenRoutes({ management = null, session = null } = {}) {
  const minted = []
  const route = load('src/lib/mcp/operations/admin/tokens/operation.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (fn) => fn },
    '@/lib/mcp/auth': {
      checkMcpRateLimit: async () => null,
      createUnauthorizedResponse: () => Response.json({ success: false, reason: 'invalid_token' }, { status: 401 }),
      validateManagementOrSessionAuth: async () => management,
      validateMcpAuth: async () => session,
    },
    '@/lib/mcp/accountTokens': {
      InvalidAccountMcpTokenError: class extends Error {},
      mintAccountMcpToken: (user, days) => {
        minted.push({ userId: user.id, days })
        return { success: true, token: 'minted-once' }
      },
      revokeAccountMcpToken: async () => ({ success: true, revoked: true }),
    },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
  })
  return { ...route, minted }
}

function tokenRequest(method, authorization = 'Bearer oauth-session') {
  return new Request('https://app.hypertask.ai/api/mcp/admin/tokens', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(method === 'DELETE' ? { revoke_all: true } : { expires_in_days: 30 }),
  })
}

test('hypertask_tokens refuses an authenticated non-admin login without filing an authentication bug', async () => {
  const session = { user: { id: 6, email: 'owner@example.test' }, agentId: null, teamScope: null }
  for (const method of ['POST', 'DELETE']) {
    const route = tokenRoutes({ session })
    const response = await route[method](tokenRequest(method))
    const body = await response.json()
    assert.equal(response.status, 403, JSON.stringify(body))
    assert.equal(body.code, 'forbidden')
    assert.equal(body.field, 'authorization')
    assert.equal(route.minted.length, 0)
    const mapped = mapHttpErrorToMcpError(response.status, body.error, undefined, body)
    assert.ok(mapped instanceof AuthorizationError)
    const report = await filedFor('hypertask_tokens', mapped, { quiet: false })
    assert.deepEqual(report.filed, [])
    assert.equal(report.pending.length, 0)
  }
})

test('hypertask_tokens still rejects a missing login and still mints for an allowed account token', async () => {
  const missing = tokenRoutes()
  const rejected = await missing.POST(tokenRequest('POST', null))
  assert.equal(rejected.status, 401)
  assert.equal((await rejected.json()).reason, 'invalid_token')
  assert.equal(missing.minted.length, 0)

  const invalid = tokenRoutes()
  const unknown = await invalid.POST(tokenRequest('POST'))
  assert.equal(unknown.status, 401)
  assert.equal(invalid.minted.length, 0)

  const allowed = tokenRoutes({
    management: { user: { id: 6, email: 'owner@example.test' }, agentId: null, teamScope: null },
  })
  const minted = await allowed.POST(tokenRequest('POST', 'Bearer account-token'))
  const body = await minted.json()
  assert.equal(minted.status, 201, JSON.stringify(body))
  assert.equal(body.token, 'minted-once')
  assert.deepEqual(allowed.minted, [{ userId: 6, days: 30 }])
})
