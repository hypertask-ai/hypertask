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

function loadRoute(comments, listQuery = null) {
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
    ...require("./helpers/stub-map.cjs").waitingActivityStubs,
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
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: "agent-1", teamScope: null }),
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
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (html) => html },
    "@/utils/helperFunctions/multiPages": { extractTipTapContent: () => "" },
    "@/lib/mcp/normalizeBlockHtml": { normalizeBlockHtml: (html) => html },
    "@/lib/mcp/comments/contentPresence": require("./task-route-loader.cjs").load("src/lib/mcp/comments/contentPresence.ts", {}),
    "@/utils/helperFunctions/markdownToHtml": { formatRichTextInput: (text) => text },
    "@/lib/mcp/fieldError": { buildFieldError: () => ({}) },
    "@/lib/mcp/tasks/validators": { CONTENT_TYPE_ALLOWED_VALUES: [] },
    "@/lib/mcp/comments/activityMetadata": { withActivityMetadata: (comment) => comment },
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
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/flags/keys": {},
    "@/lib/mcp/listQuery": require("./task-route-loader.cjs").load("src/lib/mcp/listQuery.ts", {}),
    "@/lib/mcp/readListQuery": { readListQuery: () => ({ listQuery }) },
  };
  const loaded = new Module(routePath);
  loaded.filename = routePath;
  stubs["./agentChatterRouting"] = require("./task-route-loader.cjs").load(
    "src/lib/mcp/operations/comments/agentChatterRouting.ts",
    {},
  );
  stubs["@/lib/agents/writing"] = require("./task-route-loader.cjs").load("src/lib/agents/writing.ts", {});
  stubs["@/lib/agents/writingEnforcement"] = require("./helpers/stub-map.cjs").enforcementFor(
    stubs["@/lib/agents/writing"],
  );
  loaded.require = (request) =>
    request === "@/lib/mcp/routeWrapper"
      ? require("./helpers/mcp-route-wrapper.cjs").loadRouteWrapper(stubs)
      : stubs[request] ?? require(request);
  stubs["@/lib/mcp/comments/visibleReactionAgents"] =
    require("./helpers/visible-reaction-agents.cjs").loadVisibleReactionAgentsModule(loaded.require);
  loaded._compile(javascript, routePath);
  return { GET: loaded.exports.GET, getQuery: () => commentFindManyQuery };
}

const createdAt = new Date("2026-11-03T07:00:00.000Z");

function commentFixture(overrides) {
  return {
    id: 1,
    text: "Comment",
    commentText: "Comment",
    createdAt,
    creatorId: 6,
    creator: { id: 6, email: "person@example.com", displayName: "A Person" },
    agentId: null,
    agentDisplayName: null,
    agent: null,
    kind: null,
    attachments: [],
    reactions: [],
    ...overrides,
  };
}

test("HTPR-8352: comment list names the kind of every comment, so a Question is not answered as a QA note", async () => {
  const route = loadRoute([
    commentFixture({ id: 1, kind: "question", text: "Question", commentText: "Question" }),
    commentFixture({ id: 2, kind: "qa", text: "QA verdict", commentText: "QA verdict" }),
    commentFixture({ id: 3, kind: "done", text: "Done", commentText: "Done" }),
    commentFixture({ id: 4, kind: null, text: "Agent log line", commentText: "Agent log line" }),
  ]);

  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ task_id: "100" }) },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.comments.map((comment) => comment.kind),
    ["question", "qa", "done", null],
  );
  for (const comment of response.body.comments) {
    assert.ok(Object.hasOwn(comment, "kind"), `comment ${comment.id} carries no kind key`);
  }
});

test("a comment with no stored kind still answers with an explicit null", async () => {
  const route = loadRoute([commentFixture({ id: 9, kind: undefined })]);

  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ task_id: "100" }) },
  });

  assert.equal(response.body.comments[0].kind, null);
  assert.ok(Object.hasOwn(response.body.comments[0], "kind"));
});

test("an agent can ask for fields=kind without a 400", async () => {
  const route = loadRoute(
    [commentFixture({ id: 5, kind: "question" })],
    { fields: ["kind"], filter: {} },
  );

  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ task_id: "100" }) },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.comments, [{ kind: "question" }]);
});

test("a field Hypertask does not serve is still refused", async () => {
  const route = loadRoute([], { fields: ["kindred"], filter: {} });

  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ task_id: "100" }) },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /not known: kindred/);
  assert.match(response.body.message, /kind/);
});
