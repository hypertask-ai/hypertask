const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function fixture(enabled = true) {
  let rows = [
    ...Array.from({ length: 500 }, (_, index) => ({ id: index + 1, taskId: index + 1, userId: 985, status: "Normal", archivedAt: null })),
    { id: 501, taskId: 1, userId: 985, status: "Normal", archivedAt: null },
    { id: 502, taskId: 1, userId: 985, status: "Deleted", archivedAt: null },
    { id: 503, taskId: 1, userId: 2343, status: "Normal", archivedAt: null },
  ];
  const matches = (row, where) => Object.entries(where).every(([field, value]) => {
    if (typeof value !== "object" || value === null) return row[field] === value;
    if (value.in) return value.in.includes(row[field]);
    if (value.notIn) return !value.notIn.includes(row[field]);
    return row[field] !== value.not;
  });
  const broadcasts = [];
  const prisma = {
    notification: { findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null },
    $transaction: async (operation) => {
      const pending = rows.map((row) => ({ ...row }));
      let elapsed = 0;
      const result = await operation({ notification: { updateMany: async ({ where, data }) => {
        elapsed += 20;
        if (elapsed > 5000) throw new Error("P2028: transaction expired");
        let count = 0;
        for (const row of pending) if (matches(row, where)) { Object.assign(row, data); count++; }
        return { count };
      } } });
      rows = pending;
      return result;
    },
  };
  const { POST } = load("src/lib/api/notification-writes/archive-bulk.ts", {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/auth/agentScope": { withAgentScopeRequest: (_request, callback) => callback(), prepareAgentScope: async () => {} },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/realtime/server": { broadcastInboxChange: async (...args) => broadcasts.push(args), socketIdFromHeader: (value) => value },
  });
  const request = (entries, status = "Archive") => POST({
    headers: new Headers({ "x-socket-id": "123.456" }),
    json: async () => ({ notificationIds: entries, status }),
  });
  return { request, rows: () => rows, broadcasts };
}

for (const enabled of [false, true]) {
  test(`archive and undo keep siblings recoverable and other users untouched, flag ${enabled}`, async () => {
    const f = fixture(enabled);
    let response = await f.request([{ notificationId: 1, taskId: 1 }]);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: "Notifications processed successfully", archivedCount: 1, deletedCount: 1 });
    const archived = f.rows().filter((row) => row.id === 1 || row.id === 501);
    assert.deepEqual(archived.map((row) => row.status), ["Archive", "Archive"]);
    assert.ok(archived[0].archivedAt instanceof Date);
    assert.equal(archived[0].archivedAt.getTime(), archived[1].archivedAt.getTime());
    assert.equal(f.rows().find((row) => row.id === 502).status, "Deleted");
    assert.equal(f.rows().find((row) => row.id === 503).status, "Normal");
    response = await f.request([{ notificationId: 1, taskId: 1 }], "Normal");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: "Notifications processed successfully", archivedCount: 1, deletedCount: 0 });
    assert.deepEqual(f.rows().find((row) => row.id === 1), { id: 1, taskId: 1, userId: 985, status: "Normal", archivedAt: null });
    assert.equal(f.rows().find((row) => row.id === 501).status, "Archive");
    assert.deepEqual(f.broadcasts[0], [985, { originUserId: 985 }, "123.456"]);
  });
}

test("large selections archive atomically within the transaction budget", async () => {
  const f = fixture();
  const response = await f.request(Array.from({ length: 500 }, (_, index) => ({ notificationId: index + 1, taskId: index + 1 })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "Notifications processed successfully", archivedCount: 500, deletedCount: 1 });
  assert.equal(f.rows().filter((row) => row.status === "Archive").length, 501);
});

test("overlapping selected tasks and duplicate IDs count each row once", async () => {
  const f = fixture();
  const response = await f.request([{ notificationId: 1, taskId: 1 }, { notificationId: 501, taskId: 1 }, { notificationId: 1, taskId: 1 }, { notificationId: 2000000000, taskId: null }]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "Notifications processed successfully", archivedCount: 2, deletedCount: 0 });
  assert.equal(f.rows().find((row) => row.id === 502).status, "Deleted");
});

test("a foreign notification rejects the whole batch before any change", async () => {
  const f = fixture();
  const response = await f.request([{ notificationId: 1, taskId: 1 }, { notificationId: 503, taskId: 1 }]);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: "Forbidden" });
  assert.equal(f.rows()[0].status, "Normal");
  assert.deepEqual(f.broadcasts, []);
});
