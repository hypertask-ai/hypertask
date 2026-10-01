const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const agentId = "85b985ac-afe8-41a3-a1ac-d9549a9310c7";
let calls;
let autoAssignResult = "ready";

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const prisma = {
  task: {
    create: async ({ data }) => {
      calls.taskData = data;
      return { id: 99, ...data, project: { teamId: 1 }, priority: null };
    },
  },
  team_Activity: { update: async (options) => { calls.teamActivity = options; } },
  drafts: { create: async (options) => { calls.drafts.push(options); } },
};
stubModule("src/lib/prisma.ts", { __esModule: true, default: prisma });
stubModule("src/utils/controllers/tasks/create.ts", { getUniqueTaskCount: async () => 10 });
stubModule("src/utils/generateRank.ts", { __esModule: true, default: () => "a" });
stubModule("src/utils/controllers/description/common-description-create.ts", {
  __esModule: true,
  default: async (options) => { calls.description = options; return options; },
});
stubModule("src/lib/mcp/webhooks/taskEvents.ts", {
  createTaskWithBoardWebhookOutbox: async (db, actor, callback) => {
    calls.boardActor = actor;
    const result = await callback(db);
    return { ...result, boardWebhookDeliveryIds: ["delivery-1"] };
  },
});
stubModule("src/lib/mcp/webhooks/outbox.ts", {
  publishBoardWebhookDeliveries: async (ids) => { calls.deliveries = ids; },
});
stubModule("src/lib/agentWebhooks/outbox.ts", {
  persistAgentTaskCreatedPending: async (_tx, taskId) => { calls.pending = taskId; },
  markAgentTaskCreatedReady: async (taskId) => { calls.ready = taskId; },
  emitAgentTaskCreatedWebhook: async (options) => { calls.agentWebhook = options; },
});
stubModule("src/utils/controllers/assignees/autoAssignForSection.ts", {
  autoAssignForSection: async (options) => {
    calls.autoAssign = options;
    return autoAssignResult;
  },
});
stubModule("src/lib/agentWebhooks/taskCreatedRecovery.ts", {
  recoverPendingAgentTaskCreatedWebhook: async (taskId, actor) => {
    calls.recovery = { taskId, actor };
    return "recovered";
  },
});
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { createTaskCore } = jiti(path.join(root, "src/utils/controllers/tasks/createTaskCore.ts"));

for (const [name, options, expectedAgentId, assignmentResult] of [
  ["agent creation", { agentId }, agentId, "ready"],
  ["legacy creation without an agent", {}, null, "ready"],
  ["explicit null agent", { agentId: null }, null, "ready"],
  ["agent creation with pending assignment recovery", { agentId }, agentId, "pending"],
]) {
  test(`${name} preserves creator and attribution without assigning the creator`, async () => {
    calls = { drafts: [] };
    autoAssignResult = assignmentResult;
    const result = await createTaskCore({
      title: "Remove feature flag htpr-test",
      description: "<p>Remove the released flag.</p>",
      userId: 6,
      projectId: 15,
      sectionId: 1,
      sectionTitle: "Bugs",
      projectIdentifier: "HTPR",
      ranking: "a",
      ...options,
    });
    const actor = { userId: 6, agentId: expectedAgentId };
    assert.equal(calls.taskData.userId, 6);
    assert.equal(calls.taskData.agentId, expectedAgentId);
    assert.equal(result.task.agentId, expectedAgentId);
    assert.equal(result.task.ticketNumber, "HTPR-11");
    assert.equal(calls.taskData.assignees, undefined);
    assert.equal(calls.taskData.assigneeId, undefined);
    assert.deepEqual(calls.boardActor, actor);
    assert.equal(calls.description.agentId, options.agentId);
    assert.equal(calls.description.creatorId, 6);
    assert.deepEqual(calls.autoAssign, {
      taskId: 99, projectId: 15, sectionId: 1,
      currentUserId: 6, agentAssignerId: options.agentId,
    });
    assert.equal(calls.pending, 99);
    assert.deepEqual(calls.deliveries, ["delivery-1"]);
    assert.equal(calls.drafts.length, 2);
    assert.deepEqual(calls.teamActivity.data, { total_tasks: { increment: 1 } });
    if (assignmentResult === "pending") {
      assert.deepEqual(calls.recovery, { taskId: 99, actor });
      assert.equal(calls.agentWebhook, undefined);
    } else {
      assert.equal(calls.ready, 99);
      assert.deepEqual(calls.agentWebhook, { taskId: 99, actor });
    }
  });
}
