const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// HTPR-6080: /api/mcp/comments must only name an agent when it belongs to the
// task's own project, not merely to any project the requester can see. This
// loads the real route plus the real visibility helpers (only prisma/auth are
// stubbed), so two fixture users/projects stand in for a live second account.
const root = path.resolve(__dirname, "..");
const routePath = path.join(root, "src/app/api/mcp/comments/route.ts");

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
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200 }),
      },
    },
    "@prisma/client": { Prisma: { DbNull: Symbol("DbNull") } },
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: null }),
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/mcp/agents": { mcpVisibleAgentSelect, mapVisibleMcpAgent },
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
      // The requester (user 6, project 15) is asking about a task that lives
      // in their own project. That task's projectId is what must gate agent
      // attribution, not the requester's broader project access.
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
      normalizeIdempotencyKey: () => null,
      withIdempotency: async (_key, fn) => fn(),
      IdempotencyInProgressError: class extends Error {},
    },
    "@/lib/mcp/readJsonBody": { readJsonBody: async () => ({ ok: true, body: {} }) },
    "@/lib/mcp/boards/links": { buildMcpTaskUrl: () => "" },
    "@/lib/mcp/comments/reactionResponse": {
      commentReactionInclude: {},
      mapMcpCommentReaction: (r) => r,
    },
  };
  const loaded = new Module(routePath);
  loaded.filename = routePath;
  loaded.require = (request) => stubs[request] ?? require(request);
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
    userId: 42, // owned by a different user entirely
    visibility: "TEAM",
    // Real DB rows scope `members` to the query's `where` (project 15, see
    // assertion below), so an agent whose only membership is project 77
    // comes back with an empty array here, exactly like production.
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
  const [outsiderComment, insiderComment] = response.body.comments;

  assert.equal(outsiderComment.agent, undefined);
  assert.equal(outsiderComment.agent_display_name, "Private agent");

  assert.equal(insiderComment.agent?.id, "insider-agent");
  assert.equal(insiderComment.agent_display_name, "Insider Team Agent");

  // The visibility select and the response mapper must both be scoped to the
  // viewed task's own project (15), not the requester's user id alone.
  assert.equal(route.getQuery().include.agent.select.members.where.project.id, 15);
});
