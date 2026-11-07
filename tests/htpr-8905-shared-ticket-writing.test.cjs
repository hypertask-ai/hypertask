const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const { assertAgentWriting, AgentWritingError, AGENT_WRITING_RULES } = load("src/lib/agents/writing.ts", {});
const flagKey = "htpr-8905-shared-ticket-writing";

const withRisk = `<h2>Problem</h2><p>Search omits reminders.</p><h2>Fix</h2><p>Search reads reminders.</p><h2>Done when</h2><p>Search finds reminders.</p><h2>Risk</h2><p>Low. Undo: revert one change.</p><h2>Decision</h2><p>None.</p>`;
const withoutRisk = withRisk.replace("<h2>Risk</h2><p>Low. Undo: revert one change.</p>", "");

const examples = {
  "robot-status": { title: "Search finds reminders", description: `${withRisk}<p>Helpers: none.</p>` },
  "technical-detail": { title: "Search finds reminders", description: `${withRisk}<p>See src/lib/search/reminders.ts for the read.</p>` },
  "dashed-code-name": { title: "Remove feature flag htpr-7273-column-events", description: withRisk },
  "plain-valentin-quote": { title: "Search finds reminders", description: `${withRisk}<p>Valentin, 2026-10-24: "count a plain yes".</p>` },
  "sentence-length": { title: "Search finds reminders", description: `${withRisk}<p>This deliberately long sentence contains far too many words for one short glance.</p>` },
  "question-shape": {
    title: "Search finds reminders",
    description: `${withRisk}<p>Question: Remove the forced rule?</p><p>Yes: it goes.</p>`,
  },
  "ticket-parts": { title: "Search finds reminders", description: withoutRisk },
};

const passing = { title: "Search finds reminders", description: withRisk };

function directRefusal(fields) {
  try {
    assertAgentWriting("agent", fields, {}, { create: true, houseRules: true });
    return null;
  } catch (error) {
    assert.ok(error instanceof AgentWritingError);
    return error;
  }
}

function appCreate(sharedOn) {
  const writes = [];
  const prisma = {
    user: { findUnique: async () => ({ id: 6, email: "qa@example.com", displayName: "QA", photoURL: null }) },
    project: { findFirst: async () => ({ id: 7 }), findUnique: async () => ({ uniqueIdentifier: "HTPR" }) },
    task: { create: async ({ data }) => { writes.push(data); return { id: 91, projectId: 7, ...data }; } },
    section: { findFirst: async () => ({ id: 12, section_title: "Todo" }) },
    label: { findMany: async () => [] },
    $executeRaw: async () => {},
  };
  const effects = {
    schedulePostCreateWork() {},
    persistAssignee: async () => ({}),
    createAssigneeActivityAndNotification: async () => {},
    createPriorityActivity: async () => {},
    createEstimateAndActivity: async () => {},
    getActiveAgentOwnerId: async () => 6,
    isAgentAssignee: () => false,
  };
  const flags = {
    isFeatureEnabled: async (key) => sharedOn || key !== flagKey,
  };
  const stubs = {
    "@/lib/flags": flags,
    "@/lib/flags/keys": {},
    "@/lib/api/task-writes/create-global-effects": effects,
    "./create-global-effects": effects,
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async () => true },
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError: Error } },
    "@/utils/generateRank": { default: () => "a" },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 4 },
    "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_prisma, _actor, callback) => ({ ...(await callback(prisma)), boardWebhookDeliveryIds: [] }) },
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: async () => {} },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskCreatedPending: async () => {} },
    "@/lib/telemetry/savedWork": { CREATION_AGENT_HEADER: "X-Hypertask-Creation-Agent", CREATION_CHANNEL_HEADER: "X-Hypertask-Creation-Channel", creationChannelFromHeader: () => "web" },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {}, prepareAgentScope: async () => {}, withAgentScopeRequest: (_request, run) => run() },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent: ({ sessionAgentId }) => ({ ok: true, agentId: sessionAgentId ?? null }) },
    "@/lib/auth/session": { SESSION_COOKIE: "session", verifySession: (token) => token === "signed" ? { id: 6, agentId: "agent" } : null },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "better-auth/cookies": { parseCookies: () => new Map() },
  };
  const api = load("src/lib/api/task-writes/create-global.ts", stubs);
  return {
    writes,
    post: async (fields, actor = { userId: 6, agentId: "agent" }) => {
      const body = { title: fields.title, description: fields.description, projectId: 7, userId: actor.userId, sectionId: 12, agentId: actor.agentId };
      const response = await api.POST({ json: async () => body, headers: new Headers(), cookies: actor.agentId ? { session: "signed" } : {} }, actor);
      return { status: response.status, body: await response.json() };
    },
  };
}

function toolCreate() {
  const ctx = { user: { id: 6 }, agentId: "agent", teamScope: null };
  const calls = { writes: 0 };
  const auth = { validateMcpAuth: async () => ctx, checkMcpRateLimit: async () => null };
  const create = load("src/lib/mcp/operations/tasks/create/operation.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (fn) => fn, validateMcpRouteAuth: auth.validateMcpAuth, checkMcpRouteRateLimit: auth.checkMcpRateLimit, readMcpRouteJsonBody: async (request) => ({ ok: true, body: await request.json() }) },
    "@/lib/mcp/auth": auth,
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/agents": { getMcpSessionAgentSummary: async () => null },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: "QA", teamId: null } }),
      getSectionForTask: async () => ({ section: { id: 1, section_title: "Todo" } }),
      validateParentTask: async () => ({}),
      createTask: async (data) => { calls.writes += 1; return { id: 42, ...data }; },
    },
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async () => true },
    "@/lib/mcp/tasks/mappers": { mapTaskToDetail: (task) => task },
    "@/lib/mcp/idempotency/idempotencyStore": { normalizeIdempotencyKey: () => null, withIdempotency: async (_op, _user, _key, _body, write) => write(), IdempotencyAccessError: class extends Error {}, IdempotencyInProgressError: class extends Error {} },
    "@/lib/prisma": { default: { task: { findMany: async () => [] }, user: { findUnique: async () => ({ id: 6, email: "qa@example.com" }) }, label: { findMany: async () => [] } } },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === "yper4-910-agent-writing" || key === "htpr-8798-writing-house-rules" || key === flagKey },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (text) => text },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (text) => text },
    "@/lib/planLimits": { isPlanLimitReachedError: () => false, planLimitResponse: () => null },
    "@/lib/mcp/operationContext": { getMcpOperationContext: async () => ({}) },
    "@/lib/mcp/tasks/validators": { validateCreateTaskBody: (body) => ({ valid: true, data: body }) },
    "@/lib/mcp/tasks/types": {},
    "@/lib/mcp/fieldError": { buildFieldError: (code, field, message) => ({ code, field, message }) },
    "@/lib/flags/definitions/htpr-7121-mcp-not-found-detail": { HTPR_7121_MCP_NOT_FOUND_DETAIL_FLAG: "htpr-7121" },
    "@/lib/flags/definitions/htpr-8471-board-refusal-next-step": { HTPR_8471_BOARD_REFUSAL_NEXT_STEP_FLAG: "htpr-8471" },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (_request, error) => { throw error } },
    "@/lib/mcp/tasks/agentMutationLeaseAdoption": { withAdoptedAgentMutationLease: async (_db, _actor, execute) => execute() },
    "@/lib/pullRequests/taskPullRequests": {},
    "@/lib/auth/session": { SESSION_COOKIE: "session", signSession: () => "test-session" },
    "@/lib/auth/slimUserCookie": { slimUserForCookie: (user) => user },
  }).POST;
  return {
    calls,
    post: async (fields, dryRun = true) => {
      const response = await create(new Request("https://app.hypertask.ai/api/mcp/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: 15, title: fields.title, description: fields.description, dry_run: dryRun }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test("the shared rule list is what both ticket creates refuse", async () => {
  const definition = require("./helpers/flag-files.cjs").load("src/lib/flags/definitions/htpr-8905-shared-ticket-writing.ts");
  assert.equal(definition.HTPR_8905_SHARED_TICKET_WRITING_FLAG, flagKey);
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  const app = appCreate(true);
  const tool = toolCreate();
  for (const rule of AGENT_WRITING_RULES) {
    const fields = examples[rule.id];
    assert.ok(fields, rule.id);
    const direct = directRefusal(fields);
    assert.equal(direct.rule, rule.id, rule.id);
    assert.match(direct.message, new RegExp(rule.fix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const saved = await app.post(fields);
    const posted = await tool.post(fields);
    assert.equal(saved.status, 400, `${rule.id} app ${JSON.stringify(saved.body)}`);
    assert.equal(posted.status, 400, `${rule.id} tool ${JSON.stringify(posted.body)}`);
    assert.equal(saved.body.message, direct.message, rule.id);
    assert.equal(posted.body.error, direct.message, rule.id);
    assert.equal(saved.body.field, direct.field);
    assert.equal(posted.body.field, direct.field);
  }
  assert.equal(app.writes.length, 0);
  assert.equal(tool.calls.writes, 0);
});

test("the same finished ticket is saved by the app and accepted by the agent tool", async () => {
  assert.equal(directRefusal(passing), null);
  const app = appCreate(true);
  const tool = toolCreate();
  const saved = await app.post(passing);
  const posted = await tool.post(passing, false);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  assert.equal(app.writes.length, 1);
  assert.equal(tool.calls.writes, 1);
  const person = await app.post({ title: "Remove feature flag htpr-7273-column-events", description: withRisk }, { userId: 6, agentId: null });
  assert.equal(person.status, 200, JSON.stringify(person.body));
});

test("switching the shared check off lets the app save text the agent tool still refuses", async () => {
  const app = appCreate(false);
  const saved = await app.post(examples["dashed-code-name"]);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(app.writes.length, 1);
  const posted = await toolCreate().post(examples["dashed-code-name"]);
  assert.equal(posted.status, 400);
  assert.equal(posted.body.error, directRefusal(examples["dashed-code-name"]).message);
});
