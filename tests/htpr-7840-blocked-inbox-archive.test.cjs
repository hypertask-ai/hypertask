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
    create: async ({ data }) => {
      const row = { id: rows.length + 700, agentId: null, createdAt: new Date(), task: blockedTask, project, fromUserId: null, ...data };
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

test("Undo restores the blocked Inbox entry without changing the blocker", async () => {
  const f = fixture();
  await f.archive();
  assert.equal((await f.archive({ intent: undefined })).status, 200);
  assert.equal(f.rows[0].status, "Normal");
  assert.equal((await f.reload()).json.notifications.some(row => row.id === "-42"), true);
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
