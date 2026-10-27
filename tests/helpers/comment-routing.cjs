const { load } = require('../task-route-loader.cjs')

function setup(options = {}) {
  const calls = { comments: [], runs: [], activities: [], broadcasts: [], urls: [], flags: [], idempotency: [] }
  const user = { id: 6, displayName: 'Owner' }
  const ctx = { user, agentId: options.human ? null : 'agent-1', teamScope: null }
  const cache = new Map()
  const stubs = {
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ctx,
      mcpRouteUnauthorizedResponse: async () => ({ status: 401 }),
      readMcpRouteJsonBody: async (request) => ({ ok: true, body: request.body }),
    },
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    '@prisma/client': { Prisma: { DbNull: null } },
    '@/lib/prisma': { default: {
      task: { findUnique: async () => ({ userId: 6, projectId: 15, uniqueIndex: 7341 }) },
      user: { findUnique: async () => user },
      comment: { findUnique: async () => null },
    } },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null, mcpVisibleAgentSelect: () => ({}) },
    '@/utils/controllers/urls/extractUrlsFromContent': {
      buildMcpImageUrls: () => [],
      persistUrlsForComment: async (...args) => calls.urls.push(args),
    },
    '@/utils/controllers/comments/processMentions': {
      convertPlainTextMentionsToHtml: (text) => text,
      resolveTextMentions: async (text) => text,
    },
    '@/utils/controllers/comments/createCommentService': {
      createCommentService: async (params) => {
        calls.comments.push(params)
        return { id: 42, text: params.text, kind: params.kind ?? null, createdAt: new Date('2026-10-19T12:00:00Z') }
      },
    },
    '@/utils/controllers/comments/agentInvocationCorrelation': { AgentInvocationNotPendingError: class extends Error {} },
    '@/lib/mcp/tasks/resolveTask': {
      validateTaskIdentifier: () => ({ valid: true }),
      findTaskByIdentifier: async () => options.noTask ? null : ({ id: 99, projectId: 15 }),
    },
    '@/lib/mcp/tasks/services': { validateProjectMemberIds: async () => ({ invalidIds: [] }) },
    '@/lib/realtime/server': { broadcastTaskComment: async (...args) => calls.broadcasts.push(args) },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (text) => text },
    '@/utils/helperFunctions/multiPages': { extractTipTapContent: () => ({ mentions: options.textMentions ?? [] }) },
    '@/lib/mcp/normalizeBlockHtml': { normalizeBlockHtml: (text) => text },
    '@/utils/helperFunctions/markdownToHtml': { formatRichTextInput: (text) => options.formattedText ?? text },
    '@/lib/mcp/tasks/validators': { CONTENT_TYPE_ALLOWED_VALUES: ['html', 'markdown'] },
    '@/lib/mcp/comments/activityMetadata': {},
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/idempotency/idempotencyStore': {
      IdempotencyAccessError: class extends Error {},
      IdempotencyInProgressError: class extends Error {},
      normalizeIdempotencyKey: (key) => key,
      withIdempotency: async (operation, userId, key, body, handler) => {
        calls.idempotency.push({ operation, userId, key, body })
        if (key && cache.has(key)) return { ...cache.get(key), idempotent_replayed: true }
        const result = await handler()
        if (key) cache.set(key, result)
        return result
      },
    },
    '@/lib/mcp/boards/links': { buildMcpTaskUrl: () => 'https://app.hypertask.ai/detail/project-15/7341' },
    '@/lib/mcp/comments/reactionResponse': {},
    '@/lib/mcp/comments/visibleReactionAgents': { loadVisibleReactionAgents: async () => new Map() },
    '@/lib/agents/publicAgent': {},
    '@/lib/flags': { isFeatureEnabled: async (key, userId) => {
      calls.flags.push({ key, userId })
      return (key === 'htpr-7341-agent-chatter-to-log' && options.flag !== false) ||
        (key === 'htpr-7512-attach-keeps-comment' && options.attachFlag !== false) ||
        (key === 'htpr-7514-inline-agent-images' && options.inlineImages === true)
    } },
    '@/lib/mcp/listQuery': {},
    '@/lib/mcp/readListQuery': {},
    '@/lib/agentRuns/service': {
      runtimeAgentRunsEnabledFor: async () => options.runtime !== false,
      createRuntimeAgentRun: async (...args) => {
        calls.runs.push(args)
        return options.noRun ? null : { id: 'run-1' }
      },
      createAgentRunActivity: async (...args) => {
        calls.activities.push(args)
        return options.noActivity ? null : { activity: {
          id: 'activity-1', runId: args[1], type: args[2].type.toLowerCase(),
          text: args[2].text, createdAt: '2026-10-19T12:00:00.000Z',
        } }
      },
    },
  }
  const { POST } = load('src/lib/mcp/operations/comments/operation.ts', stubs)
  return {
    calls,
    post: (body = {}, key = null) => POST({ body: { task_id: 99, text: '<p>Progress &amp; next step</p>', ...body }, headers: new Headers(key ? { 'Idempotency-Key': key } : {}) }),
  }
}

module.exports = { setup }
