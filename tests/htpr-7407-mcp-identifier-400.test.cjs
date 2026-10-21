const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const oversized = 99999999999
const user = { id: 6 }
const ctx = { user, agentId: 'agent-1' }

function setup(failure) {
  const queries = []
  const crashReports = []
  const query = async (...args) => {
    queries.push(args)
    return []
  }
  const prisma = new Proxy({}, {
    get: () => new Proxy({}, { get: () => query }),
  })
  const auth = {
    validateMcpAuth: async () => ctx,
    checkMcpRateLimit: async () => null,
  }
  const stubs = {
    'next/server': { NextResponse: Response },
    '@prisma/client': { Prisma: {}, DecisionRequestStatus: {} },
    '@/lib/prisma': { default: prisma },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    '@/utils/controllers/projects/findPrefixAliasTasks': {},
    '@/lib/mcp/auth': auth,
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => async (...args) => {
        try {
          const response = await handler(...args)
          if (response.status >= 500) crashReports.push(response.status)
          return response
        } catch (error) {
          crashReports.push(error)
          return Response.json({ success: false, error: 'Internal server error' }, { status: 500 })
        }
      },
      validateMcpRouteAuth: auth.validateMcpAuth,
      checkMcpRouteRateLimit: auth.checkMcpRateLimit,
      withMcpRouteMutationLease: (_db, _actor, run) => run(),
      readMcpRouteJsonBody: async (request) => ({ ok: true, body: await request.json() }),
    },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (_request, error) => crashReports.push(error) },
    '@/lib/mcp/agents': {},
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/tasks/services': {},
    '@/lib/mcp/tasks/mappers': {},
    '@/lib/mcp/tasks/agentMutationFence': { AgentMutationLeaseConflictError: class extends Error {} },
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': { withAdoptedAgentMutationLease: (_db, _actor, run) => run() },
    '@/lib/realtime/server': {},
    '@/utils/controllers/tasks/moveToDifferentBoard': {},
    '@/utils/controllers/assignees/assign': {},
    '@/utils/controllers/getMemberAndOwnerForBoard': {},
    '@/lib/agents/visibility': {},
    '@/lib/timeTracking': {},
    '@/utils/controllers/pages/htmlToMarkdown': {},
    '@/utils/controllers/description/common-description-create': {},
    '@/utils/controllers/comments/createCommentService': {},
    '@/utils/helperFunctions/sanitizeRichHtml': {},
    '@/lib/taskCardActions/inboxState': {},
    '@/utils/controllers/pages/pageService': {},
    '@/lib/mcp/idempotency/idempotencyStore': {
      normalizeIdempotencyKey: () => null,
      IdempotencyInProgressError: class extends Error {},
    },
    '@/lib/mcp/tasks/updateTaskSelector': {
      executeTaskUpdate: async ({ requestBody }) => {
        await batch.findTasksByIdentifier(user, requestBody)
        return { response: Response.json({ success: true }) }
      },
    },
    '@/lib/mcp/attachments/safeFetch': {},
    '@/lib/mcp/attachments/storeLockedBatch': {},
    '@/lib/mcp/attachments/storeBatch': { AttachmentBatchError: class extends Error {} },
  }
  const resolver = load('src/lib/mcp/tasks/resolveTask.ts', stubs)
  stubs['@/lib/mcp/tasks/resolveTask'] = failure ? {
    ...resolver,
    findTaskByIdentifier: async () => { throw failure(resolver) },
    findTaskByStringIdentifier: async () => { throw failure(resolver) },
    resolveTaskIdOnly: async () => { throw failure(resolver) },
  } : resolver
  const batch = load('src/lib/mcp/tasks/fields/findTasks.ts', stubs)
  return {
    queries,
    crashReports,
    resolver,
    batch,
    route: (path) => load(path, stubs),
    request: (body = {}, query = '') => {
      const url = new URL(`https://app.hypertask.ai/api/mcp/test?${query}`)
      return Object.assign(new Request(url, { method: 'POST', body: JSON.stringify(body) }), { nextUrl: url })
    },
  }
}

for (const field of ['task_id', 'unique_index', 'project_id']) {
  for (const method of ['findTaskByIdentifier', 'resolveTaskIdOnly', 'findTasksByIdentifier']) {
    test(`${method} rejects oversized ${field} before any Prisma call`, async () => {
      const h = setup()
      const options = { task_id: 1, unique_index: 1, project_id: 15, [field]: oversized }
      const invoke = method === 'resolveTaskIdOnly'
        ? () => h.resolver[method](options)
        : () => (method === 'findTasksByIdentifier' ? h.batch : h.resolver)[method](user, options)
      await assert.rejects(invoke, (error) => {
        assert.ok(error instanceof h.resolver.TaskIdentifierOutOfRangeError)
        assert.equal(error.status, 400)
        assert.equal(error.code, 'invalid_field')
        assert.match(error.message, new RegExp(field))
        return true
      })
      assert.equal(h.queries.length, 0)
    })
  }
}

test('numeric string identifiers and mixed batch IDs reject oversized values without Prisma', async () => {
  const h = setup()
  for (const value of [String(oversized), '-99999999999', '9'.repeat(400)]) {
    await assert.rejects(() => h.resolver.findTaskByStringIdentifier(user, value), h.resolver.TaskIdentifierOutOfRangeError)
  }
  for (const task_id of [[1, oversized], ['1', String(oversized)]]) {
    await assert.rejects(() => h.batch.findTasksByIdentifier(user, { task_id }), h.resolver.TaskIdentifierOutOfRangeError)
  }
  assert.equal(h.queries.length, 0)
})

test('database int maximum is accepted and ordinary database errors are not classified as identifier errors', async () => {
  const h = setup()
  assert.equal(await h.resolver.resolveTaskIdOnly({ task_id: 2147483647 }), 2147483647)
  await h.resolver.findTaskByStringIdentifier(user, '2147483647')
  await h.batch.findTasksByIdentifier(user, { task_id: [2147483647] })
  assert.equal(h.queries.length, 2)
  assert.equal(h.resolver.taskIdentifierErrorResponse(new Error('db down')), null)
  assert.equal(h.resolver.taskIdentifierErrorResponse({ status: 400, code: 'invalid_field' }), null)
})

const ambiguous = (resolver) => new resolver.TaskIdentifierAmbiguityError('DUP-7')
const operation = (path) => `src/lib/mcp/operations/${path}/operation.ts`
const appRoute = (path) => `src/app/api/mcp/tasks/${path}/route.ts`
const ambiguousRoutes = [
  [operation('drafts'), 'GET', {}, 'ticket_number=DUP-7'],
  [operation('drafts'), 'POST', { ticket_number: 'DUP-7', draft_type: 'comment', text: 'hello' }],
  [operation('decisions'), 'GET', {}, 'ticket_number=DUP-7'],
  [operation('decisions'), 'POST', { ticket_number: 'DUP-7', question: 'Which?', options: ['A', 'B'] }],
  [operation('inbox/move'), 'POST', { ticket_number: 'DUP-7', user_id: 6 }],
  [operation('tasks/tree'), 'GET', {}, 'ticket_number=DUP-7'],
  [operation('tasks/description-versions'), 'GET', {}, 'ticket_number=DUP-7'],
  [operation('tasks/description-restore'), 'POST', { ticket_number: 'DUP-7', version_id: 1 }],
  [operation('tasks/attachments'), 'POST', { ticket_number: 'DUP-7', files: [{ url: 'https://example.com/a.png', filename: 'a.png', content_type: 'image/png' }] }],
  [appRoute('evidence'), 'GET', {}, 'ticket_number=DUP-7'],
  [appRoute('evidence'), 'POST', { ticket_number: 'DUP-7', type: 'test', title: 'Proof', url: 'https://example.com' }],
  [appRoute('session'), 'GET', {}, 'ticket_number=DUP-7'],
  [appRoute('session'), 'POST', { ticket_number: 'DUP-7', session_id: 's-1', action: 'start' }],
  [appRoute('escalate'), 'POST', { ticket_number: 'DUP-7', reason: 'Need help' }],
  [operation('time/report'), 'GET', {}, 'task=DUP-7'],
  ...['log', 'start', 'pause', 'resume', 'status', 'stop'].map((name) => [operation(`time/${name}`), 'POST', { task: 'DUP-7', minutes: 10 }]),
]

for (const [path, method, body, query] of ambiguousRoutes) {
  test(`${path} ${method}: ambiguity returns 400 without crash reporting`, async () => {
    const h = setup(ambiguous)
    const response = await h.route(path)[method](h.request(body, query))
    assert.equal(response.status, 400)
    const result = await response.json()
    assert.equal(result.code, 'ambiguous_ticket_number')
    assert.match(result.error, /ambiguous/)
    assert.equal(h.crashReports.length, 0)
  })
}

for (const [path, method, body, query] of ambiguousRoutes) {
  test(`${path} ${method}: resolver range errors return 400 without crash reporting`, async () => {
    const h = setup((resolver) => new resolver.TaskIdentifierOutOfRangeError('task_id'))
    const response = await h.route(path)[method](h.request(body, query))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'invalid_field')
    assert.equal(h.crashReports.length, 0)
  })
}

const rangeRoutes = [
  [operation('tasks/move'), { task_id: oversized, target_project_id: 15 }, 'task_id'],
  [operation('tasks/move'), { task_id: 1, target_project_id: oversized }, 'target_project_id'],
  [operation('tasks/move'), { task_id: 1, target_project_id: 15, target_section_id: oversized }, 'target_section_id'],
  [operation('tasks/move'), { ticket_number: String(oversized), target_project_id: 15 }, 'ticket_number'],
  [operation('assignees/assign'), { task_id: oversized, user_id: 6 }, 'task_id'],
  [operation('assignees/assign'), { task_id: 1, user_ids: [6, oversized], mode: 'multiple' }, 'user_ids'],
  [operation('pages/create'), { task_id: oversized, content: 'hello' }, 'task_id'],
  [operation('pages/create'), { ticket_number: 'DUP-7', project_id: oversized, content: 'hello' }, 'project_id'],
  [operation('pages/create'), { task_id: 1, parent_page_id: oversized, content: 'hello' }, 'parent_page_id'],
  [operation('tasks/update'), { task_id: oversized, title: 'hello' }, 'task_id'],
  [operation('tasks/update'), { task_id: 1, sectionId: oversized }, 'sectionId'],
  [operation('tasks/update'), { task_id: 1, assignee: [oversized] }, 'assignee'],
  [operation('tasks/update'), { task_id: 1, parent_task_id: oversized }, 'parent_task_id'],
  ...['claim', 'heartbeat', 'release'].map((name) => [appRoute(`lease/${name}`), { task_id: oversized }, 'task_id']),
]
for (const [path, body, field] of rangeRoutes) {
  test(`${path}: oversized ${field} returns 400 before Prisma or crash reporting`, async () => {
    const h = setup()
    const response = await h.route(path).POST(h.request(body))
    assert.equal(response.status, 400)
    const result = await response.json()
    assert.equal(result.code, 'invalid_field')
    assert.match(result.error, new RegExp(field))
    assert.equal(h.queries.length, 0)
    assert.equal(h.crashReports.length, 0)
  })
}

test('drafts GET preserves 500 and crash reporting for an ordinary database failure', async () => {
  const failure = new Error('db down')
  const h = setup(() => failure)
  const response = await h.route(operation('drafts')).GET(h.request({}, 'ticket_number=DUP-7'))
  assert.equal(response.status, 500)
  assert.ok(h.crashReports.includes(failure))
})

for (const field of ['task_id', 'attachment_id']) {
  test(`attachment GET rejects oversized ${field} before Prisma`, async () => {
    const h = setup()
    const response = await h.route(operation('tasks/attachments')).GET(h.request({}, new URLSearchParams({ task_id: '1', attachment_id: '1', [field]: String(oversized) }).toString()))
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, new RegExp(field))
    assert.equal(h.queries.length, 0)
    assert.equal(h.crashReports.length, 0)
  })
}

for (const method of ['GET', 'PATCH']) {
  test(`decision ${method} rejects oversized path id before Prisma`, async () => {
    const h = setup()
    const response = await h.route(operation('decisions/[id]'))[method](h.request(), { params: Promise.resolve({ id: String(oversized) }) })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).field, 'id')
    assert.equal(h.queries.length, 0)
    assert.equal(h.crashReports.length, 0)
  })
}

for (const field of ['user', 'board']) {
  test(`time report rejects oversized ${field} before Prisma`, async () => {
    const h = setup()
    const response = await h.route(operation('time/report')).GET(h.request({}, `${field}=${oversized}`))
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, new RegExp(field))
    assert.equal(h.queries.length, 0)
    assert.equal(h.crashReports.length, 0)
  })
}

test('inbox move rejects an oversized user_id before Prisma', async () => {
  const h = setup()
  const response = await h.route(operation('inbox/move')).POST(h.request({ task_id: 1, user_id: oversized }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /user_id/)
  assert.equal(h.queries.length, 0)
  assert.equal(h.crashReports.length, 0)
})

test('description restore rejects an oversized version_id before Prisma', async () => {
  const h = setup()
  const response = await h.route(operation('tasks/description-restore')).POST(h.request({ task_id: 1, version_id: oversized }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /version_id/)
  assert.equal(h.queries.length, 0)
  assert.equal(h.crashReports.length, 0)
})

test('attachment POST rejects an oversized comment_id before Prisma', async () => {
  const h = setup()
  const response = await h.route(operation('tasks/attachments')).POST(h.request({
    task_id: 1,
    comment_id: oversized,
    files: [{ filename: 'a.png', content_type: 'image/png', url: 'https://example.com/a.png' }],
  }))
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /comment_id/)
  assert.equal(h.queries.length, 0)
  assert.equal(h.crashReports.length, 0)
})
