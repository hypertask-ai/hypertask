const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  delete require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

// HTPR-5881: getInboxNotifications' rows are the only source of taskIds, so
// the TaskReadState lookup used for unreadCount no longer waits behind the
// actor/direct-reply/blocked-task/user-setting queries in the same wave — it
// starts the moment getInboxNotifications resolves. This pins the response
// (structuredData/notifications/unreadCount) unchanged across that reorder,
// and proves the readStates query fires before the unrelated wave-1 queries
// settle rather than after.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadNotificationGetAll({ onCall, slowWave1 = false } = {}) {
  const calls = [];
  const record = (name, args) => {
    calls.push({ name, args, at: calls.length });
    onCall?.(name, args);
    return name;
  };

  const task = (id, projectId) => ({
    id,
    projectId,
    uniqueIndex: id,
    sectionId: 1,
    priority: null,
    title: `Task ${id}`,
    estimate: null,
    section: "In Progress",
    sectionChangedAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    assignees: [],
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    lastCommentAt: new Date("2026-08-01T00:00:00.000Z"),
    staleNudgedAt: null,
    waitingOnUserId: null,
    waitingOnSetById: null,
    waitingOnSetAt: null,
    comments: [],
    taskLabels: [],
    ticketNumber: id,
    dueDate: null,
    status: "Normal",
    savedContent: [],
  });

  const notifications = [
    {
      id: 201,
      type: "Comment",
      userId: 6,
      taskId: 101,
      projectId: 15,
      fromUserId: 9,
      fromAgentId: null,
      agentId: null,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
      seen: false,
      directReply: false,
      comment: { id: 1, text: "hi" },
      reaction: null,
      notification_invite: null,
      project: { id: 15, title: "Product", name: "product", teamId: 1, stalenessEnabled: false },
      task: task(101, 15),
      fromUser: { displayName: "Alice", photoURL: null },
      fromAgent: null,
    },
    {
      id: 202,
      type: "Comment",
      userId: 6,
      taskId: 102,
      projectId: 15,
      fromUserId: 9,
      fromAgentId: null,
      agentId: null,
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
      seen: false,
      directReply: false,
      comment: { id: 2, text: "hey" },
      reaction: null,
      notification_invite: null,
      project: { id: 15, title: "Product", name: "product", teamId: 1, stalenessEnabled: false },
      task: task(102, 15),
      fromUser: { displayName: "Alice", photoURL: null },
      fromAgent: null,
    },
  ];

  // Task 101 has a read state (exercises the comment-unread-count branch),
  // task 102 has none (exercises the notification-unread-count branch).
  const readStates = [
    { taskId: 101, lastReadAt: new Date("2026-08-01T00:00:00.000Z") },
  ];

  const dependencies = [
    "src/utils/controllers/notifications/getAll.ts",
    "src/utils/controllers/notifications/visibleInboxScope.ts",
    "src/utils/controllers/notifications/recentActors.ts",
    "src/utils/controllers/notifications/agentImportantPermission.ts",
    "src/lib/prisma.ts",
    "src/lib/configs/inbox.config.ts",
    "src/lib/configs/general.config.ts",
    "src/lib/inboxSplitSettings.ts",
    "src/utils/helperFunctions/helperFunctions.ts",
  ];
  for (const dependency of dependencies) {
    delete require.cache[path.join(root, dependency)];
  }

  stubModule("src/lib/prisma.ts", {
    default: {
      $queryRaw: async (query) => {
        const sql = (
          Array.isArray(query?.strings) ? query.strings.join("?") : String(query)
        ).replace(/\s+/g, " ");
        if (sql.includes('"notification_inviteId"')) {
          record("selectInboxIds");
          return notifications.map((row) => ({ id: row.id }));
        }
        record("recentActorActivity");
        return [];
      },
      notification: {
        findMany: async (args) => {
          if (args.where?.directReply === true) {
            if (slowWave1) await delay(20);
            record("directReplyRows:resolved", args);
            return [];
          }
          if (args.where?.type === "Mentioned") {
            if (slowWave1) await delay(20);
            record("hyperAiInvites:resolved", args);
            return [];
          }
          // Deep Inbox row fetch from getInboxNotifications — deliberately fast,
          // so taskIds/readStates never wait on the slow wave-1 queries above.
          record("inboxDeepFetch:resolved", args);
          return notifications.filter((row) =>
            args.where.AND[0].id.in.includes(row.id),
          );
        },
        groupBy: async (args) => {
          record("unreadNotificationGroupBy:resolved", args);
          return [];
        },
      },
      task: {
        findMany: async (args) => {
          if (slowWave1) await delay(20);
          record("blockedTasks:resolved", args);
          return [];
        },
      },
      userSetting: {
        findUnique: async (args) => {
          if (slowWave1) await delay(20);
          record("userSetting:resolved", args);
          return null;
        },
      },
      taskReadState: {
        findMany: async (args) => {
          // Recorded at invocation, before any await, so this timestamp marks
          // when the query was *started*, not when it settles.
          record("taskReadStates:invoked", args);
          return readStates;
        },
      },
      comment: {
        groupBy: async (args) => {
          record("unreadCommentGroupBy", args);
          return [{ taskId: 101, _count: { _all: 3 } }];
        },
      },
    },
  });

  const jiti = require("jiti")(
    path.join(root, `tests/jiti-inbox-getall-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false },
  );
  const notificationGetAll = jiti(
    path.join(root, "src/utils/controllers/notifications/getAll.ts"),
  ).default;

  return { notificationGetAll, calls };
}

test("HTPR-5881: unread counts and structured Inbox data survive the readState reorder", async () => {
  const { notificationGetAll } = loadNotificationGetAll();

  const result = await notificationGetAll("6");

  assert.equal(result.status, 200);
  const byId = new Map(result.json.notifications.map((row) => [row.id, row]));
  // Task 101 has a read state -> unread count comes from the comment groupBy fixture.
  assert.equal(byId.get(201).unreadCount, 3);
  // Task 102 has no read state -> unread count comes from the notification groupBy
  // fixture (empty here), so it falls back to 0.
  assert.equal(byId.get(202).unreadCount, 0);
  assert.deepEqual(
    result.json.notifications.map((row) => row.id),
    [201, 202],
  );
  assert.ok(result.json.structuredData && typeof result.json.structuredData === "object");
});

test("HTPR-5881: the TaskReadState lookup starts before the unrelated wave-1 queries settle", async () => {
  const order = [];
  const { notificationGetAll } = loadNotificationGetAll({
    slowWave1: true,
    onCall: (name) => order.push(name),
  });

  await notificationGetAll("6");

  const readStateIndex = order.indexOf("taskReadStates:invoked");
  const userSettingIndex = order.indexOf("userSetting:resolved");
  const blockedTasksIndex = order.indexOf("blockedTasks:resolved");

  assert.notEqual(readStateIndex, -1);
  assert.notEqual(userSettingIndex, -1);
  assert.notEqual(blockedTasksIndex, -1);
  // userSetting/blockedTasks are made deliberately slow (20ms). The old
  // sequencing awaited the whole wave-1 Promise.all — including those two —
  // before it could even compute taskIds, so TaskReadState.findMany could
  // only start after they resolved. It's now derived straight from
  // getInboxNotifications' fast result, so it starts well before either of
  // the slow queries finishes.
  assert.ok(
    readStateIndex < userSettingIndex,
    `expected taskReadStates (${readStateIndex}) to start before userSetting resolves (${userSettingIndex})`,
  );
  assert.ok(
    readStateIndex < blockedTasksIndex,
    `expected taskReadStates (${readStateIndex}) to start before blockedTasks resolves (${blockedTasksIndex})`,
  );
});
