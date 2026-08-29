// HTPR-5690: open task detail views must live-sync when a ticket is archived
// from another tab, the board, AI chat, or the auto-archive sweep.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/task-detail-archive-realtime.test.cjs"), {
  interopDefault: true,
});

const { refreshTaskDetailQueryCache } = jiti(
  path.join(root, "src/lib/realtime/taskDetailRefresh.ts")
);

const MEMBER_USER_ID = 6;
const MEMBER_PROJECT = 15;
const TASK_ID = 5690;

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

function loadArchiveHandler() {
  const broadcasts = [];
  const updated = [];
  const stubs = {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        agent: {
          findUnique: async () => null,
        },
      },
    },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove":
      {
        __esModule: true,
        default: async () => undefined,
      },
    "@/utils/controllers/activities/createArchiveActivity": {
      __esModule: true,
      default: async () => undefined,
    },
    "@/models/model": {},
    "../queues/duedateQueue": {
      cancelDueDateJob: async () => undefined,
    },
    "@/utils/controllers/tasks/single": {
      updateTaskSingle: async (newTask) => {
        updated.push(newTask);
        return {
          status: 200,
          json: { id: newTask.id, projectId: MEMBER_PROJECT },
        };
      },
    },
    "@/utils/controllers/notifications/broadcastInboxForTask": {
      broadcastInboxForTask: async () => undefined,
    },
    "@/lib/realtime/server": {
      broadcastBoardChange: (...args) => broadcasts.push(["board", ...args]),
      broadcastTaskChange: (...args) => broadcasts.push(["task", ...args]),
    },
  };

  const javascript = transpileHandler("src/pages/api/tasks/(un)archive.ts");
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request)
    );
    return { handler: mod.exports.default, updated, broadcasts };
  } finally {
    Module._load = originalLoad;
  }
}

async function callArchive(handler, { taskId, status, userId = MEMBER_USER_ID }) {
  const req = {
    method: "POST",
    body: { taskId, status },
    cookies: { nookies_user: JSON.stringify({ id: userId, displayName: "Member" }) },
  };
  let statusCode = 0;
  let payload;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(body) {
      payload = body;
      return res;
    },
  };
  await handler(req, res);
  return { status: statusCode, payload };
}

function loadSweepAutoArchives() {
  const broadcasts = [];
  const updated = [];
  const stubs = {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        $queryRaw: async () => [{ id: TASK_ID, projectId: MEMBER_PROJECT }],
        user: {
          findUnique: async () => ({
            id: 332,
            displayName: "HyperAI",
          }),
        },
      },
    },
    "@/utils/controllers/tasks/single": {
      updateTaskSingle: async (newTask, ...rest) => {
        updated.push({ newTask, rest });
        return { status: 200 };
      },
    },
    "@/utils/controllers/activities/createArchiveActivity": {
      __esModule: true,
      default: async () => undefined,
    },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove":
      {
        __esModule: true,
        default: async () => undefined,
      },
    "@/pages/api/queues/duedateQueue": {
      cancelDueDateJob: async () => undefined,
    },
    "@/lib/realtime/server": {
      broadcastBoardChange: (...args) => broadcasts.push(["board", ...args]),
      broadcastTaskChange: (...args) => broadcasts.push(["task", ...args]),
    },
    "@/lib/configs/general.config": {
      generalConfig: { hyperAiId: 332 },
    },
    "@/models/model": {},
  };

  const javascript = transpileHandler("src/utils/controllers/tasks/sweepAutoArchive.ts");
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request)
    );
    return { sweepAutoArchives: mod.exports.sweepAutoArchives, updated, broadcasts };
  } finally {
    Module._load = originalLoad;
  }
}

test("refreshTaskDetailQueryCache cancels stale fetches before writing archived status", async () => {
  const calls = [];
  const archivedTask = { id: TASK_ID, status: "Archive" };
  const queryClient = {
    cancelQueries: async (opts) => {
      calls.push(["cancel", opts.queryKey]);
    },
    setQueryData: (key, data) => {
      calls.push(["set", key, data]);
    },
  };

  const task = await refreshTaskDetailQueryCache({
    queryClient,
    taskId: TASK_ID,
    fetchTask: async () => archivedTask,
  });

  assert.equal(task, archivedTask);
  assert.deepEqual(calls, [
    ["cancel", ["task-", TASK_ID]],
    ["set", ["task-", TASK_ID], archivedTask],
  ]);
});

test("board archive route broadcasts board and task channels after persistence", async () => {
  const { handler, updated, broadcasts } = loadArchiveHandler();
  const { status, payload } = await callArchive(handler, {
    taskId: TASK_ID,
    status: "Archive",
  });

  assert.equal(status, 200);
  assert.equal(payload.id, TASK_ID);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].status, "Archive");
  assert.deepEqual(broadcasts.map(([kind]) => kind), ["board", "task"]);
  assert.equal(broadcasts[0][1], MEMBER_PROJECT);
  assert.equal(broadcasts[1][1], TASK_ID);
  assert.equal(broadcasts[1][2].originUserId, MEMBER_USER_ID);
});

test("auto-archive sweep broadcasts task detail changes for each archived row", async () => {
  const { sweepAutoArchives, updated, broadcasts } = loadSweepAutoArchives();
  const archived = await sweepAutoArchives();

  assert.equal(archived, 1);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].newTask.id, TASK_ID);
  assert.equal(updated[0].newTask.status, "Archive");
  assert.deepEqual(
    broadcasts.filter(([kind]) => kind === "task").map(([, taskId]) => taskId),
    [TASK_ID]
  );
  assert.deepEqual(
    broadcasts.filter(([kind]) => kind === "board").map(([, projectId]) => projectId),
    [MEMBER_PROJECT]
  );
});
