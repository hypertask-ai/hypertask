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

function loadService() {
  const jiti = require("jiti")(
    path.join(root, `tests/inbound-email-comment-resume-${++entryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(
    path.join(root, "src/utils/controllers/comments/createCommentService.ts"),
  ).createCommentService;
}

test("a failed inbound reply resumes its comment without repeating durable effects", async () => {
  const receiptState = { value: null };
  const notifications = [];
  const calls = {
    commentCreates: 0,
    taskCountIncrements: 0,
    taskUpdatedAtWrites: 0,
    deviceReads: 0,
  };
  const task = {
    id: 99,
    ticketNumber: "HTPR-99",
    projectId: 15,
    title: "Reply target",
    uniqueIndex: 99,
    userId: 8,
    waitingOnUserId: null,
    updatedByUserIds: [],
    project: { team: {}, owner: { devices: [] } },
  };
  const comment = {
    id: 501,
    taskId: 99,
    creatorId: 6,
    agentId: null,
    text: "<p>Ship it.</p>",
    createdAt: new Date("2026-08-23T09:00:00.000Z"),
  };

  const receiptDelegate = {
    findUnique: async () => receiptState.value,
    create: async ({ data }) => {
      receiptState.value = {
        ...data,
        completedAt: null,
        comment,
      };
      return receiptState.value;
    },
    updateMany: async ({ where, data }) => {
      const receipt = receiptState.value;
      if (
        !receipt ||
        receipt.emailId !== where.emailId ||
        receipt.commentId !== where.commentId ||
        receipt.completedAt !== null ||
        (where.processingStartedAt &&
          receipt.processingStartedAt !== where.processingStartedAt)
      ) {
        return { count: 0 };
      }
      if (where.OR) {
        const staleBefore = where.OR[1].processingStartedAt.lt;
        if (
          receipt.processingStartedAt !== null &&
          receipt.processingStartedAt >= staleBefore
        ) {
          return { count: 0 };
        }
      }
      receiptState.value = { ...receipt, ...data };
      return { count: 1 };
    },
  };

  const prisma = {
    $transaction: async (callback) => callback(prisma),
    $queryRaw: async () => [{ id: 99 }],
    inboundEmailReceipt: receiptDelegate,
    task: {
      findFirst: async () => task,
      update: async ({ data }) => {
        if (data.totalComments) calls.taskCountIncrements += 1;
        return task;
      },
      updateMany: async () => ({ count: 0 }),
    },
    comment: {
      create: async () => {
        calls.commentCreates += 1;
        return comment;
      },
      findFirst: async () => null,
      findUniqueOrThrow: async () => comment,
    },
    assignees: {
      findMany: async ({ where }) => (where.agentId ? [] : [{ userId: 9 }]),
    },
    follower: { findMany: async () => [] },
    notification: {
      findFirst: async ({ where }) =>
        notifications.find(
          (item) =>
            item.commentId === where.commentId &&
            item.userId === where.userId &&
            item.agentId === where.agentId,
        ) ?? null,
      create: async ({ data }) => {
        notifications.push(data);
        return data;
      },
    },
    reminder: { updateMany: async () => ({ count: 0 }) },
    webhookSubscription: { findMany: async () => [] },
    boardWebhookDelivery: { create: async () => null },
    agentWebhookSubscription: { findUnique: async () => null },
    agentWebhookDelivery: { create: async () => null },
    agent: { findUnique: async () => null },
    drafts: { deleteMany: async () => ({ count: 0 }) },
    user: {
      findFirst: async () => ({ id: 6, displayName: "Person" }),
      findMany: async () => [],
      findUnique: async () => ({ id: 6, displayName: "Person" }),
    },
    subscribedDevices: {
      findMany: async () => {
        calls.deviceReads += 1;
        if (calls.deviceReads === 1) throw new Error("devices unavailable");
        return [];
      },
    },
  };

  const modules = {
    "src/lib/prisma.ts": { __esModule: true, default: prisma },
    "src/utils/controllers/notifications/IdsToSendNotificationsTo.ts": {
      __esModule: true,
      default: async () => [],
    },
    "src/lib/realtime/server.ts": {
      broadcastBoardChange: async () => {},
      broadcastInboxChange: async () => {},
    },
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts":
      {
        __esModule: true,
        default: async (_userId, _projectId, _taskId, payload) => {
          notifications.push({ ...payload, agentId: null });
        },
      },
    "src/utils/controllers/notifications/agentActionRecipients.ts": {
      includeSenderInRecipients: () => false,
      shouldNotifyTaskOwnerForComment: () => false,
    },
    "src/pages/api/queues/FAST/generateSummary.ts": {
      __esModule: true,
      default: async () => {},
    },
    "src/utils/controllers/tasks/single.ts": {
      updateTaskSingle: async () => {
        calls.taskUpdatedAtWrites += 1;
      },
    },
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
    "src/pages/api/queues/FAST/generateCommentSummary.ts": {
      __esModule: true,
      default: async () => {},
    },
    "src/utils/controllers/projects/getAllIncludes.ts": {
      taskWriteAccessWhere: () => ({}),
    },
    "src/lib/ai/hyperAiConfirmation.ts": {
      recordHyperAiCommentOrigin: async () => {},
    },
    "src/lib/agentWebhooks/outbox.ts": {
      persistAgentWebhookEvent: async () => null,
      persistAgentWebhookEvents: async () => [],
      publishAgentWebhookDeliveries: async () => {},
    },
    "src/lib/mcp/webhooks/outbox.ts": {
      persistBoardWebhookEvents: async () => [],
      publishBoardWebhookDeliveries: async () => {},
    },
    "src/lib/configs/general.config.ts": {
      generalConfig: { hyperAiId: 332 },
    },
    "src/utils/controllers/comments/agentInvocationCorrelation.ts": {
      buildAgentInvocationSelector: () => null,
      claimPendingAgentInvocation: async () => null,
      DirectReplyAlreadyHandledError: class extends Error {},
    },
  };

  resetModule("src/utils/controllers/comments/createCommentService.ts");
  resetModule("src/utils/controllers/comments/inboundEmailReceipt.ts");
  for (const [relativePath, exports] of Object.entries(modules)) {
    resetModule(relativePath);
    stubModule(relativePath, exports);
  }

  const createCommentService = loadService();
  const input = {
    text: comment.text,
    creatorId: 6,
    taskId: 99,
    ownerId: 8,
    currentUser: {
      id: 6,
      email: "person@example.com",
      displayName: "Person",
      photoURL: null,
    },
    accessUserId: 6,
    inboundEmailId: "received-email-1",
  };

  await assert.rejects(createCommentService(input), /devices unavailable/);
  assert.equal(receiptState.value.processingStartedAt, null);
  assert.equal(receiptState.value.completedAt, null);

  assert.equal(await createCommentService(input), comment);
  assert.equal(calls.commentCreates, 1);
  assert.equal(calls.taskCountIncrements, 1);
  assert.equal(calls.taskUpdatedAtWrites, 1);
  assert.equal(notifications.length, 1);
  assert.equal(receiptState.value.processingStartedAt, null);
  assert.ok(receiptState.value.completedAt instanceof Date);

  receiptState.value = { ...receiptState.value, commentId: null, comment: null };
  await assert.rejects(
    createCommentService(input),
    (error) => error.name === "InboundEmailCommentDeletedError",
  );
  assert.equal(calls.commentCreates, 1);
});
