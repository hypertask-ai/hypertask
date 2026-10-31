const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
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
    "@/lib/mcp/skills/context": require("./helpers/mcp-skill-context.cjs"),
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
    "@/lib/agents/publicAgent": require("./task-route-loader.cjs").load("src/lib/agents/publicAgent.ts", {}),
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
    "@/lib/mcp/comments/activityMetadata": {
      withActivityMetadata: (comment) => comment,
    },
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
    "@/lib/mcp/listQuery": {
      parseNumericCursor: () => null,
      parseUpdatedSince: () => null,
      projectRows: (rows) => rows,
    },
    "@/lib/mcp/readListQuery": {
      readListQuery: () => ({ listQuery: null }),
    },
  };
  const loaded = new Module(routePath);
  loaded.filename = routePath;
  stubs['@/lib/agents/writing'] = require('./task-route-loader.cjs').load('src/lib/agents/writing.ts', {})
  stubs['@/lib/agents/writingEnforcement'] = require('./helpers/stub-map.cjs').enforcementFor(stubs['@/lib/agents/writing'])
  stubs['./agentChatterRouting'] = require('./task-route-loader.cjs').load('src/lib/mcp/operations/comments/agentChatterRouting.ts', {})
  loaded.require = (request) => request === "@/lib/mcp/routeWrapper"
      ? require("./helpers/mcp-route-wrapper.cjs").loadRouteWrapper(stubs)
      : stubs[request] ?? require(request);
  stubs["@/lib/mcp/comments/visibleReactionAgents"] =
    require("./helpers/visible-reaction-agents.cjs").loadVisibleReactionAgentsModule(loaded.require);
  loaded._compile(javascript, routePath);
  return { GET: loaded.exports.GET, getQuery: () => commentFindManyQuery };
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

test("comments GET keeps a same-team agent visible but hides a different team's agent", async () => {
  const outsiderAgent = {
    id: "outsider-agent",
    displayName: "Outsider Team Agent",
    photoURL: null,
    userId: 42,
    visibility: "TEAM",
    members: [],
  };
  const insiderAgent = {
    id: "insider-agent",
    displayName: "Insider Team Agent",
    photoURL: null,
    userId: 6,
    visibility: "TEAM",
    members: [{ projectId: 15 }],
  };

  const route = loadRoute([
    commentFixture({
      id: 1,
      agentDisplayName: "Outsider Team Agent",
      agent: outsiderAgent,
    }),
    commentFixture({ id: 3, agentDisplayName: "Deleted Team Agent" }),
    commentFixture({
      id: 2,
      agentDisplayName: "Insider Team Agent",
      agent: insiderAgent,
    }),
  ]);

  const response = await route.GET({
    nextUrl: {
      searchParams: new URLSearchParams({ task_id: "100" }),
    },
  });

  assert.equal(response.status, 200);
  const [outsiderComment, deletedComment, insiderComment] = response.body.comments;

  assert.equal(outsiderComment.agent, undefined);
  assert.equal(outsiderComment.agent_display_name, "Private agent");

  assert.equal(deletedComment.agent_display_name, "Deleted Team Agent");
  assert.equal(deletedComment.agent, undefined);

  assert.equal(insiderComment.agent?.id, "insider-agent");
  assert.equal(insiderComment.agent_display_name, "Insider Team Agent");

  assert.equal(route.getQuery().include.agent.select.members.where.project.id, 15);
});
