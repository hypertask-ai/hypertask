const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
})

const {
  commentReactionInclude,
  mapMcpCommentReaction,
} = jiti(path.join(root, 'src/lib/mcp/comments/reactionResponse.ts'))

const routeSource = fs.readFileSync(
  path.join(root, 'src/app/api/mcp/comments/route.ts'),
  'utf8'
)
const routeJavascript = ts.transpileModule(routeSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText

function loadCommentsRoute({
  authContext = { user: { id: 6 }, agentId: null },
  task = { id: 42 },
  taskResolver = null,
} = {}) {
  const queryCalls = []
  const resolverCalls = []
  const allReactions = [
    {
      id: 'reaction-7001',
      emoji: '👍',
      userId: 6,
      isDeleted: false,
      user: { id: 6, displayName: 'Valentin Yeo' },
    },
    {
      id: 'deleted-7001',
      emoji: '✅',
      userId: 9,
      isDeleted: true,
      user: { id: 9, displayName: 'Other User' },
    },
  ]
  const commentsFixture = [
    {
      id: 7001,
      taskId: 42,
      text: '<p>Approved</p>',
      commentText: '<p>Approved</p>',
      createdAt: new Date('2026-08-21T00:00:00.000Z'),
      activity: null,
      creatorId: 6,
      creator: {
        id: 6,
        email: 'owner@example.test',
        displayName: 'Valentin Yeo',
      },
      agent: null,
      attachments: [],
      reactions: allReactions,
    },
    {
      id: 7002,
      taskId: 42,
      text: '<p>Needs a name</p>',
      commentText: '<p>Needs a name</p>',
      createdAt: new Date('2026-08-20T00:01:00.000Z'),
      activity: null,
      creatorId: 9,
      creator: {
        id: 9,
        email: 'other@example.test',
        displayName: 'Other User',
      },
      agent: null,
      attachments: [],
      reactions: [{
        id: 'reaction-7002',
        emoji: '👀',
        userId: 9,
        isDeleted: false,
        user: null,
      }],
    },
    {
      id: 7003,
      taskId: 42,
      text: '<p>Activity row</p>',
      commentText: '<p>Activity row</p>',
      createdAt: new Date('2026-08-19T00:02:00.000Z'),
      activity: { type: 'TaskMoved' },
      creatorId: 6,
      creator: {
        id: 6,
        email: 'owner@example.test',
        displayName: 'Valentin Yeo',
      },
      agent: null,
      attachments: [],
      reactions: [],
    },
  ]
  const resolveTask = taskResolver ?? (async () => task)
  const prisma = {
    comment: {
      count: async (query) => {
        return commentsFixture.filter((comment) => {
          if (comment.taskId !== query.where.taskId) return false
          return query.where.activity === undefined || comment.activity === null
        }).length
      },
      findMany: async (query) => {
        queryCalls.push(query)
        const reactionWhere = query.include?.reactions?.where
        const matchingComments = commentsFixture.filter((comment) => {
          if (comment.taskId !== query.where.taskId) return false
          return query.where.activity === undefined || comment.activity === null
        })
        const orderedComments = [...matchingComments].sort((left, right) => {
          const direction = query.orderBy.createdAt === 'asc' ? 1 : -1
          return (left.createdAt - right.createdAt) * direction
        })
        return orderedComments.slice(query.skip, query.skip + query.take).map((comment) => ({
          ...comment,
          reactions: reactionWhere
            ? comment.reactions.filter((reaction) =>
                Object.entries(reactionWhere).every(
                  ([key, value]) => reaction[key] === value
                )
              )
            : comment.reactions,
        }))
      },
    },
  }
  const routeModule = { exports: {} }
  const modules = {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    '@prisma/client': { Prisma: { DbNull: Symbol('DbNull') } },
    '@/lib/mcp/auth': {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => authContext,
      // The route hands a rejection to the shared helper so the 401 names its
      // cause (HTPR-4814). The real one reads the request headers; here only
      // the status and shape the route passes through matter.
      mcpUnauthorizedResponse: async () => ({
        body: {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.',
          reason: 'invalid_token',
        },
        status: 401,
      }),
    },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null, mapMcpAgent: () => null, mcpAgentSelect: {} },
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/lib/mcp/tasks/resolveTask': {
      findTaskByIdentifier: async (...args) => { resolverCalls.push(args); return resolveTask(...args) },
      validateTaskIdentifier: () => ({ valid: true }),
    },
    '@/lib/mcp/comments/reactionResponse': { commentReactionInclude, mapMcpCommentReaction },
    '@/lib/mcp/comments/activityMetadata': { withActivityMetadata: (comment) => comment },
    '@/utils/controllers/urls/extractUrlsFromContent': { buildMcpImageUrls: () => [], persistUrlsForComment: async () => {} },
    '@/utils/controllers/comments/processMentions': { convertPlainTextMentionsToHtml: (text) => text, resolveTextMentions: async (text) => text },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => ({}) },
    '@/utils/controllers/comments/agentInvocationCorrelation': {
      AgentInvocationNotPendingError: class extends Error {},
    },
    '@/lib/mcp/tasks/services': { validateProjectMemberIds: async () => ({ invalidIds: [] }) },
    '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (text) => text },
    '@/utils/helperFunctions/multiPages': { extractTipTapContent: () => ({ mentions: [] }) },
    '@/lib/mcp/normalizeBlockHtml': { normalizeBlockHtml: (text) => text },
    '@/utils/helperFunctions/markdownToHtml': { markdownToHtml: (text) => text },
    '@/lib/mcp/fieldError': { buildFieldError: () => ({}) },
    '@/lib/mcp/tasks/validators': { CONTENT_TYPE_ALLOWED_VALUES: ['html', 'markdown'] },
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/idempotency/idempotencyStore': {
      IdempotencyInProgressError: class extends Error {}, normalizeIdempotencyKey: () => null,
      withIdempotency: async (_operation, _userId, _key, _body, handler) => handler(),
    },
    '@/lib/mcp/readJsonBody': { readJsonBody: async () => ({ ok: false, response: {} }) },
  }
  const mockRequire = (request) => {
    if (modules[request]) return modules[request]
    throw new Error(`Unexpected import: ${request}`)
  }

  new Function('module', 'exports', 'require', routeJavascript)(
    routeModule,
    routeModule.exports,
    mockRequire
  )

  return { GET: routeModule.exports.GET, queryCalls, resolverCalls }
}

test('comment reaction reads select active reactions and reactor identity', () => {
  assert.deepEqual(commentReactionInclude.where, { isDeleted: false })
  assert.deepEqual(commentReactionInclude.select.user.select, {
    id: true,
    displayName: true,
  })
})

test('comment reaction mapping keeps the stable user ID when no display name exists', () => {
  assert.deepEqual(
    mapMcpCommentReaction({
      id: 'reaction-2',
      emoji: '✅',
      userId: 9,
      user: { id: 9, displayName: null },
    }),
    {
      id: 'reaction-2',
      emoji: '✅',
      userId: 9,
      user: { id: 9 },
    }
  )
})

test('MCP comments response includes mapped active reactions', async () => {
  const route = loadCommentsRoute()
  const response = await route.GET({
    nextUrl: {
      searchParams: new URLSearchParams({ task_id: '42' }),
    },
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.comments.length, 2)
  assert.equal(response.body.total, 2)
  assert.deepEqual(response.body.comments[0].reactions, [{
    id: 'reaction-7001',
    emoji: '👍',
    userId: 6,
    user: { id: 6, displayName: 'Valentin Yeo' },
  }])
  assert.equal(
    response.body.comments[0].reactions.some(({ id }) => id === 'deleted-7001'),
    false
  )
  assert.deepEqual(response.body.comments[1].reactions, [{
    id: 'reaction-7002',
    emoji: '👀',
    userId: 9,
  }])
  assert.deepEqual(
    route.queryCalls[0].include.reactions,
    commentReactionInclude
  )
  assert.equal(route.queryCalls[0].where.taskId, 42)
  assert.ok('equals' in route.queryCalls[0].where.activity)
  assert.equal(route.queryCalls[0].orderBy.createdAt, 'desc')
  assert.equal(route.queryCalls[0].take, 50)
  assert.equal(route.queryCalls[0].skip, 0)
})

test('MCP comments GET rejects unauthenticated callers', async () => {
  const route = loadCommentsRoute({ authContext: null })
  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ task_id: '42' }) },
  })

  assert.equal(response.status, 401)
  assert.equal(response.body.success, false)
})

test('MCP comments GET applies comment pagination to the scoped result', async () => {
  const route = loadCommentsRoute()
  const response = await route.GET({
    nextUrl: {
      searchParams: new URLSearchParams({
        task_id: '42',
        limit: '1',
        offset: '1',
      }),
    },
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.total, 2)
  assert.deepEqual(response.body.comments.map(({ id }) => id), [7002])
  assert.equal(route.queryCalls[0].take, 1)
  assert.equal(route.queryCalls[0].skip, 1)
})

test('MCP comments GET returns not found when task access is denied', async () => {
  const route = loadCommentsRoute({ taskResolver: async () => null })
  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ task_id: '42' }) },
  })

  assert.equal(response.status, 404)
  assert.equal(response.body.success, false)
  assert.deepEqual(route.resolverCalls[0][0], { id: 6 })
  assert.equal(route.resolverCalls[0][1].task_id, 42)
  assert.equal(route.resolverCalls[0][2], null)
})
