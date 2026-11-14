const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')
const { setup } = require('./helpers/comment-routing.cjs')
const { MISSING_COMMENT_AUDIENCE } = load('src/lib/mcp/operations/comments/agentChatterRouting.ts', {})

const refusal = MISSING_COMMENT_AUDIENCE

test('the audience flag ships for everyone and can be switched off', () => {
  const definition = load('src/lib/flags/definitions/htpr-9063-comment-audience.ts', {})
  assert.equal(definition.HTPR_9063_COMMENT_AUDIENCE_FLAG, 'htpr-9063-comment-audience')
  assert.equal(definition.default.key, 'htpr-9063-comment-audience')
  assert.equal(definition.default.kind, 'bugfix')
  assert.equal(definition.default.defaultMode, 'EVERYONE')
  assert.equal(definition.default.shippedOn, '2026-11-11')
  assert.equal(definition.default.releaseRisk.risk, 'small')
  assert.match(definition.default.description, /no audience is refused/)
  assert.match(definition.default.releaseRisk.reason, /activity add/)
})

test('flag on refuses an agent comment with no kind and saves nothing', async () => {
  const { post, calls } = setup({ refuseUntyped: true })
  const response = await post({ reply_to_comment_id: 12 })
  assert.equal(response.status, 400)
  assert.equal(response.body.code, 'missing_field')
  assert.equal(response.body.field, 'kind')
  assert.equal(response.body.error, refusal)
  assert.equal(response.body.success, false)
  assert.equal(calls.comments.length + calls.activities.length + calls.runs.length + calls.broadcasts.length, 0)
})

test('flag on dry run refuses before any write', async () => {
  const { post, calls } = setup({ refuseUntyped: true })
  const response = await post({ dry_run: true })
  assert.equal(response.status, 400)
  assert.equal(response.body.valid, false)
  assert.equal(response.body.error, refusal)
  assert.equal(calls.comments.length + calls.activities.length + calls.runs.length + calls.idempotency.length, 0)
})

test('flag on still stores the same text when kind is qa', async () => {
  const { post, calls } = setup({ refuseUntyped: true })
  const response = await post({ kind: 'qa' })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(response.body.visibleToPeople, true)
  assert.equal(response.body.comment.kind, 'qa')
  assert.equal(calls.comments.length, 1)
  assert.equal(calls.comments[0].kind, 'qa')
  assert.equal(calls.activities.length, 0)
})

test('flag on leaves a human comment with no kind in the thread', async () => {
  const { post, calls } = setup({ refuseUntyped: true, human: true })
  const response = await post()
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'comments')
  assert.equal(calls.comments.length, 1)
  assert.equal(calls.activities.length, 0)
})

test('flag off still stores an untyped agent note in the log', async () => {
  const { post, calls } = setup()
  const response = await post()
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(calls.comments.length, 0)
  assert.equal(calls.activities.length, 1)
})

function aiTool({ audienceOn, actingAgentId }) {
  const writes = []
  const { createAddCommentTool } = load('src/lib/ai/tools/addComment.ts', {
    ai: { tool: (definition) => definition },
    '@/lib/flags': { isFeatureEnabled: async (key) => audienceOn && key === 'htpr-9063-comment-audience' },
    '@/lib/prisma': { default: {
      task: { findUnique: async ({ where }) => ({ id: where.id, title: 'Task', projectId: 15, uniqueIndex: 9063, userId: 6 }) },
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
    '@/lib/mcp/boards/links': { buildMcpTaskUrl: () => 'https://app.hypertask.ai/detail/project-15/9063' },
  })
  const tool = createAddCommentTool({
    user: { id: 6 },
    actingAgentId,
    confirmationSessionId: 'chat-9063',
    bulkPreviewsIssued: new Set(),
    sendStatus() {},
    body: {},
    inlineAgentImagesEnabled: false,
  }).hypertask_add_comment
  return { writes, run: (input) => tool.execute(tool.inputSchema.parse(input)) }
}

test('the AI comment tool refuses an agent comment with no kind and still posts qa', async () => {
  const refused = aiTool({ audienceOn: true, actingAgentId: 'agent-1' })
  const missing = await refused.run({ task_id: 99, text: 'Status for the team' })
  assert.equal(missing.success, false)
  assert.equal(missing.error, refusal)
  assert.equal(refused.writes.length, 0)
  const posted = await refused.run({ task_id: 99, text: 'QA passed.', kind: 'qa' })
  assert.equal(posted.success, true)
  assert.equal(refused.writes.length, 1)
  assert.equal(refused.writes[0].kind, 'qa')
})

test('the AI comment tool still posts when the audience flag is off', async () => {
  const off = aiTool({ audienceOn: false, actingAgentId: 'agent-1' })
  const posted = await off.run({ task_id: 99, text: 'Status for the team' })
  assert.equal(posted.success, true)
  assert.equal(off.writes.length, 1)
  assert.equal(off.writes[0].kind, undefined)
})

test('the pages comment route refuses an agent comment with no kind and still posts qa', async () => {
  let writes = 0
  const route = load('src/pages/api/comments/create.ts', {
    '@/lib/auth/agentScope': { withAgentScopeRequest: (_request, run) => run(), prepareAgentScope: async () => {} },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 6 }) },
    '@/lib/prisma': { default: { user: { findUnique: async () => ({ id: 6 }) } } },
    '@/lib/flags': { isFeatureEnabled: async (key) => key === 'htpr-9063-comment-audience' },
    '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => { writes++; return { id: 42 } } },
    '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
  }).default
  const response = { statusCode: 200, status(value) { this.statusCode = value; return this }, json(body) { this.body = body; return this } }
  await route({ method: 'POST', headers: {}, body: { text: 'Status for the team', creatorId: 6, ownerId: 6, taskId: 99, agentId: 'agent-1' } }, response)
  assert.equal(response.statusCode, 400)
  assert.equal(response.body.field, 'kind')
  assert.equal(response.body.code, 'missing_field')
  assert.equal(response.body.message, refusal)
  assert.equal(writes, 0)
  const posted = { statusCode: 200, status(value) { this.statusCode = value; return this }, json(body) { this.body = body; return this } }
  await route({ method: 'POST', headers: {}, body: { text: 'QA passed.', creatorId: 6, ownerId: 6, taskId: 99, agentId: 'agent-1', kind: 'qa' } }, posted)
  assert.equal(posted.statusCode, 200)
  assert.equal(writes, 1)
})
