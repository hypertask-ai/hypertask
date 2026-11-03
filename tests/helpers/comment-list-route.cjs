const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "../..");
const routePath = path.join(root, "src/lib/mcp/operations/comments/operation.ts");

const {
  mcpVisibleAgentSelect,
  mapVisibleMcpAgent,
  transpile,
} = require(path.join(root, "tests/helpers/load-mcp-agents.cjs"));

function loadRoute(comments) {
  const javascript = transpile(routePath);

  let commentFindManyQuery;
  const prisma = {
    comment: {
      count: async () => comments.length,
      findMany: async (query) => {
        commentFindManyQuery = query;
        return comments;
      },
    },
  };
  const stubs = {
    "@/lib/mcp/skills/context": require("./mcp-skill-context.cjs"),
    "@/utils/controllers/projects/getAllIncludes": {},
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/planLimits": { isPlanLimitReachedError: () => false, planLimitResponse: () => ({ status: 402, body: {} }) },
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200 }),
      },
    },
    "@prisma/client": { Prisma: { DbNull: Symbol("DbNull") } },
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: null, teamScope: null }),
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/mcp/agents": { mcpVisibleAgentSelect, mapVisibleMcpAgent },
    "@/lib/agents/publicAgent": require("../task-route-loader.cjs").load("src/lib/agents/publicAgent.ts", {}),
    "@/utils/controllers/urls/extractUrlsFromContent": {
      buildMcpImageUrls: () => [],
      persistUrlsForComment: async () => {},
    },
    "@/utils/controllers/comments/processMentions": {
      convertPlainTextMentionsToHtml: (text) => text,
      resolveTextMentions: async () => [],
    },
    "@/utils/controllers/comments/createCommentService": {
      createCommentService: async () => ({}),
    },
    "@/utils/controllers/comments/agentInvocationCorrelation": {
      AgentInvocationNotPendingError: class extends Error {},
    },
    "@/lib/mcp/tasks/resolveTask": {
      findTaskByIdentifier: async () => ({ id: 100, projectId: 15 }),
      validateTaskIdentifier: () => ({ valid: true }),
    },
    "@/lib/mcp/tasks/services": { validateProjectMemberIds: async () => [] },
    "@/lib/realtime/server": { broadcastTaskComment: async () => {} },
    "@/utils/helperFunctions/sanitizeRichHtml": {
      sanitizeRichHtml: (html) => html,
    },
    "@/utils/helperFunctions/multiPages": {
      extractTipTapContent: () => "",
    },
    "@/lib/mcp/normalizeBlockHtml": { normalizeBlockHtml: (html) => html },
    "@/utils/helperFunctions/markdownToHtml": {
      formatRichTextInput: (text) => text,
    },
    "@/lib/mcp/fieldError": { buildFieldError: () => ({}) },
    "@/lib/mcp/tasks/validators": { CONTENT_TYPE_ALLOWED_VALUES: [] },
    "@/lib/mcp/comments/activityMetadata": require('../task-route-loader.cjs').load('src/lib/mcp/comments/activityMetadata.ts', {}),
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/idempotency/idempotencyStore": {
      IdempotencyAccessError: class extends Error {},
      normalizeIdempotencyKey: () => null,
      withIdempotency: async (_key, fn) => fn(),
      IdempotencyInProgressError: class extends Error {},
    },
    "@/lib/mcp/readJsonBody": { readJsonBody: async () => ({ ok: true, body: {} }) },
    "@/lib/mcp/boards/links": { buildMcpTaskUrl: () => "" },
    "@/lib/mcp/comments/reactionResponse": {
      commentReactionInclude: {},
      mapMcpCommentReaction: (r) => r,
      reactionAgentIds: () => [],
    },
    "@/lib/flags": {

      isFeatureEnabled: async () => false,
    },
    "@/lib/flags/keys": {

    },
    "@/lib/mcp/listQuery": require('../task-route-loader.cjs').load('src/lib/mcp/listQuery.ts', {}),
    "@/lib/mcp/readListQuery": require('../task-route-loader.cjs').load('src/lib/mcp/readListQuery.ts', {}),
  };
  const loaded = new Module(routePath);
  loaded.filename = routePath;
  stubs['@/lib/agents/writing'] = require('../task-route-loader.cjs').load('src/lib/agents/writing.ts', {})
  stubs['@/lib/agents/writingEnforcement'] = require('./stub-map.cjs').enforcementFor(stubs['@/lib/agents/writing'])
  stubs['./agentChatterRouting'] = require('../task-route-loader.cjs').load('src/lib/mcp/operations/comments/agentChatterRouting.ts', {})
  loaded.require = (request) => request === "@/lib/mcp/routeWrapper"
      ? require("./mcp-route-wrapper.cjs").loadRouteWrapper(stubs)
      : stubs[request] ?? require(request);
  stubs["@/lib/mcp/comments/visibleReactionAgents"] =
    require("./visible-reaction-agents.cjs").loadVisibleReactionAgentsModule(loaded.require);
  loaded._compile(javascript, routePath);
  return {
    get: (params) => loaded.exports.GET({ nextUrl: { searchParams: new URLSearchParams(params) } }),
    getQuery: () => commentFindManyQuery,
  };
}

const createdAt = new Date("2026-09-07T00:00:00.000Z");

function commentFixture(overrides) {
  return {
    id: 1,
    text: "Comment",
    commentText: "Comment",
    createdAt,
    creatorId: null,
    creator: null,
    agentDisplayName: null,
    agent: null,
    attachments: [],
    reactions: [],
    ...overrides,
  };
}

module.exports = { loadRoute, commentFixture };
