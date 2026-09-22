// HTPR-6509: comment notification fan-out must cost a fixed number of database
// round trips, whatever the recipient count, while keeping the per-recipient
// dedupe, board mute and reminder rules exactly as before.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let entryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function resetModule(relativePath) {
  delete require.cache[path.join(root, relativePath)];
}

function matchesId(filter, value) {
  if (filter === undefined) return true;
  if (filter && typeof filter === "object" && "in" in filter) {
    return filter.in.includes(value);
  }
  return filter === value;
}

// A counting Prisma double. The transaction client is a distinct object so a
// test can prove inbox writes ran inside the task lock.
function createDatabase({
  mutedUserIds = [],
  reminders = [],
  existing = [],
  agentAssignees = [],
  agentFollowers = [],
} = {}) {
  const calls = [];
  let transactionCount = 0;
  let transactionIndex = 0;
  const notifications = existing.map((row) => ({ ...row }));
  let nextId = 1000;
  const insert = (data) => {
    const row = { id: ++nextId, ...data };
    notifications.push(row);
    return row;
  };
  const notificationMatches = (row, where) =>
    row.type === where.type &&
    row.commentId === where.commentId &&
    matchesId(where.userId, row.userId) &&
    (where.agentId === null
      ? row.agentId == null
      : matchesId(where.agentId, row.agentId));

  function client(label) {
    const record = (name, extra = {}) =>
      calls.push({ name, client: label, transactionIndex, ...extra });
    return {
      label,
      $executeRaw: async () => {
        record("$executeRaw");
        return 1;
      },
      projectMute: {
        findUnique: async ({ where }) => {
          record("projectMute.findUnique");
          return mutedUserIds.includes(where.projectId_userId.userId)
            ? { id: "mute" }
            : null;
        },
        findMany: async ({ where }) => {
          record("projectMute.findMany");
          return mutedUserIds
            .filter((userId) => matchesId(where.userId, userId))
            .map((userId) => ({ userId }));
        },
      },
      reminder: {
        findFirst: async ({ where }) => {
          record("reminder.findFirst");
          return (
            reminders.find(
              (reminder) =>
                reminder.userId === where.userId &&
                reminder.status === where.status,
            ) ?? null
          );
        },
        findMany: async ({ where }) => {
          record("reminder.findMany");
          return reminders.filter(
            (reminder) =>
              matchesId(where.userId, reminder.userId) &&
              reminder.status === where.status,
          );
        },
      },
      notification: {
        findFirst: async ({ where }) => {
          record("notification.findFirst");
          return notifications.find((row) => notificationMatches(row, where))
            ? { id: 1 }
            : null;
        },
        findMany: async ({ where }) => {
          record("notification.findMany");
          return notifications.filter((row) => notificationMatches(row, where));
        },
        create: async ({ data }) => {
          record("notification.create");
          return insert(data);
        },
        createMany: async ({ data }) => {
          record("notification.createMany", { size: data.length });
          data.forEach(insert);
          return { count: data.length };
        },
      },
      assignees: {
        findMany: async () => {
          record("assignees.findMany");
          return agentAssignees;
        },
      },
      follower: {
        findMany: async () => {
          record("follower.findMany");
          return agentFollowers;
        },
      },
    };
  }

  const tx = client("tx");
  const prisma = client("prisma");
  prisma.$transaction = async (callback) => {
    transactionCount += 1;
    transactionIndex = transactionCount;
    calls.push({ name: "$transaction", client: "prisma", transactionIndex });
    try {
      return await callback(tx);
    } finally {
      transactionIndex = 0;
    }
  };
  return { prisma, tx, calls, notifications };
}

function loadFanout(database) {
  const broadcasts = [];
  const invoked = [];
  const modules = {
    "src/lib/prisma.ts": { __esModule: true, default: database.prisma },
    "src/lib/realtime/server.ts": {
      broadcastBoardChange: async () => {},
      broadcastTaskComment: async () => {},
      broadcastInboxChange: async (userId, options) => {
        broadcasts.push({ userId, originUserId: options?.originUserId });
      },
    },
    "src/utils/controllers/reminders/invokeReminder.ts": {
      __esModule: true,
      default: async (reminder, client) => {
        invoked.push({ reminderId: reminder.id, client: client?.label });
        database.calls.push({
          name: "invokeReminder",
          userId: reminder.userId,
          transactionIndex: database.calls.findLast(
            (call) => call.name === "$transaction",
          )?.transactionIndex,
        });
      },
    },
    "src/utils/controllers/notifications/IdsToSendNotificationsTo.ts": {
      __esModule: true,
      default: async () => [],
    },
    "src/pages/api/queues/FAST/generateSummary.ts": {
      __esModule: true,
      default: async () => {},
    },
    "src/pages/api/queues/FAST/generateCommentSummary.ts": {
      __esModule: true,
      default: async () => {},
    },
    "src/utils/controllers/tasks/single.ts": { updateTaskSingle: async () => {} },
    "src/utils/controllers/turbopuffer/turbopufferHelper.ts": {
      upsertCommentToTurbopuffer: async () => {},
    },
    "src/utils/controllers/comments/processMentions.ts": {
      getMentionedUserIdsFromCommentText: () => [],
      getMentionedAgentIdsFromCommentText: () => [],
      processMentionsFromCommentText: async () => {},
    },
    "src/utils/controllers/comments/extractTaskReferences.ts": {
      extractTaskReferencesFromCommentText: () => [],
    },
    "src/utils/controllers/tasks/addRelatedTasks.ts": {
      addRelatedTasks: async () => ({ status: 200 }),
    },
    "src/utils/controllers/FCM/index.ts": { sendDataOnlyFcm: async () => {} },
    "src/utils/controllers/notifications/shouldNotify.ts": {
      shouldNotify: async () => true,
    },
    "src/utils/controllers/notifications/sendNotification.ts": {
      sendEmailNotification: async () => {},
    },
    "src/utils/controllers/projects/getAllIncludes.ts": {
      taskWriteAccessWhere: () => ({}),
    },
    "src/lib/ai/hyperAiConfirmation.ts": {
      recordHyperAiCommentOrigin: async () => {},
    },
    "src/lib/agentWebhooks/outbox.ts": {
      persistAgentRunTriggerWebhooks: async () => [],
      persistAgentTaskRunPromptWebhooks: async () => [],
      persistAgentWebhookEvent: async () => null,
      persistAgentWebhookEvents: async () => [],
      publishAgentWebhookDeliveries: async () => {},
    },
    "src/lib/mcp/webhooks/outbox.ts": {
      persistBoardWebhookEvents: async () => [],
      publishBoardWebhookDeliveries: async () => {},
    },
    "src/lib/configs/general.config.ts": { generalConfig: { hyperAiId: 332 } },
    "src/lib/flags.ts": { isFeatureEnabled: async () => true },
    "src/utils/controllers/comments/agentInvocationCorrelation.ts": {
      buildAgentInvocationSelector: () => null,
      claimPendingAgentInvocation: async () => null,
      DirectReplyAlreadyHandledError: class extends Error {},
    },
  };
  for (const relativePath of [
    "src/utils/controllers/comments/createCommentService.ts",
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts",
    "src/utils/controllers/notifications/projectMute.ts",
    "src/lib/taskCardActions/writeLocks.ts",
  ]) {
    resetModule(relativePath);
  }
  for (const [relativePath, exports] of Object.entries(modules)) {
    resetModule(relativePath);
    stubModule(relativePath, exports);
  }
  const jiti = require("jiti")(
    path.join(root, `tests/comment-notification-fanout-${++entryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const { createNotificationForComment } = jiti(
    path.join(root, "src/utils/controllers/comments/createCommentService.ts"),
  );
  return { createNotificationForComment, broadcasts, invoked };
}

const task = { id: 99, projectId: 15, userId: 8 };
const comment = { id: 501 };
const agent = (agentId, userId) => ({ agentId, agent: { id: agentId, userId } });
const humans = (count) => Array.from({ length: count }, (_, i) => 11 + i);

async function countQueries({ humanCount, dedupeByComment }) {
  const database = createDatabase({
    agentAssignees: [agent("agent-a", 40), agent("agent-b", 41)],
  });
  const { createNotificationForComment } = loadFanout(database);
  await createNotificationForComment(
    task,
    comment,
    7,
    humans(humanCount),
    null,
    null,
    dedupeByComment,
  );
  return database.calls.map((call) => call.name);
}

test("fan-out costs a fixed number of queries per chunk of ten recipients", async () => {
  for (const dedupeByComment of [false, true]) {
    const five = await countQueries({ humanCount: 5, dedupeByComment });
    const ten = await countQueries({ humanCount: 10, dedupeByComment });
    const twenty = await countQueries({ humanCount: 20, dedupeByComment });
    console.log(
      `[HTPR-6509] 5 humans + 2 agent assignees, dedupe=${dedupeByComment}: ${five.length} calls`,
      JSON.stringify(five),
    );
    const transactions = (names) =>
      names.filter((name) => name === "$transaction").length;
    assert.equal(ten.length, five.length);
    assert.equal(transactions(ten), 1);
    assert.equal(transactions(twenty), 2);
    // A second chunk adds exactly: transaction, lock, mute read, reminder
    // read, createMany. Nothing per recipient.
    assert.equal(twenty.length - ten.length, 5);
  }
});

test("a 50-recipient comment with reminders holds the lock per chunk of ten", async () => {
  const newNotificationUserIds = [11, 19, 25, 26, 40, 60];
  const database = createDatabase({
    reminders: [
      ...newNotificationUserIds.map((userId) => ({
        id: userId,
        userId,
        status: "Normal",
        invokeCondition: "NewNotification",
      })),
      { id: 30, userId: 30, status: "Normal", invokeCondition: "DurationComplete" },
    ],
  });
  const { createNotificationForComment, broadcasts, invoked } =
    loadFanout(database);
  const recipients = humans(50);

  await createNotificationForComment(task, comment, 7, recipients, null, null, false);

  const transactions = database.calls.filter((call) => call.name === "$transaction");
  assert.equal(transactions.length, 5);
  const writes = database.calls.filter(
    (call) => call.name === "notification.createMany" && call.client === "tx",
  );
  assert.deepEqual(
    writes.map((call) => call.size),
    [10, 10, 10, 10, 10],
  );
  // Every reminder release runs inside the lock of the chunk holding its user.
  const releases = database.calls.filter((call) => call.name === "invokeReminder");
  assert.deepEqual(
    releases.map(({ userId, transactionIndex }) => [userId, transactionIndex]),
    [
      [11, 1],
      [19, 1],
      [25, 2],
      [26, 2],
      [40, 3],
      [60, 5],
    ],
  );
  assert.ok(invoked.every(({ client }) => client === "tx"));
  // Mute and reminder reads are per chunk, never per recipient.
  assert.equal(
    database.calls.filter((call) => call.name === "reminder.findMany").length,
    5,
  );

  const created = database.notifications.filter((row) => row.id > 1000);
  assert.deepEqual(
    created.map((row) => row.userId),
    recipients,
  );
  assert.deepEqual(
    created.filter((row) => row.status === "Archive").map((row) => row.userId),
    [30],
  );
  assert.deepEqual(
    broadcasts.map(({ userId }) => userId),
    recipients.filter((userId) => userId !== 30),
  );
});

test("no human recipients means no inbox lock is taken", async () => {
  const database = createDatabase();
  const { createNotificationForComment } = loadFanout(database);
  await createNotificationForComment(task, comment, 7, [16], null, 16, false);
  assert.deepEqual(
    database.calls.map((call) => call.name),
    ["assignees.findMany", "follower.findMany"],
  );
  assert.equal(database.notifications.length, 0);
});

test("dedupe, board mute and reminder rules pick the same recipients as before", async () => {
  const database = createDatabase({
    mutedUserIds: [12],
    reminders: [
      { id: 1, userId: 13, status: "Normal", invokeCondition: "DurationComplete" },
      { id: 2, userId: 14, status: "Normal", invokeCondition: "NewNotification" },
      // A second open reminder must not invoke twice for the same comment.
      { id: 3, userId: 14, status: "Normal", invokeCondition: "NewNotification" },
    ],
    existing: [
      { id: 1, type: "Comment", commentId: 501, userId: 15, agentId: null },
      { id: 2, type: "Comment", commentId: 501, userId: 40, agentId: "agent-a" },
    ],
    agentAssignees: [agent("agent-a", 40), agent("agent-b", 41)],
    // agent-a is an assignee already handled above, even though it was deduped.
    // Follower rows have no unique index, so one agent can appear twice; a
    // replay still writes a single row for it.
    agentFollowers: [
      agent("agent-a", 40),
      agent("agent-c", 42),
      agent("agent-c", 42),
    ],
  });
  const { createNotificationForComment, broadcasts, invoked } =
    loadFanout(database);

  await createNotificationForComment(
    task,
    comment,
    7,
    [11, 12, 13, 14, 15, 16],
    "sender-agent",
    16,
    true,
  );

  const base = {
    type: "Comment",
    commentId: 501,
    taskId: 99,
    projectId: 15,
    fromUserId: 7,
    fromAgentId: "sender-agent",
  };
  const created = database.notifications
    .filter((row) => row.id > 1000)
    .map(({ id, ...row }) => row);
  const sortKey = (row) => `${row.agentId ?? ""}:${row.userId}`;
  assert.deepEqual(
    created.sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    [
      { ...base, userId: 11 },
      { ...base, userId: 13, status: "Archive" },
      { ...base, userId: 14 },
      { ...base, agentId: "agent-b", userId: 41 },
      { ...base, agentId: "agent-c", userId: 42 },
    ].sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
  );

  // The NewNotification reminder is released inside the same task lock.
  assert.deepEqual(invoked, [{ reminderId: 2, client: "tx" }]);
  // Mute and reminder reads plus human inserts all run under the inbox lock.
  for (const call of database.calls) {
    if (/^(projectMute|reminder)\./.test(call.name)) {
      assert.equal(call.client, "tx", call.name);
    }
  }
  // Snoozed-to-archive, muted and deduped users get no live inbox push; agent
  // followers never did.
  assert.deepEqual(
    broadcasts.map(({ userId }) => userId).sort(),
    [11, 14, 41],
  );
  assert.ok(broadcasts.every(({ originUserId }) => originUserId === 7));
});
