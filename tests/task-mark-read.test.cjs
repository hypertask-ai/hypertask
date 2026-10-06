const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { Prisma } = require("@prisma/client");

const root = path.resolve(__dirname, "..");
const taskId = 101;
const userId = 3412;
const readState = { lastReadAt: new Date("2026-10-01T14:30:00.000Z") };
const where = { taskId_userId: { taskId, userId } };

function prismaError(code) {
  return new Prisma.PrismaClientKnownRequestError("Mock database error", {
    code,
    clientVersion: "test",
  });
}

function loadModule(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    loadedModule,
    loadedModule.exports,
    (request) => {
      if (Object.hasOwn(stubs, request)) return stubs[request];
      if (request === "@prisma/client") return { Prisma };
      throw new Error(`Unexpected import: ${request}`);
    },
  );
  return loadedModule.exports;
}

function loadController({ upsertError, updateError, taskExists = true, lookupError } = {}) {
  const calls = { upsert: [], update: [], taskLookup: [] };
  const prisma = {
    taskReadState: {
      upsert: async (args) => {
        calls.upsert.push(args);
        if (upsertError) throw upsertError;
        return readState;
      },
      update: async (args) => {
        calls.update.push(args);
        if (updateError) throw updateError;
        return readState;
      },
    },
    task: {
      findUnique: async (args) => {
        calls.taskLookup.push(args);
        if (lookupError) throw lookupError;
        return taskExists ? { id: taskId } : null;
      },
    },
  };
  const controller = loadModule("src/utils/controllers/tasks/markRead.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
  });
  return { ...controller, calls };
}

test("marking read upserts the authenticated user's timestamp", async () => {
  const { markTaskRead, calls } = loadController();
  assert.deepEqual(await markTaskRead(taskId, userId), { status: 200, json: readState });
  assert.equal(calls.upsert.length, 1);
  assert.deepEqual(calls.upsert[0].where, where);
  assert.deepEqual(calls.upsert[0].select, { lastReadAt: true });
  assert.equal(calls.upsert[0].create.taskId, taskId);
  assert.equal(calls.upsert[0].create.userId, userId);
  assert.ok(calls.upsert[0].create.lastReadAt instanceof Date);
  assert.ok(calls.upsert[0].update.lastReadAt instanceof Date);
  assert.deepEqual(calls.update, []);
  assert.deepEqual(calls.taskLookup, []);
});

test("a concurrent unique-key conflict retries once as an update", async () => {
  const { markTaskRead, calls } = loadController({ upsertError: prismaError("P2002") });
  assert.deepEqual(await markTaskRead(taskId, userId), { status: 200, json: readState });
  assert.equal(calls.upsert.length, 1);
  assert.equal(calls.update.length, 1);
  assert.deepEqual(calls.update[0].where, where);
  assert.deepEqual(calls.update[0].select, { lastReadAt: true });
  assert.ok(calls.update[0].data.lastReadAt instanceof Date);
  assert.deepEqual(calls.taskLookup, []);
});

test("a missing task causing a foreign-key failure returns not found", async () => {
  const { markTaskRead, calls } = loadController({
    upsertError: prismaError("P2003"),
    taskExists: false,
  });
  assert.deepEqual(await markTaskRead(taskId, userId), {
    status: 404,
    json: { message: "Task not found" },
  });
  assert.deepEqual(calls.taskLookup, [{ where: { id: taskId }, select: { id: true } }]);
  assert.deepEqual(calls.update, []);
});

test("a task deleted between the unique conflict and retry returns not found", async () => {
  const { markTaskRead, calls } = loadController({
    upsertError: prismaError("P2002"),
    updateError: prismaError("P2025"),
    taskExists: false,
  });
  assert.deepEqual(await markTaskRead(taskId, userId), {
    status: 404,
    json: { message: "Task not found" },
  });
  assert.equal(calls.upsert.length, 1);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.taskLookup.length, 1);
});

for (const scenario of [
  { name: "a user foreign-key failure when the task exists", upsertError: prismaError("P2003") },
  { name: "an unexpected upsert failure", upsertError: new Error("Database unavailable") },
  { name: "an unexpected retry failure", upsertError: prismaError("P2002"), updateError: new Error("Database unavailable") },
  { name: "a repeated unique conflict", upsertError: prismaError("P2002"), updateError: prismaError("P2002") },
  { name: "a missing read state when the task still exists", upsertError: prismaError("P2002"), updateError: prismaError("P2025") },
  { name: "a task lookup outage", upsertError: prismaError("P2003"), lookupError: new Error("Database unavailable") },
]) {
  test(`${scenario.name} remains an internal server error`, async (t) => {
    t.mock.method(console, "log", () => {});
    const { markTaskRead, calls } = loadController(scenario);
    assert.deepEqual(await markTaskRead(taskId, userId), {
      status: 500,
      json: { message: "Internal server error" },
    });
    assert.equal(calls.upsert.length, 1);
    assert.ok(calls.update.length <= 1);
  });
}

test("invalid ids are rejected without querying Prisma", async () => {
  const { markTaskRead, calls } = loadController();
  for (const [invalidTaskId, invalidUserId] of [[NaN, userId], [taskId, Infinity]]) {
    assert.equal((await markTaskRead(invalidTaskId, invalidUserId)).status, 400);
  }
  assert.deepEqual(calls, { upsert: [], update: [], taskLookup: [] });
});

for (const scenario of [
  { name: "unauthenticated request", session: null, status: 401 },
  { name: "invalid task id", body: { taskId: "invalid" }, status: 400 },
  { name: "malformed beacon JSON", body: "{", status: 400 },
  { name: "missing task", upsertError: prismaError("P2003"), taskExists: false, status: 404 },
  { name: "unique conflict", upsertError: prismaError("P2002"), status: 200 },
  { name: "unexpected failure", upsertError: new Error("Database unavailable"), status: 500 },
]) {
  test(`the route returns ${scenario.status} for ${scenario.name}`, async (t) => {
    t.mock.method(console, "log", () => {});
    const controller = loadController(scenario);
    const { default: handler } = loadModule("src/pages/api/tasks/markRead.ts", {
      "@/lib/api/task-writes/route": { withTaskWriteFlag: (handler) => handler },
      "@/utils/controllers/tasks/markRead": controller,
      "@/lib/auth/getSessionUser": {
        getSessionUser: async () => scenario.session === null ? null : { userId },
      },
    });
    let status;
    let body;
    const response = {
      status(value) { status = value; return response; },
      json(value) { body = value; return response; },
    };
    await handler({
      method: "POST",
      headers: {},
      body: scenario.body ?? { taskId, userId: 999 },
    }, response);
    assert.equal(status, scenario.status);
    assert.ok(body);
    if (controller.calls.upsert.length) {
      assert.equal(controller.calls.upsert[0].create.userId, userId);
    } else {
      assert.ok([400, 401].includes(status));
    }
  });
}
