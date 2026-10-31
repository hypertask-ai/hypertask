const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { loader } = require('./htpr-6927-fixtures.cjs')

const user = { id: 42, email: 'fixture@example.com', displayName: 'Fixture', photoURL: null }
let state
const events = () => state.events
const prisma = {
  featureFlag: { findUnique: async () => null },
  task: {
    findMany: async ({ where }) => where.OR
      ? state.tasks.map(({ id, sectionId, projectId, status }) => ({ id, sectionId, projectId, status }))
      : state.tasks.filter((task) => where.id.in.includes(task.id)).map((task) => ({ ...task })),
    findUnique: async ({ where }) => state.tasks.find((task) => task.id === where.id),
    update: async ({ where, data }) => { events().push(['contract', where.id]); Object.assign(state.tasks.find((task) => task.id === where.id), data) },
  },
  user: { findUnique: async () => {
    state.reads.push('user')
    if (state.userFailure) throw new Error('user read failed')
    if (state.waitUser) await state.waitUser
    return state.missingUser ? null : user
  } },
  section: { findUnique: async () => {
    state.reads.push('section')
    if (state.sectionFailure) throw new Error('section read failed')
    return { section_title: 'Review', projectId: 15 }
  } },
  agent: { findUnique: async () => ({ id: 'agent-fixture', permissions: { role: 'write' } }), findFirst: async ({ where }) => ({ id: where.id }) },
  assignees: { findMany: async () => [{ userId: 7 }] },
  $transaction: async (run) => run(prisma),
  $executeRaw: async (sql, ...values) => {
    const statement = sql.join('?')
    if (statement.includes('pg_advisory')) events().push(['lease_lock', values[1]])
    else if (statement.includes('UPDATE "TaskLease"')) events().push(['lease_release_ref', values[1]])
    else if (statement.includes('DELETE FROM "TaskLease"')) { events().push(['lease_delete', values[0]]); state.lease = null }
    else throw new Error('unexpected lease statement')
    return 1
  },
  $queryRaw: async (sql, ...values) => {
    const statement = sql.join('?')
    if (statement.includes('INSERT INTO "TaskLease"')) {
      state.lease = { agentId: values[2], token: values[3], adoptionCount: 1 }
      events().push(['lease_adopt', values[0]])
      return [{ taskId: values[0] }]
    }
    if (statement.includes('SELECT "agentId"')) return state.lease ? [state.lease] : []
    throw new Error('unexpected lease query')
  },
}
const redis = {
  get: async (key) => state.cache.get(key) ?? null,
  set: async (key, value, ...options) => {
    if (options.includes('NX') && state.cache.has(key)) return null
    state.cache.set(key, value)
    return 'OK'
  },
  del: async (key) => { state.cache.delete(key); return 1 },
}
const load = loader({
  '@/lib/prisma': { __esModule: true, default: prisma },
  '@/lib/redis': { getRedis: async () => redis },
  '@/lib/auth/session': { SESSION_COOKIE: 'fixture_session', signSession: (claims) => {
    if (state.cookieFailure) throw new Error('cookie failed')
    return JSON.stringify(claims)
  } },
  '@/lib/mcp/auth': { checkMcpRateLimit: async () => null, validateMcpAuth: async () => state.ctx },
  '@/lib/mcp/agents': { getMcpSessionAgentSummary: async (id) => id ? { id, name: 'Fixture Agent' } : null },
  '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: (id, agentId) => ({ id, agentId }) },
  '@/utils/controllers/getMemberAndOwnerForBoard': { __esModule: true, default: async () => [7, 8] },
  '@/lib/agents/activityAttribution': { actingAgentSelect: { id: true } },
  '@/lib/mcp/tasks/mappers': { taskDetailInclude: () => ({}), taskMcpGetInclude: () => ({}), mapTaskToDetail: (task) => task, mapTaskToMcpGetResponse: (task) => task },
  '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForDescription: async (text, taskId) => events().push(['description_urls', taskId, text]) },
  '@/utils/controllers/assignees/assign': { clearHumanAssignees: async (_user, taskId) => { events().push(['clear_assignees', taskId]); return { status: 200 } } },
  '@/lib/mcp/tasks/services': {
    setTaskLabels: async (id, projectId, labels, actor) => { events().push(['labels', id, projectId, labels, actor.id]); state.tasks.find((task) => task.id === id).labels = labels },
    mutateTaskLabels: async (id, projectId, mutation) => events().push(['mutate_labels', id, projectId, mutation]),
  },
  '@/lib/pullRequests/taskPullRequests': { linkTaskPullRequest: async () => {}, PullRequestLinkError: class extends Error {} },
  '@/lib/realtime/server': {
    broadcastBoardChange: async (id, payload) => { events().push(['board', id, payload]); if (state.delivery) await state.delivery; if (state.deliveryFailure) throw new Error('delivery failed') },
    broadcastTaskChange: async (id, payload) => { events().push(['task', id, payload]); if (state.delivery) await state.delivery },
  },
})
const executor = load('src/lib/mcp/tasks/updateTask.ts').executeTaskUpdate
const operation = load('src/lib/mcp/operations/tasks/update/operation.ts').POST
const batch = load('src/lib/mcp/tasks/batchTasks.ts').handleBatchBody

function reset(extra = {}) {
  state = {
    events: [], reads: [], cache: new Map(),
    tasks: [{ id: 101, projectId: 15, sectionId: 10, status: 'Normal', title: 'Before' }],
    ctx: { user, agentId: null }, ...extra,
  }
}
function request(body, key) {
  return new NextRequest('http://localhost/api/mcp/tasks/update', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body),
  })
}
async function withFetch(run) {
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('http://localhost:3000/api/'), 'only mocked internal writes permitted')
    const path = new URL(url).pathname
    const body = JSON.parse(options.body)
    const taskId = body.taskId ?? body.newTask?.id ?? body.task_id
    events().push([path, body, options.method, options.headers])
    if (state.failTaskId === taskId || state.failPath === path) return Response.json({ message: 'Fixture write failed' }, { status: 409 })
    if (state.denyPath === path) return Response.json({ message: 'Authenticated agents cannot archive or delete tasks in Done', code: 'agent_done_lifecycle_denied' }, { status: 403 })
    const task = state.tasks.find((task) => task.id === taskId)
    if (body.newTask) Object.assign(task, body.newTask)
    return Response.json({ success: true })
  }
  try { return await run() } finally { globalThis.fetch = previous }
}
async function execute(executor, body, extra = {}) {
  reset(extra)
  const input = structuredClone(body)
  const result = await withFetch(() => executor({ request: request(input), ctx: state.ctx, requestBody: input, dryRun: input.dry_run, strictSideEffectFailures: extra.strict ?? false }))
  return { status: result.response.status, outcome: result.outcome, text: await result.response.text(), events: state.events, body: input }
}
const cases = [
  ['title', { task_id: 101, title: 'After' }],
  ['description', { task_id: 101, description: '## Heading\n\nContent', content_type: 'markdown' }],
  ['section move', { task_id: 101, sectionId: 20 }],
  ['assignees', { task_id: 101, assignee: [8] }],
  ['clear assignees', { task_id: 101, assignee: [] }],
  ['labels', { task_id: 101, labels: ['bug'] }],
  ['label mutation', { task_id: 101, add_labels: ['bug'], remove_labels: ['old'] }],
  ['priority', { task_id: 101, priority: 'high' }],
  ['due date', { task_id: 101, due_date: '2026-10-06' }],
  ['clear due date', { task_id: 101, due_date: null }],
  ['ordered fields', { task_id: 101, title: 'After', description: '<p>After</p>', sectionId: 20, status: 'Normal', due_date: '2026-10-06', priority: 2, estimate: 2, labels: ['bug'], assignee: [8] }],
  ['partial failure', { task_id: [101, 102], title: 'After' }, { tasks: [{ id: 101, sectionId: 10, projectId: 15, status: 'Normal' }, { id: 102, sectionId: 10, projectId: 15, status: 'Normal' }], failTaskId: 102 }],
  ['all failed', { task_id: 101, title: 'After' }, { failTaskId: 101 }],
  ['strict side effect failure', { task_id: 101, priority: 2 }, { strict: true, failPath: '/api/priority/setPriority' }],
  ['best effort side effect failure', { task_id: 101, priority: 2 }, { failPath: '/api/priority/setPriority' }],
  ['agent archive of Done task denied', { task_id: 101, status: 'Archive' }, { denyPath: '/api/tasks/(un)archive' }],
  ['mixed denied and failed batch', { task_id: [101, 102], status: 'Archive' }, { tasks: [{ id: 101, sectionId: 10, projectId: 15, status: 'Normal' }, { id: 102, sectionId: 10, projectId: 15, status: 'Normal' }], denyPath: '/api/tasks/(un)archive', failTaskId: 102 }],
  ['not found', { task_id: 101, title: 'After' }, { tasks: [] }],
  ['archived move', { task_id: 101, sectionId: 20 }, { tasks: [{ id: 101, projectId: 15, status: 'Archive' }] }],
  ['deleted assignment', { task_id: 101, assignee: [8] }, { tasks: [{ id: 101, projectId: 15, status: 'Deleted' }] }],
  ['missing user', { task_id: 101, sectionId: 20 }, { missingUser: true, sectionFailure: true }],
  ['invalid title', { task_id: 101, title: '' }],
  ['validation precedence', { task_id: 101, description: '', content_type: 'invalid', due_date: 'invalid' }],
]
for (const [name, body, extra] of cases) {
  test(`${name} preserves update responses and side effects`, async () => {
    const after = await execute(executor, body, extra)
    const expectedStatus = {
      'all failed': 500, 'strict side effect failure': 500,
      'agent archive of Done task denied': 403, 'mixed denied and failed batch': 500,
      'not found': 404, 'archived move': 409, 'deleted assignment': 404,
      'missing user': 404, 'invalid title': 400, 'validation precedence': 400,
    }[name] ?? 200
    assert.equal(after.status, expectedStatus, after.text)
    assert.equal(JSON.parse(after.text).success, expectedStatus === 200)
    if (expectedStatus === 200) {
      assert.ok(after.events.some(([kind]) => kind === 'task'))
    } else {
      assert.equal(after.events.some(([kind]) => kind === 'task' || kind === 'board'), false)
      assert.equal(typeof JSON.parse(after.text).error, 'string')
    }
    if (['not found', 'archived move', 'deleted assignment', 'missing user', 'invalid title', 'validation precedence'].includes(name)) {
      assert.deepEqual(after.events, [])
    }
    if (name === 'validation precedence') assert.equal(JSON.parse(after.text).field, 'content_type')
    if (name === 'agent archive of Done task denied') {
      assert.equal(after.status, 403, after.text)
      assert.equal(JSON.parse(after.text).code, 'agent_done_lifecycle_denied')
    }
    if (name === 'mixed denied and failed batch') assert.equal(after.status, 500, after.text)
    if (name === 'partial failure') {
      assert.equal(JSON.parse(after.text).failed_tasks[0].taskId, 102)
      assert.ok(after.events.some(([kind]) => kind === 'board'))
    }
    if (name === 'ordered fields') assert.deepEqual(after.events.map(([kind]) => kind).filter((kind) => kind.startsWith('/api/')), [
      '/api/tasks/moveTask', '/api/tasks/(un)archive', '/api/tasks/single', '/api/tasks/setDueDate', '/api/priority/setPriority', '/api/estimate/setEstimate', '/api/mcp/assignees/assign', '/api/mcp/assignees/assign',
    ])
  })
}

test('direct, single and batch updates normalize descriptions without consulting flags', async () => {
  const body = { task_id: 101, description: '## Heading', content_type: 'markdown' }
  for (const caller of ['direct', 'single', 'batch']) {
    reset()
    const input = structuredClone(body)
    const result = await withFetch(() => caller === 'direct' ? executor({ request: request(input), ctx: state.ctx, requestBody: input }) : caller === 'single' ? operation(request(input)) : batch(request(input), state.ctx, { op: 'update', updates: [input] }, { assignAssignees: async () => {} }))
    const response = caller === 'direct' ? result.response : result
    assert.equal(response.status, 200, await response.text())
    assert.ok(state.events.some(([kind, , text]) => kind === 'description_urls' && text.includes('<h2>Heading</h2>')))
  }
})

test('idempotent replay suppresses duplicate side effects', async () => {
  reset()
  const body = { task_id: 101, description: '## Heading', content_type: 'markdown' }
  const first = await withFetch(() => operation(request(body, 'replay-key')))
  assert.equal(first.status, 200)
  const effects = [...state.events]
  const replay = await withFetch(() => operation(request(body, 'replay-key')))
  assert.equal(JSON.parse(await replay.text()).idempotent_replayed, true)
  assert.deepEqual(state.events, effects)
})

test('agent lease conflicts refuse writes and successful updates release leases', async () => {
  for (const conflict of [false, true]) {
    reset({ ctx: { user, agentId: 'agent-fixture' }, lease: conflict ? { agentId: 'other-agent', token: 'other-lease', adoptionCount: 0 } : null })
    const response = await withFetch(() => operation(request({ task_id: 101, title: 'After' })))
    const text = await response.text()
    if (conflict) {
      assert.equal(response.status, 409)
      assert.equal(JSON.parse(text).code, 'agent_mutation_lease_conflict')
      assert.deepEqual(state.events, [['lease_lock', 101]])
    } else {
      assert.equal(response.status, 200)
      assert.equal(state.lease, null)
      assert.deepEqual(state.events.slice(-2), [['lease_release_ref', 101], ['lease_delete', 101]])
      assert.ok(state.events.findIndex(([kind]) => kind === 'task') < state.events.findIndex(([kind]) => kind === 'lease_delete'))
    }
  }
})

test('updates await realtime delivery and tolerate broadcast failures before returning receipts', async () => {
  let release
  reset({ delivery: new Promise((resolve) => { release = resolve }), deliveryFailure: true })
  let settled = false
  const pending = withFetch(() => executor({ request: request({}), ctx: state.ctx, requestBody: { task_id: 101, title: 'After' } })).then((result) => { settled = true; return result })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  assert.ok(state.events.some(([kind]) => kind === 'task'))
  release()
  assert.equal((await pending).response.status, 200)
})


test('updates overlap independent user/section reads after access and preserves rejection precedence', async () => {
  let release
  reset({ waitUser: new Promise((resolve) => { release = resolve }) })
  const pending = withFetch(() => executor({ request: request({}), ctx: state.ctx, requestBody: { task_id: 101, sectionId: 20 } }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(state.reads, ['user', 'section'])
  assert.equal(state.events.length, 0)
  release()
  await pending
  for (const [extra, message] of [
    [{ userFailure: true, sectionFailure: true }, 'user read failed'],
    [{ cookieFailure: true, sectionFailure: true }, 'cookie failed'],
    [{ sectionFailure: true }, 'section read failed'],
  ]) {
    await assert.rejects(execute(executor, { task_id: 101, sectionId: 20 }, extra), { message })
  }
})

test('dry-run receipts retain normalization, validation and missing-target outcomes without writes', async () => {
  for (const extra of [{}, { tasks: [] }, { missingUser: true }]) {
    const body = { task_id: 101, title: 'After', sectionId: 20, dry_run: true }
    const after = await execute(executor, body, extra)
    assert.equal(after.status, extra.missingUser ? 404 : 200)
    const result = JSON.parse(after.text)
    assert.equal(result.valid, !extra.missingUser)
    if (!extra.missingUser) assert.equal(result.dry_run, true)
    assert.deepEqual(after.events, [])
  }
})
