const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");
const { setup } = require("./helpers/comment-routing.cjs");

const root = path.resolve(__dirname, "..");
const definitions = load("src/lib/flags/definitions/htpr-8900-ci-blocker-write.ts");
const FLAG = definitions.HTPR_8900_CI_BLOCKER_WRITE_FLAG;
const { columnRole, columnRoleFor, missingWorkflowColumns } = load("src/lib/mcp/boards/columnRole.ts");
const validations = load("src/lib/mcp-server/validations/project.validation.ts");

const fleetCiColumns = [
  "Backlog",
  "In Progress",
  "Agent Blocked",
  "AI Review",
  "Valentin Review",
  "Later (parked)",
  "Done",
];
const fiveColumns = ["Todo", "Doing", "AI Review", "Valentin Review", "Done"];

class StubResponse {
  constructor(body, status) {
    this.body = body;
    this.status = status;
  }
  static json(body, init) {
    return new StubResponse(body, init?.status ?? 200);
  }
  async json() {
    return this.body;
  }
}

test("the flag is an access bugfix that stays on owner and QA", () => {
  assert.equal(definitions.default.key, FLAG);
  assert.equal(definitions.default.kind, "bugfix");
  assert.equal(definitions.default.defaultMode, "OWNER_AND_QA");
  assert.equal(definitions.default.releaseRisk.highRisk, "access");
});

function loadCreate({ open = false, member = false, stranger = false, person = false, flagThrows = false } = {}) {
  const calls = { created: 0 };
  const { POST } = load("src/lib/mcp/operations/tasks/create/operation.ts", {
    "next/server": { NextResponse: StubResponse },
    "@/lib/agents/writing": { AgentWritingError: class extends Error {} },
    "@/lib/agents/writingEnforcement": { enforceAgentWriting: async () => {} },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, ...(person ? {} : { agentId: "runner-h" }) }),
      checkMcpRouteRateLimit: async () => null,
      readMcpRouteJsonBody: async (request) => ({ ok: true, body: request.body }),
    },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => stranger
        ? { error: { status: 403, message: "User does not have permission to access this project" } }
        : { project: { uniqueIdentifier: "HYCI", teamId: 1 } },
      getSectionForTask: async () => ({ section: { id: 32923, section_title: "Backlog" } }),
      validateParentTask: async () => ({}),
      validateProjectMemberIds: async () => ({ invalidIds: [] }),
      createTask: async (data) => { calls.created += 1; calls.data = data; return { id: 1, projectId: data.projectId }; },
      matchLabelIds: () => ({ ids: [], unresolved: [] }),
    },
    "@/lib/mcp/tasks/mappers": { mapTaskToDetail: (task) => task },
    "@/lib/mcp/idempotency/idempotencyStore": {
      IdempotencyAccessError: class extends Error {},
      IdempotencyInProgressError: class extends Error {},
      normalizeIdempotencyKey: () => null,
      withIdempotency: async (_a, _b, _c, _d, fn) => fn(),
    },
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/agents": { getMcpSessionAgentSummary: async () => null },
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async () => member },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => {
        if (key === FLAG && flagThrows) throw new Error("flag unreadable");
        return key === FLAG && open;
      },
    },
    "@/lib/prisma": { default: { label: { findMany: async () => [] } } },
  });
  return {
    calls,
    post: (body = {}) => POST({ body: { project_id: 11514, title: "CI blocker", ...body }, headers: { get: () => null } }),
  };
}

test("a reader who is not a member can file a Fleet CI blocker", async () => {
  const { post, calls } = loadCreate({ open: true });
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(calls.created, 1);
  assert.equal(calls.data.projectId, 11514);
  assert.equal(calls.data.agentId, "runner-h");
});

test("a dry run by that reader is valid", async () => {
  const { post, calls } = loadCreate({ open: true });
  const response = await post({ dry_run: true });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.valid, true);
  assert.equal(body.would.project_id, 11514);
  assert.equal(calls.created, 0);
});

test("flag off still refuses a non-member agent", async () => {
  const { post, calls } = loadCreate({ open: false });
  const response = await post();
  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /not a member of this board/);
  assert.equal(calls.created, 0);
});

test("an unreadable flag keeps the membership refusal", async () => {
  const { post, calls } = loadCreate({ open: true, flagThrows: true });
  const response = await post();
  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /not a member of this board/);
  assert.equal(calls.created, 0);
});

test("a stranger who cannot read the board is still refused", async () => {
  const { post, calls } = loadCreate({ open: true, stranger: true });
  const response = await post();
  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /does not have permission/);
  assert.equal(calls.created, 0);
});

test("a member still files when the flag is off", async () => {
  const { post, calls } = loadCreate({ member: true });
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(calls.created, 1);
});

test("a person with no agent still files", async () => {
  const { post, calls } = loadCreate({ person: true });
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(calls.created, 1);
  assert.equal(calls.data.agentId, undefined);
});

function loadGlobalCreate({ open = false, member = false, project = true, flagThrows = false } = {}) {
  const calls = { created: 0, membershipChecks: 0 };
  const { POST } = load("src/lib/api/task-writes/create-global.ts", {
    "@/lib/prisma": { default: {
      user: { findUnique: async () => ({ id: 6, displayName: "Owner", email: "owner@example.invalid" }) },
      project: { findFirst: async () => project ? { id: 11514 } : null },
    } },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => {
        if (key === FLAG && flagThrows) throw new Error("flag unreadable");
        return key === FLAG && open;
      },
    },
    "@/lib/auth/agentScope": { recordAgentBoardScopeMiss() {} },
    "@/lib/auth/session": { verifySession: () => ({ agentId: "runner-h" }) },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: "runner-h" }) },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async () => { calls.membershipChecks += 1; return member; } },
    "@/lib/ai/taskWriterDueDate": {},
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/utils/controllers/tasks/parentTaskAccess": {},
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 1 },
    "@/utils/generateRank": { default: () => "rank" },
    "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_db, _actor, create) => {
      calls.created += 1;
      const value = await create({
        $executeRaw: async () => {},
        section: { findFirst: async () => ({ id: 32923, section_title: "Backlog" }) },
        project: { findUnique: async () => ({ uniqueIdentifier: "HYCI" }) },
        task: { create: async ({ data }) => ({ ...data, id: 9, description_: { content: "" } }) },
        taskLabel: { findMany: async () => [] },
      });
      return { result: value.result, boardWebhookDeliveryIds: [] };
    } },
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: async () => {} },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskCreatedPending: async () => {} },
    "@/lib/telemetry/savedWork": { creationChannelFromHeader: () => "agent" },
    "./create-global-effects": { getActiveAgentOwnerId: async () => 6, schedulePostCreateWork() {} },
    "./route": { taskWriteRoute: ({ operation }) => async (request, session) => operation(await request.json(), session, request) },
  });
  return {
    calls,
    post: () => POST({
      headers: new Headers(),
      json: async () => ({ projectId: 11514, title: "CI blocker", description: "", ranking: "a" }),
    }, { userId: 6 }),
  };
}

test("the global create path files a blocker for a reader who is not a member", async () => {
  const { post, calls } = loadGlobalCreate({ open: true });
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(calls.created, 1);
  assert.equal(calls.membershipChecks, 0);
});

test("global create still forbids a non-member when the flag is off", async () => {
  const { post, calls } = loadGlobalCreate();
  const response = await post();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).message, "Forbidden");
  assert.equal(calls.created, 0);
  assert.equal(calls.membershipChecks, 1);
});

test("global create still forbids a board the agent cannot read", async () => {
  const { post, calls } = loadGlobalCreate({ open: true, project: false });
  const response = await post();
  assert.equal(response.status, 403);
  assert.equal(calls.created, 0);
});

function chatHarness({ open = false, member = false } = {}) {
  const saved = [];
  const { createCreateTaskTool } = load("src/lib/ai/tools/createTask.ts", {
    ai: { tool: (definition) => definition },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === FLAG && open },
    "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html },
    "@/lib/prisma": { default: { agent: { findFirst: async () => ({ id: "runner-h" }) } } },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: "HYCI", teamId: 1 } }),
      getSectionForTask: async () => ({ section: { id: 32923, section_title: "Backlog" } }),
      validateParentTask: async () => ({}),
      createTask: async (input) => {
        const task = { ...input, id: 1, uniqueIndex: 1, ticketNumber: "HYCI-1" };
        saved.push(task);
        return task;
      },
    },
    "@/utils/controllers/getMemberAndOwnerForBoard": { default: async () => [6] },
    "@/lib/ai/tools/execution": { withToolErrors: (fn) => fn, dropEmptyPadding: (input) => input },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (input) => input, mapTaskToDetail: (input) => input },
    "@/lib/ai/chatStream/errors": { errorMessage: (error) => error.message },
    "@/lib/ai/bulkConfirmation": { requireCrossMessageConfirmation: async () => "preview" },
    "@/app/api/ai/chat/stream/bulkTools": { buildBulkOperationKey: () => "preview" },
    "@/app/api/ai/_lib/taskWriterDraft": { generateTaskWriterDraft: async () => ({ success: true, title: "CI blocker", html: "<p>Build failed.</p>" }) },
    "@/app/api/ai/_lib/taskWriterRun": { taskWriterRequestSchema: { parse: (input) => input } },
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: async () => member },
    "./updateOneTask": { createTaskUpdater: () => async () => ({ success: true, task: saved[0] }) },
  });
  const tool = createCreateTaskTool({
    user: { id: 6 },
    actingAgentId: "runner-h",
    body: {},
    chatTaskWriterEnabled: true,
    sendStatus() {},
    confirmationSessionId: "session",
    bulkPreviewsIssued: new Set(),
    send() { return true; },
  }).hypertask_create_task;
  return {
    saved,
    execute: () => tool.execute(tool.inputSchema.parse({ project_id: 11514, brief: "CI blocker" })),
  };
}

test("chat create files a blocker for a reader who is not a member", async () => {
  const h = chatHarness({ open: true });
  const result = await h.execute();
  assert.equal(result.success, true);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].projectId, 11514);
});

test("chat create still refuses a non-member when the flag is off", async () => {
  const h = chatHarness();
  const result = await h.execute();
  assert.equal(result.success, false);
  assert.match(result.error, /not an active owned member/);
  assert.equal(h.saved.length, 0);
});

function loadRun({ open = false, member = false, hidden = false, flagThrows = false } = {}) {
  const lookups = [];
  const now = new Date("2026-11-07T12:00:00Z");
  const tx = {
    task: {
      findFirst: async ({ where }) => {
        lookups.push(where);
        if (hidden) return null;
        if (where.project?.members && !member) return null;
        return { id: 89579, projectId: 11514 };
      },
    },
    agentRun: {
      createMany: async () => ({ count: 1 }),
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => ({
        id: "run-1",
        agentId: "runner-h",
        taskId: 89579,
        chatSessionId: null,
        trigger: "RUNTIME",
        status: "ACTIVE",
        title: "CI blocker",
        createdAt: now,
        lastActivityAt: now,
        stoppedById: null,
      }),
    },
  };
  const { createRuntimeAgentRun } = load("src/lib/agentRuns/service.ts", {
    "server-only": {},
    "@/lib/prisma": { default: { $transaction: async (fn) => fn(tx) } },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => {
        if (key === FLAG && flagThrows) throw new Error("flag unreadable");
        return key === FLAG && open;
      },
    },
    "@/lib/mcp/tasks/agentMutationFence": { lockTaskTeamScope: async () => {} },
    "@/lib/realtime/server": {
      AGENT_CHAT_EVENT: "chat",
      broadcastTaskComment: async () => {},
      broadcast: async () => {},
      userChannel: () => "user-6",
    },
    "@/lib/agentStatus/boardRefresh": { refreshBoardForAgentRun: async () => {} },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({ id: 11514 }) },
  });
  return {
    lookups,
    open: () => createRuntimeAgentRun(
      { userId: 6, agentId: "runner-h", source: "agent", displayName: "Runner H" },
      { taskId: 89579, title: "CI blocker", source: "runtime" },
      now,
    ),
  };
}

test("opening activity on a readable ticket does not require a membership row", async () => {
  const run = loadRun({ open: true });
  const opened = await run.open();
  assert.equal(opened.id, "run-1");
  assert.equal(opened.taskId, 89579);
  assert.equal(run.lookups[0].project.members, undefined);
});

test("opening activity still hides a readable ticket when the flag is off", async () => {
  const run = loadRun();
  assert.equal(await run.open(), null);
  assert.deepEqual(run.lookups[0].project.members, { some: { agentId: "runner-h", status: "Accepted" } });
});

test("a member can still open activity when the flag is off", async () => {
  const run = loadRun({ member: true });
  assert.equal((await run.open()).id, "run-1");
});

test("an unreadable flag keeps the activity membership filter", async () => {
  const run = loadRun({ open: true, flagThrows: true });
  assert.equal(await run.open(), null);
  assert.ok(run.lookups[0].project.members);
});

test("a ticket the agent cannot read stays hidden", async () => {
  const run = loadRun({ open: true, hidden: true });
  assert.equal(await run.open(), null);
});

test("a note on a readable board is not refused for membership", async () => {
  const h = setup({ noRun: true, notMember: true, ciBlockerWrite: true });
  const response = await h.post({ text: "<p>Plus one on the existing blocker.</p>" });
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.body.error, /not a member/);
  assert.equal(h.calls.comments.length, 0);
});

test("a note is still refused for membership when the flag is off", async () => {
  const h = setup({ noRun: true, notMember: true });
  const response = await h.post({ text: "<p>Plus one on the existing blocker.</p>" });
  assert.equal(response.status, 403);
  assert.match(response.body.error, /not a member of this board/);
});

test("an agent who can read both tickets can link a blocker", async () => {
  const stored = [];
  const tasks = {
    100: { id: 100, projectId: 15, ticketNumber: "HTPR-8840", title: "Product", status: "Normal", uniqueIndex: 8840 },
    200: { id: 200, projectId: 11514, ticketNumber: "HYCI-1", title: "CI blocker", status: "Normal", uniqueIndex: 1 },
  };
  const { POST } = load("src/lib/mcp/operations/tasks/relations/operation.ts", {
    "next/server": { NextResponse: StubResponse },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: "runner-h", teamScope: null }),
    },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => null },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/mcp/tasks/resolveTask": {
      validateTaskIdentifier: () => ({ valid: true }),
      taskIdentifierErrorResponse: () => null,
      findTaskByIdentifier: async (_user, identifier) => tasks[identifier.task_id] ?? null,
    },
    "@/lib/prisma": { default: {
      taskRelations: { upsert: async (args) => { stored.push(args.create); return { id: 1, ...args.create }; } },
    } },
  });
  const response = await POST({ json: async () => ({ source_task_id: 100, target_task_id: 200, relation_type: "BlockedBy" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).relation.relationType, "BlockedBy");
  assert.deepEqual(stored, [{ sourceTaskId: 100, targetTaskId: 200, relationType: "BlockedBy" }]);
});

test("linking a ticket the agent cannot read is still refused", async () => {
  const { POST } = load("src/lib/mcp/operations/tasks/relations/operation.ts", {
    "next/server": { NextResponse: StubResponse },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: "runner-h", teamScope: null }),
    },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => null },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/mcp/tasks/resolveTask": {
      validateTaskIdentifier: () => ({ valid: true }),
      taskIdentifierErrorResponse: () => null,
      findTaskByIdentifier: async (_user, identifier) => identifier.task_id === 100
        ? { id: 100, projectId: 15, ticketNumber: "HTPR-8840", title: "Product", status: "Normal", uniqueIndex: 8840 }
        : null,
    },
    "@/lib/prisma": { default: { taskRelations: { upsert: async () => { throw new Error("hidden task was linked"); } } } },
  });
  const response = await POST({ json: async () => ({ source_task_id: 100, target_task_id: 200, relation_type: "BlockedBy" }) });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /access denied/);
});

test("Fleet CI columns are missing QA and Release, and the five-column set is missing Blocked too", () => {
  assert.equal(columnRole("QA"), "human-review");
  assert.equal(columnRole("Agent Blocked"), "other");
  assert.equal(columnRole("Agent Blocked", true), "blocked");
  assert.equal(columnRole("Agent Blocked (Infra)", true), "blocked");
  assert.equal(columnRole("QA", true), "qa");
  assert.equal(columnRole("Release", true), "release");
  assert.equal(columnRole("Release review", true), "release");
  assert.equal(columnRole("Release verification", true), "release");
  assert.equal(columnRole("Released", true), "other");
  assert.equal(columnRole("Valentin Review", true), "human-review");
  assert.equal(columnRoleFor({ section_title: "Flag: Only Me + QA", isDone: true }, true), "done");
  assert.deepEqual(missingWorkflowColumns(fleetCiColumns), ["QA", "Release"]);
  assert.deepEqual(missingWorkflowColumns(fiveColumns), ["Blocked", "QA", "Release"]);
  assert.deepEqual(missingWorkflowColumns([...fleetCiColumns, "QA", "Release"]), []);
  assert.deepEqual(missingWorkflowColumns([...fiveColumns, "Blocked", "QA", "Released"]), ["Release"]);
});

test("section role filters accept blocked, qa, and release", () => {
  for (const role of ["blocked", "qa", "release"]) {
    const parsed = validations.SectionCrudInputSchema.safeParse({ action: "list", project_id: 11514, role });
    assert.equal(parsed.success, true, role);
  }
  assert.equal(validations.SectionCrudInputSchema.safeParse({ action: "list", project_id: 11514, role: "shipping" }).success, false);
});

test("a column list finds QA and Release by role", async () => {
  const { SectionService } = load("src/lib/mcp-server/lib/services/section.service.ts");
  const sections = [
    ...fleetCiColumns.map((section_title, index) => ({
      id: index + 1,
      section_title,
      projectId: 11514,
      visibility: true,
      deleted: false,
      ranking: `A${index}`,
      isDone: section_title === "Done",
      autoAssign: null,
      taskCount: 0,
    })),
    { id: 8, section_title: "QA", projectId: 11514, visibility: true, deleted: false, ranking: "A8", isDone: false, autoAssign: null, taskCount: 0 },
    { id: 9, section_title: "Release", projectId: 11514, visibility: true, deleted: false, ranking: "A9", isDone: false, autoAssign: null, taskCount: 0 },
  ];
  const client = new SectionService({
    makeRequest: async () => ({ success: true, sections, projectId: 11514 }),
  });
  const options = { roleEnabled: true, workflowColumns: true };
  const qa = await client.manageSection({ action: "list", project_id: 11514, role: "qa" }, options);
  const release = await client.manageSection({ action: "list", project_id: 11514, role: "release" }, options);
  const blocked = await client.manageSection({ action: "list", project_id: 11514, role: "blocked" }, options);
  const closed = await client.manageSection({ action: "list", project_id: 11514, role: "qa" }, { roleEnabled: true });
  assert.deepEqual(qa.sections.map((section) => section.section_title), ["QA"]);
  assert.deepEqual(release.sections.map((section) => section.section_title), ["Release"]);
  assert.deepEqual(blocked.sections.map((section) => section.section_title), ["Agent Blocked"]);
  assert.deepEqual(closed.sections, []);
});

test("workflow columns are added only on Fleet CI while the write is open", async () => {
  const created = [];
  const titles = [...fleetCiColumns];
  const steps = [];
  let open = false;
  let flagThrows = false;
  let createThrows = false;
  const db = {
    $queryRaw: async () => { steps.push("lock"); return []; },
    section: {
      findMany: async () => { steps.push("read"); return titles.map((section_title) => ({ section_title })); },
      create: async ({ data }) => {
        if (createThrows) throw new Error("column insert failed");
        steps.push("create");
        created.push(data);
        titles.push(data.section_title);
        return { ...data, id: created.length };
      },
    },
  };
  db.$transaction = async (fn) => fn(db);
  const { ensureFleetCiWorkflowColumns } = load("src/lib/mcp/boards/workflowColumns.ts", {
    "@/lib/flags": { isFeatureEnabled: async (key) => {
      if (flagThrows) throw new Error("flag unavailable");
      if (key !== FLAG) throw new Error(key);
      return open;
    } },
    "@/lib/telemetry/savedWork": {
      enqueueColumnCreated: async () => "column-created",
      processAnalyticsIntentSoon: () => {},
    },
    "@/lib/prisma": { default: db },
  });
  await ensureFleetCiWorkflowColumns(11514, 6);
  assert.deepEqual(created, []);
  open = true;
  await ensureFleetCiWorkflowColumns(15, 6);
  assert.deepEqual(created, []);
  await ensureFleetCiWorkflowColumns(11514, 6);
  assert.deepEqual(created.map((column) => [column.section_title, column.ranking]), [["QA", "A0505"], ["Release", "A0525"]]);
  assert.deepEqual(steps.slice(0, 3), ["lock", "read", "create"]);
  created.length = 0;
  titles.splice(0, titles.length, ...fiveColumns);
  await ensureFleetCiWorkflowColumns(11514, 6);
  assert.deepEqual(created.map((column) => column.section_title), ["Blocked", "QA", "Release"]);
  created.length = 0;
  flagThrows = true;
  titles.splice(0, titles.length, ...fiveColumns);
  await ensureFleetCiWorkflowColumns(11514, 6);
  assert.deepEqual(created, []);
  flagThrows = false;
  createThrows = true;
  await assert.doesNotReject(ensureFleetCiWorkflowColumns(11514, 6));
  assert.deepEqual(created, []);
});
