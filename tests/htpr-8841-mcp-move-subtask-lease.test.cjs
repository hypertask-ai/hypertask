const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const leaseMessage = "Caller holds no agent mutation lease for this task. Claim one with POST /mcp/tasks/lease/claim before this write.";

function tree() {
  return {
    20: { id: 20, projectId: 1, userId: 7, status: "Normal", parentTaskId: null, teamId: "team-a", subTasks: [{ id: 21 }] },
    21: { id: 21, projectId: 1, userId: 7, status: "Normal", parentTaskId: 20, subTasks: [] },
  };
}

function loadMove(updateTaskSingle) {
  const tasks = tree();
  const moved = [];
  const noRows = async () => [];
  const noCount = async () => ({ count: 0 });
  const prisma = {
    $transaction: async (run) => run(prisma),
    task: {
      findUnique: async ({ where }) => structuredClone(tasks[where.id]),
      findFirst: async () => null,
    },
    project: {
      findUnique: async () => ({ id: 2, teamId: "team-a", uniqueIdentifier: "B", status: "Normal" }),
      findFirst: async () => ({ id: 2 }),
    },
    section: {
      findUnique: async () => ({ id: 3, projectId: 2, section_title: "Todo" }),
    },
    page: { findMany: async () => [] },
    estimate: { updateMany: noCount },
    priority: { updateMany: noCount },
    savedContent: { updateMany: noCount },
    notification: { deleteMany: noCount },
    assignees: { findMany: noRows, deleteMany: noCount },
    follower: { findMany: noRows, deleteMany: noCount },
    drafts: { deleteMany: noCount },
    reminder: { deleteMany: noCount },
    taskLabel: { findMany: noRows },
  };
  const { moveTaskToDifferentBoard } = load("src/utils/controllers/tasks/moveToDifferentBoard.ts", {
    "@prisma/client": { Prisma: { join: () => { throw new Error("page lock was not part of this move"); } } },
    "date-fns": { subMinutes: (date) => date },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/getMemberAndOwnerForBoard": { __esModule: true, default: async () => [7] },
    "@/utils/generateRank": { __esModule: true, default: () => "rank" },
    "./getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 8 },
    "@/pages/api/queues/duedateQueue": { cancelDueDateJob: async () => {}, scheduleDueDateJob: async () => {} },
    "@/utils/controllers/tasks/single": {
      TASK_IDENTITY_CONFLICT_CODE: "TASK_IDENTITY_CONFLICT",
      updateTaskSingle: async (mutation) => {
        moved.push(mutation.id);
        return updateTaskSingle(mutation);
      },
    },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: async () => "ready" },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "../turbopuffer/turbopufferHelper": { upsertPageToTurbopuffer: async () => {} },
  });
  return {
    moved,
    move: () => moveTaskToDifferentBoard({
      taskId: 20,
      currentProjectId: 1,
      targetProjectId: 2,
      targetSectionId: 3,
      currentUser: { id: 7 },
      agentId: "agent-a",
    }),
  };
}

test("a subtask lease refusal is returned as 409 instead of crashing the move", async () => {
  const harness = loadMove((mutation) => mutation.id === 21
    ? { status: 409, json: { message: leaseMessage } }
    : { status: 200, json: { id: mutation.id } });

  const result = await harness.move();

  assert.deepEqual(result, {
    success: false,
    error: leaseMessage,
    statusCode: 409,
  });
  assert.deepEqual(harness.moved, [20, 21]);
});

test("a subtask server failure still rejects the move", async () => {
  const harness = loadMove((mutation) => mutation.id === 21
    ? { status: 500, json: { message: "Failed to update task" } }
    : { status: 200, json: { id: mutation.id } });

  await assert.rejects(harness.move(), /Failed to update task/);
  assert.deepEqual(harness.moved, [20, 21]);
});

test("a tree move still succeeds when every subtask accepts the move", async () => {
  const harness = loadMove((mutation) => ({ status: 200, json: { id: mutation.id, projectId: 2 } }));

  const result = await harness.move();

  assert.equal(result.success, true);
  assert.equal(result.task.id, 20);
  assert.deepEqual(harness.moved, [20, 21]);
});
