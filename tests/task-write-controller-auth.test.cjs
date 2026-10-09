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

class PrismaClientKnownRequestError extends Error {}

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

test("first-task email integration schedules the committed transition with authenticated actor", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(OWNER_PROJECT, OWNER_PROJECT, {
    stateAtFence: { title: "Latest title under the fence" },
  });
  const result = await updateTaskSingle({ id: TASK_ID, sectionId: SECTION_ID }, { id: USER_ID }, OWNED_AGENT, { skipAutoAssign: true, taskMovedActivity: { fromAgent: { id: OWNED_AGENT, userId: USER_ID, displayName: "Test agent" } } });
  assert.equal(result.status, 200);
  assert.equal(calls.transactionActive, false);
  assert.equal(calls.firstTaskEmails.length, 1);
  const scheduled = calls.firstTaskEmails[0];
  assert.equal(scheduled.before.title, "Latest title under the fence");
  assert.equal(scheduled.after.sectionId, SECTION_ID);
  assert.equal(scheduled.userId, USER_ID);
  assert.equal(scheduled.agentId, OWNED_AGENT);
});

function loadUpdateController(
  projectId,
  destinationSectionProjectId,
  {
    moveShouldNotify = false,
    serializeTaskWrites = false,
    initialSectionId = SECTION_ID - 1,
    updateErrorCode = null,
    updateErrorTarget = ["projectId", "uniqueIndex"],
    initialTask = {},
    aliasError = false,
    stateAtFence,
  } = {},
) {
  const calls = { transaction: 0, sideEffects: 0 };
  const noop = () => {
    calls.sideEffects += 1;
  };
  let currentTask = {
    id: TASK_ID,
    projectId,
    title: "Task",
    description: "",
    description_: { content: "" },
    section: initialSectionId === null ? "" : "Backlog",
    sectionId: initialSectionId,
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
    ...initialTask,
  };
  const aliases = new Map();
  const tx = {
    $executeRaw: async () => {},
    project: { findUnique: async ({ where }) => ({ uniqueIdentifier: where.id === MEMBER_PROJECT ? "M" : "S" }) },
    taskNumberAlias: {
      upsert: async (query) => {
        assert.equal(calls.transactionActive, true);
        if (aliasError) throw new Error("Alias persistence failed");
        (calls.aliases ??= []).push(query);
        (calls.order ??= []).push("number-alias");
        const key = `${query.create.projectId}/${query.create.uniqueIndex}`;
        aliases.set(key, aliases.has(key) ? { ...aliases.get(key), ...query.update } : query.create);
      },
    },
    task: {
      findUnique: async () => ({ ...currentTask }),
      update: async ({ data }) => {
        if (updateErrorCode) {
          const error = new PrismaClientKnownRequestError("Update failed");
          error.code = updateErrorCode;
          error.meta = { target: updateErrorTarget };
          throw error;
        }
        if (data.section == null) {
          throw new Error("Task requires a section name");
        }
        (calls.order ??= []).push("task-update");
        currentTask = { ...currentTask, ...data };
        return { ...currentTask };
      },
    },
    section: {
      findFirst: async ({ where }) => {
        calls.validatedSectionProjectId = where.projectId;
        if (where.projectId !== destinationSectionProjectId) return null;
        return {
          section_title: where.id === SECTION_ID ? "Todo" : "Backlog",
        };
      },
      findMany: async () => [
        { id: SECTION_ID - 1, section_title: "Backlog" },
        { id: SECTION_ID, section_title: "Todo" },
      ],
    },
    taskSectionEvent: {
      create: async ({ data }) => {
        if (data.from == null || data.to == null) {
          throw new Error("TaskSectionEvent requires section names");
        }
        (calls.sectionEvents ??= []).push(data);
      },
    },
  };
  let fenceTail = Promise.resolve();
  const fenceReleases = new WeakMap();
  const activeTransactions = new Set();
  const acquireTaskFence = async (transaction, taskId) => {
    if (!serializeTaskWrites) return;
    assert.equal(taskId, TASK_ID);
    if (fenceReleases.has(transaction)) return;
    const previous = fenceTail;
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    fenceTail = tail;
    await previous;
    fenceReleases.set(transaction, () => {
      release();
      if (fenceTail === tail) fenceTail = Promise.resolve();
    });
  };
  const prisma = {
    task: {
      findUnique: async () => ({ ...currentTask }),
    },
    project: {
      findFirst: async ({ where }) => findWritableProject(where),
    },
    $transaction: async (callback) => {
      calls.transaction += 1;
      if (destinationSectionProjectId === undefined) {
        throw new Error("a denied write reached the transaction");
      }
      if (stateAtFence) currentTask = { ...currentTask, ...stateAtFence };
      const taskSnapshot = { ...currentTask };
      const aliasSnapshot = new Map(aliases);
      const transaction = { ...tx };
      activeTransactions.add(transaction);
      calls.transactionActive = true;
      calls.transactionClient = transaction;
      try {
        return await callback(transaction);
      } catch (error) {
        currentTask = taskSnapshot;
        aliases.clear();
        for (const [key, alias] of aliasSnapshot) aliases.set(key, alias);
        throw error;
      } finally {
        fenceReleases.get(transaction)?.();
        activeTransactions.delete(transaction);
        calls.transactionActive = activeTransactions.size > 0;
      }
    },
  };
  const createTaskMovedActivityInTransaction = async (args) => {
    assert.equal(activeTransactions.has(args.transaction), true);
    calls.moveActivityArgs = args;
    (calls.moveActivityArgsList ??= []).push(args);
    (calls.order ??= []).push("move-activity");
    return { newComment: { id: 1 }, shouldNotify: moveShouldNotify };
  };
  const stubs = {
    "@/lib/telemetry/activationOccurrences": { recordActivationOccurrence: () => {}, recordAgentTaskCompletion: () => {} },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/api/errorMessage": execute(compile("src/lib/api/errorMessage.ts"), {}),
    "@/models/ActivityModels.ts": {},
    "@/models/model": {},
    "@prisma/client": {
      Prisma: { PrismaClientKnownRequestError },
      Status: { Archive: "Archive" },
    },
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
    "../notifications/agentFirstTaskEmail": {
      scheduleAgentFirstTaskEmail: (before, after, userId, agentId) => {
        (calls.firstTaskEmails ??= []).push({ before, after, userId, agentId });
      },
    },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: acquireTaskFence,
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
    "@/lib/mcp/tasks/agentDoneLifecycle": {
      assertAgentMayLeaveDone: async () => undefined,
      AgentDoneLifecycleDeniedError: class extends Error {
        constructor(message) {
          super(message);
          this.status = 403;
          this.code = "agent_done_lifecycle_denied";
        }
      },
    },
    "@/lib/cycleService": {
      assertCycleAssignable: async (_transaction, cycleProjectId, cycleId) => {
        calls.cycleValidation = { cycleId, projectId: cycleProjectId };
      },
      CycleAssignmentError: class extends Error {},
    },
  };
  return {
    updateTaskSingle: execute(
      compile("src/utils/controllers/tasks/single.ts"),
      stubs,
    ).updateTaskSingle,
    calls,
    aliases,
  };
}

test("expected title rejects a concurrent title-only edit under the mutation fence", async () => {
  for (const expectedTitle of ["Enter task title here", ""]) {
    for (const concurrentEdit of [false, true]) {
      const { updateTaskSingle, calls } = loadUpdateController(OWNER_PROJECT, OWNER_PROJECT, {
        initialTask: { title: expectedTitle },
        stateAtFence: concurrentEdit ? { title: "Human title" } : undefined,
      });
      const result = await updateTaskSingle(
        { id: TASK_ID, title: "AI title" },
        { id: USER_ID },
        null,
        { expectedTitle, expectedDescription: "", skipAutoAssign: true, skipRecurrence: true },
      );
      assert.equal(result.status, concurrentEdit ? 409 : 200);
      if (concurrentEdit) {
        assert.equal(calls.order, undefined, "no task write or activity on conflict");
        assert.equal(calls.sideEffects, 0);
        const preserved = await updateTaskSingle({ id: TASK_ID }, { id: USER_ID }, null, { skipAutoAssign: true, skipRecurrence: true });
        assert.equal(preserved.json.title, "Human title");
        assert.equal(preserved.json.description_?.content, "");
      } else assert.equal(result.json.title, "AI title");
    }
  }
});

test("Compose fill compares board and lifecycle status under the mutation fence before writing", async () => {
  for (const concurrentState of [
    {},
    { projectId: MEMBER_PROJECT },
    { status: "Archive", archivedAt: new Date() },
    { status: "Deleted", deletedAt: new Date() },
  ]) {
    const { updateTaskSingle, calls } = loadUpdateController(OWNER_PROJECT, OWNER_PROJECT, {
      initialTask: { title: "Enter task title here" },
      stateAtFence: concurrentState,
    });
    const result = await updateTaskSingle(
      { id: TASK_ID, title: "AI title" },
      { id: USER_ID },
      null,
      { expectedTitle: "Enter task title here", expectedDescription: "", expectedProjectId: OWNER_PROJECT, expectedStatus: "Normal", skipAutoAssign: true, skipRecurrence: true },
    );
    const conflict = Object.keys(concurrentState).length > 0;
    assert.equal(result.status, conflict ? 409 : 200, JSON.stringify(concurrentState));
    if (conflict) {
      assert.equal(calls.order, undefined, "no task write or activity on target conflict");
      assert.equal(calls.sideEffects, 0, "no post-commit effects on target conflict");
      assert.match(result.json.message, /moved or changed status/);
    } else {
      assert.equal(result.json.projectId, OWNER_PROJECT);
      assert.equal(result.json.status, "Normal");
      assert.equal(result.json.title, "AI title");
    }
  }
});

test("board moves preserve each previous identity in the task transaction", async () => {
  const { updateTaskSingle, calls, aliases } = loadUpdateController(OWNER_PROJECT, MEMBER_PROJECT);
  for (const [projectId, uniqueIndex, ticketNumber] of [
    [MEMBER_PROJECT, 2, "M-2"],
    [OWNER_PROJECT, 1, "S-1"],
    [MEMBER_PROJECT, 4, "M-4"],
  ]) {
    const result = await updateTaskSingle(
      { id: TASK_ID, projectId, uniqueIndex, ticketNumber },
      { id: USER_ID },
      null,
      { allowProjectChange: true, skipAutoAssign: true, skipRecurrence: true },
    );
    assert.equal(result.status, 200);
  }
  assert.deepEqual(calls.aliases, [
    [OWNER_PROJECT, 1, "S-1"],
    [MEMBER_PROJECT, 2, "M-2"],
    [OWNER_PROJECT, 1, "S-1"],
  ].map(([projectId, uniqueIndex, ticketNumber]) => ({
    where: { projectId_uniqueIndex: { projectId, uniqueIndex } },
    create: { projectId, uniqueIndex, ticketNumber, taskId: TASK_ID },
    update: { ticketNumber, taskId: TASK_ID },
  })));
  assert.deepEqual(calls.order, [
    "number-alias", "task-update", "number-alias", "task-update", "number-alias", "task-update",
  ]);
  assert.equal(aliases.size, 2);
});

test("aliases use the identity read under the mutation fence", async () => {
  const { updateTaskSingle, aliases } = loadUpdateController(OWNER_PROJECT, MEMBER_PROJECT, {
    stateAtFence: { projectId: SOURCE_PROJECT, uniqueIndex: 55, ticketNumber: "HTPR-55" },
  });
  const result = await updateTaskSingle(
    { id: TASK_ID, projectId: MEMBER_PROJECT, uniqueIndex: 2, ticketNumber: "M-2" },
    { id: USER_ID }, null, { allowProjectChange: true },
  );
  assert.equal(result.status, 200);
  assert.deepEqual([...aliases.values()], [{
    taskId: TASK_ID, projectId: SOURCE_PROJECT, uniqueIndex: 55, ticketNumber: "HTPR-55",
  }]);
});

test("a failed destination write rolls back its number alias", async () => {
  const { updateTaskSingle, aliases } = loadUpdateController(OWNER_PROJECT, MEMBER_PROJECT, { updateErrorCode: "P2002" });
  const result = await updateTaskSingle(
    { id: TASK_ID, projectId: MEMBER_PROJECT, uniqueIndex: 2, ticketNumber: "M-2" },
    { id: USER_ID }, null, { allowProjectChange: true },
  );
  assert.equal(result.status, 409);
  assert.equal(aliases.size, 0);
});

test("legacy tasks without a ticket number still preserve their old web identity", async () => {
  const { updateTaskSingle, aliases } = loadUpdateController(OWNER_PROJECT, MEMBER_PROJECT, { initialTask: { ticketNumber: null } });
  const result = await updateTaskSingle(
    { id: TASK_ID, projectId: MEMBER_PROJECT, uniqueIndex: 2, ticketNumber: "M-2" },
    { id: USER_ID }, null, { allowProjectChange: true },
  );
  assert.equal(result.status, 200);
  assert.equal([...aliases.values()][0].ticketNumber, null);
});

test("a move cannot replace its identity when alias persistence fails", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(OWNER_PROJECT, MEMBER_PROJECT, { aliasError: true });
  const result = await updateTaskSingle(
    { id: TASK_ID, projectId: MEMBER_PROJECT, uniqueIndex: 2, ticketNumber: "M-2" },
    { id: USER_ID }, null, { allowProjectChange: true },
  );
  assert.equal(result.status, 500);
  assert.equal(calls.order, undefined);
});

test("same-board section changes do not create a number alias", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(OWNER_PROJECT, OWNER_PROJECT);
  const result = await updateTaskSingle({ id: TASK_ID, title: "Renamed" }, { id: USER_ID });
  assert.equal(result.status, 200);
  assert.equal(calls.aliases, undefined);
});

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

test("the shared update controller identifies task index collisions", async () => {
  const { updateTaskSingle } = loadUpdateController(
    OWNER_PROJECT,
    OWNER_PROJECT,
    { updateErrorCode: "P2002" },
  );

  const result = await updateTaskSingle(
    { id: TASK_ID, title: "Updated" },
    { id: USER_ID },
  );

  assert.equal(result.status, 409);
  assert.equal(result.json.code, "TASK_IDENTITY_CONFLICT");
});

test("the shared update controller does not misclassify other uniqueness failures", async () => {
  const { updateTaskSingle } = loadUpdateController(
    OWNER_PROJECT,
    OWNER_PROJECT,
    {
      updateErrorCode: "P2002",
      updateErrorTarget: ["userId", "teamId"],
    },
  );

  const result = await updateTaskSingle(
    { id: TASK_ID, title: "Updated" },
    { id: USER_ID },
  );

  assert.equal(result.status, 500);
  assert.equal(result.json.code, undefined);
});

test("cycle assignment validates against the effective destination board", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(
    OWNER_PROJECT,
    OWNER_PROJECT,
  );
  const result = await updateTaskSingle(
    { id: TASK_ID, projectId: MEMBER_PROJECT, cycleId: 77 },
    { id: USER_ID },
    null,
    { allowProjectChange: true },
  );

  assert.equal(result.status, 200);
  assert.deepEqual(calls.cycleValidation, {
    cycleId: 77,
    projectId: MEMBER_PROJECT,
  });
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

test("a move from an unassigned section records activity without caller opt-in", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(
    OWNER_PROJECT,
    OWNER_PROJECT,
    { initialSectionId: null },
  );
  const result = await updateTaskSingle(
    { id: TASK_ID, sectionId: SECTION_ID, section: "Todo" },
    { id: USER_ID, displayName: "Valentin" },
    null,
    {
      skipAutoAssign: true,
      skipRecurrence: true,
    },
  );

  assert.equal(result.status, 200);
  assert.equal(result.json.section, "Todo");
  assert.equal(calls.moveActivityArgs.fromSectionId, null);
  assert.equal(calls.moveActivityArgs.toSectionId, SECTION_ID);
  assert.deepEqual(calls.sectionEvents, [
    {
      taskId: TASK_ID,
      from: "",
      to: "Todo",
      userId: USER_ID,
    },
  ]);
  assert.ok(result.moveActivity.newComment);
});

test("a move into an unassigned section records activity without caller opt-in", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(
    OWNER_PROJECT,
    OWNER_PROJECT,
  );
  const result = await updateTaskSingle(
    { id: TASK_ID, sectionId: null, section: null },
    { id: USER_ID, displayName: "Valentin" },
    null,
    {
      skipAutoAssign: true,
      skipRecurrence: true,
    },
  );

  assert.equal(result.status, 200);
  assert.equal(result.json.sectionId, null);
  assert.equal(result.json.section, "");
  assert.equal(calls.moveActivityArgs.fromSectionId, SECTION_ID - 1);
  assert.equal(calls.moveActivityArgs.toSectionId, null);
  assert.deepEqual(calls.sectionEvents, [
    {
      taskId: TASK_ID,
      from: "Backlog",
      to: "",
      userId: USER_ID,
    },
  ]);
  assert.ok(result.moveActivity.newComment);
});

test("overlapping task moves serialize state and activity without caller opt-in", async () => {
  const { updateTaskSingle, calls } = loadUpdateController(
    OWNER_PROJECT,
    OWNER_PROJECT,
    { serializeTaskWrites: true },
  );
  const user = { id: USER_ID, displayName: "Valentin" };
  const moveOptions = {
    skipAutoAssign: true,
    skipRecurrence: true,
  };

  const results = await Promise.all([
    updateTaskSingle(
      { id: TASK_ID, sectionId: SECTION_ID, section: "Todo" },
      user,
      null,
      moveOptions,
    ),
    updateTaskSingle(
      { id: TASK_ID, sectionId: SECTION_ID - 1, section: "Backlog" },
      user,
      null,
      moveOptions,
    ),
  ]);

  assert.deepEqual(
    results.map(({ status }) => status),
    [200, 200],
  );
  assert.deepEqual(calls.order, [
    "task-update",
    "move-activity",
    "task-update",
    "move-activity",
  ]);
  assert.deepEqual(
    calls.moveActivityArgsList.map(({ fromSectionId, toSectionId }) => [
      fromSectionId,
      toSectionId,
    ]),
    [
      [SECTION_ID - 1, SECTION_ID],
      [SECTION_ID, SECTION_ID - 1],
    ],
  );
  assert.equal(calls.transaction, 2);
  assert.equal(calls.transactionActive, false);
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

function loadMoveController({
  targetProjectId,
  sectionProjectId,
  agentId,
  projectIdentifier = "T",
  identityConflicts = 0,
  subTasks = [],
  updateImplementation,
  destinationIndices = [],
}) {
  const calls = { downstream: 0, queue: 0 };
  const currentTask = {
    id: TASK_ID,
    projectId: SOURCE_PROJECT,
    userId: USER_ID,
    parentTaskId: null,
    dueDate: null,
    uniqueIndex: 5731,
    ticketNumber: "HTPR-5731",
    subTasks,
  };
  const tasks = new Map([[TASK_ID, currentTask]]);
  for (const child of subTasks) {
    tasks.set(child.id, child);
    for (const grandchild of child.subTasks ?? []) tasks.set(grandchild.id, grandchild);
  }
  const prisma = {
    task: {
      findUnique: async ({ where }) => tasks.get(where.id),
      findFirst: async () => null,
    },
    project: {
      findUnique: async ({ where, select }) => {
        if (where.id === SOURCE_PROJECT && select) return { teamId: "team-1" };
        return knownProjects.has(where.id)
          ? {
              id: where.id,
              uniqueIdentifier:
                where.id === SOURCE_PROJECT ? "HTPR" : projectIdentifier,
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
  let remainingIdentityConflicts = identityConflicts;
  const updateTaskSingle = async (task, _user, _agentId, options) => {
    calls.downstream += 1;
    calls.updateAttempts = (calls.updateAttempts ?? 0) + 1;
    calls.allowProjectChange = options?.allowProjectChange;
    calls.updatedTask = task;
    if (updateImplementation) return updateImplementation(task, _user, _agentId, options, tasks.get(task.id));
    if (remainingIdentityConflicts > 0) {
      remainingIdentityConflicts -= 1;
      return {
        status: 409,
        json: { code: "TASK_IDENTITY_CONFLICT" },
      };
    }
    const projectChanged = task.projectId !== undefined && task.projectId !== currentTask.projectId;
    return !projectChanged || options?.allowProjectChange
      ? { status: 200, json: { ...currentTask, ...task } }
      : { status: 400, json: { message: "Project change denied" } };
  };
  let taskCount = 0;
  const stubs = {
    "@/lib/telemetry/activationOccurrences": { recordActivationOccurrence: () => {}, recordAgentTaskCompletion: () => {} },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/api/errorMessage": execute(compile("src/lib/api/errorMessage.ts"), {}),
    "@/utils/controllers/getMemberAndOwnerForBoard": async () => [],
    "@/utils/generateRank": () => "rank",
    "./getNextUniqueTaskIndex": {
      getNextUniqueTaskIndex: async () => {
        calls.downstream += 1;
        return Math.max(0, ...destinationIndices) + (++taskCount);
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
    "@/utils/controllers/tasks/single": {
      TASK_IDENTITY_CONFLICT_CODE: "TASK_IDENTITY_CONFLICT",
      updateTaskSingle,
    },
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

test("cross-board moves record aliases for the parent and nested subtasks through the real updater", async () => {
  const aliases = [];
  const child = (id, uniqueIndex, subTasks = []) => ({
    id, uniqueIndex, ticketNumber: `HTPR-${uniqueIndex}`, projectId: SOURCE_PROJECT,
    userId: USER_ID, dueDate: null, subTasks,
  });
  const { move } = loadMoveController({
    targetProjectId: OWNER_PROJECT,
    sectionProjectId: OWNER_PROJECT,
    agentId: null,
    subTasks: [child(102, 5732, [child(103, 5733)])],
    updateImplementation: async (task, user, agentId, options, initialTask) => {
      const controller = loadUpdateController(SOURCE_PROJECT, OWNER_PROJECT, { initialTask });
      const result = await controller.updateTaskSingle(task, user, agentId, options);
      aliases.push(...controller.calls.aliases);
      return result;
    },
  });
  const result = await move();
  assert.equal(result.success, true);
  assert.deepEqual(aliases.map(({ create }) => create), [
    [101, 5731], [102, 5732], [103, 5733],
  ].map(([taskId, uniqueIndex]) => ({
    taskId, uniqueIndex, projectId: SOURCE_PROJECT, ticketNumber: `HTPR-${uniqueIndex}`,
  })));
});

test("cross-board moves adopt the destination ticket identity", async () => {
  const { move, calls } = loadMoveController({
    targetProjectId: OWNER_PROJECT,
    sectionProjectId: OWNER_PROJECT,
    agentId: null,
  });
  const result = await move();

  assert.equal(result.success, true);
  assert.equal(result.task.projectId, OWNER_PROJECT);
  assert.equal(result.task.uniqueIndex, 1);
  assert.equal(result.task.ticketNumber, "T-1");
  assert.equal(calls.updatedTask.ticketNumber, "T-1");
  assert.equal(calls.updatedTask.cycleId, null);
  assert.equal(calls.allowProjectChange, true);
});

test("cross-board moves retry a conflicting destination identity with a fresh index", async () => {
  const { move, calls } = loadMoveController({
    targetProjectId: OWNER_PROJECT,
    sectionProjectId: OWNER_PROJECT,
    agentId: null,
    identityConflicts: 1,
  });

  const result = await move();

  assert.equal(result.success, true);
  assert.equal(result.task.uniqueIndex, 2);
  assert.equal(result.task.ticketNumber, "T-2");
  assert.equal(calls.updateAttempts, 2);
});

test("cross-board move identity retries are bounded", async () => {
  const { move, calls } = loadMoveController({
    targetProjectId: OWNER_PROJECT,
    sectionProjectId: OWNER_PROJECT,
    agentId: null,
    identityConflicts: 3,
  });

  const result = await move();

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 409);
  assert.equal(calls.updateAttempts, 3);
  assert.equal(calls.queue, 0);
});

test("cross-board moves reject a destination without a ticket identifier", async () => {
  const { move, calls } = loadMoveController({
    targetProjectId: OWNER_PROJECT,
    sectionProjectId: OWNER_PROJECT,
    agentId: null,
    projectIdentifier: null,
  });

  const result = await move();

  assert.equal(result.statusCode, 409);
  assert.equal(result.error, "Target project has no ticket identifier");
  assert.deepEqual(calls, { downstream: 0, queue: 0 });
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

test("cross-board move after permanent deletes allocates beyond the highest surviving index", async () => {
  const { move } = loadMoveController({
    targetProjectId: OWNER_PROJECT,
    sectionProjectId: OWNER_PROJECT,
    agentId: null,
    destinationIndices: [1, 3, 4],
  });
  const result = await move();
  assert.equal(result.success, true);
  assert.equal(result.task.uniqueIndex, 5);
  assert.equal(result.task.ticketNumber, "T-5");
});
