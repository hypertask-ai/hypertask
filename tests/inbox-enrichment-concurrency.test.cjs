const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let entryId = 0;

function deferred() {
  const { promise, resolve, reject } = Promise.withResolvers();
  return { promise, resolve, reject };
}

const readAt = new Date("2026-10-01T10:00:00Z");
const createdAt = new Date("2026-10-01T12:00:00Z");
const human = { id: 8, displayName: "Human", photoURL: null, email: "qa@example.test" };
const agent = { id: "agent-1", displayName: "Agent", photoURL: null, permissions: { postsToImportant: false } };

function notification(id, taskId, type, fromAgentId = null) {
  return {
    id, taskId, type, fromAgentId, fromUserId: fromAgentId ? null : human.id,
    fromUser: fromAgentId ? null : human,
    fromAgent: fromAgentId ? agent : null,
    userId: 2343, agentId: null, status: "Normal", archivedAt: null,
    seen: false, directReply: false, createdAt,
    commentId: null, comment: null,
    task: {
      id: taskId, title: `Task ${taskId}`, priority: "Normal", status: "Normal",
      sectionChangedAt: readAt, createdAt: readAt, lastCommentAt: null,
      section: { title: "In Progress" }, assignees: [],
    },
  };
}

function fixture({ empty = false, hold = false } = {}) {
  const representatives = empty ? [] : [
    notification(10, 1, "TaskDueDate", agent.id),
    notification(20, 2, "Comment"),
  ];
  const earner = { ...notification(9, 1, "Mentioned"), createdAt: readAt, commentId: 90, comment: { id: 90, text: "Please look" } };
  const gates = Object.fromEntries(["agents", "users", "readStates", "comments", "unread"].map((name) => [name, deferred()]));
  const calls = [];
  const read = (name, args, rows) => {
    calls.push({ name, args });
    return hold ? gates[name].promise.then(() => rows) : Promise.resolve(rows);
  };
  const prisma = {
    $queryRaw: async (query) => query.sql.includes("AS selected")
      ? representatives.map(({ id }) => ({ id }))
      : representatives.flatMap((row) => [
          { taskId: row.taskId, type: row.type, fromAgentId: row.fromAgentId, fromUserId: row.fromUserId, createdAt },
          ...(row.taskId === 1 ? [{ taskId: 1, type: "Mentioned", fromAgentId: null, fromUserId: human.id, createdAt: readAt }] : []),
        ]),
    notification: {
      findMany: async (args) => {
        if (args.where.AND?.some((clause) => clause.id)) return representatives;
        if (args.where.directReply) return empty ? [] : [
          { taskId: 1, type: "Mentioned", fromAgentId: null },
          { taskId: 2, type: "Comment", fromAgentId: agent.id },
        ];
        if (args.where.userId === 2343) {
          calls.push({ name: "earners", args });
          return [earner];
        }
        return [];
      },
      groupBy: (args) => {
        assert.equal(args.where.seen, false, "only unread notification counts are queried");
        return read("unread", args, [{ taskId: 2, _count: { _all: 3 } }]);
      },
    },
    agent: { findMany: (args) => read("agents", args, [agent]) },
    user: { findMany: (args) => read("users", args, [human]) },
    task: { findMany: async () => [] },
    userSetting: { findUnique: async () => null },
    taskReadState: { findMany: (args) => read("readStates", args, [{ taskId: 1, lastReadAt: readAt }]) },
    comment: { groupBy: (args) => read("comments", args, [{ taskId: 1, _count: { _all: 2 } }]) },
  };
  const filename = path.join(root, "src/lib/prisma.ts");
  require.cache[filename] = { id: filename, filename, loaded: true, exports: { default: prisma } };
  const jiti = createJiti(path.join(root, `tests/inbox-concurrency-${++entryId}.cjs`), {
    alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false,
  });
  const controllerPath = path.join(root, "src/utils/controllers/notifications/getAll.ts");
  delete require.cache[controllerPath];
  const loaded = jiti(controllerPath);
  return { run: () => (loaded.default ?? loaded)("2343"), calls, gates, representatives, earner };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

function assertResults(result, f) {
  assert.equal(result.status, 200);
  const [first, second] = result.json.notifications;
  assert.deepEqual(first, {
    ...f.representatives[0],
    type: f.earner.type, comment: f.earner.comment, commentId: f.earner.commentId,
    fromUserId: human.id, fromUser: human, fromAgentId: null, fromAgent: null,
    directReply: false, directReplyTypes: [], unreadCount: 2,
    activeNotificationTypes: ["TaskDueDate", "Mentioned"],
    agentOnlyTypes: ["TaskDueDate"], mutedTypes: ["TaskDueDate"],
    recentActors: [{ displayName: "Human", photoURL: null }, { displayName: "Agent", photoURL: null }],
    earnedAt: readAt,
  });
  assert.deepEqual(second, {
    ...f.representatives[1], directReply: false, directReplyTypes: [], unreadCount: 3,
    activeNotificationTypes: ["Comment"], agentOnlyTypes: [], mutedTypes: [],
    recentActors: [{ displayName: "Human", photoURL: null }],
  });
  const readCall = f.calls.find(({ name }) => name === "readStates");
  assert.deepEqual(readCall.args.where, { userId: 2343, taskId: { in: [1, 2] } });
  const commentCall = f.calls.find(({ name }) => name === "comments");
  assert.deepEqual(commentCall.args.where.AND[0].OR, [{ taskId: 1, createdAt: { gt: readAt } }]);
  assert.deepEqual(f.calls.find(({ name }) => name === "unread").args.where.taskId, { in: [2] });
}

test("read states and counts run alongside actors, and earning rows do not wait for counts", async () => {
  const f = fixture({ hold: true });
  const resultPromise = f.run();
  try {
    await turn();
    assert.ok(f.calls.some(({ name }) => name === "agents"));
    assert.ok(f.calls.some(({ name }) => name === "users"));
    assert.ok(f.calls.some(({ name }) => name === "readStates"), "read states must start before actor lookups finish");
    assert.ok(!f.calls.some(({ name }) => name === "comments"), "unread comments still require read timestamps");
    f.gates.readStates.resolve();
    await turn();
    for (const name of ["comments", "unread"]) {
      assert.ok(f.calls.some((call) => call.name === name), `${name} must start while actors are pending`);
    }
    f.gates.agents.resolve();
    f.gates.users.resolve();
    await turn();
    assert.ok(f.calls.some(({ name }) => name === "earners"), "earning rows must start while aggregates are pending");
  } finally {
    Object.values(f.gates).forEach(({ resolve }) => resolve());
    await resultPromise;
  }
  assertResults(await resultPromise, f);
});

test("earning rows start before unread aggregates finish", async () => {
  const f = fixture({ hold: true });
  const resultPromise = f.run();
  try {
    f.gates.agents.resolve();
    f.gates.users.resolve();
    f.gates.readStates.resolve();
    await turn();
    assert.ok(f.calls.some(({ name }) => name === "comments"));
    assert.ok(f.calls.some(({ name }) => name === "earners"), "earning rows must not wait for aggregates");
  } finally {
    Object.values(f.gates).forEach(({ resolve }) => resolve());
    await resultPromise;
  }
  assertResults(await resultPromise, f);
});

for (const branch of ["agents", "readStates", "comments"]) {
  test(`${branch} failure keeps the existing 500 response`, async (t) => {
    t.mock.method(console, "log", () => {});
    const f = fixture({ hold: true });
    const resultPromise = f.run();
    await turn();
    if (branch === "comments") {
      f.gates.readStates.resolve();
      await turn();
    }
    f.gates[branch].reject(new Error("query failed"));
    Object.values(f.gates).forEach(({ resolve }) => resolve());
    assert.deepEqual(await resultPromise, { status: 500, json: [] });
  });
}

test("populated inbox preserves display fields, counts, direct replies and muted-agent behavior", async () => {
  const f = fixture();
  assertResults(await f.run(), f);
});

test("empty inbox skips all enrichment reads", async () => {
  const f = fixture({ empty: true });
  const result = await f.run();
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.notifications, []);
  assert.deepEqual(f.calls, []);
});
