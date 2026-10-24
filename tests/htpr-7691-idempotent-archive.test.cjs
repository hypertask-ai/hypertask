const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function resetModules(relativePaths) {
  for (const relativePath of relativePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-htpr-7691-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const loaded = jiti(path.join(root, relativePath));
  return typeof loaded === "function" ? loaded : loaded.default ?? loaded;
}

function makeRes() {
  const res = {
    setHeader() {},
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
  return res;
}

function makeReq({ method = "GET", query = {}, body = {} } = {}) {
  return {
    method,
    query,
    body,
    headers: {},
  };
}

function makeNotificationStub(row) {
  const calls = { updateMany: [], update: [] };
  const notification = {
    findUnique: async () => row,
    updateMany: async (args) => {
      calls.updateMany.push(args);
      return { count: 1 };
    },
    update: async (args) => {
      calls.update.push(args);
      return { ...row, ...(args.data ?? {}) };
    },
  };
  return { notification, calls };
}

async function loadMarkAsDone({ row, flagOn = true }) {
  const stub = makeNotificationStub(row);
  const broadcasts = [];
  resetModules([
    "src/pages/api/notifications/markAsDone.ts",
    "src/lib/api/notification-writes/mark-done.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/lib/api/task-writes/route.ts",
    "src/lib/realtime/server.ts",
    "src/lib/prisma.ts",
    "src/lib/flags.ts",
  ]);
  stubModule("src/lib/flags.ts", {
    isFeatureEnabled: async (key, userId) => key === "htpr-7691-idempotent-archive" && userId === 6 && flagOn,
  });
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => ({ userId: 6 }),
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastInboxChange: async (...args) => broadcasts.push(args),
    socketIdFromHeader: () => null,
  });
  stubModule("src/lib/prisma.ts", { default: { notification: stub.notification } });
  const handler = loadTs("src/pages/api/notifications/markAsDone.ts");
  return { handler, calls: stub.calls, broadcasts };
}


const archivedRow = { id: 5, userId: 6, taskId: 77, status: "Archive", type: "TaskReminder", archivedAt: new Date("2026-10-23T21:00:00.000Z") };

test("archiving a message that is already archived leaves it archived", async () => {
  const { handler, calls } = await loadMarkAsDone({ row: archivedRow });
  const res = makeRes();
  await handler(makeReq({ query: { id: "5", taskId: "77", intent: "archive" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "Archive");
  assert.deepEqual(calls.update, []);
  assert.deepEqual(calls.updateMany, []);
});

test("Undo, which sends no archive intent, still puts an archived message back", async () => {
  const { handler, calls } = await loadMarkAsDone({ row: archivedRow });
  const res = makeRes();
  await handler(makeReq({ query: { id: "5", taskId: "77" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "Normal");
  assert.equal(calls.update[0].data.status, "Normal");
});

test("archive intent still archives a message that is in the Inbox", async () => {
  const { handler, calls } = await loadMarkAsDone({ row: { ...archivedRow, status: "Normal", archivedAt: null } });
  const res = makeRes();
  await handler(makeReq({ query: { id: "5", taskId: "77", intent: "archive" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "Archive");
  assert.equal(calls.update[0].data.status, "Archive");
});

test("with the flag off a second archive keeps the old toggle", async () => {
  const { handler } = await loadMarkAsDone({ row: archivedRow, flagOn: false });
  const res = makeRes();
  await handler(makeReq({ query: { id: "5", taskId: "77", intent: "archive" } }), res);
  assert.equal(res.payload.status, "Normal");
});

test("the bugfix flag is on for everyone by default", () => {
  const flag = loadTs("src/lib/flags/definitions/htpr-7691-idempotent-archive.ts");
  assert.equal(flag.key, "htpr-7691-idempotent-archive");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
});
