const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

function loadDispatch({ enabled = true } = {}) {
  const notifications = [];
  const pushes = [];
  const emails = [];
  const flagReads = [];
  const task = { id: 99, projectId: 7049, userId: 985, title: "Fixture", section: "Todo", uniqueIndex: 1 };
  const stubs = {
    "@/lib/prisma": { default: {
      task: { findUnique: async () => task },
      notification: { findMany: async () => [] },
      comment: { findMany: async () => [] },
      subscribedDevices: { findMany: async () => [] },
    } },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { flagReads.push({ key, userId }); return typeof enabled === "function" ? enabled(userId) : enabled; } },
    "../IdsToSendNotificationsTo": { default: async () => [985, 4037] },
    "./check-reminder_create-notification": { default: async (_user, _project, _task, payload) => {
      notifications.push(payload);
      return { ...payload, fromUser: { displayName: "Actor" }, user: { email: "qa@example.test" } };
    } },
    "../../FCM": { sendDataNewCommentFCM: async (body) => pushes.push(body) },
    "../sendNotification": { sendEmailNotification: async (...args) => emails.push(args) },
    "../shouldNotify": { shouldNotify: async () => true },
  };
  const { default: dispatch } = loadModule("src/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove.ts", stubs);
  return { dispatch, notifications, pushes, emails, flagReads };
}

for (const type of ["TaskMoved", "TaskUpdateDescription"]) {
  test(`agent ${type}: quiet recipients receive no inbox, push or email`, async () => {
    const { dispatch, notifications, pushes, emails, flagReads } = loadDispatch();
    assert.equal(await dispatch(6, type, 99, 7049, "runner"), true);
    assert.deepEqual(notifications, []);
    assert.deepEqual(pushes, []);
    assert.deepEqual(emails, []);
    assert.deepEqual(flagReads, [
      { key: "htpr-8143-quiet-agent-updates", userId: 985 },
      { key: "htpr-8143-quiet-agent-updates", userId: 4037 },
    ]);
  });

  test(`agent ${type}: flag off preserves delivery and attribution`, async () => {
    const { dispatch, notifications, pushes, emails } = loadDispatch({ enabled: false });
    assert.equal(await dispatch(6, type, 99, 7049, "runner"), true);
    assert.deepEqual(notifications.map(({ userId, fromAgentId, type }) => [userId, fromAgentId, type]), [[985, "runner", type], [4037, "runner", type]]);
    assert.equal(pushes.length, 2);
    assert.equal(emails.length, type === "TaskMoved" ? 2 : 0);
  });

  test(`agent ${type}: recipient flag does not silence other people`, async () => {
    const { dispatch, notifications, pushes } = loadDispatch({ enabled: (userId) => userId === 985 });
    assert.equal(await dispatch(6, type, 99, 7049, "runner"), true);
    assert.deepEqual(notifications.map(({ userId }) => userId), [4037]);
    assert.equal(pushes.length, 1);
  });

  test(`human ${type}: unchanged delivery without a flag read`, async () => {
    const { dispatch, notifications, pushes, flagReads } = loadDispatch();
    assert.equal(await dispatch(6, type, 99, 7049), true);
    assert.deepEqual(notifications.map(({ userId, fromAgentId, type }) => [userId, fromAgentId, type]), [[985, undefined, type], [4037, undefined, type]]);
    assert.equal(pushes.length, 2);
    assert.deepEqual(flagReads, []);
  });
}

for (const type of ["TaskArchived", "TaskDueDate"]) {
  test(`agent ${type}: unaffected by quiet moves and description edits`, async () => {
    const { dispatch, notifications, flagReads } = loadDispatch();
    assert.equal(await dispatch(6, type, 99, 7049, "runner"), true);
    assert.equal(notifications.length, 2);
    assert.deepEqual(flagReads, []);
  });
}

test("flag limits changed delivery to reviewed accounts", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-8143-quiet-agent-updates.ts");
  assert.equal(flag.key, "htpr-8143-quiet-agent-updates");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.releaseRisk.highRisk, "customer-email");
});
