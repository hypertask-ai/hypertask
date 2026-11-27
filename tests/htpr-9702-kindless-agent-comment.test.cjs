const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')
const { setup } = require('./helpers/comment-routing.cjs')
const { AGENT_LOG_NOTE } = load('src/lib/mcp/operations/comments/agentLog.ts', {})

function agentRunsStubs(calls) {
  return {
    '@/lib/agentRuns/service': {
      createRuntimeAgentRun: async (...args) => {
        calls.runs.push(args)
        return { id: 'run-1' }
      },
      createAgentRunActivity: async (...args) => {
        calls.activities.push(args)
        return { activity: {
          id: 'activity-1', runId: args[1], type: args[2].type.toLowerCase(),
          text: args[2].text, createdAt: '2026-10-19T12:00:00.000Z',
        } }
      },
    },
  }
}

test('an agent comment with no kind is saved to the agent log and says where it went', async () => {
  const { post, calls } = setup()
  const response = await post()
  assert.equal(response.status, 201)
  assert.equal(response.body.success, true)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.visibleToPeople, false)
  assert.equal(response.body.notice, AGENT_LOG_NOTE)
  assert.match(response.body.notice, /agent log/)
  assert.match(response.body.notice, /question, qa or done/)
  assert.equal(response.body.activity.type, 'thought')
  assert.equal(response.body.activity.text, 'Progress & next step')
  assert.equal(calls.activities.length, 1)
  assert.equal(calls.comments.length, 0)
  assert.equal(calls.broadcasts.length, 0)
})

test('a dry run points an agent comment with no kind at the agent log', async () => {
  const { post, calls } = setup()
  const response = await post({ dry_run: true })
  assert.equal(response.status, 200)
  assert.equal(response.body.would.routedTo, 'log')
  assert.equal(calls.comments.length + calls.activities.length + calls.runs.length, 0)
})

for (const kind of ['question', 'qa', 'done']) {
  test(`an agent comment with kind ${kind} stays a people comment`, async () => {
    const { post, calls } = setup()
    const response = await post({ kind })
    assert.equal(response.status, 201)
    assert.equal(response.body.routedTo, 'comments')
    assert.equal(response.body.visibleToPeople, true)
    assert.equal(response.body.comment.kind, kind)
    assert.equal(response.body.notice, undefined)
    assert.equal(calls.comments.length, 1)
    assert.equal(calls.activities.length, 0)
  })
}

test('a person comment with no kind stays in the thread', async () => {
  const { post, calls } = setup({ human: true })
  const response = await post()
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(response.body.comment.kind, null)
  assert.equal(calls.comments.length, 1)
  assert.equal(calls.activities.length, 0)
})

function pagesRoute(logCalls) {
  const writes = []
  const route = load('src/pages/api/comments/create.ts', {
    '@/lib/auth/agentScope': { withAgentScopeRequest: (_request, run) => run(), prepareAgentScope: async () => {} },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6 }) },
    '@/lib/prisma': { default: { user: { findUnique: async () => ({ id: 6, displayName: 'Owner' }) } } },
    '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async (params) => { writes.push(params); return { id: 42, text: params.text } } },
    '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
    ...agentRunsStubs(logCalls),
  }).default
  const post = async (body) => {
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this }, json(value) { this.body = value; return this } }
    await route({ method: 'POST', headers: {}, body: { text: '<p>Status for the team</p>', creatorId: 6, ownerId: 6, taskId: 99, agentId: 'agent-1', ...body } }, response)
    return response
  }
  return { writes, post }
}

test('the pages comment route sends an agent note with no kind to the agent log', async () => {
  const logCalls = { runs: [], activities: [] }
  const { writes, post } = pagesRoute(logCalls)
  const response = await post()
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.visibleToPeople, false)
  assert.equal(response.body.notice, AGENT_LOG_NOTE)
  assert.equal(response.body.activity.text, 'Status for the team')
  assert.equal(logCalls.activities.length, 1)
  assert.equal(writes.length, 0)
})

test('the pages comment route still publishes an agent comment with a kind', async () => {
  const logCalls = { runs: [], activities: [] }
  const { writes, post } = pagesRoute(logCalls)
  const response = await post({ kind: 'qa' })
  assert.equal(response.statusCode, 200)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].kind, 'qa')
  assert.equal(logCalls.activities.length, 0)
})

test('the pages comment route keeps a person comment with no kind in the thread', async () => {
  const logCalls = { runs: [], activities: [] }
  const { writes, post } = pagesRoute(logCalls)
  await post({ agentId: null })
  assert.equal(writes.length, 1)
  assert.equal(logCalls.activities.length, 0)
})

function aiTool({ actingAgentId }) {
  const logCalls = { runs: [], activities: [] }
  const writes = []
  const { createAddCommentTool } = load('src/lib/ai/tools/addComment.ts', {
    ai: { tool: (definition) => definition },
    '@/lib/prisma': { default: {
      task: { findUnique: async ({ where }) => ({ id: where.id, title: 'Task', projectId: 15, uniqueIndex: 9702, userId: 6 }) },
      user: { findUnique: async () => ({ id: 6, displayName: 'Owner' }) },
      comment: { findUnique: async () => null },
    } },
    '@/lib/ai/tools/execution': {
      withToolErrors: (fn) => fn,
      resolveTaskForTool: async () => ({ task: { id: 99 } }),
    },
    '@/lib/ai/tools/helpers': {
      sanitizeForJson: (value) => value,
      commentInclude: () => ({}),
      mapCommentToResponse: (value) => value,
      applyDurableCommentAttribution: (value) => value,
    },
    '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
    '@/utils/controllers/comments/processMentions': {
      convertPlainTextMentionsToHtml: (text) => text,
      resolveTextMentions: async (text) => text,
    },
    '@/utils/helperFunctions/toStoredHtml': { toStoredHtml: (text) => text },
    '@/utils/controllers/comments/linkifyTicketRefs': { linkifyTicketRefs: async (text) => text },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async (params) => {
      writes.push(params)
      return { id: 42, text: params.text, kind: params.kind ?? null }
    } },
    '@/utils/controllers/urls/extractUrlsFromContent': { buildMcpImageUrls: () => [], persistUrlsForComment: async () => {} },
    '@/lib/realtime/server': { broadcastTaskComment() {} },
    '@/lib/ai/chatStream/prompt': { COMMENT_TASK_LINK_RULE: '' },
    '@/lib/ai/chatStream/errors': { errorMessage: (error) => error.message },
    '@/lib/mcp/boards/links': { buildMcpTaskUrl: () => 'https://app.hypertask.ai/detail/project-15/9702' },
    ...agentRunsStubs(logCalls),
  })
  const tool = createAddCommentTool({
    user: { id: 6 },
    actingAgentId,
    teamScope: actingAgentId ? null : undefined,
    confirmationSessionId: 'chat-9702',
    bulkPreviewsIssued: new Set(),
    sendStatus() {},
    body: {},
    inlineAgentImagesEnabled: false,
  }).hypertask_add_comment
  return { writes, logCalls, run: (input) => tool.execute(tool.inputSchema.parse(input)) }
}

test('the AI comment tool saves an agent note with no kind to the agent log', async () => {
  const tool = aiTool({ actingAgentId: 'agent-1' })
  const result = await tool.run({ task_id: 99, text: 'Status for the team' })
  assert.equal(result.success, true)
  assert.equal(result.routedTo, 'log')
  assert.equal(result.visibleToPeople, false)
  assert.equal(result.notice, AGENT_LOG_NOTE)
  assert.equal(result.activity.text, 'Status for the team')
  assert.equal(tool.logCalls.activities.length, 1)
  assert.equal(tool.writes.length, 0)
})

test('the AI comment tool still publishes an agent comment with a kind', async () => {
  const tool = aiTool({ actingAgentId: 'agent-1' })
  const result = await tool.run({ task_id: 99, text: 'QA passed.', kind: 'qa' })
  assert.equal(result.success, true)
  assert.equal(tool.writes.length, 1)
  assert.equal(tool.writes[0].kind, 'qa')
  assert.equal(tool.logCalls.activities.length, 0)
})

test('the AI comment tool keeps a person comment with no kind in the thread', async () => {
  const tool = aiTool({ actingAgentId: null })
  const result = await tool.run({ task_id: 99, text: 'Status for the team' })
  assert.equal(result.success, true)
  assert.equal(tool.writes.length, 1)
  assert.equal(tool.logCalls.activities.length, 0)
})

test('no comment audience flag is left to refuse an agent note with no kind', () => {
  const keys = require('./helpers/flag-files.cjs').load('src/lib/flags/keys.ts')
  const definitions = require('./helpers/flag-files.cjs').definitions()
  assert.equal(Object.keys(keys).filter((name) => name.includes('COMMENT_AUDIENCE')).length, 0)
  assert.equal(definitions.filter(({ key }) => key === 'htpr-9063-comment-audience').length, 0)
})

test('agent-facing tool text says an untyped agent comment goes to the agent log', () => {
  const hello = load('src/lib/mcp/hello/getHelloPayload.ts', {
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/mcp/hello/boards': { loadHelloBoards: async () => [] },
  })
  assert.match(hello.HELLO_CAPABILITIES.comments, /saved to the agent log/)
  assert.doesNotMatch(hello.HELLO_CAPABILITIES.comments, /is refused and nothing is saved/)
})
