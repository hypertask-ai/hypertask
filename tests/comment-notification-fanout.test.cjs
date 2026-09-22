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
    const record = (name) => calls.push({ name, client: label });
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
          record("notification.createMany");
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
    calls.push({ name: "$transaction", client: "prisma" });
    return callback(tx);
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

test("fan-out query count does not grow with the number of recipients", async () => {
  for (const dedupeByComment of [false, true]) {
    const five = await countQueries({ humanCount: 5, dedupeByComment });
    const ten = await countQueries({ humanCount: 10, dedupeByComment });
    console.log(
      `[HTPR-6509] 5 humans + 2 agent assignees, dedupe=${dedupeByComment}: ${five.length} calls`,
      JSON.stringify(five),
    );
    assert.equal(ten.length, five.length);
    assert.equal(five.filter((name) => name === "$transaction").length, 1);
    assert.equal(five.filter((name) => name === "$executeRaw").length, 1);
  }
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
