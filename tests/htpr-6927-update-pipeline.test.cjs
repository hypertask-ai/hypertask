const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { loader } = require('./htpr-6927-fixtures.cjs')

const user = { id: 42, email: 'fixture@example.com', displayName: 'Fixture', photoURL: null }
let state
let flag = false
let flagFailure = false
let observedBody
const events = () => state.events
const prisma = {
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
  '@/lib/flags': { isFeatureEnabled: async (key, id) => {
    if (key !== 'htpr-6927-mcp-v2') return false
    assert.equal(id, state.ctx.user.id)
    if (observedBody) assert.equal(observedBody.description, state.originalDescription)
    if (flagFailure) throw new Error('flag unavailable')
    return flag
  } },
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
const v1 = load('src/lib/mcp/tasks/updateTask.ts').executeTaskUpdate
const v2 = load('src/lib/mcp/tasks/updateTaskV2.ts').executeTaskUpdateV2
const selector = load('src/lib/mcp/tasks/updateTaskSelector.ts').executeTaskUpdate
const operation = load('src/lib/mcp/operations/tasks/update/operation.ts').POST
const batch = load('src/lib/mcp/tasks/batchTasks.ts').handleBatchBody

function reset(extra = {}) {
  state = {
    events: [], reads: [], cache: new Map(),
    tasks: [{ id: 101, projectId: 15, sectionId: 10, status: 'Normal', title: 'Before' }],
    ctx: { user, agentId: null }, ...extra,
  }
  observedBody = undefined
  flagFailure = false
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
  ['not found', { task_id: 101, title: 'After' }, { tasks: [] }],
  ['archived move', { task_id: 101, sectionId: 20 }, { tasks: [{ id: 101, projectId: 15, status: 'Archive' }] }],
  ['deleted assignment', { task_id: 101, assignee: [8] }, { tasks: [{ id: 101, projectId: 15, status: 'Deleted' }] }],
  ['missing user', { task_id: 101, sectionId: 20 }, { missingUser: true, sectionFailure: true }],
  ['invalid title', { task_id: 101, title: '' }],
  ['validation precedence', { task_id: 101, description: '', content_type: 'invalid', due_date: 'invalid' }],
]
for (const [name, body, extra] of cases) {
  test(`V2 parity: ${name} retains response bytes, normalized body, ordered field writes and side effects`, async () => {
    const before = await execute(v1, body, extra)
    const after = await execute(v2, body, extra)
    assert.deepEqual(after, before)
    if (!extra && !['invalid title', 'validation precedence'].includes(name)) {
      assert.equal(after.status, 200, after.text)
      assert.equal(JSON.parse(after.text).success, true)
      assert.ok(after.events.some(([kind]) => kind === 'task'))
    }
    if (name === 'partial failure') {
      assert.equal(JSON.parse(after.text).failed_tasks[0].taskId, 102)
      assert.ok(after.events.some(([kind]) => kind === 'board'))
    }
    if (name === 'ordered fields') assert.deepEqual(after.events.map(([kind]) => kind).filter((kind) => kind.startsWith('/api/')), [
      '/api/tasks/moveTask', '/api/tasks/(un)archive', '/api/tasks/single', '/api/tasks/setDueDate', '/api/priority/setPriority', '/api/estimate/setEstimate', '/api/mcp/assignees/assign', '/api/mcp/assignees/assign',
    ])
  })
}

test('single update and batch callers select ON/OFF before description normalization', async () => {
  const body = { task_id: 101, description: '## Heading', content_type: 'markdown' }
  for (const caller of ['selector', 'single', 'batch']) {
    const results = []
    for (const enabled of [false, true]) {
      reset()
      flag = enabled
      const input = structuredClone(body)
      state.originalDescription = input.description
      observedBody = input
      const result = await withFetch(() => caller === 'selector' ? selector({ request: request(input), ctx: state.ctx, requestBody: input }) : caller === 'single' ? operation(request(input)) : batch(request(input), state.ctx, { op: 'update', updates: [input] }, { assignAssignees: async () => {} }))
      const response = caller === 'selector' ? result.response : result
      results.push({ text: await response.text(), status: response.status, events: state.events })
    }
    assert.deepEqual(results[1], results[0], caller)
  }
  reset()
  flagFailure = true
  assert.deepEqual(await withFetch(async () => {
    const result = await selector({ request: request(body), ctx: state.ctx, requestBody: structuredClone(body) })
    return result.response.text()
  }), (await execute(v1, body)).text)
})

test('idempotent replay retains bytes and suppresses duplicate side effects in both single update versions', async () => {
  const results = []
  for (const enabled of [false, true]) {
    reset()
    flag = enabled
    const body = { task_id: 101, description: '## Heading', content_type: 'markdown' }
    const first = await withFetch(() => operation(request(body, 'replay-key')))
    const firstText = await first.text()
    const effects = [...state.events]
    const replay = await withFetch(() => operation(request(body, 'replay-key')))
    const replayText = await replay.text()
    assert.equal(JSON.parse(replayText).idempotent_replayed, true)
    assert.deepEqual(state.events, effects)
    results.push({ firstText, replayText, effects })
  }
  assert.deepEqual(results[1], results[0])
})

test('agent lease conflict receipts and cleanup match for single updates and adopted V1/V2 writes', async () => {
  for (const conflict of [false, true]) {
    const results = []
    for (const enabled of [false, true]) {
      reset({ ctx: { user, agentId: 'agent-fixture' }, lease: conflict ? { agentId: 'other-agent', token: 'other-lease', adoptionCount: 0 } : null })
      flag = enabled
      const response = await withFetch(() => operation(request({ task_id: 101, title: 'After' })))
      results.push({ text: await response.text(), status: response.status, events: state.events })
      if (conflict) {
        assert.equal(response.status, 500)
        assert.deepEqual(state.events, [['lease_lock', 101]])
      } else {
        assert.equal(state.lease, null)
        assert.deepEqual(state.events.slice(-2), [['lease_release_ref', 101], ['lease_delete', 101]])
        assert.ok(state.events.findIndex(([kind]) => kind === 'task') < state.events.findIndex(([kind]) => kind === 'lease_delete'))
      }
    }
    assert.deepEqual(results[1], results[0])
  }
})

test('both executors await realtime delivery and tolerate broadcast failures before returning receipts', async () => {
  for (const executor of [v1, v2]) {
    let release
    reset({ delivery: new Promise((resolve) => { release = resolve }), deliveryFailure: true })
    let settled = false
    const pending = withFetch(() => executor({ request: request({}), ctx: state.ctx, requestBody: { task_id: 101, title: 'After' } })).then((result) => { settled = true; return result })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settled, false)
    assert.ok(state.events.some(([kind]) => kind === 'task'))
    release()
    assert.equal((await pending).response.status, 200)
  }
})

test('V2 overlaps independent user/section reads after access and preserves rejection precedence', async () => {
  let release
  reset({ waitUser: new Promise((resolve) => { release = resolve }) })
  const pending = withFetch(() => v2({ request: request({}), ctx: state.ctx, requestBody: { task_id: 101, sectionId: 20 } }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(state.reads, ['user', 'section'])
  assert.equal(state.events.length, 0)
  release()
  await pending
  for (const extra of [{ userFailure: true, sectionFailure: true }, { cookieFailure: true, sectionFailure: true }, { sectionFailure: true }]) {
    let before
    await assert.rejects(execute(v1, { task_id: 101, sectionId: 20 }, extra), (error) => { before = error.message; return true })
    await assert.rejects(execute(v2, { task_id: 101, sectionId: 20 }, extra), (error) => error.message === before)
  }
})

test('dry-run receipts retain normalization, validation and missing-target outcomes without writes', async () => {
  for (const extra of [{}, { tasks: [] }, { missingUser: true }]) {
    const body = { task_id: 101, title: 'After', sectionId: 20, dry_run: true }
    const before = await execute(v1, body, extra)
    const after = await execute(v2, body, extra)
    assert.deepEqual(after, before)
    assert.deepEqual(after.events, [])
  }
})
