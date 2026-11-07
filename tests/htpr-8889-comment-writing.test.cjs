const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { setup } = require("./helpers/comment-routing.cjs");

const agent = "85b985ac-afe8-41a3-a1ac-d9549a9310c7";
const keptStatus = "<p>Next: old status.</p><p>Saved.</p>";
const keptStatusEdit = "<p>Next: old status.</p><p>Saved now.</p>";

const definition = load("src/lib/flags/definitions/htpr-8889-people-comment-writing.ts", {});

test("people comment writing ships for everyone as a small bugfix", () => {
  assert.equal(definition.HTPR_8889_PEOPLE_COMMENT_WRITING_FLAG, "htpr-8889-people-comment-writing");
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  assert.equal(definition.default.releaseRisk.risk, "small");
  assert.equal(definition.default.releaseRisk.highRisk, undefined);
  assert.match(definition.default.shippedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(definition.default.description.trim());
  assert.ok(definition.default.releaseRisk.reason.trim());
});

function flags(modes = {}) {
  return {
    isFeatureEnabled: async (key) => {
      if (modes.throwWhole && key === "htpr-8889-people-comment-writing") throw new Error("flag store unavailable");
      if (key === "yper4-910-agent-writing") return modes.writing !== false;
      if (key === "htpr-8889-people-comment-writing") return modes.whole !== false;
      return false;
    },
  };
}

function isPeopleWritingRefusal(error) {
  assert.equal(error.field, "text");
  assert.equal(error.status, 400);
  assert.match(error.message, /Robot status/);
  assert.match(error.message, /Use short plain sentences for people/);
  assert.match(error.message, /agent log/);
  return true;
}

function loadUpdate(stored, modes) {
  const writes = [];
  const service = load("src/utils/controllers/comments/updateCommentService.ts", {
    "@prisma/client": { Prisma: {} },
    "@/lib/prisma": {
      default: {
        comment: { findFirst: async () => stored },
        $transaction: async (run) => run({
          comment: {
            updateMany: async () => ({ count: 1 }),
            update: async (args) => {
              writes.push(args);
              return { id: stored.id, taskId: stored.taskId, text: args.data.text, seen: [], creatorId: 6 };
            },
          },
        }),
      },
    },
    "@/lib/flags": flags(modes),
    "@/lib/agents/publicAgent": { publicAgentSelect: { id: true } },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertCommentToTurbopuffer: async () => {} },
    "@/pages/api/queues/FAST/generateSummary": { default: async () => {} },
    "@/pages/api/queues/FAST/generateCommentSummary": { default: async () => {} },
    "@/utils/controllers/comments/processMentions": { processMentionsFromCommentText: async () => {} },
    "./processMentions": { processMentionsFromCommentText: async () => {} },
    "@/lib/ai/hyperAiConfirmation": { invalidateHyperAiCommentOrigin: async () => {} },
  });
  return { updateCommentService: service.updateCommentService, writes };
}

test("a status line posted for people is refused and names the rule and the fix", async () => {
  const harness = setup();
  const response = await harness.post({ text: "Next: wait for checks.", kind: "qa" });
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.field, "text");
  assert.match(response.body.error, /Robot status/);
  assert.match(response.body.error, /Use short plain sentences for people/);
  assert.equal(harness.calls.comments.length, 0);
});

test("an edit that keeps a status line is refused and names the rule and the fix", async () => {
  const stored = { id: 44, taskId: 91, text: keptStatus, task: { projectId: 15 } };
  const { updateCommentService, writes } = loadUpdate(stored, {});
  await assert.rejects(
    updateCommentService({ commentId: 44, text: keptStatusEdit, userId: 6, agentId: agent }),
    isPeopleWritingRefusal,
  );
  assert.equal(writes.length, 0);
});

test("a short agent edit still saves, and a human edit of a status line still saves", async () => {
  const short = loadUpdate({ id: 44, taskId: 91, text: "<p>Saved.</p>", task: { projectId: 15 } }, {});
  const saved = await short.updateCommentService({
    commentId: 44, text: "<p>Saved now.</p>", userId: 6, agentId: agent,
  });
  assert.match(saved.text, /Saved now/);
  assert.equal(short.writes.length, 1);

  const human = loadUpdate({ id: 44, taskId: 91, text: keptStatus, task: { projectId: 15 } }, {});
  const updated = await human.updateCommentService({ commentId: 44, text: keptStatusEdit, userId: 6 });
  assert.match(updated.text, /Saved now/);
  assert.equal(human.writes.length, 1);
});

test("turning the comment check off keeps today's edit, and a new status line is still refused", async () => {
  const stored = { id: 44, taskId: 91, text: keptStatus, task: { projectId: 15 } };
  const off = loadUpdate(stored, { whole: false });
  const updated = await off.updateCommentService({
    commentId: 44, text: keptStatusEdit, userId: 6, agentId: agent,
  });
  assert.match(updated.text, /Saved now/);
  assert.equal(off.writes.length, 1);

  const fresh = loadUpdate({ id: 44, taskId: 91, text: "<p>Saved.</p>", task: { projectId: 15 } }, { whole: false });
  await assert.rejects(
    fresh.updateCommentService({ commentId: 44, text: "<p>Next: wait.</p>", userId: 6, agentId: agent }),
    isPeopleWritingRefusal,
  );
  assert.equal(fresh.writes.length, 0);
});

test("the writing switch off still accepts the same edit, and a broken read refuses it", async () => {
  const stored = { id: 44, taskId: 91, text: keptStatus, task: { projectId: 15 } };
  const policyOff = loadUpdate(stored, { writing: false });
  await policyOff.updateCommentService({ commentId: 44, text: keptStatusEdit, userId: 6, agentId: agent });
  assert.equal(policyOff.writes.length, 1);

  const broken = loadUpdate(stored, { throwWhole: true });
  await assert.rejects(
    broken.updateCommentService({ commentId: 44, text: keptStatusEdit, userId: 6, agentId: agent }),
    isPeopleWritingRefusal,
  );
  assert.equal(broken.writes.length, 0);
});

function pastWritingPrisma() {
  const later = new Proxy(() => {
    throw new Error("past-writing");
  }, {
    get: () => later,
    apply: () => { throw new Error("past-writing"); },
  });
  return new Proxy({
    task: { findFirst: async () => ({ id: 91, projectId: 15, project: { id: 15 } }) },
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return later;
    },
  });
}

function loadCreate(modes) {
  const noop = async () => {};
  return load("src/utils/controllers/comments/createCommentService.ts", {
    "@prisma/client": { Prisma: {} },
    "server-only": {},
    "@/lib/prisma": { default: pastWritingPrisma() },
    "@/lib/flags": flags(modes),
    "@/utils/controllers/notifications/IdsToSendNotificationsTo": { default: async () => [] },
    "@/lib/realtime/server": { broadcastBoardChange: noop, broadcastInboxChange: noop, broadcastTaskComment: noop },
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": { checkRemindersAndCreateNotifications: noop },
    "@/utils/controllers/notifications/agentActionRecipients": { includeSenderInRecipients: () => false, shouldNotifyTaskOwnerForComment: () => false },
    "@/pages/api/queues/FAST/generateSummary": { default: noop },
    "@/pages/api/queues/FAST/generateCommentSummary": { default: noop },
    "@/utils/controllers/tasks/single": { updateTaskSingle: noop },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertCommentToTurbopuffer: noop },
    "@/utils/controllers/comments/processMentions": {
      getMentionedUserIdsFromCommentText: () => [],
      getMentionedAgentIdsFromCommentText: () => [],
      processMentionsFromCommentText: noop,
    },
    "@/utils/controllers/comments/extractTaskReferences": { extractTaskReferencesFromCommentText: () => [] },
    "@/utils/controllers/tasks/addRelatedTasks": { addRelatedTasks: noop },
    "@/utils/controllers/FCM": { sendDataOnlyFcm: noop },
    "@/utils/controllers/notifications/shouldNotify": { shouldNotify: async () => false },
    "@/utils/controllers/notifications/sendNotification": { sendEmailNotification: noop },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/lib/ai/hyperAiConfirmation": { recordHyperAiCommentOrigin: noop },
    "@/lib/agentWebhooks/outbox": {
      persistAgentRunTriggerWebhooks: noop,
      persistAgentTaskRunPromptWebhooks: noop,
      persistAgentWebhookEvent: noop,
      persistAgentWebhookEvents: noop,
      publishAgentWebhookDeliveries: noop,
    },
    "@/lib/mcp/webhooks/outbox": { persistBoardWebhookEvents: noop, publishBoardWebhookDeliveries: noop },
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 1 } },
    "@/utils/controllers/comments/agentInvocationCorrelation": {
      buildAgentInvocationSelector: () => null,
      claimPendingAgentInvocation: noop,
      DirectReplyAlreadyHandledError: class DirectReplyAlreadyHandledError extends Error {},
    },
    "@/utils/controllers/comments/inboundEmailReceipt": {
      claimInboundEmailProcessing: noop,
      completeInboundEmailProcessing: noop,
      findInboundEmailReceipt: async () => null,
      recordInboundEmailComment: noop,
      releaseInboundEmailProcessing: noop,
      requireInboundEmailComment: () => null,
    },
    "@/lib/agentRuns/persistence": { persistAgentRunActivity: noop, persistAgentRunSelection: noop },
    "@/lib/agentRuns/model": { AgentRunActivityInProgressError: class AgentRunActivityInProgressError extends Error {}, serializeAgentRun: (run) => run },
    "@/utils/controllers/comments/persistComment": { persistComment: async () => { throw new Error("past-writing"); } },
    "@/utils/controllers/comments/commentFanout": { fanOutCommentNotifications: noop },
    "@/utils/controllers/comments/commentNotifications": { createNotificationForComment: noop },
  }).createCommentService;
}

function runReply(text) {
  return {
    text,
    creatorId: 6,
    taskId: 91,
    ownerId: 6,
    currentUser: { id: 6 },
    agentId: agent,
    agentRunActivity: {
      id: "activity-1",
      runId: "run-1",
      agentId: agent,
      context: { taskId: 91 },
      idempotencyKey: null,
      createdAt: new Date("2026-11-07T00:00:00.000Z"),
      type: "RESPONSE",
    },
  };
}

test("an agent run reply that is a status line is refused before it is saved", async () => {
  const createCommentService = loadCreate({});
  await assert.rejects(createCommentService(runReply("<p>Next: wait.</p>")), isPeopleWritingRefusal);
  await assert.rejects(createCommentService(runReply("<p>Saved.</p>")), /past-writing/);
});

test("a run reply stays unchecked when the comment check or the writing switch is off", async () => {
  await assert.rejects(loadCreate({ whole: false })(runReply("<p>Next: wait.</p>")), /past-writing/);
  await assert.rejects(loadCreate({ writing: false })(runReply("<p>Next: wait.</p>")), /past-writing/);
});

test("a replay of a stored run comment is not checked again", async () => {
  const createCommentService = loadCreate({});
  await assert.rejects(createCommentService({
    text: "<p>Next: wait.</p>",
    creatorId: 6,
    taskId: 91,
    ownerId: 6,
    currentUser: { id: 6 },
    agentId: agent,
    agentRunReplayComment: {
      id: 8,
      activityId: "activity-1",
      agentWebhookDeliveryIds: [],
      boardWebhookDeliveryIds: [],
      notificationsCompletedAt: null,
    },
  }), /past-writing/);
});
