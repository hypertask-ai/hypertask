// HTPR-6281: routes that change task-visible properties (assignees, labels,
// due date, start date) must also broadcast task:changed, because an open task
// detail view listens only on its task channel — board events never reach it.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const USER_ID = 6;
const PROJECT_ID = 15;
const TASK_ID = 6281;

function transpileHandler(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

function loadHandler(relativePath, stubs) {
  const javascript = transpileHandler(relativePath);
  // Write the transpiled CommonJS to a unique temp file and require() it with
  // Module._load patched, so stubs intercept the handler's own requires
  // without dynamic code execution.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpr-6281-"));
  const file = path.join(tmpDir, "handler.js");
  fs.writeFileSync(file, javascript);
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = require(file);
    return mod.default ?? mod;
  } finally {
    Module._load = originalLoad;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function makeResponse() {
  let statusCode = 0;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(body) {
      res.payload = body;
      return res;
    },
  };
  res.statusCode = () => statusCode;
  return res;
}

const realtimeStubs = (broadcasts) => ({
  broadcastBoardChange: (...args) => broadcasts.push(["board", ...args]),
  broadcastTaskChange: (...args) => broadcasts.push(["task", ...args]),
});

const cookies = {
  nookies_user: JSON.stringify({ id: USER_ID, displayName: "Member" }),
};

test("setDueDate broadcasts task:changed to open detail views", async () => {
  const broadcasts = [];
  const stubs = {
    "date-fns": { subMinutes: (d) => d },
    "@/lib/prisma": {
      __esModule: true,
      default: { agent: { findUnique: async () => null } },
    },
    "@/utils/controllers/activities/createTaskDueDateActivity": {
      __esModule: true,
      default: async () => undefined,
    },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove":
      { __esModule: true, default: async () => undefined },
    "../queues/duedateQueue": {
      cancelDueDateJob: async () => undefined,
      scheduleDueDateJob: async () => undefined,
    },
    "@/utils/controllers/tasks/single": {
      __esModule: true,
      updateTaskSingle: async () => ({
        status: 200,
        json: { id: TASK_ID, projectId: PROJECT_ID, dueDate: new Date() },
        oldTask: { dueDate: null },
      }),
    },
    "@/lib/realtime/server": { __esModule: true, ...realtimeStubs(broadcasts) },
  };
  const handler = loadHandler("src/pages/api/tasks/setDueDate.ts", stubs);
  const res = makeResponse();
  await handler(
    { method: "POST", body: { taskId: TASK_ID, dueDate: new Date() }, cookies },
    res
  );
  assert.equal(res.statusCode(), 200);
  assert.deepEqual(
    broadcasts.filter(([kind]) => kind === "task"),
    [["task", TASK_ID, { originUserId: USER_ID }]]
  );
  assert.ok(broadcasts.some(([kind]) => kind === "board"));
});

test("setStartDate broadcasts task:changed to open detail views", async () => {
  const broadcasts = [];
  const stubs = {
    "@/utils/controllers/tasks/single": {
      __esModule: true,
      updateTaskSingle: async () => ({
        status: 200,
        json: { id: TASK_ID, projectId: PROJECT_ID, startDate: new Date() },
      }),
    },
    "@/utils/controllers/tasks/assertTaskAccess": {
      __esModule: true,
      userCanAccessTask: async () => true,
    },
    "@/lib/realtime/server": { __esModule: true, ...realtimeStubs(broadcasts) },
  };
  const handler = loadHandler("src/pages/api/tasks/setStartDate.ts", stubs);
  const res = makeResponse();
  await handler(
    { method: "POST", body: { taskId: TASK_ID, startDate: new Date() }, cookies },
    res
  );
  assert.equal(res.statusCode(), 200);
  assert.deepEqual(
    broadcasts.filter(([kind]) => kind === "task"),
    [["task", TASK_ID, { originUserId: USER_ID }]]
  );
  assert.ok(broadcasts.some(([kind]) => kind === "board"));
});

test("assignLabel broadcasts task:changed to open detail views", async () => {
  const broadcasts = [];
  let queryRawCall = 0;
  const tx = {
    $queryRaw: async () => {
      queryRawCall += 1;
      // Task lock, TaskLabel lock, Label lock.
      return queryRawCall === 2 ? [] : [{ projectId: PROJECT_ID }];
    },
    taskLabel: {
      findFirst: async () => null,
      create: async () => ({ id: 1, label: { id: 1, value: "bug" } }),
      delete: async () => undefined,
      findMany: async () => [{ label: { id: 1, value: "bug" } }],
    },
  };
  const stubs = {
    "@/lib/prisma": {
      __esModule: true,
      default: { $transaction: async (fn) => fn(tx) },
    },
    "@/utils/controllers/activities/createLabelActivity": {
      __esModule: true,
      default: async () => undefined,
    },
    "@/lib/agentWebhooks/outbox": {
      __esModule: true,
      persistAgentTaskUpdatedWebhook: async () => [],
      publishAgentWebhookDeliveries: async () => undefined,
    },
    "@/lib/realtime/server": { __esModule: true, ...realtimeStubs(broadcasts) },
  };
  const handler = loadHandler("src/pages/api/labels/assignLabel.ts", stubs);
  const res = makeResponse();
  await handler(
    { method: "POST", body: { taskId: TASK_ID, labelId: 1 }, cookies },
    res
  );
  assert.equal(res.statusCode(), 200);
  assert.deepEqual(
    broadcasts.filter(([kind]) => kind === "task"),
    [["task", TASK_ID, { originUserId: USER_ID }]]
  );
  assert.ok(broadcasts.some(([kind]) => kind === "board"));
});

test("assignees/assign broadcasts task:changed to open detail views", async () => {
  const broadcasts = [];
  const stubs = {
    "@/utils/controllers/assignees/assign": {
      __esModule: true,
      default: async () => ({ status: 200, json: { message: "Success" } }),
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        user: { findUnique: async () => ({ id: USER_ID }) },
        task: { findFirst: async () => ({ projectId: PROJECT_ID }) },
      },
    },
    "@/lib/auth/getSessionUser": {
      __esModule: true,
      default: async () => ({ userId: USER_ID }),
      getSessionUser: async () => ({ userId: USER_ID }),
    },
    "@/utils/controllers/projects/getAllIncludes": {
      __esModule: true,
      getProjectWhere: () => ({}),
    },
    "@/lib/realtime/server": { __esModule: true, ...realtimeStubs(broadcasts) },
  };
  const handler = loadHandler("src/pages/api/assignees/assign.ts", stubs);
  const res = makeResponse();
  await handler(
    { method: "POST", body: { taskId: TASK_ID, userId: USER_ID }, cookies },
    res
  );
  assert.equal(res.statusCode(), 200);
  assert.deepEqual(
    broadcasts.filter(([kind]) => kind === "task"),
    [["task", TASK_ID, { originUserId: USER_ID }]]
  );
  assert.ok(broadcasts.some(([kind]) => kind === "board"));
});
