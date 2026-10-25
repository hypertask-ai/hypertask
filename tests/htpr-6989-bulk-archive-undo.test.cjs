const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const originalRevision = "008e6325caf9a521a2f8d1dd9fb642a0b74b6f3d";
const bulkPage = "src/pages/api/notifications/(un)archiveBulk.ts";
const bulkWeb = "src/lib/api/notification-writes/archive-bulk.ts";
const proveUnfixed = process.argv.includes("--prove-unfixed");

function compileOriginal(file, mocks) {
  const source = execFileSync("git", ["show", `${originalRevision}:${file}`], { cwd: root, encoding: "utf8" });
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    if (!Object.hasOwn(mocks, specifier)) {
      if (specifier.startsWith("@/")) return load(`src/${specifier.slice(2)}.ts`, mocks);
      return require(specifier);
    }
    const mock = mocks[specifier];
    return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
  }, mod, mod.exports);
  return mod.exports;
}

function fixture(api, original = false) {
  const rows = [101, 102, 103].map((id, index) => ({
    id, taskId: 201 + index, userId: 985, agentId: null, fromUserId: 7,
    type: "TaskMovedToInbox", status: "Normal", archivedAt: null,
  }));
  rows.push({ ...rows[0], id: 104, userId: 7 }, { ...rows[1], id: 105, status: "Deleted" });
  const writes = [], broadcasts = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if (Object.hasOwn(value, "in")) return value.in.includes(row[key]);
      if (Object.hasOwn(value, "not")) return row[key] !== value.not;
    }
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
  });
  const notification = {
    findFirst: async ({ where }) => structuredClone(rows.find(row => matches(row, where)) ?? null),
    findUnique: async ({ where }) => structuredClone(rows.find(row => matches(row, where)) ?? null),
    updateMany: async ({ where, data }) => {
      const found = rows.filter(row => matches(row, where));
      found.forEach(row => Object.assign(row, structuredClone(data)));
      writes.push({ where, data, count: found.length });
      return { count: found.length };
    },
    update: async ({ where, data }) => {
      const row = rows.find(row => matches(row, where));
      assert.ok(row, "single archive must find its notification");
      Object.assign(row, structuredClone(data));
      return structuredClone(row);
    },
  };
  const db = { notification, $transaction: async callback => callback(db) };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/realtime/server": {
      socketIdFromHeader: () => "123.456",
      broadcastInboxChange: async (...args) => broadcasts.push(args),
    },
  };
  const web = original ? compileOriginal(bulkWeb, mocks).POST : load(bulkWeb, mocks).POST;
  mocks["@/lib/api/notification-writes/archive-bulk"] = { POST: web };
  // The unfixed variant swaps only the shared Web handler, which holds the bug; the Pages adapter is always current.
  const page = load(bulkPage, mocks).default;
  const markPage = load("src/pages/api/notifications/markAsDone.ts", mocks).default;
  const markWeb = load("src/lib/api/notification-writes/mark-done.ts", mocks).GET;
  const undo = load("src/utils/undoActions/helperFuncs.ts", {
    "@/lib/realtime/client": { realtimeEchoHeaders: () => ({ "x-socket-id": "123.456" }) },
    "../api/global": { default: {} },
  }).UndoInboxArchive;
  // These task-backed, non-self-triggered fixture rows otherwise qualify for All.
  const scope = load("src/utils/controllers/notifications/visibleInboxScope.ts", {}).visibleUserInboxWhere(985);
  const inboxIds = () => rows.filter(row => ["userId", "agentId", "status", "archivedAt"].every(key => row[key] === scope[key])).map(row => row.id);
  async function invoke(body, single = false) {
    const query = single ? { id: "101", taskId: "201", userId: "7" } : {};
    if (api === "web") {
      const request = {
        headers: new Headers({ "x-socket-id": "123.456" }), query,
        json: async () => body,
      };
      return (single ? markWeb : web)(request);
    }
    let response;
    await (single ? markPage : page)({ method: single ? "GET" : "POST", headers: {}, query, body }, {
      setHeader() {},
      status: status => ({ json: payload => { response = Response.json(payload, { status }); return response; } }),
    });
    return response;
  }
  async function clientUndo(data) {
    const saved = global.fetch;
    global.fetch = async (url, options) => {
      if (data.isBulkOperation) {
        assert.equal(url, "/api/notifications/(un)archiveBulk");
        assert.deepEqual(JSON.parse(options.body), { notificationIds: data.notificationIds, status: "Normal" });
        return invoke(JSON.parse(options.body));
      }
      assert.ok(url.startsWith("/api/notifications/markAsDone?id=101&taskId=201&"));
      return invoke({}, true);
    };
    try { return await undo(data); } finally { global.fetch = saved; }
  }
  return { rows, writes, broadcasts, inboxIds, invoke, clientUndo };
}

async function bulkRoundTrip(api, original = false) {
  const fx = fixture(api, original);
  const notificationIds = fx.rows.slice(0, 3).map(({ id, taskId }) => ({ notificationId: id, taskId, userId: 7 }));
  assert.deepEqual(fx.inboxIds(), [101, 102, 103]);
  const archived = await fx.invoke({ notificationIds, status: "Archive" });
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).archivedCount, 3);
  assert.deepEqual(fx.inboxIds(), []);
  assert.ok(fx.rows.slice(0, 3).every(row => row.status === "Archive" && row.archivedAt instanceof Date));
  const undoStart = fx.writes.length;
  const restored = await fx.clientUndo({ isBulkOperation: true, notificationIds });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).archivedCount, 3, "the reported bug updates three rows, not zero");
  assert.equal(fx.writes.slice(undoStart).reduce((total, write) => total + write.count, 0), 3);
  assert.ok(fx.rows.slice(0, 3).every(row => row.status === "Normal"));
  assert.equal(fx.rows[3].status, "Normal", "other user's notification must not change");
  assert.equal(fx.rows[4].status, "Deleted", "Deleted notifications must not change");
  assert.equal(fx.broadcasts.length, 2);
  assert.deepEqual(fx.broadcasts[1], [985, { originUserId: 985 }, "123.456"]);
  // A fresh read of persisted rows, rather than an optimistic cache, models reload.
  assert.deepEqual(fx.inboxIds(), [101, 102, 103], `${api}: bulk undo must restore the persisted inbox`);
  assert.ok(fx.rows.slice(0, 3).every(row => row.archivedAt === null));
}

test("bulk undo restores all three persisted inbox items and preserves single undo on both API paths", async () => {
  const savedLog = console.log;
  console.log = () => {};
  try {
    for (const api of ["pages", "web"]) {
      if (proveUnfixed) {
        await assert.rejects(() => bulkRoundTrip(api, true), error =>
          error.code === "ERR_ASSERTION" && error.message.includes("bulk undo must restore the persisted inbox") &&
          JSON.stringify(error.actual) === "[]" && JSON.stringify(error.expected) === "[101,102,103]",
        );
        continue;
      }
      await bulkRoundTrip(api);
      const single = fixture(api);
      assert.equal((await single.invoke({}, true)).status, 200);
      assert.deepEqual(single.inboxIds(), [102, 103]);
      await single.clientUndo({ notification: { id: "101", taskId: 201, type: "TaskMovedToInbox" }, currentUser: { id: 985 } });
      assert.deepEqual(single.inboxIds(), [101, 102, 103], `${api}: single undo must keep working`);
      assert.equal(single.rows[0].archivedAt, null);
      const fx = fixture(api);
      assert.equal((await fx.invoke({ notificationIds: [{ notificationId: 104 }], status: "Normal" })).status, 403);
      assert.deepEqual(fx.writes, [], "foreign notification rejects before writing");
      const missing = await fx.invoke({ notificationIds: [{ notificationId: 999 }], status: "Normal" });
      assert.equal(missing.status, 200);
      assert.equal((await missing.json()).archivedCount, 0, "unknown IDs can return zero but are not the reported cause");
    }
  } finally { console.log = savedLog; }
  console.log(proveUnfixed ? "HTPR-6989 original implementation regression confirmed" : "HTPR-6989 bulk archive undo passed");
});
