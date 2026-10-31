const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { load } = require('./task-route-loader.cjs')

const writing = load('src/lib/agents/writing.ts', {})
const long = 'One two three four five six seven eight nine ten eleven twelve thirteen.'

function fixture(content = '<p>Please check this.</p>') {
  const writes = []
  const user = { id: 7, email: 'user@example.invalid' }
  const ctx = { user, agentId: 'agent-1', teamScope: null }
  const draft = { id: 1, userId: 7, taskId: 42, type: 'Comment', content, task: { id: 42, projectId: 15, ticketNumber: 'TASK-1', project: { ownerId: 7, members: [] } } }
  const row = { id: 3, taskId: 42, question: 'Choose?', options: ['Yes', 'No'], status: 'Pending', answer: null, answerNote: null, createdAt: new Date(), answeredAt: null, commentId: null }
  const db = {
    task: { findUnique: async () => ({ userId: 7, title: 'Task', ticketNumber: 'TASK-1' }) },
    user: { findUnique: async () => user },
    drafts: { findUnique: async () => draft },
    decisionRequest: {
      create: async ({ data }) => { writes.push('decision'); return { ...row, ...data } },
      update: async ({ data }) => { writes.push('update'); return { ...row, ...data } },
    },
  }
  const mocks = {
    '@/lib/agents/writing': writing,
    '@/lib/prisma': { default: db },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (handler) => handler, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => ctx },
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/tasks/agentMutationFence': { TaskTeamScopeError: class extends Error {} },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ({}) },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/tasks/resolveTask': { validateTaskIdentifier: () => ({ valid: true }), findTaskByIdentifier: async () => ({ id: 42, projectId: 15 }), taskIdentifierErrorResponse: () => null },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async (input) => {
      if (input.agentId && !input.kind) throw new writing.AgentWritingError('kind', 'Untyped agent notes must use the agent log')
      writing.assertAgentWriting(input.agentId, { text: input.text })
      writes.push({ comment: input })
      return { id: 9 }
    } },
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForComment: async () => { writes.push('urls') } },
    '@/lib/auth/agentScope': { agentScopeEnforced: () => false, recordAgentBoardScopeMiss: () => {} },
    '@/utils/controllers/tasks/assertTaskAccess': { userCanAccessTask: async () => true },
    '@/lib/auth/session': {},
    '@/lib/auth/slimUserCookie': {},
  }
  const request = (body) => new NextRequest('http://localhost/api/mcp/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { mocks, writes, ctx, draft, request }
}

for (const [name, file, body, kind, status] of [
  ['decision', 'src/lib/mcp/operations/decisions/operation.ts', { task_id: 42, question: 'Choose?', options: ['Yes', 'No'] }, 'question', 201],
  ['escalation', 'src/app/api/mcp/tasks/escalate/route.ts', { task_id: 42, reason: 'Need help.' }, 'question', 201],
  ['draft', 'src/lib/mcp/operations/drafts/[draft_id]/publish/operation.ts', {}, 'qa', 200],
]) {
  for (const refused of [false, true]) {
    test(`${name}: ${refused ? 'long agent text refused before writes' : 'short agent text reaches people'}`, async () => {
      const f = fixture(refused ? `<p>${long}</p>` : undefined)
      const input = { ...body }
      if (refused && name === 'decision') input.options = ['Yes', long]
      if (refused && name === 'escalation') input.attempts_summary = long
      const { POST } = load(file, f.mocks)
      const response = await POST(f.request(input), { params: Promise.resolve({ draft_id: '1' }) })
      assert.equal(response.status, refused ? 400 : status)
      if (refused) {
        assert.equal((await response.json()).code, 'invalid_field')
        assert.deepEqual(f.writes, [])
      } else {
        assert.equal(f.writes.find((entry) => entry.comment).comment.kind, kind)
        if (name === 'decision') assert.deepEqual(f.writes.map((entry) => typeof entry === 'string' ? entry : 'comment'), ['decision', 'comment', 'update'])
      }
    })
  }
}

test('human draft publication stays untyped', async () => {
  const f = fixture()
  f.ctx.agentId = null
  const { POST } = load('src/lib/mcp/operations/drafts/[draft_id]/publish/operation.ts', f.mocks)
  const response = await POST(f.request({}), { params: Promise.resolve({ draft_id: '1' }) })
  assert.equal(response.status, 200)
  assert.equal(f.writes.find((entry) => entry.comment).comment.kind, undefined)
})

for (const refused of [false, true]) {
  test(`AI decision: ${refused ? 'long option refused before writes' : 'short request reaches people'}`, async () => {
    const f = fixture()
    Object.assign(f.mocks, {
      ai: { tool: (definition) => definition },
      '@/lib/ai/tools/constants': { TOOL_TASK_ID_DESCRIPTION: 'Task ID' },
      '@/lib/ai/tools/execution': { withToolErrors: (execute) => async (...args) => {
        try { return await execute(...args) } catch (error) { return { success: false, error: error.message } }
      } },
      '@/lib/ai/tools/helpers': { sanitizeForJson: (value) => value },
    })
    const { createDecisionRequestTool } = load('src/lib/ai/tools/decisionRequest.ts', f.mocks)
    const tool = createDecisionRequestTool({ user: f.ctx.user, actingAgentId: f.ctx.agentId, sendStatus() {} }).hypertask_decision_request
    const result = await tool.execute({ task_id: 42, question: 'Choose?', options: ['Yes', refused ? long : 'No'] })
    assert.equal(result.success, !refused)
    if (refused) assert.deepEqual(f.writes, [])
    else assert.equal(f.writes.find((entry) => entry.comment).comment.kind, 'question')
  })
}

for (const refused of [false, true]) {
  test(`AI draft: ${refused ? 'long text refused before writes' : 'short draft reaches people'}`, async () => {
    const f = fixture(refused ? `<p>${long}</p>` : undefined)
    Object.assign(f.mocks, {
      ai: { tool: (definition) => definition },
      './schemas': { inlineAgentImageFields: () => ({}) },
      '@/lib/ai/tools/constants': { TOOL_TASK_ID_DESCRIPTION: 'Task ID' },
      '@/lib/ai/chatStream/prompt': { COMMENT_TASK_LINK_RULE: '' },
      '@/lib/ai/tools/execution': { withToolErrors: (execute) => async (...args) => {
        try { return await execute(...args) } catch (error) { return { success: false, error: error.message } }
      } },
      '@/lib/ai/tools/helpers': { sanitizeForJson: (value) => value, findDraftWithAccess: async () => f.draft, userHasProjectAccess: () => true, validateMentionUserIds: async () => null },
      '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (text) => text },
      '@/utils/helperFunctions/toStoredHtml': {},
      '@/utils/controllers/comments/linkifyTicketRefs': { linkifyTicketRefs: async (text) => text },
      '@/utils/helperFunctions/multiPages/multipages.functions': { extractTipTapContent: () => ({ mentions: [] }) },
      '@/lib/realtime/server': { broadcastTaskComment: async () => {} },
      '@/utils/controllers/tasks/single': {},
    })
    const { createDraftTool } = load('src/lib/ai/tools/draft.ts', f.mocks)
    const tool = createDraftTool({ user: f.ctx.user, actingAgentId: f.ctx.agentId, sendStatus() {} }).hypertask_draft
    const result = await tool.execute({ action: 'publish', draft_id: 1 })
    assert.equal(result.success, !refused)
    if (refused) assert.deepEqual(f.writes, [])
    else assert.equal(f.writes.find((entry) => entry.comment).comment.kind, 'qa')
  })
}
