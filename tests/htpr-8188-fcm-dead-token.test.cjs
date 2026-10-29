const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const UNREGISTERED = Object.assign(new Error("NotRegistered"), {
  code: "messaging/registration-token-not-registered",
  codePrefix: "messaging",
  httpResponse: { status: 404, headers: {}, data: { error: { message: "NotRegistered" } } },
});

function harness(thrown) {
  const task = { id: 1001, title: "Push task", status: "Normal" };
  const comment = { id: 77, taskId: task.id, text: "Hello", creatorId: 100 };
  const devices = [{ userId: 201, firebaseId: "device-dead-token-1", sendNotifications: true }];
  const calls = { sent: [], deleted: [], marked: [] };
  const prisma = {
    userSetting: {
      findMany: async ({ where }) => where.userId.in.map((userId) => ({
        userId, notificationPreference: "all", pushAllowed: true,
      })),
    },
    notification: { findMany: async () => [] },
    subscribedDevices: {
      deleteMany: async ({ where }) => { calls.deleted.push(where.firebaseId); return { count: 1 }; },
    },
  };
  const mocks = {
    "@prisma/client": { NotificationType: {} },
    "@/lib/prisma": { default: prisma },
    "@/lib/access/canReadTaskNow": { filterTaskReadersNow: async (userIds) => [...new Set(userIds)] },
    "@/utils/controllers/notifications/shouldNotify": {
      resolveNotificationChannelPreference: () => true,
    },
    "@/lib/firebase-admin": { getFirebaseAdmin: () => ({}) },
    "firebase-admin/messaging": {
      getMessaging: () => ({
        send: async (message) => {
          calls.sent.push(message.token);
          if (thrown) throw thrown;
          return "message-id";
        },
      }),
    },
  };
  const { sendDataOnlyFcm } = load("src/utils/controllers/FCM/index.ts", mocks);
  return {
    calls,
    run: () => sendDataOnlyFcm(
      devices, { displayName: "Alice" }, task.title, 1, 5, comment.creatorId, comment,
      {
        failOnError: true,
        deliveredDeviceIds: new Set(),
        markDelivered: async (firebaseId) => { calls.marked.push(firebaseId); },
      },
    ),
  };
}

async function captureConsole(run) {
  const originalError = console.error;
  const originalLog = console.log;
  const calls = { errors: [], logs: [] };
  console.error = (...args) => { calls.errors.push(args.map(String).join(" ")); };
  console.log = (...args) => { calls.logs.push(args.map(String).join(" ")); };
  try {
    await run();
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  return calls;
}

test("dead token: firebase-admin v14 error shape prunes the device row and resolves the send", async () => {
  const h = harness(UNREGISTERED);
  let failure;
  const output = await captureConsole(async () => {
    try {
      await h.run();
    } catch (error) {
      failure = error;
    }
  });
  assert.equal(failure, undefined);
  assert.deepEqual(h.calls.sent, ["device-dead-token-1"]);
  assert.deepEqual(h.calls.deleted, ["device-dead-token-1"]);
  assert.deepEqual(h.calls.marked, ["device-dead-token-1"]);
  assert.deepEqual(output.errors, []);
  assert.match(output.logs.join("\n"), /dropping unregistered device token/);
});

test("dead token: legacy errorInfo shape still prunes the device row", async () => {
  const legacy = Object.assign(new Error("not registered"), {
    errorInfo: { code: "messaging/registration-token-not-registered", message: "not registered" },
  });
  const h = harness(legacy);
  const output = await captureConsole(() => h.run());
  assert.deepEqual(h.calls.deleted, ["device-dead-token-1"]);
  assert.deepEqual(output.errors, []);
});

test("dead token: a real delivery failure keeps its device row and stays an error", async () => {
  const h = harness(Object.assign(new Error("Server responded with status 503"), {
    code: "messaging/server-unavailable",
    codePrefix: "messaging",
  }));
  let failure;
  const output = await captureConsole(async () => {
    try {
      await h.run();
    } catch (error) {
      failure = error;
    }
  });
  assert.deepEqual(h.calls.deleted, []);
  assert.deepEqual(h.calls.marked, []);
  assert.equal(failure instanceof AggregateError, true);
  assert.equal(output.errors.length, 1);
  assert.match(output.errors[0], /send failed/);
});
