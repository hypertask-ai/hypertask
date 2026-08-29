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
    path.join(root, `tests/jiti-inbox-undo-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const loaded = jiti(path.join(root, relativePath));
  // Single default-export routes come back wrapped as { default: fn }.
  return typeof loaded === "function" ? loaded : loaded.default ?? loaded;
}

function makeRes() {
  const res = {
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

// A prisma.notification stub that records every updateMany/update and serves
// a scripted row for findUnique.
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

async function loadMarkAsDone({ row }) {
  const stub = makeNotificationStub(row);
  const broadcasts = [];
  resetModules([
    "src/pages/api/notifications/markAsDone.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/lib/realtime/server.ts",
    "src/lib/prisma.ts",
  ]);
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

async function loadArchiveBulk() {
  const calls = { updateMany: [], transaction: null };
  const notification = {
    findFirst: async () => null,
    updateMany: async (args) => {
      calls.updateMany.push(args);
      return { count: 1 };
    },
  };
  const prisma = {
    notification,
    $transaction: async (fn) => {
      calls.transaction = true;
      return fn(prisma);
    },
  };
  resetModules([
    "src/pages/api/notifications/(un)archiveBulk.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/lib/realtime/server.ts",
    "src/lib/prisma.ts",
  ]);
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => ({ userId: 6 }),
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastInboxChange: async () => undefined,
    socketIdFromHeader: () => null,
  });
  stubModule("src/lib/prisma.ts", { default: prisma });
  const handler = loadTs("src/pages/api/notifications/(un)archiveBulk.ts");
  return { handler, calls };
}

test("archiving an inbox notification archives siblings instead of deleting them", async () => {
  const batchTime = new Date("2026-08-23T12:00:00.000Z");
  const { handler, calls } = await loadMarkAsDone({
    row: {
      id: 5,
      userId: 6,
      taskId: 77,
      status: "Normal",
      type: "TaskDueDate",
      archivedAt: null,
    },
  });
  // Freeze Date so both writes share one batch timestamp.
  const realNow = Date.now;
  Date.now = () => batchTime.getTime();
  try {
    const res = makeRes();
    await handler(makeReq({ query: { id: "5", taskId: "77" } }), res);
    assert.equal(res.statusCode, 200);
  } finally {
    Date.now = realNow;
  }

  const siblingWrite = calls.updateMany.find(
    (args) => args.where?.id && args.where.id.not === 5
  );
  assert.ok(siblingWrite, "expected a sibling write scoped to id != representative");
  assert.equal(siblingWrite.where.taskId, 77);
  assert.equal(siblingWrite.where.userId, 6);
  assert.equal(siblingWrite.data.status, "Archive", "siblings must stay recoverable");
  assert.ok(siblingWrite.data.archivedAt, "siblings need the batch timestamp");

  const representativeWrite = calls.update.find((args) => args.where?.id === 5);
  assert.ok(representativeWrite, "expected the representative archive write");
  assert.equal(representativeWrite.data.status, "Archive");
  assert.equal(
    representativeWrite.data.archivedAt?.getTime(),
    siblingWrite.data.archivedAt.getTime(),
    "representative and siblings must share the exact batch timestamp"
  );
});

test("undo restores the representative and the siblings archived in the same batch", async () => {
  const batchTime = new Date("2026-08-23T12:00:00.000Z");
  const { handler, calls } = await loadMarkAsDone({
    row: {
      id: 5,
      userId: 6,
      taskId: 77,
      status: "Archive",
      type: "TaskDueDate",
      archivedAt: batchTime,
    },
  });
  const res = makeRes();
  await handler(makeReq({ query: { id: "5", taskId: "77" } }), res);
  assert.equal(res.statusCode, 200);

  const restoreWrite = calls.updateMany.find(
    (args) => args.data?.status === "Normal"
  );
  assert.ok(restoreWrite, "expected a batch restore write");
  assert.equal(restoreWrite.where.taskId, 77);
  assert.equal(restoreWrite.where.userId, 6);
  assert.equal(restoreWrite.where.id.not, 5);
  assert.equal(restoreWrite.where.status, "Archive");
  assert.equal(restoreWrite.where.archivedAt?.getTime(), batchTime.getTime());

  const representativeWrite = calls.update.find((args) => args.where?.id === 5);
  assert.ok(representativeWrite, "expected the representative restore write");
  assert.equal(representativeWrite.data.status, "Normal");
  assert.equal(representativeWrite.data.archivedAt, null);
});

test("undo of a task-less notification restores only that row", async () => {
  const { handler, calls } = await loadMarkAsDone({
    row: {
      id: 9,
      userId: 6,
      taskId: null,
      status: "Archive",
      type: "Invited",
      archivedAt: new Date("2026-08-23T12:00:00.000Z"),
    },
  });
  const res = makeRes();
  await handler(makeReq({ query: { id: "9" } }), res);
  assert.equal(res.statusCode, 200);

  assert.equal(
    calls.updateMany.length,
    0,
    "no sibling writes without a taskId"
  );
  const representativeWrite = calls.update.find((args) => args.where?.id === 9);
  assert.ok(representativeWrite);
  assert.equal(representativeWrite.data.status, "Normal");
});

test("bulk archive keeps siblings recoverable with the batch timestamp", async () => {
  const { handler, calls } = await loadArchiveBulk();
  const res = makeRes();
  await handler(
    makeReq({
      method: "POST",
      body: {
        notificationIds: [{ notificationId: 5, taskId: 77 }],
        status: "Archive",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 200);

  const siblingWrite = calls.updateMany.find(
    (args) => args.where?.id && args.where.id.not === 5
  );
  assert.ok(siblingWrite, "expected a sibling write");
  assert.equal(siblingWrite.data.status, "Archive", "bulk siblings must stay recoverable");
  const representativeWrite = calls.updateMany.find(
    (args) => args.where?.id === 5
  );
  assert.ok(representativeWrite);
  assert.equal(
    representativeWrite.data.archivedAt?.getTime(),
    siblingWrite.data.archivedAt.getTime(),
    "bulk representative and siblings must share the batch timestamp"
  );
});

test("bulk unarchive does not delete or re-archive siblings", async () => {
  const { handler, calls } = await loadArchiveBulk();
  const res = makeRes();
  await handler(
    makeReq({
      method: "POST",
      body: {
        notificationIds: [{ notificationId: 5, taskId: 77 }],
        status: "Normal",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 200);

  const writes = calls.updateMany;
  assert.equal(writes.length, 1, "only the representative write is expected");
  assert.equal(writes[0].where.id, 5);
  assert.equal(writes[0].data.status, "Normal");
});
