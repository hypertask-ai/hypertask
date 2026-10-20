const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const oversized = 99999999999
const ctx = { user: { id: 6 }, agentId: 'agent-1' }

function setup(failure) {
  const queries = []
  const crashReports = []
  const query = async (...args) => {
    queries.push(args)
    return { id: 1, projectId: 15 }
  }
  const prisma = new Proxy({}, {
    get: () => new Proxy({}, { get: () => query }),
  })
  const auth = {
    validateMcpAuth: async () => ctx,
    checkMcpRateLimit: async () => null,
  }
  const wrapMcpRoute = (handler) => async (...args) => {
    try {
      const response = await handler(...args)
      if (response.status >= 500) crashReports.push(response.status)
      return response
    } catch (error) {
      crashReports.push(error)
      return Response.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
  }
  const stubs = {
    'next/server': { NextResponse: Response },
    '@prisma/client': { Prisma: {} },
    '@/lib/prisma': { default: prisma },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    '@/utils/controllers/projects/findPrefixAliasTasks': {},
    '@/lib/mcp/auth': auth,
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute,
      validateMcpRouteAuth: auth.validateMcpAuth,
      checkMcpRouteRateLimit: auth.checkMcpRateLimit,
    },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (_request, error) => crashReports.push(error) },
    '@/lib/mcp/tasks/mappers': {},
    '@/lib/mcp/agents': {},
    '@/lib/agents/publicAgent': {},
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/comments/reactionStore': {},
    '@/lib/mcp/comments/reactionResponse': {},
    '@/lib/mcp/comments/visibleReactionAgents': {},
    '@/lib/agentWebhooks/commentReaction': {},
    '@/lib/agentWebhooks/outbox': {},
    '@/lib/realtime/server': {},
    '@/utils/controllers/notifications/creation-service/check-reminder_create-notification': {},
    '@/utils/controllers/FCM': {},
    '@/lib/taskCardActions/inboxState': { setTaskMovedToInboxState: async () => true },
    '@/lib/taskCardActions/writeLocks': {},
    '@/utils/controllers/turbopuffer/turbopufferHelper': {},
  }
  const resolver = load('src/lib/mcp/tasks/resolveTask.ts', stubs)
  stubs['@/lib/mcp/tasks/resolveTask'] = failure ? {
    ...resolver,
    findTaskByIdentifier: async () => { throw failure(resolver) },
  } : resolver
  return {
    queries,
    crashReports,
    resolver,
    wrapMcpRoute,
    load: (path) => load(path, stubs),
    request: (taskId = 1) => {
      const url = new URL(`https://app.hypertask.ai/api/mcp/test?task_id=${taskId}&project_id=15`)
      return Object.assign(new Request(url, {
        method: 'POST',
        body: JSON.stringify({ task_id: taskId, project_id: 15, action: 'inbox', active: true }),
      }), { nextUrl: url })
    },
  }
}

const paths = [
  {
    source: 'src/lib/mcp/comments/reactionHandler.ts',
    invoke: (h, commentId = 1) => h.load('src/app/api/mcp/comments/[comment_id]/reactions/route.ts').POST(
      new Request('https://app.hypertask.ai/api/mcp/comments/1/reactions', {
        method: 'POST', body: JSON.stringify({ emoji: '👍', active: true }),
      }),
      { params: Promise.resolve({ comment_id: String(commentId) }) },
    ),
    lookupQueries: 1,
  },
  {
    source: 'src/lib/mcp/operations/tasks/context/operation.ts',
    invoke: (h, taskId) => h.load('src/lib/mcp/operations/tasks/context/operation.ts').GET(h.request(taskId)),
  },
  {
    source: 'src/lib/mcp/tasks/cardActionHandler.ts',
    invoke: (h, taskId) => h.load('src/app/api/mcp/tasks/card-actions/route.ts').POST(h.request(taskId)),
  },
  {
    source: 'src/lib/mcp/tasks/relatedTasks.ts',
    invoke: (h, taskId = 1) => h.wrapMcpRoute((request) =>
      h.load('src/lib/mcp/tasks/relatedTasks.ts').handleRelatedTasksGet(request, ctx, { taskId, limit: null })
    )(h.request(taskId)),
  },
]

for (const { source, invoke, lookupQueries = 0 } of paths) {
  test(`${source}: identifier errors are 400 without crashes; database errors remain reported 500s`, async () => {
    for (const [failure, code] of [
      [(resolver) => new resolver.TaskIdentifierAmbiguityError('DUP-7'), 'ambiguous_ticket_number'],
      [(resolver) => new resolver.TaskIdentifierOutOfRangeError('task_id'), 'invalid_field'],
    ]) {
      const h = setup(failure)
      const response = await invoke(h)
      assert.equal(response.status, 400)
      const result = await response.json()
      assert.equal(result.success, false)
      assert.equal(result.code, code)
      assert.equal(result.error, failure(h.resolver).message)
      assert.equal(h.queries.length, lookupQueries)
      assert.equal(h.crashReports.length, 0)
    }

    const range = setup()
    const response = await invoke(range, oversized)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'invalid_field')
    assert.equal(range.queries.length, 0)
    assert.equal(range.crashReports.length, 0)

    const failure = new Error('database unavailable')
    const db = setup(() => failure)
    const dbResponse = await invoke(db)
    assert.equal(dbResponse.status, 500)
    assert.equal((await dbResponse.json()).success, false)
    assert.ok(db.crashReports.includes(failure) || db.crashReports.includes(500))

    if (source.endsWith('cardActionHandler.ts')) {
      await assert.rejects(() => db.load(source).POST(db.request()), (error) => error === failure)
      const success = setup()
      const result = await success.load(source).POST(success.request())
      assert.equal(result.status, 200)
      assert.equal((await result.json()).active, true)
    }
  })
}
