const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const flag = "htpr-8090-assignee-inbox";
let entry = 0;

async function deliver({ flagOn = true, kind = "qa", agentId = "own-agent", assigned = true, directReply = null, dedupe = false } = {}) {
  const flagsPath = path.join(root, "src/lib/flags.ts");
  require.cache[flagsPath] = {
    id: flagsPath, filename: flagsPath, loaded: true,
    exports: { isFeatureEnabled: async (key) => key === flag ? flagOn : true },
  };
  const jiti = require("jiti")(path.join(root, `tests/8090-${++entry}.cjs`), {
    interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false,
  });
  const { fanOutCommentNotifications } = jiti(path.join(root, "src/utils/controllers/comments/commentFanout.ts"));
  const { includeSenderInRecipients, shouldNotifyTaskOwnerForComment } = jiti(path.join(root, "src/utils/controllers/notifications/agentActionRecipients.ts"));
  const inbox = [];
  const emails = [];
  const noop = async () => {};
  const dependencies = {
    includeSenderInRecipients, shouldNotifyTaskOwnerForComment,
    getMentionedUserIdsFromCommentText: () => [],
    extractTaskReferencesFromCommentText: () => [],
    processMentionsFromCommentText: noop,
    recordHyperAiCommentOrigin: noop,
    scheduleCommentSummaryGeneration: noop,
    scheduleTaskSummaryGeneration: noop,
    upsertCommentToTurbopuffer: noop,
    broadcastInboxChange: noop,
    broadcastBoardChange: noop,
    publishAgentWebhookDeliveries: noop,
    publishBoardWebhookDeliveries: noop,
    idsToSendNotificationsTo: async () => [],
    sendDataOnlyFcm: noop,
    shouldNotify: async () => true,
    sendEmailNotification: async (_type, data) => { emails.push(data); return true; },
    checkRemindersAndCreateNotifications: async (userIds, _project, _task, data) => {
      inbox.push(...userIds.map((userId) => ({ userId, ...data })));
    },
    prisma: {
      assignees: {
        findMany: async ({ where }) => where.agentId === null && agentId && assigned ? [{ userId: 985 }] : [],
        findFirst: async ({ where }) => assigned && where.userId === 985 && where.agentId === null ? { userId: 985 } : null,
      },
      follower: { findMany: async () => [] },
      task: { update: noop },
      drafts: { deleteMany: noop },
      agent: { findUnique: async () => ({ displayName: "QA agent" }) },
      user: {
        findFirst: async () => ({ id: 985 }),
        findMany: async ({ where }) => where.id.in.map((id) => ({ id, email: "qa@example.test", UserSetting: { notification: true } })),
      },
      notification: { findMany: async () => dedupe ? [{ userId: 985 }] : [] },
      subscribedDevices: { findMany: async () => [] },
    },
  };
  const comment = { id: 501, text: "<p>QA verdict</p>", kind, createdAt: new Date() };
  const result = await fanOutCommentNotifications({
    dependencies, creatorId: 985, creatorIdNum: 985, taskId: 99, ownerId: 985,
    currentUser: { id: 985, displayName: "QA" }, agentId,
    task: { id: 99, userId: 985, projectId: 7049, title: "Fixture", uniqueIndex: 1, updatedByUserIds: [] },
    processTaskReferences: false,
    transactionResult: {
      comment, webhookDeliveryIds: [], boardWebhookDeliveryIds: [],
      resolvedDirectReplyUserId: directReply, inboundCompleted: false,
    },
    ...(dedupe ? { inboundEmailId: "receipt", transactionResult: {
      comment, webhookDeliveryIds: [], boardWebhookDeliveryIds: [],
      resolvedDirectReplyUserId: directReply, inboundCompleted: false, inboundProcessingStartedAt: new Date(),
    }, dependencies: { ...dependencies, completeInboundEmailProcessing: noop } } : {}),
  });
  assert.equal(result.id, 501);
  return { inbox, emails };
}

for (const kind of ["qa", "done", "question"]) {
  test(`${kind}: own agent reaches human assignee through comment fan-out, not email`, async () => {
    const { inbox, emails } = await deliver({ kind });
    assert.deepEqual(inbox.map(({ userId, commentId, fromAgentId, type }) => [userId, commentId, fromAgentId, type]), [[985, 501, "own-agent", "Comment"]]);
    assert.deepEqual(emails, []);
  });
}

for (const [name, options] of [
  ["flag off", { flagOn: false }],
  ["untyped chatter", { kind: null }],
  ["owner not assigned as a person", { assigned: false }],
  ["human self-comment", { agentId: null }],
  ["direct reply already delivered", { directReply: 985 }],
  ["inbound replay already delivered", { dedupe: true }],
]) {
  test(`${name}: no extra inbox delivery`, async () => {
    const { inbox } = await deliver(options);
    assert.deepEqual(inbox, []);
  });
}
