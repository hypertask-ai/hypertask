const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function resetModules(relativePaths) {
  for (const relativePath of relativePaths) delete require.cache[path.join(root, relativePath)];
}

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, `tests/jiti-htpr-7682-${++jitiEntryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  const loaded = jiti(path.join(root, relativePath));
  return typeof loaded === "function" ? loaded : loaded.default ?? loaded;
}

function makeRes() {
  return {
    setHeader() {},
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
}

const inboxRow = { id: 5, userId: 6, taskId: 77, status: "Normal", type: "TaskReminder", archivedAt: null };

function loadHandler({ session = { userId: 6 } } = {}) {
  const updates = [];
  resetModules([
    "src/pages/api/notifications/markAsDone.ts",
    "src/lib/api/notification-writes/mark-done.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/lib/api/task-writes/route.ts",
    "src/lib/realtime/server.ts",
    "src/lib/prisma.ts",
    "src/lib/flags.ts",
  ]);
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => false });
  stubModule("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => session });
  stubModule("src/lib/realtime/server.ts", { broadcastInboxChange: async () => {}, socketIdFromHeader: () => null });
  stubModule("src/lib/prisma.ts", { default: { notification: {
    findUnique: async () => inboxRow,
    updateMany: async () => ({ count: 1 }),
    update: async (args) => { updates.push(args); return { ...inboxRow, ...args.data }; },
  } } });
  return { handler: loadTs("src/pages/api/notifications/markAsDone.ts"), updates };
}

const request = (method, extra) => ({ method, query: {}, body: undefined, headers: {}, ...extra });

test("a POST with a JSON body archives the message", async () => {
  const { handler, updates } = loadHandler();
  const res = makeRes();
  await handler(request("POST", { body: { id: 5, taskId: 77, userId: 6, type: "TaskReminder", intent: "archive" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "Archive");
  assert.equal(updates[0].where.id, 5);
});

test("a POST with a null task id still archives the message", async () => {
  const { handler, updates } = loadHandler();
  const res = makeRes();
  await handler(request("POST", { body: { id: 5, taskId: null, userId: 6, type: "TaskReminder" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updates[0].data.status, "Archive");
});

test("the old GET still archives while clients switch over", async () => {
  const { handler, updates } = loadHandler();
  const res = makeRes();
  await handler(request("GET", { query: { id: "5", taskId: "77", userId: "6", type: "TaskReminder" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, "Archive");
  assert.equal(updates.length, 1);
});

test("a POST without a session is refused and archives nothing", async () => {
  const { handler, updates } = loadHandler({ session: null });
  const res = makeRes();
  await handler(request("POST", { body: { id: 5, taskId: 77 } }), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(updates, []);
});

test("a POST for another user's message is refused", async () => {
  const { handler, updates } = loadHandler({ session: { userId: 99 } });
  const res = makeRes();
  await handler(request("POST", { body: { id: 5, taskId: 77 } }), res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(updates, []);
});

test("other methods are still refused", async () => {
  const { handler } = loadHandler();
  const res = makeRes();
  await handler(request("PATCH"), res);
  assert.equal(res.statusCode, 405);
});
