const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const repeatFlag = 'htpr-8894-feedback-repeat-activity'
const boardNumberFlag = 'htpr-8777-activity-board-number'

const reports = [
  { id: 90438, projectId: 15, uniqueIndex: 8894, ticketNumber: 'HTPR-8894', status: 'Normal', accessible: true, feedback: true },
  { id: 89173, projectId: 15, uniqueIndex: 8803, ticketNumber: 'HTPR-8803', status: 'Normal', accessible: true, feedback: true },
  { id: 88985, projectId: 15, uniqueIndex: 8782, ticketNumber: 'HTPR-8782', status: 'Normal', accessible: true, feedback: true },
  { id: 89199, projectId: 15, uniqueIndex: 8809, ticketNumber: 'HTPR-8809', status: 'Normal', accessible: true, feedback: true },
  { id: 42, projectId: 15, uniqueIndex: 100, ticketNumber: 'HTPR-100', status: 'Normal', accessible: true, feedback: false },
]

function matches(task, where) {
  if (!where) return true
  if (where.OR) return where.OR.some((part) => matches(task, { ...where, OR: undefined, ...part }))
  if (where.id != null && task.id !== where.id) return false
  if (where.projectId != null && task.projectId !== where.projectId) return false
  if (where.uniqueIndex != null && task.uniqueIndex !== where.uniqueIndex) return false
  if (where.ticketNumber?.equals && task.ticketNumber.toLowerCase() !== String(where.ticketNumber.equals).toLowerCase()) return false
  if (where.status?.not && task.status === where.status.not) return false
  if (where.project && task.accessible === false) return false
  return true
}

function activityFixture({ enabled = true } = {}) {
  const runs = []
  const db = {
    task: {
      findFirst: async ({ where }) => {
        if (where?.project?.members) return null
        if (Array.isArray(where?.OR)) {
          const report = reports.find((row) => row.id === where.id && row.feedback)
          return report ? { id: report.id, projectId: report.projectId } : null
        }
        const report = reports.find((row) => matches(row, where))
        return report ? { id: report.id, projectId: report.projectId } : null
      },
      findMany: async ({ where, take }) => reports.filter((row) => matches(row, where)).slice(0, take ?? reports.length).map((row) => ({ id: row.id, projectId: row.projectId })),
    },
    taskNumberAlias: { findMany: async () => [] },
    agentRun: {
      createMany: async ({ data }) => {
        runs.push(data[0])
        return { count: 1 }
      },
      updateMany: async () => ({ count: 0 }),
      findFirst: async ({ where }) => {
        const run = runs.find((row) => row.agentId === where.agentId && row.taskId === where.taskId)
        return run ? { ...run, chatSessionId: null, trigger: 'RUNTIME', status: 'ACTIVE', stoppedById: null } : null
      },
    },
    $transaction: async (run) => run(db),
  }
  const principal = {
    userId: 6,
    agentId: 'runner-3',
    displayName: 'Runner 3',
    source: 'agent',
    teamScope: null,
  }
  const mocks = {
    '@/lib/flags': {
      HTPR_6868_TICKET_PREFIX_FLAG: 'htpr-6868-ticket-prefix',
      isFeatureEnabled: async (key) => enabled && (key === repeatFlag || key === boardNumberFlag),
    },
    '@/lib/prisma': { default: db, Prisma: {} },
    '@prisma/client': { Status: { Deleted: 'Deleted' }, Prisma: {} },
    '@/lib/auth/agentScope': { recordAgentBoardScopeMiss: () => {}, agentScopeEnforced: () => false },
    '@/utils/controllers/projects/getAllIncludes': {
      getProjectWhere: () => ({ readable: true }),
      projectContentAccessWhere: () => ({ readable: true }),
      intersectProjectTeamScope: (access) => access,
      taskWriteAccessWhere: () => ({ readable: true }),
    },
    '@/utils/controllers/projects/findPrefixAliasTasks': { findPrefixAliasTasks: async () => [] },
    '@/lib/mcp/auth': { checkMcpRateLimit: async () => null, validateMcpAuth: async () => null },
    '@/lib/mcp/agents/delete': { handleDeleteAgentRequest: async () => null },
    '@/lib/mcp/agents/get': { handleGetAgentRequest: async () => null },
    '@/lib/mcp/agents/lifecycleRequests': { handlePatchAgentRequest: async () => null },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (run) => run },
    '@/lib/mcp/tasks/agentMutationFence': { TaskTeamScopeError: class TaskTeamScopeError extends Error {}, lockTaskTeamScope: async () => {} },
    '@/lib/realtime/server': {
      AGENT_CHAT_EVENT: 'agent-chat',
      broadcast: () => Promise.resolve(),
      broadcastTaskComment: async () => {},
      userChannel: () => 'user',
    },
    '@/lib/agentStatus/boardRefresh': { refreshBoardForAgentRun: async () => {} },
    '@/lib/agentRuns/service': {
      authenticateAgentRunRequest: async () => principal,
    },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  }
  const service = load('src/lib/agentRuns/service.ts', mocks)
  mocks['@/lib/agentRuns/service'] = {
    authenticateAgentRunRequest: async () => principal,
    createRuntimeAgentRun: service.createRuntimeAgentRun,
  }
  const route = load('src/lib/mcp/operations/agents/[agentId]/operation.ts', mocks)
  const post = (body) => route.POST(
    { json: async () => body },
    { params: Promise.resolve({ agentId: 'runs' }) },
  )
  return { post, runs, createRuntimeAgentRun: service.createRuntimeAgentRun, principal }
}

function feedbackFixture({ repeat = true } = {}) {
  const created = []
  const comments = []
  const rows = []
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async () => ({ displayName: 'Valentin Yeo', id: 6, email: 'valentin.yeo@gmail.com' }) },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => {
      const marker = where.description_?.is?.content?.contains
      if (!marker) return null
      return rows.find((row) => row.section !== 'Done' && row.description.includes(marker)) ?? null
    } },
    comment: {
      findFirst: async ({ where }) => {
        if (!where.task) return comments.find((comment) => comment.taskId === where.taskId && comment.text.includes(where.text.contains)) ?? null
        const comment = comments.find((comment) => comment.text.includes(where.text.contains))
        const task = comment && rows.find((row) => row.id === comment.taskId && row.section !== 'Done')
        return task ? { task } : null
      },
      update: async ({ where, data }) => Object.assign(comments.find((comment) => comment.id === where.id), data),
    },
    $queryRaw: async () => [{ locked: true }],
    $transaction: async (run) => run(db),
  }
  const mod = load('src/lib/aiFeedback/report.ts', {
    '@/lib/prisma': { __esModule: true, default: db },
    '@/lib/flags': {
      isFeatureEnabled: async (key) => repeat && key === repeatFlag,
      featureFlagCandidateUserIds: async () => [],
    },
    '@/lib/telemetry/accountCategory': { accountCategory: () => 'customer' },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async (options) => {
      const task = { ...options, id: created.length + 1, ticketNumber: `HTPR-${8800 + created.length}`, uniqueIndex: 8800 + created.length }
      created.push(task)
      rows.push(task)
      return { task }
    } },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async (options) => {
      const comment = { ...options, id: comments.length + 1 }
      comments.push(comment)
      return comment
    } },
    '@/lib/realtime/server': { broadcastTaskChange: async () => {} },
    './rateLimit': { reserveFeedbackAttempt: async () => true, reserveFeedbackQuota: async () => true },
  })
  return { ...mod, created, comments }
}

test('the flag is a bug fix on for everyone', () => {
  const definition = load(`src/lib/flags/definitions/${repeatFlag}.ts`).default
  assert.equal(definition.key, repeatFlag)
  assert.equal(definition.kind, 'bugfix')
  assert.equal(definition.defaultMode, 'EVERYONE')
})

test('HTPR-8894 repeat activity on the linked feedback ticket is not task not found', async () => {
  const f = activityFixture()
  const response = await f.post({ taskId: 8894, projectId: 15, source: 'runtime' })
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.run.taskId, 90438)
  assert.equal(body.error, undefined)
})

test('HTPR-8803 a readable feedback duplicate accepts activity from an agent who is not a board member', async () => {
  const f = activityFixture()
  const response = await f.post({ taskId: 89173, projectId: 15, source: 'runtime' })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).run.taskId, 89173)
  assert.equal(f.runs[0].taskId, 89173)
})

test('HTPR-8782 the board number in the feedback link reaches that ticket', async () => {
  const f = activityFixture()
  const response = await f.post({ taskId: 8782, source: 'runtime' })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).run.taskId, 88985)
})

test('HTPR-8809 follow-up agent log evidence does not require board membership', async () => {
  const f = activityFixture()
  const calls = { activities: [] }
  const user = { id: 6, displayName: 'Valentin Yeo' }
  const { POST } = load('src/lib/mcp/operations/comments/operation.ts', {
    '@/lib/agents/writing': { AgentWritingError: class AgentWritingError extends Error {} },
    '@/lib/agents/writingEnforcement': { agentWritingPolicyEnabled: async () => true, enforceAgentWriting: async () => {} },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({ readable: true }) },
    '@/lib/media/inlineAgentImages.server': { inlineAgentImagesForUser: async (html) => html },
    '@/lib/flags/keys': {
      HTPR_7341_AGENT_CHATTER_TO_LOG_FLAG: 'htpr-7341-agent-chatter-to-log',
      HTPR_7512_ATTACH_KEEPS_COMMENT_FLAG: 'htpr-7512-attach-keeps-comment',
      HTPR_7514_INLINE_AGENT_IMAGES_FLAG: 'htpr-7514-inline-agent-images',
      HTPR_8268_MENTION_BY_NAME_FLAG: 'htpr-8268-mention-by-name',
      HTPR_8344_LOG_POST_STATUS_FLAG: 'htpr-8344-log-post-status',
      HTPR_8513_AGENT_MENTIONS_FLAG: 'htpr-8513-agent-mentions',
      HTPR_8811_AGENT_NOTE_IMAGE_LINKS_FLAG: 'htpr-8811-agent-note-image-links',
    },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user, agentId: 'runner-g', teamScope: null }),
      mcpRouteUnauthorizedResponse: async () => ({ status: 401 }),
      readMcpRouteJsonBody: async (request) => ({ ok: true, body: request.body }),
    },
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    '@prisma/client': { Prisma: { DbNull: null }, Status: { Deleted: 'Deleted' } },
    '@/lib/prisma': { default: {
      task: { findUnique: async () => ({ userId: 6, projectId: 15, uniqueIndex: 8809 }) },
      user: { findUnique: async () => user },
      comment: { findUnique: async () => null },
      member: { findFirst: async () => null },
    } },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null, mcpVisibleAgentSelect: () => ({}) },
    '@/utils/controllers/urls/extractUrlsFromContent': { buildMcpImageUrls: () => [], persistUrlsForComment: async () => {} },
    '@/utils/controllers/comments/processMentions': { convertPlainTextMentionsToHtml: (text) => text, resolveTextMentions: async (text) => text },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => { throw new Error('people comment') } },
    '@/utils/controllers/comments/agentInvocationCorrelation': { AgentInvocationNotPendingError: class extends Error {} },
    '@/lib/mcp/tasks/resolveTask': {
      taskIdentifierErrorResponse: () => null,
      validateTaskIdentifier: () => ({ valid: true }),
      findTaskByIdentifier: async () => ({ id: 89199, projectId: 15 }),
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
    '@/lib/mcp/boards/links': { buildMcpTaskUrl: () => 'https://app.hypertask.ai/detail/project-15/8809' },
    '@/lib/mcp/comments/reactionResponse': {},
    '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
    '@/lib/agents/publicAgent': {},
    '@/lib/flags': { isFeatureEnabled: async (key) => key === 'yper4-910-agent-writing' || key === repeatFlag },
    '@/lib/mcp/listQuery': load('src/lib/mcp/listQuery.ts', {}),
    '@/lib/mcp/readListQuery': {},
    '@/lib/agentRuns/service': {
      createRuntimeAgentRun: (principal, input) => f.createRuntimeAgentRun(
        { ...principal, userId: 6, agentId: 'runner-g' },
        { ...input, taskId: 89199 },
      ),
      createAgentRunActivity: async (_principal, runId, input) => {
        calls.activities.push({ runId, text: input.text })
        return { activity: { id: 'activity-1', runId, type: 'thought', text: input.text, createdAt: '2026-11-07T00:00:00.000Z' } }
      },
    },
  })
  const response = await POST({ body: { task_id: 8809, project_id: 15, text: '<p>Repeat feedback evidence</p>' }, headers: new Headers() })
  assert.equal(response.status, 201)
  assert.equal(response.body.routedTo, 'log')
  assert.equal(response.body.code, undefined)
  assert.equal(calls.activities.length, 1)
  assert.match(calls.activities[0].text, /Repeat feedback evidence/)
})

test('a ticket that is not feedback still says task not found', async () => {
  const f = activityFixture()
  const response = await f.post({ taskId: 42, projectId: 15, source: 'runtime' })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'Task not found')
  assert.equal(f.runs.length, 0)
})

test('a board number that is not a feedback report is not opened', async () => {
  const f = activityFixture()
  const response = await f.post({ taskId: 100, source: 'runtime' })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'Task not found')
})

test('flag off keeps the membership refusal and the raw tool name', async () => {
  const activity = activityFixture({ enabled: false })
  const missed = await activity.post({ taskId: 8894, projectId: 15, source: 'runtime' })
  assert.equal(missed.status, 404)
  const filing = feedbackFixture({ repeat: false })
  await assert.rejects(
    filing.fileAiFeedback({ surface: 'cli', tool: 'hypertask feedback', category: 'other' }, 6, { origin: 'agent' }),
    (error) => error.status === 400 && /tool/.test(error.message),
  )
})

test('HTPR-8819 a multiword command is stored as a slug and the repeat joins that ticket', async () => {
  const { feedbackToolSlug, aiFeedbackSchema } = load('src/lib/aiFeedback/input.ts')
  const { reportFeedbackTool } = load('src/lib/mcp-server/tools/report-feedback.tool.ts', {
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/mcp/auth': { validateMcpAuth: async () => null },
    '@/lib/mcp/operationContext': { getMcpExecutionContext: () => null },
    '@/lib/aiFeedback/clientInfo': { getFeedbackClient: async () => undefined },
    '../config/tool-metadata': { TOOL_METADATA: { REPORT_FEEDBACK: { name: 'hypertask_report_feedback', description: '' } } },
    '../config/tool-annotations': { TOOL_ANNOTATIONS: { hypertask_report_feedback: {} } },
  })
  assert.equal(feedbackToolSlug('activity.add'), 'activity.add')
  assert.equal(feedbackToolSlug('comment.add'), 'comment.add')
  assert.equal(feedbackToolSlug('agent-feedback'), 'agent-feedback')
  assert.equal(feedbackToolSlug('hypertask feedback'), 'hypertask-feedback')
  assert.equal(feedbackToolSlug('task get'), 'task-get')
  assert.equal(feedbackToolSlug('<script>'), undefined)
  assert.equal(aiFeedbackSchema.safeParse({ surface: 'cli', tool: 'activity.add' }).success, true)
  assert.equal(aiFeedbackSchema.safeParse({ surface: 'cli', tool: 'hypertask feedback' }).success, false)
  assert.equal(reportFeedbackTool.parameters.safeParse({ tool: 'hypertask feedback' }).success, true)

  const filing = feedbackFixture()
  const first = await filing.fileAiFeedback({
    surface: 'cli', tool: 'hypertask feedback', category: 'other', kind: 'friction',
  }, 6, { origin: 'agent' })
  assert.equal(first.deduped, false)
  assert.match(filing.created[0].description, /Tool: hypertask-feedback/)
  const again = await filing.fileAiFeedback({
    surface: 'cli', tool: 'hypertask-feedback', category: 'other', kind: 'friction',
  }, 6, { origin: 'agent' })
  assert.equal(again.deduped, true)
  assert.equal(again.ticketNumber, first.ticketNumber)
  assert.equal(filing.created.length, 1)

  const spaced = await filing.fileAiFeedback({
    surface: 'cli', tool: 'task get', status: 404, errorCode: 'feedback_bump_not_found', category: 'call_failed',
  }, 6, { origin: 'agent' })
  const slugged = await filing.fileAiFeedback({
    surface: 'cli', tool: 'task-get', status: 404, errorCode: 'feedback-bump-not-found', category: 'call_failed',
  }, 6, { origin: 'agent' })
  assert.equal(spaced.deduped, false)
  assert.notEqual(slugged.ticketNumber, spaced.ticketNumber)
  assert.match(filing.created.map((task) => task.description).join('\n'), /Tool: task-get/)
})
