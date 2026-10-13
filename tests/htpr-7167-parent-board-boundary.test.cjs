const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(file, stubs = {}) {
  const javascript = ts.transpileModule(read(file), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (request) => {
    assert.ok(request in stubs, `Unexpected dependency: ${request}`);
    return stubs[request];
  });
  return mod.exports;
}
const relations = load("src/lib/tasks/sameBoardRelations.ts");
const parentAccess = load("src/utils/controllers/tasks/parentTaskAccess.ts");
const mutation = load("src/lib/mcp/tasks/humanMutationOverride.ts");
const noop = async () => undefined;
class KnownRequestError extends Error {}
const client = { Prisma: { PrismaClientKnownRequestError: KnownRequestError, sql: noop }, Status: { Archive: "Archive", Deleted: "Deleted" } };

function lockingRead(calls, parents) {
  return async (strings, ...values) => {
    calls.locks.push({ sql: strings.join("?"), values });
    assert.match(strings.join("?"), /SELECT id FROM "Task"[\s\S]*WHERE id = \? AND "projectId" = \?[\s\S]*status <> 'Deleted'[\s\S]*FOR SHARE/);
    const [id, projectId] = values;
    return parents.some((parent) => parent.id === id && parent.projectId === projectId && parent.status !== "Deleted") ? [{ id }] : [];
  };
}
function updateHarness(initial = {}, parents = []) {
  const calls = { writes: 0, transactions: 0, locks: [] };
  let state = { id: 101, projectId: 10, title: "Task", description: "", section: "Todo", sectionId: 1, userId: 7, status: "Normal", parentTaskId: null, uniqueIndex: 1, ticketNumber: "S-1", ...initial };
  const tx = {
    $queryRaw: lockingRead(calls, parents), $executeRaw: noop,
    project: { findUnique: async () => ({ uniqueIdentifier: "T" }) },
    task: { findUnique: async () => ({ ...state }), update: async ({ data }) => { calls.writes++; state = { ...state, ...data }; return state; } },
    taskNumberAlias: { upsert: noop },
  };
  const prisma = {
    task: { findUnique: async () => ({ ...state }) }, project: { findFirst: async () => ({ id: 10 }) },
    $transaction: async (callback) => { calls.transactions++; return callback(tx); },
  };
  const stubs = {
    "@/lib/tasks/sameBoardRelations": relations,
    "@/utils/controllers/tasks/parentTaskAccess": parentAccess,
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@prisma/client": client,
    "@/lib/telemetry/activationOccurrences": { recordAgentTaskCompletion: noop },
    "../activities/createActivity": { __esModule: true, default: noop },
    "../activities/createTaskMovedActivity": { createTaskMovedActivityInTransaction: noop },
    "../activities/sendTaskMoveNotification": { sendTaskMoveNotificationIfNeeded: noop },
    "../notifications/creation-service/createAndSendNotificationTaskMove": { __esModule: true, default: noop },
    "../description/common-description-create": { __esModule: true, default: noop },
    "@/pages/api/queues/FAST/generateSummary": { __esModule: true, default: noop },
    "../turbopuffer/turbopufferHelper": { upsertAllCommentsToTurbopuffer: noop, upsertTaskToTurbopuffer: noop },
    "../assignees/autoAssignForSection": { autoAssignForSection: noop },
    "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels: noop },
    "./spawnRecurrence": { sectionIsDone: () => false, spawnNextRecurrence: noop },
    "../notifications/agentFirstTaskEmail": { scheduleAgentFirstTaskEmail: noop },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/lib/mcp/tasks/agentMutationFence": { AgentMutationLeaseConflictError: class extends Error {}, assertAgentAssignmentChangeAllowed: noop, cancelAgentMutationLeaseForHumanOverride: noop },
    "./invokeTaskDelete": {},
    "@/lib/mcp/webhooks/outbox": { persistBoardWebhookEvent: async () => [], publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: noop },
    "@/lib/mcp/tasks/humanMutationOverride": mutation,
    "@/lib/mcp/tasks/agentDoneLifecycle": { assertAgentMayLeaveDone: noop, AgentDoneLifecycleDeniedError: class extends Error {} },
    "@/lib/cycleService": { assertCycleAssignable: noop, CycleAssignmentError: class extends Error {} },
  };
  const controller = load("src/utils/controllers/tasks/single.ts", stubs);
  return { calls, controller, update: (patch, options = {}, agentId = null) => controller.updateTaskSingle({ id: 101, ...patch }, { id: 7 }, agentId, { skipAutoAssign: true, skipRecurrence: true, ...options }) };
}

for (const trustedCaller of [false, true]) {
  test(`foreign parent update returns 404 without writes (trusted=${trustedCaller})`, async () => {
    const h = updateHarness({}, [{ id: 102, projectId: 99 }]);
    assert.deepEqual(await h.update({ parentTaskId: 102 }, { trustedCaller }), { status: 404, json: { message: "Parent task not found" } });
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.locks.length, 1);
  });
}
for (const status of ["Normal", "Archive", "Deleted"]) {
  test(`same-board ${status} parent is ${status === "Deleted" ? "refused" : "allowed"}`, async () => {
    const h = updateHarness({}, [{ id: 102, projectId: 10, status }]);
    assert.equal((await h.update({ parentTaskId: 102 })).status, status === "Deleted" ? 404 : 200);
    assert.equal(h.calls.writes, status === "Deleted" ? 0 : 1);
  });
}
test("missing parent is indistinguishable from a foreign parent", async () => {
  const h = updateHarness();
  assert.equal((await h.update({ parentTaskId: 102 })).status, 404);
  assert.equal(h.calls.writes, 0);
});
for (const relation of ["subTasks", "parentTask"]) {
  for (const key of ["connect", "connectOrCreate", "create", "createMany", "set", "disconnect", "delete", "deleteMany", "update", "updateMany", "upsert"]) {
    test(`${relation}.${key} is refused before the transaction`, async () => {
      const h = updateHarness();
      assert.deepEqual(await h.update({ [relation]: { [key]: { id: 102 } } }), { status: 400, json: { message: "Nested writes are not allowed" } });
      assert.equal(h.calls.transactions, 0);
      assert.equal(h.calls.writes, 0);
    });
  }
}
test("nested writes are refused for trusted and agent callers too", async () => {
  for (const [options, agentId] of [[{ trustedCaller: true }, null], [{}, "agent-owned"]]) {
    const h = updateHarness();
    assert.equal((await h.update({ parentTask: { connect: { id: 102 } } }, options, agentId)).status, 400);
    assert.equal(h.calls.transactions, 0);
  }
});
test("null-prototype nested-write objects are refused", async () => {
  const h = updateHarness();
  const parentTask = Object.assign(Object.create(null), { connect: { id: 102 } });
  assert.equal((await h.update({ parentTask })).status, 400);
  assert.equal(h.calls.writes, 0);
});
test("Date and non-operator objects remain accepted", async () => {
  const h = updateHarness();
  const dueDate = new Date("2026-10-14T00:00:00Z");
  const result = await h.update({ dueDate, description_: { content: "Description" }, recurrence: { frequency: "daily" } });
  assert.equal(result.status, 200);
  assert.equal(result.json.dueDate, dueDate);
});
test("unchanged legacy foreign parent permits an unrelated title edit", async () => {
  const h = updateHarness({ parentTaskId: 102 });
  assert.equal((await h.update({ title: "Edited", parentTaskId: 102 })).status, 200);
  assert.equal(h.calls.locks.length, 0);
});
for (const parentProjectId of [10, 11]) {
  test(`project move revalidates the retained parent on board ${parentProjectId}`, async () => {
    const h = updateHarness({ parentTaskId: 102 }, [{ id: 102, projectId: parentProjectId }]);
    const result = await h.update({ projectId: 11 }, { allowProjectChange: true });
    assert.equal(result.status, parentProjectId === 11 ? 200 : 404);
    assert.equal(h.calls.writes, parentProjectId === 11 ? 1 : 0);
    assert.deepEqual(h.calls.locks[0].values, [102, 11]);
  });
}
test("clearing a parent does not require a locking read", async () => {
  const h = updateHarness({ parentTaskId: 102 });
  assert.equal((await h.update({ parentTaskId: null })).status, 200);
  assert.equal(h.calls.locks.length, 0);
});

function createHarness(parents) {
  const calls = { writes: 0, locks: [] };
  const tx = {
    $executeRaw: noop, $queryRaw: lockingRead(calls, parents),
    section: { findFirst: async () => ({ id: 1, section_title: "Todo" }) },
    project: { findUnique: async () => ({ uniqueIdentifier: "S" }) },
    task: { create: async ({ data }) => { calls.writes++; return { ...data, id: 101, description_: {} }; } },
  };
  const prisma = { user: { findUnique: async () => ({ id: 7 }) }, project: { findFirst: async () => ({ id: 10 }) } };
  const stubs = {
    "@/utils/controllers/tasks/parentTaskAccess": parentAccess,
    "@/lib/ai/taskWriterDueDate": {}, "@/lib/flags/keys": {},
    "next/server": { NextResponse: { json: (json, options) => ({ json, status: options.status }) } },
    zod: require("zod"), "better-auth/cookies": { parseCookies: () => new Map() }, "@prisma/client": client,
    "@/lib/ai/composeTaskTarget": {}, "@/lib/flags": {},
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 1 },
    "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_prisma, _actor, callback) => ({ ...await callback(tx), boardWebhookDeliveryIds: [] }) },
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskCreatedPending: noop },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: null }) },
    "@/lib/auth/session": { verifySession: () => null },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "./create-global-effects": { schedulePostCreateWork: noop },
    "./route": { taskWriteRoute: ({ operation }) => async (request, session) => operation(await request.json(), session, request) },
  };
  const { POST } = load("src/lib/api/task-writes/create-global.ts", stubs);
  return { calls, create: (patch) => POST({ headers: new Headers(), json: () => ({ title: "New", projectId: 10, ...patch }) }, { userId: 7 }) };
}
for (const patch of [{ parentTaskId: 102 }, { parentTask: { id: 102 } }, { parentTaskId: 0, parentTask: { id: 102 } }]) {
  test(`create-global validates the resolved parent ${JSON.stringify(patch)}`, async () => {
    const h = createHarness([{ id: 102, projectId: 99 }]);
    assert.deepEqual(await h.create(patch), { status: 404, json: { message: "Parent task not found" } });
    assert.equal(h.calls.writes, 0);
    assert.deepEqual(h.calls.locks[0].values, [102, 10]);
  });
}
test("create-global allows a same-board parent", async () => {
  const h = createHarness([{ id: 102, projectId: 10 }]);
  assert.equal((await h.create({ parentTaskId: 102 })).status, 200);
  assert.equal(h.calls.writes, 1);
});

const sentinel = "FOREIGN_BOARD_SECRET_TITLE";
const foreign = { id: 999, projectId: 99, title: sentinel };
const local = { id: 102, projectId: 10, title: "Same board" };
function fixture(foreignParent = false) {
  return { id: 101, projectId: 10, title: "Task", parentTask: foreignParent ? foreign : { ...local, subTasks: [local, foreign] }, subTasks: [local, foreign] };
}
function assertNoLeak(output) {
  assert.ok(!JSON.stringify(output).includes(sentinel), "foreign title must never be serialized");
}
test("negative-control sentinel check catches an unfiltered payload", () => {
  assert.throws(() => assertNoLeak(fixture()), /foreign title/);
});
for (const foreignParent of [false, true]) {
  test(`relation helper strips foreign children, siblings and parent (foreignParent=${foreignParent})`, () => {
    const input = fixture(foreignParent);
    const output = relations.stripForeignTaskRelations(input);
    assertNoLeak(output);
    assert.equal(output.subTasks.length, 1);
    if (foreignParent) assert.equal(output.parentTask, null);
    else assert.deepEqual(output.parentTask.subTasks, [local]);
    assert.equal(input.subTasks.length, 2, "input is not mutated");
  });
  test(`single reader strips legacy foreign relations (foreignParent=${foreignParent})`, async () => {
    const h = updateHarness(fixture(foreignParent));
    const output = await h.controller.getTaskSingle(101);
    assert.equal(output.status, 200);
    assertNoLeak(output);
  });
}
test("helper preserves absent and null relation shapes", () => {
  assert.deepEqual(relations.stripForeignTaskRelations({ projectId: 10 }), { projectId: 10 });
  assert.deepEqual(relations.stripForeignTaskRelations({ projectId: 10, parentTask: null, subTasks: [] }), { projectId: 10, parentTask: null, subTasks: [] });
});

const readerWiring = [
  ["src/utils/controllers/taskDetail/load.ts", /\.\.\.stripForeignTaskRelations\(task\)/],
  ["src/utils/controllers/projects/getBoardTasks.ts", /tasks: tasksWithAgentStatus\.map\(stripForeignTaskRelations\)/],
  ["src/utils/controllers/tasks/getAll.ts", /json:tasks\.map\(stripForeignTaskRelations\)/],
  ["src/utils/controllers/tasks/getArchivedTasksByProject.ts", /attachWaitingOnUsers\(tasks\.map\(stripForeignTaskRelations\)\)/],
  ["src/lib/mcp/tasks/mappers.ts", /mapTaskToMcpGetResponse[\s\S]*task = stripForeignTaskRelations\(task\)/],
  ["src/lib/mcp/operations/tasks/operation.ts", /tasks\.map\(task => \{\s*task = stripForeignTaskRelations\(task\)/],
  ["src/lib/ai/tools/listTasks.ts", /tasks\.map\(\(task\) => \{\s*task = stripForeignTaskRelations\(task\)/],
  ["src/utils/controllers/tasks/getSharedTask.ts", /shared\.task = stripForeignTaskRelations\(shared\.task\)/],
  ["src/utils/controllers/share/getProject.ts", /project\.tasks = project\.tasks\.map\(stripForeignTaskRelations\)/],
];
for (const [file, pattern] of readerWiring) {
  test(`${file} sanitizes task relations before returning them`, () => {
    assert.match(read(file), /import \{ stripForeignTaskRelations \} from "@\/lib\/tasks\/sameBoardRelations"/);
    assert.match(read(file), pattern);
  });
}
test("narrow relation selects include projectId for filtering", () => {
  const files = ["src/utils/controllers/taskDetail/load.ts", "src/utils/controllers/projects/getAllIncludes.ts", "src/lib/mcp/tasks/mappers.ts", "src/lib/mcp/operations/tasks/operation.ts", "src/lib/ai/tools/listTasks.ts"];
  for (const file of files) {
    const parsed = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isPropertyAssignment(node) && ["parentTask", "subTasks"].includes(node.name.getText(parsed)) && ts.isObjectLiteralExpression(node.initializer)) {
        const select = node.initializer.properties.find((property) => property.name?.getText(parsed) === "select");
        if (select && ts.isObjectLiteralExpression(select.initializer)) assert.match(select.initializer.getText(parsed), /projectId: true/, `${file}: relation select`);
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
});
test("unused raw parent-write bypass is removed and both writers share the locking helper", () => {
  assert.equal(fs.existsSync(path.join(root, "src/utils/controllers/tasks/addParent.ts")), false);
  for (const file of ["src/utils/controllers/tasks/single.ts", "src/lib/api/task-writes/create-global.ts"]) assert.match(read(file), /await assertParentTaskOnBoard\(/);
});

function readerStubs(prisma) {
  return {
    "@/lib/tasks/sameBoardRelations": relations,
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@prisma/client": client,
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}), getProjectWhere: () => ({}) },
    "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({}), isAgentVisibleToUser: () => false, accessibleAgentWhere: () => ({}), accessibleAgentMembershipWhere: () => ({}) },
    "@/lib/agents/publicAgent": { projectPublicAgent: () => null, redactAgentIdentitiesForPublicShare: (value) => value },
    "@/lib/mcp/agents": { mapVisibleMcpAgent: () => null, mcpVisibleAgentSelect: () => ({}) },
  };
}
for (const foreignParent of [false, true]) {
  test(`detail reader omits foreign titles (foreignParent=${foreignParent})`, async () => {
    let include;
    const task = { ...fixture(foreignParent), pullRequests: [] };
    const { fetchTaskDetail } = load("src/utils/controllers/taskDetail/load.ts", {
      ...readerStubs({ task: { findFirst: async (args) => { include = args.include; return task; } } }),
      "@vercel/functions": {}, "@/lib/realtime/server": {}, "@/lib/mcp/tasks/resolveTask": {},
      "@/lib/cycles": {}, "@/lib/pullRequests/taskPullRequests": {},
      "@/utils/controllers/notifications/visibleInboxScope": { visibleUserInboxWhere: () => ({}) },
    });
    const output = await fetchTaskDetail("project-10", 1, 7);
    assert.ok(output);
    assertNoLeak(output);
    assert.equal(include.parentTask.select.subTasks.select.projectId, true);
  });
  test(`board reader omits foreign titles (foreignParent=${foreignParent})`, async () => {
    const { default: getBoardTasks } = load("src/utils/controllers/projects/getBoardTasks.ts", {
      ...readerStubs({ project: { findFirst: async () => ({ id: 10 }) }, task: { findMany: async () => [fixture(foreignParent)] } }),
      "@/lib/ai/teamBillingSnapshotSelect": {},
      "@/utils/controllers/tasks/attachAgentStatus": {},
      "./getAllIncludes": { getProjectWhere: () => ({}), getTaskWhere: () => ({}), getBoardTaskInclude: () => ({}), getProjectIncludeWithoutTasks: () => ({}), getProjectViewInclude: () => ({}) },
      "@/utils/helperFunctions/Views/BoardFilterSanitizer": { sanitizeProjectBoardFilters: (value) => value },
      "@/utils/controllers/tasks/attachWaitingOnUsers": { attachWaitingOnUsers: async (value) => value },
      "@/utils/controllers/tasks/attachOpenBlockingTasks": { attachOpenBlockingTasks: async (value) => value },
    });
    const output = await getBoardTasks(10, 7);
    assert.equal(output.status, 200);
    assertNoLeak(output);
    assert.equal(output.json.tasks[0].subTasks.length, 1);
  });
  test(`task list reader omits foreign titles (foreignParent=${foreignParent})`, async () => {
    const { default: getAll } = load("src/utils/controllers/tasks/getAll.ts", readerStubs({ task: { findMany: async () => [fixture(foreignParent)] } }));
    for (const contract of ["legacy", "compact"]) {
      const output = await getAll(10, 7, contract);
      assert.equal(output.status, 200);
      assert.equal(output.json.length, 1);
      assertNoLeak(output);
    }
  });
  test(`archived board reader omits foreign titles (foreignParent=${foreignParent})`, async () => {
    const { default: getArchived } = load("src/utils/controllers/tasks/getArchivedTasksByProject.ts", {
      ...readerStubs({ user: { findUnique: async () => ({ id: 7 }) }, task: { findMany: async () => [fixture(foreignParent)] } }),
      "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}), getFullTaskInclude: () => ({}) },
      "./attachWaitingOnUsers": { attachWaitingOnUsers: async (value) => value },
    });
    const output = await getArchived(10, 7);
    assert.equal(output.status, 200);
    assert.equal(output.json.length, 1);
    assertNoLeak(output);
  });
  test(`MCP get mapper omits foreign titles (foreignParent=${foreignParent})`, () => {
    const { mapTaskToMcpGetResponse, taskMcpGetInclude } = load("src/lib/mcp/tasks/mappers.ts", {
      ...readerStubs({}), "@/lib/staleness": { taskStaleness: () => ({}) }, "@/lib/pullRequests/githubPullRequests": {},
    });
    const output = mapTaskToMcpGetResponse({ ...fixture(foreignParent), project: { title: "Board" }, _count: { comments: 0 }, createdAt: new Date() }, 7);
    assertNoLeak(output);
    assert.equal(output.sub_tasks.length, 1);
    assert.equal(taskMcpGetInclude(7).parentTask.select.projectId, true);
  });
  test(`AI list reader omits foreign titles (foreignParent=${foreignParent})`, async () => {
    const { createListTasksTool } = load("src/lib/ai/tools/listTasks.ts", {
      ...readerStubs({ task: { findMany: async () => [{ ...fixture(foreignParent), assignees: [], project: { title: "Board" }, _count: { taskLabels: 0, comments: 0 }, createdAt: new Date() }], count: async () => 1 } }),
      ai: { tool: (definition) => definition }, zod: require("zod"),
      "@/lib/mcp/tasks/mappers": { mapTaskDescriptionContent: () => "" },
      "@/lib/ai/chatStream/request": { statusSchema: require("zod").z.string(), sortOrderSchema: require("zod").z.string() },
      "@/lib/ai/tools/helpers": { getAccessibleProjectIds: async () => [10], normalizePriorityInput: () => [], sanitizeForJson: (value) => value },
    });
    const output = await createListTasksTool({ user: { id: 7 }, sendStatus: () => {} }).hypertask_list_tasks.execute({ labels: [], status: "Normal", limit: 50, offset: 0, sort_by: "updatedAt", sort_order: "desc" });
    assert.equal(output.success, true);
    assertNoLeak(output);
    assert.equal(output.tasks[0].sub_tasks.length, 1);
  });
  test(`public task share omits foreign titles (foreignParent=${foreignParent})`, async () => {
    const { getSharedTaskInfo } = load("src/utils/controllers/tasks/getSharedTask.ts", readerStubs({ taskSharing: { findFirst: async () => ({ task: fixture(foreignParent) }) } }));
    const output = await getSharedTaskInfo("share-id");
    assertNoLeak(output);
    assert.equal(output.task.subTasks.length, 1);
  });
  test(`public board share omits foreign titles (foreignParent=${foreignParent})`, async () => {
    const { default: getProject } = load("src/utils/controllers/share/getProject.ts", {
      ...readerStubs({ invite: { findFirst: async () => ({ projectId: 10, userId: 7 }) }, project: { findFirst: async () => ({ tasks: [fixture(foreignParent)] }) } }),
      "@/utils/helperFunctions/helperFunctions": { getCurrentProject: () => null },
      "@/utils/helperFunctions/Views/FilterHelperFunctions": {},
      "@/utils/helperFunctions/Views/SubtaskHelperFunction": {},
      "@/utils/helperFunctions/Views/EmptySectionsHelperFunction": {},
      "../projects/getAllIncludes": { getProjectViewBaseInclude: () => ({}) },
    });
    const output = await getProject("share-id");
    assert.equal(output.status, 200);
    assertNoLeak(output);
    assert.equal(output.json.tasks[0].subTasks.length, 1);
  });
}

for (const searchQuery of ["", "Task"]) {
  test(`orphan search filters foreign children (query=${JSON.stringify(searchQuery)})`, async () => {
    let query;
    const { default: search } = load("src/utils/controllers/tasks/getOrphanTasks.ts", readerStubs({
      task: { findMany: async (args) => { query = args; return [{ ...fixture(), parentTask: undefined }]; } },
    }));
    const output = await search(10, 101, searchQuery);
    assert.equal(output.status, 200);
    assert.equal(query.where.projectId, 10);
    assert.equal(query.select.projectId, true);
    assert.equal(query.select.subTasks, true);
    assertNoLeak(output);
    assert.deepEqual(output.json[0].subTasks, [local]);
  });
}

for (const foreignParent of [false, true]) {
  for (const status of ["Deleted", "Normal"]) {
    for (const alreadyApplied of [false, true]) {
      test(`delete reminder filters relations (foreignParent=${foreignParent}, status=${status}, alreadyApplied=${alreadyApplied})`, async () => {
        let task = fixture(foreignParent);
        const writes = [], queries = [];
        let rawReads = 0;
        const tx = {
          $queryRaw: async () => ++rawReads === 1 ? [{ id: 101 }] : [{
            id: 101, status: alreadyApplied ? status : status === "Deleted" ? "Normal" : "Deleted",
            sectionId: 1, hardDeleteProcessingAt: null,
          }],
          task: {
            findUniqueOrThrow: async (query) => { queries.push(query); return task; },
            updateMany: async (query) => { writes.push(query); },
            update: async ({ data }) => { task = { ...task, ...data, parentTask: null }; },
          },
          notification: { deleteMany: noop },
        };
        const { updateTaskAndSubtasks } = load("src/pages/api/queues/tasks/taskDeleteReminder.ts", {
          ...readerStubs({ $transaction: (callback) => callback(tx) }),
          "date-fns": { subMinutes: (date) => date },
          "../taskDeleteQueue": {}, sugar: {}, "@/lib/constants": {},
          "@prisma/client": require("@prisma/client"),
          "@/lib/auth/getSessionUser": {}, "@/lib/auth/session": {}, "@/lib/auth/resolveActingAgent": {},
          "@/lib/mcp/tasks/agentMutationFence": { assertAgentAssignmentChangeAllowed: noop, cancelAgentMutationLeaseForHumanOverride: noop },
          "@/lib/mcp/tasks/agentDoneLifecycle": { assertAgentMayLeaveDoneForTasks: noop },
        });
        const output = await updateTaskAndSubtasks({ id: 101 }, status);
        assert.equal(output.id, 101);
        assert.equal(output.projectId, 10);
        assertNoLeak(output);
        assert.deepEqual(output.subTasks, [local]);
        if (foreignParent || (status === "Normal" && !alreadyApplied)) assert.equal(output.parentTask, null);
        else {
          assert.equal(output.parentTask.title, local.title);
          assert.deepEqual(output.parentTask.subTasks, [local]);
        }
        assert.equal(writes.length, alreadyApplied ? 0 : 1);
        assert.equal(queries.length, 1);
        assert.equal(queries[0].select.projectId, true);
        assert.deepEqual(queries[0].select.parentTask, { include: { subTasks: true } });
      });
    }
  }
}
