// HTPR-8431: DELETE /api/tasks/deleteTask answered "Task not found or access denied"
// for a live ticket that the caller can see, so every caller read it as a missing
// ticket. The route now answers "Task is not in the trash" for a live ticket and
// keeps "not found" for a ticket the caller cannot see.
// Drives the real handler; only the database layer and next/server are stubbed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "src/lib/api/task-writes/delete.ts");

class StubResponse {
  constructor(body, status) {
    this.body = body;
    this.status = status;
  }
  static json(body, init) {
    return new StubResponse(body, init?.status ?? 200);
  }
  async json() {
    return this.body;
  }
}

function loadDeleteRoute({ task }) {
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const calls = { findFirst: [], permanentlyDeleted: [], broadcasts: [] };
  const stubs = {
    "next/server": { NextResponse: StubResponse },
    "./route": {
      taskWriteRoute: (config) => async (request, session) =>
        config.operation(await request.json(), session),
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        task: {
          findFirst: async (args) => {
            calls.findFirst.push(args);
            return task;
          },
        },
      },
    },
    "@/lib/realtime/server": {
      broadcastBoardChange: async (projectId) => {
        calls.broadcasts.push(projectId);
      },
    },
    "@/utils/controllers/projects/getAllIncludes": {
      taskWriteAccessWhere: (userId) => ({ teamMembers: { some: { userId } } }),
    },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
    "@/utils/controllers/tasks/invokeTaskDelete": {
      permanentlyDeleteTask: async (taskId, userId) => {
        calls.permanentlyDeleted.push({ taskId, userId });
        return "success";
      },
    },
  };
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request in stubs) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    m._compile(js, file);
  } finally {
    Module._load = originalLoad;
  }
  return { DELETE: m.exports.DELETE, calls };
}

const deleteTask = async (taskId, options) => {
  const { DELETE, calls } = loadDeleteRoute(options);
  const response = await DELETE(
    { query: { taskId: String(taskId) }, headers: { get: () => null } },
    { userId: 7 },
  );
  return { status: response.status, body: await response.json(), calls };
};

test("a live ticket says it is not in the trash", async () => {
  const { status, body, calls } = await deleteTask(4711, {
    task: { projectId: 15, status: "Normal" },
  });
  assert.equal(status, 409);
  assert.equal(body.message, "Task is not in the trash");
  assert.deepEqual(calls.permanentlyDeleted, []);
});

test("an archived ticket says it is not in the trash", async () => {
  const { status, body } = await deleteTask(4711, {
    task: { projectId: 15, status: "Archive" },
  });
  assert.equal(status, 409);
  assert.equal(body.message, "Task is not in the trash");
});

test("a ticket the caller cannot see still says not found", async () => {
  const { status, body, calls } = await deleteTask(4711, { task: null });
  assert.equal(status, 404);
  assert.equal(body.message, "Task not found or access denied");
  assert.deepEqual(calls.permanentlyDeleted, []);
  assert.equal(calls.findFirst[0].where.status, undefined);
});

test("a trashed ticket is still permanently deleted", async () => {
  const { status, body, calls } = await deleteTask(4711, {
    task: { projectId: 15, status: "Deleted" },
  });
  assert.equal(status, 200);
  assert.equal(body.message, "Success");
  assert.deepEqual(calls.permanentlyDeleted, [{ taskId: 4711, userId: 7 }]);
  assert.deepEqual(calls.broadcasts, [15]);
});

test("the lookup stays scoped to the caller's projects", async () => {
  const { calls } = await deleteTask(4711, {
    task: { projectId: 15, status: "Deleted" },
  });
  assert.deepEqual(calls.findFirst[0].where, {
    id: 4711,
    project: { teamMembers: { some: { userId: 7 } } },
  });
});
