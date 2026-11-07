const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const { assertAgentWriting } = load("src/lib/agents/writing.ts", {});
const { hasUnfinishedFullDayObservation } = load("src/lib/tasks/observationGate.ts", {});

const phoneUnlock = `<p><strong>What this is:</strong> Observation gate: the phone stays locked.</p>
<ul>
<li><p>Problem: QA cannot open the app.</p></li>
<li><p>Reason: physical access is required.</p></li>
<li><p>Outcomes: the check passes or stays blocked.</p></li>
<li><p><strong>Question:</strong> Unlock the phone?</p></li>
</ul>
<p><strong>My recommendation:</strong> Yes.</p>
<p><strong>Why:</strong> Someone must be there.</p>
<p><strong>Yes:</strong> Unlock it for the check.</p>
<p><strong>No:</strong> Leave it locked.</p>`;

test("a phone-unlock question with the observation gate and three points is accepted", () => {
  assert.doesNotThrow(() => assertAgentWriting("agent", { text: phoneUnlock }, {}, { houseRules: true }));
});

test("four real context points are still refused", () => {
  const text = phoneUnlock.replace(
    "<li><p><strong>Question:</strong>",
    "<li><p>Extra: one more point.</p></li><li><p><strong>Question:</strong>",
  );
  assert.throws(() => assertAgentWriting("agent", { text }, {}, { houseRules: true }), /three points/);
});

test("a completion heading that names the observation gate is accepted", () => {
  for (const heading of [
    "Observation gate: the full-day check is still open.",
    "Acceptance gate: the full-day observation is unfinished.",
    "Full-day observation gate: still unfinished.",
    "Decisions: none.",
  ]) {
    assert.doesNotThrow(() => assertAgentWriting("agent", {
      text: `<p>Search now finds reminders.</p><p>${heading}</p>`,
    }));
  }
  assert.throws(() => assertAgentWriting("agent", { text: "<p>Gate: still running.</p>" }), /Robot status/);
  assert.throws(() => assertAgentWriting("agent", { text: "<p>Next: wait for checks.</p>" }), /Robot status/);
  assert.throws(() => assertAgentWriting("agent", { text: "<p>Helpers: none.</p>" }), /Robot status/);
});

test("an explicit unfinished full-day observation gate stays open", () => {
  assert.equal(hasUnfinishedFullDayObservation("<p>Full-day observation gate: still unfinished.</p>"), true);
  assert.equal(hasUnfinishedFullDayObservation("An explicit unfinished full-day observation gate remains."), true);
  assert.equal(hasUnfinishedFullDayObservation("Full-day observation gate: passed."), false);
  assert.equal(hasUnfinishedFullDayObservation("Search now finds reminders."), false);
});

function moveFixture({ section = "Done", isDone = true, description = "", acceptanceCriteria = "" } = {}) {
  const before = {
    id: 1,
    projectId: 15,
    uniqueIndex: 8872,
    ticketNumber: "HTPR-8872",
    userId: 985,
    sectionId: 10,
    section: "In Progress",
    status: "Normal",
    title: "Full-day observation",
    description: "",
    acceptanceCriteria,
    description_: { content: description },
  };
  let saved = before;
  const calls = [];
  const noop = async () => undefined;
  const db = {
    project: { findFirst: async () => ({ id: 15 }) },
    task: {
      findUnique: async () => saved,
      findUniqueOrThrow: async () => saved,
      update: async ({ data }) => { calls.push("saved"); saved = { ...saved, ...data }; return saved; },
      findMany: async () => [before],
    },
    section: {
      findFirst: async () => ({ section_title: section, isDone }),
      findMany: async () => [],
    },
    taskSectionEvent: { create: noop },
    drafts: { deleteMany: noop },
    user: { findUnique: async () => ({ id: 985 }) },
    $transaction: async (run) => run(db),
  };
  const controller = load("src/utils/controllers/tasks/single.ts", {
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError: class extends Error {} }, Status: { Normal: "Normal" } },
    "@/lib/prisma": { default: db },
    "@/lib/flags": { listFeatureFlagModes: async () => [] },
    "@/lib/auth/agentScope": { recordAgentBoardScopeMiss() {} },
    "@/lib/telemetry/analyticsIntents": {},
    "@/lib/tasks/sameBoardRelations": {},
    "@/utils/controllers/tasks/parentTaskAccess": { ParentTaskNotFoundError: class extends Error {} },
    "@/lib/telemetry/activationOccurrences": { enqueueAgentTaskCompletion: noop },
    "../activities/createActivity": { default: noop },
    "../activities/createTaskMovedActivity": { createTaskMovedActivityInTransaction: async () => null },
    "../activities/sendTaskMoveNotification": {},
    "../notifications/creation-service/createAndSendNotificationTaskMove": { default: noop },
    "../description/common-description-create": { default: noop },
    "@/pages/api/queues/FAST/generateSummary": { default() {} },
    "../turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer() {} },
    "../assignees/autoAssignForSection": {},
    "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels() {} },
    "./spawnRecurrence": {},
    "../notifications/agentFirstTaskEmail": { scheduleAgentFirstTaskEmail() {} },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/lib/mcp/tasks/agentMutationFence": {
      assertAgentAssignmentChangeAllowed: noop,
      TaskTeamScopeError: class extends Error {},
      AgentMutationLeaseConflictError: class extends Error {},
    },
    "./invokeTaskDelete": {},
    "@/lib/mcp/webhooks/outbox": { persistBoardWebhookEvent: async () => [], publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: noop },
    "@/lib/mcp/tasks/humanMutationOverride": {
      normalizeRequestedTaskMutation: (value) => value,
      requestedTaskStateChanges: (_old, value) => value,
      hasRequestedTaskStateChange: () => false,
      taskLifecycleTimestampChanges: () => ({}),
    },
    "@/lib/mcp/tasks/agentDoneLifecycle": { assertAgentMayLeaveDone: noop, AgentDoneLifecycleDeniedError: class extends Error {} },
    "@/lib/cycleService": { CycleAssignmentError: class extends Error {} },
  });
  return {
    calls,
    saved: () => saved,
    update: () => controller.updateTaskSingle(
      { id: 1, sectionId: 11, section },
      { id: 985 },
      null,
      { skipAutoAssign: true, taskMovedActivity: { fromAgent: null } },
    ),
  };
}

test("a done move keeps a ticket with an unfinished full-day observation gate", async () => {
  const open = moveFixture({ description: "<p>Full-day observation gate: still unfinished.</p>" });
  const refused = await open.update();
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, "OPEN_OBSERVATION_GATE");
  assert.match(refused.json.message, /full-day observation gate is still unfinished/);
  assert.equal(open.saved().sectionId, 10);
  assert.ok(!open.calls.includes("saved"));

  const criteria = moveFixture({
    section: "Flag: Everyone",
    isDone: true,
    acceptanceCriteria: "An explicit unfinished full-day observation gate remains.",
  });
  assert.equal((await criteria.update()).status, 409);
  assert.equal(criteria.saved().sectionId, 10);

  const working = moveFixture({
    section: "In Progress",
    isDone: false,
    description: "<p>Full-day observation gate: still unfinished.</p>",
  });
  assert.equal((await working.update()).status, 200);
  assert.equal(working.saved().sectionId, 11);

  const closed = moveFixture({ description: "<p>Full-day observation gate: passed.</p>" });
  assert.equal((await closed.update()).status, 200);
  assert.equal(closed.saved().sectionId, 11);
});
