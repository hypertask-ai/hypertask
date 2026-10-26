const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { NextRequest } = require("next/server");
const noop = async () => undefined;
const own = { key: "htpr-6906-autocap-undo", mode: "OWNER_AND_QA" };
const dependency = { key: "htpr-5908-local-writing-assistance", mode: "OWNER_AND_QA" };

function fixture({ flags = [own, dependency], projectId = 15, section = "Flag: Everyone", flagError = false } = {}) {
  const before = { id: 1, projectId, uniqueIndex: 6906, ticketNumber: "HTPR-6906", userId: 985, sectionId: 10, section: "In Progress", status: "Normal", title: "Fixture", description: "", description_: { content: `<a href="https://app.hypertask.ai/admin/flags/${dependency.key}">Flag</a>` } };
  let saved = before;
  const calls = [];
  const db = {
    project: { findFirst: async () => ({ id: projectId }) },
    task: {
      findUnique: async () => saved,
      findUniqueOrThrow: async () => saved,
      update: async ({ data }) => { calls.push("saved"); saved = { ...saved, ...data }; return saved; },
      findMany: async (args) => { calls.push(args); return [before]; },
    },
    section: { findFirst: async () => ({ section_title: section }), findMany: async () => [{ id: 10, section_title: "In Progress" }, { id: 11, section_title: section }] },
    taskSectionEvent: { create: noop },
    drafts: { deleteMany: noop },
    user: { findUnique: async () => ({ id: 985 }) },
    $transaction: async (run) => run(db),
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/flags": { listFeatureFlagModes: async () => { calls.push("flags"); if (flagError) throw new Error("unavailable"); return flags; } },
    "@/lib/auth/agentScope": { recordAgentBoardScopeMiss() {} },
    "@/lib/telemetry/analyticsIntents": {},
    "@/lib/tasks/sameBoardRelations": {},
    "@/utils/controllers/tasks/parentTaskAccess": { ParentTaskNotFoundError: class extends Error {} },
    "@/lib/telemetry/activationOccurrences": { enqueueAgentTaskCompletion: noop },
    "../activities/createActivity": { default: noop },
    "../activities/createTaskMovedActivity": { createTaskMovedActivityInTransaction: async () => null },
    "../activities/sendTaskMoveNotification": {},
    "../notifications/creation-service/createAndSendNotificationTaskMove": { default: noop },
    "../description/common-description-create": { default: async ({ content }) => { saved = { ...saved, description_: { content } }; } },
    "@/pages/api/queues/FAST/generateSummary": { default() {} },
    "../turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer() {} },
    "../assignees/autoAssignForSection": {}, "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels() {} }, "./spawnRecurrence": {},
    "../notifications/agentFirstTaskEmail": { scheduleAgentFirstTaskEmail() {} },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/lib/mcp/tasks/agentMutationFence": { assertAgentAssignmentChangeAllowed: noop, TaskTeamScopeError: class extends Error {}, AgentMutationLeaseConflictError: class extends Error {} },
    "./invokeTaskDelete": {},
    "@/lib/mcp/webhooks/outbox": { persistBoardWebhookEvent: async () => [], publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: noop },
    "@/lib/mcp/tasks/humanMutationOverride": { normalizeRequestedTaskMutation: (value) => value, requestedTaskStateChanges: (_old, value) => value, hasRequestedTaskStateChange: () => false, taskLifecycleTimestampChanges: () => ({}) },
    "@/lib/mcp/tasks/agentDoneLifecycle": { assertAgentMayLeaveDone: noop, AgentDoneLifecycleDeniedError: class extends Error {} },
    "@/lib/cycleService": { CycleAssignmentError: class extends Error {} },
  };
  const controller = load("src/utils/controllers/tasks/single.ts", mocks);
  return { calls, db, before, saved: () => saved, mocks, update: (extra = {}, agentId = null) => controller.updateTaskSingle({ id: 1, sectionId: 11, section, ...extra }, { id: 985 }, agentId, { skipAutoAssign: true, taskMovedActivity: { fromAgent: null } }) };
}

for (const mode of ["OWNER_AND_QA", "OWNER_ONLY", "OFF"]) {
  for (const agentId of [null, "runner-agent"]) {
    test(`${agentId ? "agent" : "human"} move refuses ${mode} without saving`, async () => {
      const h = fixture({ flags: [{ ...own, mode }] });
      const result = await h.update({}, agentId);
      assert.equal(result.status, 409);
      assert.equal(result.json.code, "FLAG_COLUMN_MISMATCH");
      assert.match(result.json.message, new RegExp(`${own.key} \\(${mode}\\)`));
      assert.equal(h.saved().sectionId, 10);
      assert.ok(!h.calls.includes("saved"));
    });
  }
}

test("a released own flag cannot hide an unreleased linked flag", async () => {
  const h = fixture({ flags: [{ ...own, mode: "EVERYONE" }, dependency] });
  const result = await h.update();
  assert.equal(result.status, 409);
  assert.match(result.json.message, /htpr-5908-local-writing-assistance/);
});

for (const scenario of [
  { flags: [own, dependency].map((flag) => ({ ...flag, mode: "EVERYONE" })) },
  { section: "QA" },
  { projectId: 4060 },
  { flags: [{ key: "htpr-69060-other-ticket", mode: "OFF" }] },
]) {
  test(`allowed move still saves: ${JSON.stringify(scenario)}`, async () => {
    const h = fixture(scenario);
    const result = await h.update();
    assert.equal(result.status, 200);
    assert.equal(h.saved().sectionId, 11);
    assert.ok(h.calls.includes("saved"));
    if (scenario.section || scenario.projectId) assert.ok(!h.calls.includes("flags"));
  });
}

test("unreadable flag modes never permit a move", async () => {
  const h = fixture({ flagError: true });
  assert.equal((await h.update()).status, 500);
  assert.equal(h.saved().sectionId, 10);
});

test("daily audit lists linked and own restrictions without changing tickets", async () => {
  process.env.CRON_SECRET = "fixture-secret";
  const h = fixture();
  const route = load("src/app/api/cron/flag-column-audit/route.ts", h.mocks);
  const result = await route.GET(new NextRequest("https://app.hypertask.ai/api/cron/flag-column-audit", { headers: { authorization: "Bearer fixture-secret" } }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { checked: 1, mismatches: [{ ticket: "HTPR-6906", flags: [own, dependency] }] });
  assert.deepEqual(h.calls.find((call) => typeof call === "object").where, { projectId: 15, status: "Normal", sectionId: { in: [10, 11] } });
  assert.ok(!h.calls.includes("saved"));
});

test("daily audit accepts matching tickets; refuses missing authentication", async () => {
  process.env.CRON_SECRET = "fixture-secret";
  const h = fixture({ flags: [{ ...own, mode: "EVERYONE" }] });
  const route = load("src/app/api/cron/flag-column-audit/route.ts", h.mocks);
  const denied = await route.GET(new NextRequest("https://app.hypertask.ai/api/cron/flag-column-audit"));
  assert.equal(denied.status, 401);
  assert.equal(h.calls.length, 0);
  const allowed = await route.GET(new NextRequest("https://app.hypertask.ai/api/cron/flag-column-audit", { headers: { authorization: "Bearer fixture-secret" } }));
  assert.deepEqual(await allowed.json(), { checked: 1, mismatches: [] });
});

test("daily audit does not report success when its column is missing", async () => {
  process.env.CRON_SECRET = "fixture-secret";
  const h = fixture();
  h.db.section.findMany = async () => [];
  const route = load("src/app/api/cron/flag-column-audit/route.ts", h.mocks);
  const response = await route.GET(new NextRequest("https://app.hypertask.ai/api/cron/flag-column-audit", { headers: { authorization: "Bearer fixture-secret" } }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Flag: Everyone column not found" });
});


test("removing an obsolete dependency reference and moving saves the resulting ticket", async () => {
  const h = fixture({ flags: [{ ...own, mode: "EVERYONE" }, dependency] });
  const result = await h.update({ description: "" });
  assert.equal(result.status, 200);
  assert.equal(h.saved().sectionId, 11);
  assert.equal(h.saved().description_.content, "");
});
