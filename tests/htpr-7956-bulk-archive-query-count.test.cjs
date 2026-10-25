const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function fixture(rowCount) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: index + 1, taskId: 1000 + index, userId: 985, status: "Normal", archivedAt: null,
  }));
  rows.push({ id: rowCount + 1, taskId: 1000, userId: 985, status: "Normal", archivedAt: null });
  rows.push({ id: rowCount + 2, taskId: 1001, userId: 7, status: "Normal", archivedAt: null });
  const writes = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if (Object.hasOwn(value, "in")) return value.in.includes(row[key]);
      if (Object.hasOwn(value, "notIn")) return !value.notIn.includes(row[key]);
      if (Object.hasOwn(value, "not")) return row[key] !== value.not;
    }
    return row[key] === value;
  });
  const db = {
    notification: {
      findFirst: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
      updateMany: async ({ where, data }) => {
        const found = rows.filter(row => matches(row, where));
        found.forEach(row => Object.assign(row, data));
        writes.push({ where, count: found.length });
        return { count: found.length };
      },
    },
    $transaction: async callback => callback(db),
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/realtime/server": { socketIdFromHeader: () => null, broadcastInboxChange: async () => {} },
  };
  const { POST } = load("src/lib/api/notification-writes/archive-bulk.ts", mocks);
  const invoke = body => POST({ headers: new Headers(), json: async () => body });
  return { rows, writes, invoke };
}

test("bulk archive uses the same number of queries for 3 and 300 notifications", async () => {
  const savedLog = console.log;
  console.log = () => {};
  try {
    for (const size of [3, 300]) {
      const fx = fixture(size);
      const notificationIds = fx.rows.slice(0, size).map(({ id, taskId }) => ({ notificationId: id, taskId, userId: 985 }));
      const response = await fx.invoke({ notificationIds, status: "Archive" });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.archivedCount, size, "own notifications still archive");
      assert.equal(body.deletedCount, 1, "same-task sibling still archives, other user's does not");
      assert.equal(fx.writes.length, 2, `${size} notifications must not grow the query count`);
      assert.ok(fx.rows.slice(0, size + 1).every(row => row.status === "Archive"));
      assert.equal(fx.rows[size + 1].status, "Normal");
    }
  } finally { console.log = savedLog; }
});

test("bulk restore is one query and another user's notification is still refused", async () => {
  const savedLog = console.log;
  console.log = () => {};
  try {
    const fx = fixture(50);
    const notificationIds = fx.rows.slice(0, 50).map(({ id, taskId }) => ({ notificationId: id, taskId, userId: 985 }));
    assert.equal((await fx.invoke({ notificationIds, status: "Archive" })).status, 200);
    fx.writes.length = 0;
    const restored = await fx.invoke({ notificationIds, status: "Normal" });
    assert.equal((await restored.json()).archivedCount, 50);
    assert.equal(fx.writes.length, 1);
    const foreign = await fx.invoke({ notificationIds: [{ notificationId: 52 }], status: "Archive" });
    assert.equal(foreign.status, 403);
  } finally { console.log = savedLog; }
});
