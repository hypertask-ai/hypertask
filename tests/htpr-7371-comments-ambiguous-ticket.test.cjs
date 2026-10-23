const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

class TaskIdentifierAmbiguityError extends Error {}
const ambiguityMessage = 'Ticket number OARD-7 is ambiguous across accessible projects; provide project_id.'

function setup(findTask) {
  const crashReports = []
  const user = { id: 6, displayName: 'Owner' }
  const stubs = {
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (_request, error) => crashReports.push(error) },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user, agentId: 'agent-1' }),
      mcpRouteUnauthorizedResponse: async () => ({ status: 401 }),
      readMcpRouteJsonBody: async (request) => ({ ok: true, body: request.body }),
    },
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    '@prisma/client': { Prisma: { DbNull: null } },
    '@/lib/prisma': { default: {
      comment: { count: async () => 0, findMany: async () => [], findUnique: async () => null },
      user: { findUnique: async () => user },
    } },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null, mcpVisibleAgentSelect: () => ({}) },
    '@/utils/controllers/urls/extractUrlsFromContent': { buildMcpImageUrls: () => [], persistUrlsForComment: async () => {} },
    '@/utils/controllers/comments/processMentions': {
      convertPlainTextMentionsToHtml: (text) => text,
      resolveTextMentions: async (text) => text,
    },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => { throw new Error('no comment write expected') } },
    '@/utils/controllers/comments/agentInvocationCorrelation': { AgentInvocationNotPendingError: class extends Error {} },
    '@/lib/mcp/tasks/resolveTask': {
      TaskIdentifierAmbiguityError,
      taskIdentifierErrorResponse: (error) => error instanceof TaskIdentifierAmbiguityError
        ? { body: { success: false, error: error.message }, status: 400 }
        : null,
      validateTaskIdentifier: () => ({ valid: true }),
      findTaskByIdentifier: findTask,
    },
    '@/lib/mcp/tasks/services': { validateProjectMemberIds: async () => ({ invalidIds: [] }) },
    '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (text) => text },
    '@/utils/helperFunctions/multiPages': { extractTipTapContent: () => ({ mentions: [] }) },
    '@/lib/mcp/normalizeBlockHtml': { normalizeBlockHtml: (text) => text },
    '@/utils/helperFunctions/markdownToHtml': { formatRichTextInput: (text) => text },
    '@/lib/mcp/tasks/validators': { CONTENT_TYPE_ALLOWED_VALUES: ['html', 'markdown'] },
    '@/lib/mcp/comments/activityMetadata': {},
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/idempotency/idempotencyStore': {
      IdempotencyAccessError: class extends Error {},
      IdempotencyInProgressError: class extends Error {},
      normalizeIdempotencyKey: (key) => key,
      withIdempotency: async (_operation, _userId, _key, _body, handler) => handler(),
    },
    '@/lib/mcp/boards/links': { buildMcpTaskUrl: () => 'https://app.hypertask.ai/detail/project-2312/7' },
    '@/lib/mcp/comments/reactionResponse': { commentReactionInclude: () => ({}), reactionAgentIds: () => [] },
    '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
    '@/lib/agents/publicAgent': {},
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/mcp/listQuery': {},
    '@/lib/mcp/readListQuery': { readListQuery: () => ({ listQuery: null }) },
    '@/lib/agentRuns/service': {},
  }
  const { GET, POST } = load('src/lib/mcp/operations/comments/operation.ts', stubs)
  return {
    crashReports,
    get: (query) => GET({ nextUrl: new URL(`https://app.hypertask.ai/api/mcp/comments?${query}`), headers: new Headers() }),
    post: (body) => POST({ body: { text: '<p>Hello</p>', ...body }, headers: new Headers() }),
  }
}

const ambiguous = async () => { throw new TaskIdentifierAmbiguityError(ambiguityMessage) }

test('reading comments by an ambiguous ticket number is refused with 400 and is not reported as a crash', async () => {
  const { get, crashReports } = setup(ambiguous)
  const response = await get('ticket_number=OARD-7')
  assert.equal(response.status, 400)
  assert.deepEqual(response.body, { success: false, error: ambiguityMessage })
  assert.equal(crashReports.length, 0)
})

test('adding a comment by an ambiguous ticket number is refused with 400 and is not reported as a crash', async () => {
  const { post, crashReports } = setup(ambiguous)
  const response = await post({ ticket_number: 'OARD-7' })
  assert.equal(response.status, 400)
  assert.deepEqual(response.body, { success: false, error: ambiguityMessage })
  assert.equal(crashReports.length, 0)
})

test('an unexpected lookup failure is still a reported 500', async () => {
  const failure = new Error('database unavailable')
  const { get, crashReports } = setup(async () => { throw failure })
  const response = await get('ticket_number=OARD-7')
  assert.equal(response.status, 500)
  assert.deepEqual(crashReports, [failure])
})

test('reading comments with project_id still returns the ticket comments', async () => {
  const { get, crashReports } = setup(async (_user, identifier) => {
    assert.equal(identifier.project_id, 2312)
    return { id: 24293, projectId: 2312 }
  })
  const response = await get('ticket_number=OARD-7&project_id=2312')
  assert.equal(response.status, 200)
  assert.equal(response.body.success, true)
  assert.deepEqual(response.body.comments, [])
  assert.equal(crashReports.length, 0)
})
