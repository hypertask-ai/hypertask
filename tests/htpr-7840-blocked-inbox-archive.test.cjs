const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const key = "htpr-7840-blocked-inbox-archive";
const userId = 2343;
const since = new Date("2026-10-24T10:00:00Z");
const owner = { id: 8, displayName: "Owner", photoURL: null };
const project = { id: 15, title: "Product", ownerId: userId };
const blockedTask = {
  id: 42, projectId: 15, uniqueIndex: 7002, status: "Normal", title: "Waiting",
  waitingOnUserId: userId, waitingOnSetAt: since, waitingOnSetById: 8,
  createdAt: since, sectionChangedAt: since, lastCommentAt: null,
  project, user: owner, section: "In Progress",
};

function fixture({ flagOn = true, rows = [], tasks = [blockedTask], accessible = true } = {}) {
  const writes = [], broadcasts = [];
  const matches = (row, where) => Object.entries(where).every(([field, value]) => {
    if (field === "id" && value?.in) return value.in.includes(row.id);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("gte" in value) return row[field] != null && row[field] >= value.gte;
      if ("not" in value) return row[field] !== value.not;
    }
    return row[field] === value || (value instanceof Date && row[field]?.getTime() === value.getTime());
  });
  const notifications = {
    findFirst: async ({ where }) => rows.filter(row => matches(row, where)).sort((a, b) => b.archivedAt - a.archivedAt)[0] ?? null,
    findUnique: async ({ where }) => rows.find(row => row.id === where.id) ?? null,
    groupBy: async () => [],
    findMany: async ({ where }) => {
      const ids = where.AND?.find(clause => clause.id)?.id.in;
      return ids ? rows.filter(row => ids.includes(row.id) && row.status === "Normal" && row.archivedAt === null) : [];
    },
    updateMany: async ({ where, data }) => {
      const selected = rows.filter(row => matches(row, where));
      selected.forEach(row => Object.assign(row, data));
      writes.push({ where, data });
      return { count: selected.length };
    },
    update: async ({ where, data }) => {
      const row = rows.find(candidate => candidate.id === where.id);
      assert.ok(row, "single notification update must find its row");
      Object.assign(row, data);
      writes.push({ where, data });
      return row;
    },
    delete: async ({ where }) => {
      const index = rows.findIndex(row => matches(row, where));
      assert.notEqual(index, -1);
      const [row] = rows.splice(index, 1);
      writes.push({ where, deleted: true });
      return row;
    },
    create: async ({ data }) => {
      const row = { id: 900 + rows.length, agentId: null, createdAt: new Date(), task: blockedTask, project, fromUserId: null, ...data };
      rows.push(row);
      writes.push({ data });
      return row;
    },
  };
  const db = {
    notification: notifications,
    task: {
      findFirst: async ({ where }) => {
        assert.equal(where.waitingOnUserId, userId);
        assert.ok(where.project, "synthetic IDs must still check board access");
        return accessible ? tasks.find(task => task.id === where.id && task.waitingOnUserId === userId && task.status === "Normal") ?? null : null;
      },
      findMany: async ({ where, select }) => tasks.filter(task => task.waitingOnUserId === where.waitingOnUserId).map(task => ({
        ...task,
        notifications: rows.filter(row => row.taskId === task.id && matches(row, select.notifications.where))
          .sort((a, b) => b.archivedAt - a.archivedAt).slice(0, 1).map(({ archivedAt }) => ({ archivedAt })),
      })),
    },
    $transaction: async operation => operation(db),
    $queryRaw: async query => query.sql.includes("AS selected")
      ? rows.filter(row => row.status === "Normal" && row.archivedAt === null).map(({ id }) => ({ id })) : [],
    userSetting: { findUnique: async () => null },
    user: { findMany: async () => [owner] },
    taskReadState: { findMany: async () => [] },
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/flags": { isFeatureEnabled: async requested => requested === key && flagOn },
    "@/lib/flags/keys": {},
    "@/lib/auth/agentScope": { agentScopeEnforced: () => false },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId }) },
    "@/lib/api/task-writes/route": { taskWriteRoute: ({ operation }) => async (request, session) => operation(await request.json(), session, request) },
    "@/lib/realtime/server": { broadcastInboxChange: async (...args) => broadcasts.push(args), socketIdFromHeader: () => null },
    "@/utils/controllers/notifications/quietOwnerInbox": { markQuietAgentMentions: async (_db, _userId, notifications) => notifications },
  };
  const inboxHelpers = load("src/utils/helperFunctions/inboxHelpers.ts", mocks);
  mocks["@/utils/helperFunctions/helperFunctions"] = inboxHelpers;
  const { GET } = load("src/lib/api/notification-writes/mark-done.ts", mocks);
  const getAll = load("src/utils/controllers/notifications/getAll.ts", mocks).default;
  return {
    rows, writes, broadcasts,
    reload: () => getAll(String(userId)),
    archive: (query = {}) => GET({ headers: new Headers(), query: { id: "-42", taskId: "42", intent: "archive", ...query } }, { userId }),
  };
}

test("synthetic archive persists and the blocked row stays out after reload without clearing its blocker", async () => {
  const f = fixture();
  assert.equal((await f.reload()).json.notifications[0].id, "-42");
  assert.equal((await f.archive()).status, 200);
  assert.equal(f.rows[0].status, "Archive");
  assert.ok(f.rows[0].archivedAt instanceof Date);
  assert.deepEqual((await f.reload()).json.notifications, []);
  assert.equal(blockedTask.waitingOnUserId, userId);
  assert.equal(blockedTask.waitingOnSetAt, since);
  assert.equal(f.broadcasts.length, 1);
  assert.equal((await f.archive()).status, 200);
  assert.equal(f.rows.length, 1, "repeated E is idempotent");
});

test("a still-blocked unarchived ticket keeps its marker data and split/playlist order", async () => {
  const other = { ...blockedTask, id: 43, uniqueIndex: 7003, waitingOnSetAt: new Date(since.getTime() + 1000) };
  const f = fixture({ tasks: [blockedTask, other], rows: [{
    id: 600, taskId: 42, userId, agentId: null, status: "Archive", archivedAt: new Date(since.getTime() - 1),
  }] });
  const result = await f.reload();
  assert.equal(result.status, 200);
  const { notifications, structuredData } = result.json;
  assert.deepEqual(notifications.map(row => row.taskId), [42, 43]);
  const split = structuredData.tabs.findIndex(tab => tab.project === "Blocked by you");
  assert.ok(split >= 0);
  assert.deepEqual(structuredData.data[split].map(index => notifications[index].taskId), [42, 43]);
  for (const row of notifications) assert.equal(row.task.waitingOnUserId, row.userId);
  assert.equal(notifications[0].task.waitingOnSetAt, since);
  const { buildInboxTasksPlaylist } = load("src/lib/inbox/inboxTasksPlaylist.ts", {});
  assert.deepEqual(buildInboxTasksPlaylist(notifications, false).map(task => task.uniqueIndex), [7002, 7003]);
});

test("Undo deletes a synthetic dismissal marker and restores the exact original Inbox notification set", async () => {
  const f = fixture();
  const original = structuredClone((await f.reload()).json.notifications);
  assert.deepEqual(original.map(row => row.id), ["-42"]);
  assert.deepEqual(f.rows, []);
  await f.archive();
  assert.equal(f.rows.length, 1);
  assert.deepEqual((await f.reload()).json.notifications, []);
  const response = await f.archive({ intent: undefined });
  assert.equal(response.status, 200);
  const { notificationResponseSchema } = load("src/lib/api/contracts/notificationWrites.ts", {});
  assert.equal(notificationResponseSchema.safeParse(await response.json()).success, true);
  assert.deepEqual((await f.reload()).json.notifications, original);
  assert.deepEqual(f.rows, []);
  assert.equal(blockedTask.waitingOnUserId, userId);
  assert.equal(blockedTask.waitingOnSetAt, since);
});

test("Undo restores only pre-existing active notifications, including a real TaskReminder", async () => {
  const f = fixture({ rows: [
    ...["TaskReminder", "Comment"].map((type, index) => ({
      id: 701 + index, taskId: 42, userId, projectId: 15, agentId: null, type, seen: false,
      status: "Normal", archivedAt: null, createdAt: since, task: blockedTask, project, fromUserId: null,
    })),
    { id: 600, taskId: 42, userId, agentId: null, type: "TaskReminder", status: "Archive", archivedAt: new Date(since.getTime() - 1) },
  ] });
  const originalRows = structuredClone(f.rows);
  const original = structuredClone((await f.reload()).json.notifications);
  assert.equal(original.length, 3);
  await f.archive();
  assert.deepEqual((await f.reload()).json.notifications, []);
  assert.equal((await f.archive({ intent: undefined })).status, 200);
  assert.deepEqual(f.rows, originalRows);
  assert.deepEqual((await f.reload()).json.notifications, original);
});

for (const options of [{ accessible: false }, { tasks: [{ ...blockedTask, waitingOnUserId: 985 }] }]) {
  test("a synthetic ID cannot archive an inaccessible task or another person's blocker", async () => {
    const f = fixture(options);
    assert.equal((await f.archive()).status, 404);
    assert.deepEqual(f.writes, []);
  });
}

test("flag off keeps archived blocked entries visible and rejects synthetic archive", async () => {
  const f = fixture({ flagOn: false, rows: [{ id: 600, taskId: 42, userId, agentId: null, status: "Archive", archivedAt: new Date() }] });
  assert.equal((await f.reload()).json.notifications[0].id, "-42");
  assert.equal((await f.archive()).status, 404);
  assert.deepEqual(f.writes, []);
});

test("the bugfix flag defaults to Everyone with a small release risk", () => {
  const { default: flag } = load("src/lib/flags/definitions/htpr-7840-blocked-inbox-archive.ts", {});
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason);
});


const realNotification = () => ({
  id: 701, taskId: 42, userId, projectId: 15, agentId: null, type: "Comment",
  seen: false, status: "Normal", archivedAt: null, createdAt: since,
  task: blockedTask, project, fromUserId: null,
});

test("archiving a real notification of a blocked ticket dismisses its blocked row", async () => {
  const f = fixture({ rows: [realNotification()] });
  assert.equal((await f.reload()).json.notifications.length, 2, "real row plus the blocked row");
  assert.equal((await f.archive({ id: "701" })).status, 200);
  assert.deepEqual((await f.reload()).json.notifications, [], "the blocked row stays out after a real archive");
});

test("undo after a real archive brings the blocked row back once", async () => {
  const f = fixture({ rows: [realNotification()] });
  assert.equal((await f.archive({ id: "701" })).status, 200);
  assert.deepEqual((await f.reload()).json.notifications, []);
  assert.equal((await f.archive({ id: "701", intent: undefined })).status, 200);
  assert.deepEqual(f.rows.filter((row) => row.message === "htpr-7840-blocked-inbox-dismissal"), []);
  assert.deepEqual((await f.reload()).json.notifications.map((row) => row.id).sort(), [-42, 701].sort());
});

test("with the flag off a real archive leaves the blocked row visible", async () => {
  const f = fixture({ flagOn: false, rows: [realNotification()] });
  assert.equal((await f.archive({ id: "701" })).status, 200);
  assert.deepEqual((await f.reload()).json.notifications.map((row) => row.id), ["-42"]);
});

test("archiving a synthetic row also archives its real siblings and returns the typed notification shape", async () => {
  const rows = [701, 702].map(id => ({
    id, taskId: 42, userId, projectId: 15, agentId: null, type: "Comment", seen: false,
    status: "Normal", archivedAt: null, createdAt: since,
  }));
  const f = fixture({ rows });
  const response = await f.archive();
  assert.equal(response.status, 200);
  const { notificationResponseSchema } = load("src/lib/api/contracts/notificationWrites.ts", {});
  assert.equal(notificationResponseSchema.safeParse(await response.json()).success, true);
  assert.ok(rows.every(row => row.status === "Archive" && row.archivedAt));
  assert.deepEqual((await f.reload()).json.notifications, []);
});
