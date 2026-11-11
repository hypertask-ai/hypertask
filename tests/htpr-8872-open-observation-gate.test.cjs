const test = require("node:test");
const assert = require("node:assert/strict");
const { load, withStubs } = require("./task-route-loader.cjs");

const noop = async () => undefined;

const openChecklist = '<h2>Done when</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Full-day observation: watch production for 24 hours</p></li></ul>';
const checkedChecklist = '<h2>Done when</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Full-day observation: watch production for 24 hours</p></li></ul>';
const ordinary = '<h2>Done when</h2><ul><li><p>Search finds reminders.</p></li></ul>';
const openProse = '<p>Full-day observation gate: still unfinished.</p>';
const passedProse = '<p>Full-day observation gate: passed.</p>';

function harness({ description = "", acceptanceCriteria = "", section = "Flag: Everyone", isDone = true, projectId = 15 } = {}) {
  const before = {
    id: 1,
    projectId,
    uniqueIndex: 8872,
    ticketNumber: "HTPR-8872",
    userId: 985,
    sectionId: 10,
    section: "In Progress",
    status: "Normal",
    title: "Fixture",
    description: "",
    acceptanceCriteria,
    description_: { content: description },
  };
  let saved = before;
  const calls = [];
  const db = {
    project: { findFirst: async () => ({ id: projectId }) },
    task: {
      findUnique: async () => saved,
      findUniqueOrThrow: async () => saved,
      update: async ({ data }) => { calls.push("saved"); saved = { ...saved, ...data }; return saved; },
      findMany: async () => [before],
    },
    section: {
      findFirst: async () => ({ section_title: section, isDone }),
      findMany: async () => [{ section_title: section, isDone }],
    },
    taskSectionEvent: { create: noop },
    drafts: { deleteMany: noop },
    user: { findUnique: async () => ({ id: 985 }) },
    $transaction: async (run) => run(db),
  };
  const stubs = withStubs({}, {
    "@/lib/prisma": { default: db },
    "@/lib/flags": { isFeatureEnabled: async () => false, listFeatureFlagModes: async () => [] },
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
    "../assignees/autoAssignForSection": {}, "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels() {} }, "./spawnRecurrence": { sectionIsDone: async () => false },
    "../notifications/agentFirstTaskEmail": { scheduleAgentFirstTaskEmail() {} },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/lib/mcp/tasks/agentMutationFence": { assertAgentAssignmentChangeAllowed: noop, TaskTeamScopeError: class extends Error {}, AgentMutationLeaseConflictError: class extends Error {} },
    "./invokeTaskDelete": {},
    "@/lib/mcp/webhooks/outbox": { persistBoardWebhookEvent: async () => [], publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: noop },
    "@/lib/mcp/tasks/humanMutationOverride": { normalizeRequestedTaskMutation: (value) => value, requestedTaskStateChanges: (_old, value) => value, hasRequestedTaskStateChange: () => false, taskLifecycleTimestampChanges: () => ({}) },
    "@/lib/mcp/tasks/agentDoneLifecycle": { assertAgentMayLeaveDone: noop, AgentDoneLifecycleDeniedError: class extends Error {} },
    "@/lib/cycleService": { CycleAssignmentError: class extends Error {} },
  });
  const controller = load("src/utils/controllers/tasks/single.ts", stubs);
  return {
    calls,
    saved: () => saved,
    update: (extra = {}, agentId = null, target = { sectionId: 11, section }) => controller.updateTaskSingle(
      { id: 1, ...target, ...extra },
      { id: 985 },
      agentId,
      { skipAutoAssign: true, taskMovedActivity: { fromAgent: null } },
    ),
  };
}

test("an unchecked full-day observation refuses the Done move and names the gate", async () => {
  for (const agentId of [null, "runner-agent"]) {
    const h = harness({ description: openChecklist });
    const result = await h.update({}, agentId);
    assert.equal(result.status, 409);
    assert.equal(result.json.code, "OPEN_OBSERVATION_GATE");
    assert.match(result.json.message, /Full-day observation: watch production for 24 hours/);
    assert.equal(h.saved().sectionId, 10);
    assert.ok(!h.calls.includes("saved"));
  }
});

test("a written observation gate that is still open refuses the Done move and names it", async () => {
  const h = harness({ description: openProse });
  const result = await h.update({});
  assert.equal(result.status, 409);
  assert.match(result.json.message, /full-day observation gate: still unfinished/i);
  assert.equal(h.saved().sectionId, 10);
});

test("an open gate in acceptance criteria refuses the Done move", async () => {
  const h = harness({ acceptanceCriteria: "<p>Full-day observation gate: incomplete.</p>" });
  const result = await h.update({});
  assert.equal(result.status, 409);
  assert.match(result.json.message, /incomplete/);
  assert.equal(h.saved().sectionId, 10);
});

test("a gate on a description written in the same move still refuses Done", async () => {
  const h = harness({ description: ordinary });
  const result = await h.update({ description: openChecklist });
  assert.equal(result.status, 409);
  assert.match(result.json.message, /Full-day observation: watch production for 24 hours/);
  assert.equal(h.calls.filter((call) => call === "saved").length, 0);
});

test("a ticket with no observation gate moves to Done as before", async () => {
  const h = harness({ description: ordinary });
  const result = await h.update({});
  assert.equal(result.status, 200);
  assert.equal(h.saved().sectionId, 11);
  assert.ok(h.calls.includes("saved"));
});

test("a finished observation moves to Done as before", async () => {
  for (const description of [checkedChecklist, passedProse]) {
    const h = harness({ description });
    const result = await h.update({});
    assert.equal(result.status, 200);
    assert.equal(h.saved().sectionId, 11);
  }
});

test("an open gate never blocks a move to a working column", async () => {
  const h = harness({ description: openChecklist, section: "QA", isDone: false });
  const result = await h.update({}, null, { sectionId: 5511, section: "QA" });
  assert.equal(result.status, 200);
  assert.equal(h.saved().sectionId, 5511);
});

test("a gate is read only when the ticket states one", async () => {
  const passes = [
    "<ul><li><p>A ticket can state a full-day observation gate that is not finished.</p></li></ul>",
    "<p>Full-day observation gate: no longer unfinished.</p>",
    "<p>Full-day observation gate: passed; report unfinished</p>",
    "<p>Observation from support: the reminder arrived.</p>",
  ];
  for (const description of passes) {
    const h = harness({ description });
    assert.equal((await h.update({})).status, 200, description);
  }
  const refuses = [
    ["<p>Full-day observation gate: still unfinished.</p>", /still unfinished/],
    ["<p>The full-day observation gate is not finished.</p>", /not finished/],
    ["<p>- Full-day observation: incomplete.</p>", /incomplete/],
  ];
  for (const [description, expected] of refuses) {
    const h = harness({ description });
    const result = await h.update({});
    assert.equal(result.status, 409, description);
    assert.match(result.json.message, expected);
  }
});

test("a done move by column name alone still reads the gate", async () => {
  const h = harness({ description: openChecklist });
  const result = await h.update({}, null, { section: "Flag: Everyone" });
  assert.equal(result.status, 409);
  assert.match(result.json.message, /Full-day observation: watch production for 24 hours/);
  assert.equal(h.saved().sectionId, 10);
});
