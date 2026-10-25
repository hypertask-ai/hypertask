const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (Object.hasOwn(value, "in")) return value.in.includes(row[key]);
    if (Object.hasOwn(value, "notIn")) return !value.notIn.includes(row[key]);
    if (Object.hasOwn(value, "not")) return row[key] !== value.not;
  }
  return row[key] === value;
});

function fixture(flagOn, size) {
  const rows = [];
  for (let i = 1; i <= size; i += 1) {
    rows.push({ id: i, taskId: 1000 + i, userId: 985, status: "Normal", archivedAt: null });
    rows.push({ id: size + i, taskId: 1000 + i, userId: 985, status: "Normal", archivedAt: null });
  }
  rows.push({ id: 90001, taskId: 1001, userId: 985, status: "Deleted", archivedAt: null });
  rows.push({ id: 90002, taskId: 1001, userId: 7, status: "Normal", archivedAt: null });
  let updates = 0;
  const db = {
    notification: {
      findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
      updateMany: async ({ where, data }) => {
        updates += 1;
        const found = rows.filter((row) => matches(row, where));
        found.forEach((row) => Object.assign(row, data));
        return { count: found.length };
      },
    },
    $transaction: async (callback) => callback(db),
  };
  const { POST } = load("src/lib/api/notification-writes/archive-bulk.ts", {
    "@/lib/prisma": { default: db },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/realtime/server": { socketIdFromHeader: () => null, broadcastInboxChange: async () => {} },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === "htpr-7952-bulk-archive-two-updates" && flagOn },
  });
  const call = (body) => POST({ headers: new Headers(), json: async () => body }, { userId: 985 });
  return { rows, call, updates: () => updates };
}

const entries = (size) => Array.from({ length: size }, (_, i) => ({ notificationId: i + 1, taskId: 1001 + i }));

for (const flagOn of [true, false]) {
  test(`archiving 3 items archives them and their task siblings, flag ${flagOn}`, async () => {
    const { rows, call } = fixture(flagOn, 3);
    const response = await call({ notificationIds: entries(3), status: "Archive" });
    assert.equal(response.status, 200);
    for (const row of rows.filter((r) => r.userId === 985 && r.status !== "Deleted")) {
      assert.equal(row.status, "Archive");
      assert.ok(row.archivedAt instanceof Date);
    }
    assert.equal(rows.find((r) => r.id === 90001).status, "Deleted");
    assert.equal(rows.find((r) => r.id === 90002).status, "Normal");
  });

  test(`restoring 3 items clears the archive time, flag ${flagOn}`, async () => {
    const { rows, call } = fixture(flagOn, 3);
    await call({ notificationIds: entries(3), status: "Archive" });
    await call({ notificationIds: entries(3), status: "Normal" });
    for (const id of [1, 2, 3]) {
      const row = rows.find((r) => r.id === id);
      assert.equal(row.status, "Normal");
      assert.equal(row.archivedAt, null);
    }
  });
}

test("a 300 item selection costs two database updates with the flag on and 600 with it off", async () => {
  const on = fixture(true, 300);
  assert.equal((await on.call({ notificationIds: entries(300), status: "Archive" })).status, 200);
  assert.equal(on.updates(), 2);
  const off = fixture(false, 300);
  await off.call({ notificationIds: entries(300), status: "Archive" });
  assert.equal(off.updates(), 600);
});

test("still refused: another user's notification in the selection gives 403 and changes nothing", async () => {
  const { rows, call, updates } = fixture(true, 3);
  const response = await call({ notificationIds: [...entries(3), { notificationId: 90002, taskId: 1001 }], status: "Archive" });
  assert.equal(response.status, 403);
  assert.equal(updates(), 0);
  assert.ok(rows.every((row) => row.status !== "Archive"));
});
