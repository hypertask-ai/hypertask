const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");
const { loadRouteWrapper } = require("./helpers/mcp-route-wrapper.cjs");

const user = { id: 7, email: "agent-owner@example.com", displayName: "Owner", photoURL: null };
const missingMessage = "Caller holds no agent mutation lease for this task. Claim one with POST /mcp/tasks/lease/claim before this write.";
const conflictMessage = "Task has an active agent mutation lease. Retry after the current action finishes.";
const task = (id, status = "Normal") => ({ id, projectId: 15, sectionId: null, status });
const lease = (agentId = "agent-a") => ({ agentId, token: "explicit-lease", adoptionCount: 0 });

function harness(t, { v2, tasks = [task(42)], leases = new Map(), writeError, cancelBeforeWrite = false }) {
  const reports = [];
  const pending = [];
  const writes = [];
  const warnings = [];
  const errors = [];
  const broadcasts = [];
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  t.mock.method(console, "error", (...args) => errors.push(args));
  const adoption = load("src/lib/mcp/tasks/agentMutationLeaseAdoption.ts", {});
  let transactions = 0;
  const prisma = {
    user: { findUnique: async () => user },
    agent: {
      findUnique: async () => ({ id: "agent-a" }),
      findFirst: async () => ({ id: "agent-a" }),
    },
    task: {
      findMany: async ({ where }) => where.id
        ? tasks.filter(task => where.id.in.includes(task.id))
        : tasks,
      findUnique: async ({ where }) => tasks.find(task => task.id === where.id),
      update: async ({ where, data }) => {
        if (writeError) throw writeError;
        writes.push(where.id);
        Object.assign(tasks.find(task => task.id === where.id), data);
      },
    },
    $transaction: async run => {
      transactions += 1;
      if (cancelBeforeWrite && transactions === 2) leases.clear();
      return run(prisma);
    },
    $executeRaw: async () => 1,
    $queryRaw: async (strings, ...values) => {
      const sql = Array.from(strings).join("");
      if (sql.includes('FROM "TaskLease"')) return leases.has(values[0]) ? [leases.get(values[0])] : [];
      if (sql.includes('INSERT INTO "TaskLease"')) {
        const [taskId, , agentId, token] = values;
        leases.set(taskId, { agentId, token, adoptionCount: 1 });
        return [{ taskId }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const crashReport = load("src/lib/mcp/operationCrashReport.ts", {
    "@vercel/functions": { waitUntil: promise => pending.push(promise) },
    "@/lib/errors/reportError": { reportError: async report => { reports.push(report); } },
  });
  const auth = {
    validateMcpAuth: async () => ({ user, agentId: "agent-a" }),
    checkMcpRateLimit: async () => null,
  };
  const wrapper = loadRouteWrapper({
    "./operationCrashReport": crashReport,
    "@/lib/aiFeedback/automatic": { queueRestFailure: () => {} },
    "@/lib/mcp/auth": auth,
    "@/lib/mcp/tasks/agentMutationLeaseAdoption": adoption,
    "./dbTiming": {},
  });
  const { POST } = load("src/app/api/mcp/tasks/update/route.ts", {
    "@/lib/prisma": { default: prisma },
    "@/lib/mcp/routeWrapper": wrapper,
    "@/lib/mcp/auth": auth,
    "@/lib/mcp/mcpV2": { isMcpV2Enabled: async () => v2 },
    "@/lib/mcp/tasks/agentMutationLeaseAdoption": adoption,
    "./agentMutationLeaseAdoption": adoption,
    "@/lib/mcp/idempotency/idempotencyStore": {
      IdempotencyAccessError: class extends Error {},
      IdempotencyInProgressError: class extends Error {},
      normalizeIdempotencyKey: () => null,
      withIdempotency: async (_operation, _userId, _key, _body, run) => run(),
    },
    "@/lib/auth/session": { signSession: () => "test-session", SESSION_COOKIE: "session" },
    "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/agents": { getMcpSessionAgentSummary: async () => null },
    "@/lib/mcp/tasks/mappers": { taskDetailInclude: () => ({}), mapTaskToDetail: task => ({ id: task.id }) },
    "@/lib/mcp/tasks/broadcastTaskUpdates": { broadcastTaskUpdates: async tasks => broadcasts.push(tasks.map(task => task.id)) },
    "@/lib/agents/activityAttribution": { actingAgentSelect: {} },
    "@/lib/pullRequests/taskPullRequests": { PullRequestLinkError: class extends Error {} },
    "@/lib/pullRequests/githubPullRequests": {},
    "@/lib/mcp/tasks/services": {},
    "@/utils/controllers/assignees/assign": {},
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/urls/extractUrlsFromContent": {},
    "@/utils/helperFunctions/sanitizeRichHtml": {},
    "@/utils/helperFunctions/markdownToHtml": {},
  });
  return {
    reports, writes, warnings, errors, broadcasts,
    async update() {
      const response = await POST(new NextRequest("https://app.hypertask.ai/api/mcp/tasks/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: tasks.map(task => task.id), acceptance_criteria: "Verified" }),
      }));
      await Promise.all(pending);
      return { status: response.status, body: await response.json() };
    },
  };
}

for (const v2 of [false, true]) {
  const version = v2 ? "V2" : "V1";
  for (const kind of ["missing", "conflict"]) {
    test(`${version}: all ${kind} leases answer 409 with a code, warn, and send no PostHog report`, async t => {
      const tasks = [task(42, "Archive"), task(43, "Archive")];
      const leases = kind === "missing" ? new Map() : new Map(tasks.map(task => [task.id, lease("agent-b")]));
      const h = harness(t, { v2, tasks, leases });
      const response = await h.update();

      assert.equal(response.status, 409);
      assert.deepEqual(response.body, {
        success: false,
        tasks: [],
        error: `Failed to update 2 task(s). ${kind === "missing" ? missingMessage : conflictMessage}`,
        code: `agent_mutation_lease_${kind}`,
      });
      assert.equal(h.errors.length, 0);
      const refusals = h.warnings.filter(([message]) => message.includes("Refused update of"));
      assert.equal(refusals.length, 2);
      assert.equal(refusals[0][1].name, kind === "missing" ? "AgentMutationLeaseMissingError" : "AgentMutationLeaseConflictError");
      assert.equal(h.reports.length, 0);
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.broadcasts, []);
    });
  }

  test(`${version}: a mixed batch stays 200 and includes only the successful task plus the refused failure`, async t => {
    const h = harness(t, {
      v2,
      tasks: [task(42), task(43)],
      leases: new Map([[42, lease()], [43, lease("agent-b")]]),
    });
    const response = await h.update();

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      success: true,
      tasks: [{ id: 42 }],
      task: { id: 42 },
      message: "1 task(s) updated successfully (1 task(s) failed)",
      failed_tasks: [{ taskId: 43, error: conflictMessage, status: 409, code: "agent_mutation_lease_conflict" }],
    });
    assert.deepEqual(h.writes, [42]);
    assert.deepEqual(h.broadcasts, [[42]]);
    assert.equal(h.errors.length, 0);
    assert.equal(h.reports.length, 0);
  });

  test(`${version}: a plain Prisma write Error still answers 500 and sends a PostHog report`, async t => {
    const h = harness(t, { v2, leases: new Map([[42, lease()]]), writeError: new Error("Database unavailable") });
    const response = await h.update();

    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, undefined);
    assert.match(response.body.error, /Database unavailable/);
    assert.equal(h.errors.length, 1);
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].extra.route, "/api/mcp/tasks/update");
    assert.equal(h.reports[0].extra.method, "POST");
    assert.equal(h.reports[0].extra.errorName, "McpServerErrorWithoutCause");
    assert.deepEqual(h.writes, []);
  });

  test(`${version}: still allowed, an agent holding the lease updates successfully`, async t => {
    const tasks = [task(42)];
    const h = harness(t, { v2, tasks, leases: new Map([[42, lease()]]) });
    const response = await h.update();

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.tasks, [{ id: 42 }]);
    assert.deepEqual(h.writes, [42]);
    assert.equal(tasks[0].acceptanceCriteria, "Verified");
    assert.deepEqual(h.broadcasts, [[42]]);
    assert.equal(h.warnings.length, 0);
    assert.equal(h.errors.length, 0);
    assert.equal(h.reports.length, 0);
  });

  test(`${version}: a lease cancelled before the contract write is a missing-lease 409, not a crash`, async t => {
    const h = harness(t, { v2, leases: new Map([[42, lease()]]), cancelBeforeWrite: true });
    const response = await h.update();

    assert.equal(response.status, 409);
    assert.equal(response.body.code, "agent_mutation_lease_missing");
    assert.equal(h.errors.length, 0);
    assert.equal(h.reports.length, 0);
    assert.deepEqual(h.writes, []);
  });
}

test("lease refusal metadata preserves names, messages, custom messages, and conflict instanceof checks", () => {
  const { AgentMutationLeaseConflictError, AgentMutationLeaseMissingError } = load("src/lib/mcp/tasks/agentMutationFence.ts", {});
  const conflict = new AgentMutationLeaseConflictError();
  const missing = new AgentMutationLeaseMissingError();

  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "agent_mutation_lease_conflict");
  assert.equal(conflict.name, "AgentMutationLeaseConflictError");
  assert.equal(conflict.message, conflictMessage);
  assert.equal(new AgentMutationLeaseConflictError("Custom conflict").message, "Custom conflict");
  assert.equal(missing.status, 409);
  assert.equal(missing.code, "agent_mutation_lease_missing");
  assert.equal(missing.name, "AgentMutationLeaseMissingError");
  assert.equal(missing.message, missingMessage);
  assert.ok(missing instanceof AgentMutationLeaseConflictError);
});
