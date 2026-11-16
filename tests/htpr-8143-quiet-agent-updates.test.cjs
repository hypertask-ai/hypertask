const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

function loadDispatch() {
  const notifications = [];
  const pushes = [];
  const emails = [];
  const task = { id: 99, projectId: 7049, userId: 985, title: "Fixture", section: "Todo", uniqueIndex: 1 };
  const stubs = {
    "@/lib/prisma": { default: {
      task: { findUnique: async () => task },
      notification: { findMany: async () => [] },
      comment: { findMany: async () => [] },
      subscribedDevices: { findMany: async () => [] },
    } },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      throw new Error(`unexpected feature flag read: ${key} for ${userId}`);
    } },
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
  return { dispatch, notifications, pushes, emails };
}

for (const type of ["TaskMoved", "TaskUpdateDescription"]) {
  test(`agent ${type}: quiet recipients receive no inbox, push or email`, async () => {
    const { dispatch, notifications, pushes, emails } = loadDispatch();
    assert.equal(await dispatch(6, type, 99, 7049, "runner"), true);
    assert.deepEqual(notifications, []);
    assert.deepEqual(pushes, []);
    assert.deepEqual(emails, []);
  });

  test(`human ${type}: unchanged delivery and attribution without a flag read`, async () => {
    const { dispatch, notifications, pushes, emails } = loadDispatch();
    assert.equal(await dispatch(6, type, 99, 7049), true);
    assert.deepEqual(notifications.map(({ userId, fromAgentId, type }) => [userId, fromAgentId, type]), [[985, undefined, type], [4037, undefined, type]]);
    assert.equal(pushes.length, 2);
    assert.equal(emails.length, type === "TaskMoved" ? 2 : 0);
  });

  test(`agent ${type}: a later human ${type} still notifies everyone`, async () => {
    const { dispatch, notifications } = loadDispatch();
    await dispatch(6, type, 99, 7049, "runner");
    assert.equal(await dispatch(6, type, 99, 7049), true);
    assert.deepEqual(notifications.map(({ userId }) => userId), [985, 4037]);
  });
}

for (const type of ["TaskArchived", "TaskDueDate"]) {
  test(`agent ${type}: other agent updates keep their delivery`, async () => {
    const { dispatch, notifications } = loadDispatch();
    assert.equal(await dispatch(6, type, 99, 7049, "runner"), true);
    assert.equal(notifications.length, 2);
  });
}
