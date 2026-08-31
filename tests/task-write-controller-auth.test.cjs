const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const USER_ID = 6;
const OWNED_AGENT = "agent-owned";
const REVOKED_AGENT = "agent-revoked";
const BORROWED_AGENT = "agent-borrowed";
const SOURCE_PROJECT = 10;
const OWNER_PROJECT = 11;
const MEMBER_PROJECT = 12;
const AGENT_PROJECT = 13;
const FOREIGN_PROJECT = 99;
const TASK_ID = 101;
const SECTION_ID = 201;

const knownProjects = new Set([
  SOURCE_PROJECT,
  OWNER_PROJECT,
  MEMBER_PROJECT,
  AGENT_PROJECT,
  FOREIGN_PROJECT,
]);

// The project helper's identity matrix is exercised against its real query in
// project-delegate-access.test.cjs. These controller fakes prove each caller
// consumes that decision before mutating anything.
const taskWriteAccessWhere = (userId, agentId) => ({
  testAccess: { userId, agentId: agentId ?? null },
});

function findWritableProject(where) {
  const access = where.testAccess;
  if (!access || access.userId !== USER_ID) return null;
  const allowed = access.agentId
    ? access.agentId === OWNED_AGENT &&
      [SOURCE_PROJECT, OWNER_PROJECT, MEMBER_PROJECT, AGENT_PROJECT].includes(where.id)
    : [SOURCE_PROJECT, OWNER_PROJECT, MEMBER_PROJECT].includes(where.id);
  return allowed ? { id: where.id } : null;
}

function compile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
}

function execute(javascript, stubs) {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function loadUpdateController(
  projectId,
  destinationSectionProjectId,
  { moveShouldNotify = false } = {},
) {
  const calls = { transaction: 0, sideEffects: 0 };
  const noop = () => {
    calls.sideEffects += 1;
  };
  const currentTask = {
    id: TASK_ID,
    projectId,
    title: "Task",
    description: "",
    description_: { content: "" },
    section: "Backlog",
    sectionId: SECTION_ID - 1,
    userId: USER_ID,
    status: "Normal",
    ranking: "rank",
    archivedAt: null,
    deletedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ticketNumber: "S-1",
    parentTaskId: null,
    uniqueIndex: 1,
    dueDate: null,
    recurrence: null,
  };
  const tx = {
    task: {
      findUnique: async () => currentTask,
      update: async ({ data }) => {
        (calls.order ??= []).push("task-update");
        return { ...currentTask, ...data };
      },
    },
    section: {
      findFirst: async ({ where }) => {
        calls.validatedSectionProjectId = where.projectId;
        return where.projectId === destinationSectionProjectId
          ? { section_title: "Todo" }
          : null;
      },
      findMany: async () => [
        { id: SECTION_ID - 1, section_title: "Backlog" },
        { id: SECTION_ID, section_title: "Todo" },
      ],
    },
    taskSectionEvent: { create: async () => undefined },
  };
  const prisma = {
    task: {
      findUnique: async () => currentTask,
    },
    project: {
      findFirst: async ({ where }) => findWritableProject(where),
    },
    $transaction: async (callback) => {
      calls.transaction += 1;
      if (destinationSectionProjectId === undefined) {
        throw new Error("a denied write reached the transaction");
      }
      calls.transactionActive = true;
      calls.transactionClient = tx;
      try {
        return await callback(tx);
      } finally {
        calls.transactionActive = false;
      }
    },
  };
  const createTaskMovedActivityInTransaction = async (args) => {
    assert.equal(calls.transactionActive, true);
    calls.moveActivityArgs = args;
    (calls.order ??= []).push("move-activity");
    return { newComment: { id: 1 }, shouldNotify: moveShouldNotify };
  };
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/api/errorMessage": execute(compile("src/lib/api/errorMessage.ts"), {}),
    "@/models/ActivityModels.ts": {},
    "@/models/model": {},
    "@prisma/client": { Status: { Archive: "Archive" } },
    "../activities/createActivity": noop,
    "../activities/createTaskMovedActivity": {
      createTaskMovedActivityInTransaction,
    },
    "../activities/sendTaskMoveNotification": {
      sendTaskMoveNotificationIfNeeded: async (result, sendNotification) => {
        if (!result.shouldNotify) return false;
        try {
          await sendNotification();
          return true;
        } catch {
          return false;
        }
      },
    },
    "../notifications/creation-service/createAndSendNotificationTaskMove": noop,
    "../description/common-description-create": noop,
    "@/pages/api/queues/FAST/generateSummary": noop,
    "../turbopuffer/turbopufferHelper": {
      upsertAllCommentsToTurbopuffer: noop,
      upsertTaskToTurbopuffer: noop,
    },
    "../assignees/autoAssignForSection": { autoAssignForSection: noop },
    "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels: noop },
    "./spawnRecurrence": { sectionIsDone: noop, spawnNextRecurrence: noop },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: noop,
      cancelAgentMutationLeaseForHumanOverride: noop,
    },
    "./invokeTaskDelete": {},
    "@/lib/mcp/webhooks/outbox": {
      persistBoardWebhookEvent: async () => [],
      publishBoardWebhookDeliveries: noop,
    },
    "@/lib/agentWebhooks/outbox": {
      persistAgentTaskUpdatedWebhook: async () => [],
      publishAgentWebhookDeliveries: noop,
    },
    "@/lib/mcp/tasks/humanMutationOverride": {
      hasRequestedTaskStateChange: () => false,
      normalizeRequestedTaskMutation: (task) => task,
      requestedTaskStateChanges: (_task, mutation) => mutation,
      taskLifecycleTimestampChanges: () => ({}),
    },
  };
  return {
    updateTaskSingle: execute(
      compile("src/utils/controllers/tasks/single.ts"),
      stubs,
    ).updateTaskSingle,
    calls,
  };
}

test("the shared update controller refuses a foreign board before any write or side effect", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(FOREIGN_PROJECT);
  const result = await updateTaskSingle(
    { id: TASK_ID, title: "not allowed" },
    { id: USER_ID },
  );

  assert.equal(result.status, 404);
  assert.deepEqual(calls, { transaction: 0, sideEffects: 0 });
});

test("the shared update controller rejects project changes outside the dedicated mover", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(
    OWNER_PROJECT,
    MEMBER_PROJECT,
  );
  const result = await updateTaskSingle(
    {
      id: TASK_ID,
      projectId: MEMBER_PROJECT,
      sectionId: SECTION_ID,
      section: "Todo",
    },
    { id: USER_ID },
  );

  assert.equal(result.status, 400);
  assert.deepEqual(calls, { transaction: 0, sideEffects: 0 });
});

test("the shared update controller validates a moved section against the destination board", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(
    OWNER_PROJECT,
    MEMBER_PROJECT,
  );
  const result = await updateTaskSingle(
    {
      id: TASK_ID,
      projectId: MEMBER_PROJECT,
      sectionId: SECTION_ID,
      section: "Todo",
    },
    { id: USER_ID },
    null,
    {
      allowProjectChange: true,
      skipAutoAssign: true,
      skipRecurrence: true,
    },
  );

  assert.equal(result.status, 200);
  assert.equal(calls.validatedSectionProjectId, MEMBER_PROJECT);
  assert.equal(result.json.projectId, MEMBER_PROJECT);
  assert.equal(result.json.sectionId, SECTION_ID);
});

test("a task move and its activity persist inside the same fenced transaction", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(
    OWNER_PROJECT,
    OWNER_PROJECT,
  );
  let deliveries = 0;
  const result = await updateTaskSingle(
    {
      id: TASK_ID,
      sectionId: SECTION_ID,
      section: "Todo",
    },
    { id: USER_ID, displayName: "Valentin" },
    null,
    {
      skipAutoAssign: true,
      skipRecurrence: true,
      taskMovedActivity: {
        sendNotification: async () => {
          deliveries += 1;
        },
      },
    },
  );

  assert.equal(result.status, 200);
  assert.deepEqual(calls.order, ["task-update", "move-activity"]);
  assert.equal(calls.moveActivityArgs.fromSectionId, SECTION_ID - 1);
  assert.equal(calls.moveActivityArgs.toSectionId, SECTION_ID);
  assert.equal(calls.moveActivityArgs.transaction, calls.transactionClient);
  assert.equal(result.moveActivity.shouldNotify, false);
  assert.equal(deliveries, 0);
});

test("a post-commit move notification failure preserves the successful update", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(
    OWNER_PROJECT,
    OWNER_PROJECT,
    { moveShouldNotify: true },
  );
  let deliveryAttempts = 0;
  const result = await updateTaskSingle(
    {
      id: TASK_ID,
      sectionId: SECTION_ID,
      section: "Todo",
    },
    { id: USER_ID, displayName: "Valentin" },
    null,
    {
      skipAutoAssign: true,
      skipRecurrence: true,
      taskMovedActivity: {
        sendNotification: async () => {
          assert.equal(calls.transactionActive, false);
          deliveryAttempts += 1;
          throw new Error("delivery unavailable");
        },
      },
    },
  );

  assert.equal(result.status, 200);
  assert.deepEqual(calls.order, ["task-update", "move-activity"]);
  assert.equal(result.moveActivity.shouldNotify, true);
  assert.equal(deliveryAttempts, 1);
});

function loadMoveController({ targetProjectId, sectionProjectId, agentId }) {
  const calls = { downstream: 0, queue: 0 };
  const currentTask = {
    id: TASK_ID,
    projectId: SOURCE_PROJECT,
    userId: USER_ID,
    parentTaskId: null,
    dueDate: null,
    uniqueIndex: 5731,
    ticketNumber: "HTPR-5731",
    subTasks: [],
  };
  const prisma = {
    task: {
      findUnique: async () => currentTask,
      findFirst: async () => null,
    },
    project: {
      findUnique: async ({ where, select }) => {
        if (where.id === SOURCE_PROJECT && select) return { teamId: "team-1" };
        return knownProjects.has(where.id)
          ? {
              id: where.id,
              uniqueIdentifier: where.id === SOURCE_PROJECT ? "HTPR" : "T",
              teamId: "team-1",
            }
          : null;
      },
      findFirst: async ({ where }) => findWritableProject(where),
    },
    section: {
      findUnique: async () => ({
        id: SECTION_ID,
        projectId: sectionProjectId,
        section_title: "Todo",
      }),
    },
    estimate: { updateMany: async () => undefined },
    priority: { updateMany: async () => undefined },
    savedContent: { updateMany: async () => undefined },
    notification: { deleteMany: async () => undefined },
    drafts: { deleteMany: async () => undefined },
    reminder: { deleteMany: async () => undefined },
    assignees: { findMany: async () => [] },
    follower: { findMany: async () => [] },
    taskLabel: { findMany: async () => [] },
  };
  const updateTaskSingle = async (task, _user, _agentId, options) => {
    calls.downstream += 1;
    calls.allowProjectChange = options?.allowProjectChange;
    calls.updatedTask = task;
    const projectChanged = task.projectId !== undefined && task.projectId !== currentTask.projectId;
    return !projectChanged || options?.allowProjectChange
      ? { status: 200, json: { ...currentTask, ...task } }
      : { status: 400, json: { message: "Project change denied" } };
  };
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/api/errorMessage": execute(compile("src/lib/api/errorMessage.ts"), {}),
    "@/utils/controllers/getMemberAndOwnerForBoard": async () => [],
    "@/utils/generateRank": () => "rank",
    "@/utils/controllers/tasks/create": {
      getUniqueTaskCount: async () => {
        calls.downstream += 1;
        return 0;
      },
    },
    "@/pages/api/queues/duedateQueue": {
      cancelDueDateJob: async () => {
        calls.queue += 1;
      },
      scheduleDueDateJob: async () => {
        calls.queue += 1;
      },
    },
    "date-fns": { subMinutes: (date) => date },
    "@/utils/controllers/tasks/single": { updateTaskSingle },
    "@/models/model": {},
    "@/utils/controllers/assignees/autoAssignForSection": {
      autoAssignForSection: async () => "ready",
    },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere },
  };
  const { moveTaskToDifferentBoard } = execute(
    compile("src/utils/controllers/tasks/moveToDifferentBoard.ts"),
    stubs,
  );
  return {
    move: () =>
      moveTaskToDifferentBoard({
        taskId: TASK_ID,
        targetProjectId,
        targetSectionId: SECTION_ID,
        currentProjectId: SOURCE_PROJECT,
        currentUser: { id: USER_ID },
        agentId,
      }),
    calls,
  };
}

test("cross-board moves preserve the ticket key while allocating a destination index", async () => {
  const { move, calls } = loadMoveController({
    targetProjectId: OWNER_PROJECT,
    sectionProjectId: OWNER_PROJECT,
    agentId: null,
  });
  const result = await move();

  assert.equal(result.success, true);
  assert.equal(result.task.projectId, OWNER_PROJECT);
  assert.equal(result.task.uniqueIndex, 1);
  assert.equal(result.task.ticketNumber, "HTPR-5731");
  assert.equal(calls.updatedTask.ticketNumber, undefined);
  assert.equal(calls.allowProjectChange, true);
});

test("same-board moves preserve task identity while changing the section", async () => {
  const { move, calls } = loadMoveController({
    targetProjectId: SOURCE_PROJECT,
    sectionProjectId: SOURCE_PROJECT,
    agentId: null,
  });
  const result = await move();

  assert.equal(result.success, true);
  assert.equal(result.task.id, TASK_ID);
  assert.equal(result.task.projectId, SOURCE_PROJECT);
  assert.equal(result.task.uniqueIndex, 5731);
  assert.equal(result.task.ticketNumber, "HTPR-5731");
  assert.equal(result.task.sectionId, SECTION_ID);
  assert.equal(
    `/detail/project-${result.task.projectId}/${result.task.uniqueIndex}`,
    "/detail/project-10/5731",
  );
  assert.equal(calls.updatedTask.projectId, undefined);
  assert.equal(calls.updatedTask.uniqueIndex, undefined);
  assert.equal(calls.updatedTask.ticketNumber, undefined);
  assert.equal(calls.allowProjectChange, undefined);
  assert.equal(calls.downstream, 1);
  assert.equal(calls.queue, 0);
});

for (const scenario of [
  ["foreign user", FOREIGN_PROJECT, null],
  ["revoked agent context", OWNER_PROJECT, REVOKED_AGENT],
  ["borrowed agent context", OWNER_PROJECT, BORROWED_AGENT],
]) {
  test(`cross-board moves deny a ${scenario[0]} without writes or queue work`, async () => {
    const { move, calls } = loadMoveController({
      targetProjectId: scenario[1],
      sectionProjectId: scenario[1],
      agentId: scenario[2],
    });
    const result = await move();

    assert.equal(result.statusCode, 404);
    assert.deepEqual(calls, { downstream: 0, queue: 0 });
  });
}

test("cross-board moves reject a section from another board without side effects", async () => {
  const { move, calls } = loadMoveController({
    targetProjectId: OWNER_PROJECT,
    sectionProjectId: MEMBER_PROJECT,
    agentId: null,
  });
  const result = await move();

  assert.equal(result.statusCode, 404);
  assert.deepEqual(calls, { downstream: 0, queue: 0 });
});
