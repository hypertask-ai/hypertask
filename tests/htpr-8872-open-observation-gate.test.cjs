const test = require("node:test");
const assert = require("node:assert/strict");
const { load, withStubs } = require("./task-route-loader.cjs");

const noop = async () => undefined;

const openChecklist = '<h2>Done when</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Full-day observation: watch production for 24 hours</p></li></ul>';
const checkedChecklist = openChecklist.replace('data-checked="false"', 'data-checked="true"');
const ordinary = '<h2>Done when</h2><ul><li><p>Search finds reminders.</p></li></ul>';
const openProse = '<p>Full-day observation gate: still unfinished.</p>';

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
  const controller = load("src/utils/controllers/tasks/single.ts", withStubs({}, {
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
  }));
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

for (const [name, fixture, extra, agentId, target, mark, expected] of [
  ["an unchecked full-day observation", { description: openChecklist }, {}, "runner-agent", undefined, "section", ["OPEN_OBSERVATION_GATE", /Full-day observation: watch production for 24 hours/]],
  ["an unchecked full-day observation for a person", { description: openChecklist }, {}, null, undefined, "section", [undefined, /Full-day observation: watch production for 24 hours/]],
  ["a written gate that is still open", { description: openProse }, {}, null, undefined, "section", [undefined, /still unfinished/]],
  ["a written gate with the article", { description: "<p>The full-day observation gate is not finished.</p>" }, {}, null, undefined, "section", [undefined, /not finished/]],
  ["a written gate with inline markup", { description: "<p>Full-day observation gate: still <strong>unfinished</strong>.</p>" }, {}, null, undefined, "section", [undefined, /unfinished/]],
  ["a gate in acceptance criteria", { acceptanceCriteria: "<p>Full-day observation gate: incomplete.</p>" }, {}, null, undefined, "section", [undefined, /incomplete/]],
  ["a gate added in the same move", { description: ordinary }, { description: openChecklist }, null, undefined, "nothing", [undefined, /Full-day observation: watch production for 24 hours/]],
  ["a gate read by column name alone", { description: openChecklist }, {}, null, { section: "Flag: Everyone" }, "section", [undefined, /Full-day observation: watch production for 24 hours/]],
]) {
  test(`refuses Done for ${name}`, async () => {
    const h = harness(fixture);
    const result = await h.update(extra, agentId, target);
    assert.equal(result.status, 409);
    if (expected[0]) assert.equal(result.json.code, expected[0]);
    assert.match(result.json.message, expected[1]);
    assert.equal(h.saved().sectionId, 10);
    if (mark === "nothing") assert.ok(!h.calls.includes("saved"));
  });
}

for (const [name, description, acceptanceCriteria] of [
  ["a plain ticket", ordinary, ""],
  ["a checked observation", checkedChecklist, ""],
  ["a checked observation with a plain bullet beside it", `${checkedChecklist}<ul><li><p>Observation results are attached.</p></li></ul>`, ""],
  ["a passed gate line", "<p>Full-day observation gate: passed.</p>", ""],
  ["a passed gate line with inline markup", "<p>Full-day observation gate: <em>passed</em>.</p>", ""],
  ["a passed gate beside another topic", "<p>Full-day observation gate: passed; report unfinished</p>", ""],
  ["a gate that is no longer unfinished", "<p>Full-day observation gate: no longer unfinished.</p>", ""],
  ["prose that only mentions a gate", "<ul><li><p>A ticket can state a full-day observation gate that is not finished.</p></li></ul>", ""],
  ["a passed gate with other acceptance criteria", "<p>Full-day observation gate: passed.</p>", "Report: unfinished"],
  ["a ticket with no description", "", ""],
]) {
  test(`still moves ${name} to Done`, async () => {
    const h = harness({ description, acceptanceCriteria });
    const result = await h.update({});
    assert.equal(result.status, 200);
    assert.equal(h.saved().sectionId, 11);
  });
}

test("an open gate never blocks a move to a working column", async () => {
  const h = harness({ description: openChecklist, section: "QA", isDone: false });
  const result = await h.update({}, null, { sectionId: 5511, section: "QA" });
  assert.equal(result.status, 200);
  assert.equal(h.saved().sectionId, 5511);
});
