const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function matches(row, where) {
  if (row == null) return false;
  return Object.entries(where).every(([field, filter]) => {
    if (["OR"].includes(field)) return filter.some((branch) => matches(row, branch));
    if (["AND"].includes(field)) return [filter].flat().every((branch) => matches(row, branch));
    const value = row[field];
    if (filter === null || typeof filter !== "object") return value === filter;
    if ("some" in filter) return (value ?? []).some((item) => matches(item, filter.some));
    if ("not" in filter) return value !== filter.not;
    if ("in" in filter) return filter.in.includes(value);
    return matches(value, filter);
  });
}

function harness() {
  const project = {
    id: 101, ownerId: 100, status: "Normal",
    members: [{ userId: 201, agentId: null, status: "Accepted" }],
  };
  const task = {
    id: 1001, title: "Private task", status: "Normal", project,
    followers: [{ userId: 201 }],
  };
  const comment = { id: 77, taskId: task.id, text: "Private comment", creatorId: 100 };
  const state = {
    task, project, comment, optedIn: true, accessError: false,
    devices: [{ userId: 201, firebaseId: "device-1", sendNotifications: true }],
    failingTokens: new Set(),
  };
  const calls = { sent: [], access: [], preference: [], marked: [], renewed: 0 };
  const db = {
    task: {
      findFirst: async ({ where }) => {
        calls.access.push(where);
        if (state.accessError) throw new Error("Access unavailable");
        return matches(task, where) ? { id: task.id } : null;
      },
    },
    userSetting: {
      findMany: async ({ where }) => where.userId.in.map((userId) => ({
        userId, notificationPreference: "all", pushAllowed: state.optedIn,
      })),
    },
    notification: { findMany: async () => [] },
  };
  const mocks = {
    "@prisma/client": { Status: { Deleted: "Deleted" } },
    "@/lib/prisma": { default: db },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true },
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/agents/visibility": {},
    "@/lib/cycles": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
    "@/utils/controllers/notifications/shouldNotify": {
      resolveNotificationChannelPreference: (setting, type, channel) => {
        calls.preference.push({ userId: setting.userId, type, channel });
        return setting.pushAllowed;
      },
    },
    "@/lib/firebase-admin": { getFirebaseAdmin: () => ({}) },
    "firebase-admin/messaging": {
      getMessaging: () => ({
        send: async (message) => {
          if (state.failingTokens.has(message.token)) throw new Error("Delivery failed");
          calls.sent.push(message);
          return "message-id";
        },
      }),
    },
  };
  const { sendDataOnlyFcm } = load("src/utils/controllers/FCM/index.ts", mocks);
  const access = load("src/lib/access/canReadTaskNow.ts", mocks);
  return {
    state, calls, access,
    run: (deliveryOptions) => sendDataOnlyFcm(
      state.devices, { displayName: "Alice" }, task.title, 1, project.id,
      comment.creatorId, comment, deliveryOptions,
    ),
    deliveryOptions: (deliveredDeviceIds = new Set()) => ({
      failOnError: true,
      deliveredDeviceIds,
      beforeDelivery: async () => { calls.renewed += 1; },
      markDelivered: async (firebaseId) => { calls.marked.push(firebaseId); },
    }),
  };
}

function assertSent(h, tokens = ["device-1"]) {
  assert.deepEqual(h.calls.sent.map((message) => message.token), tokens);
  for (const message of h.calls.sent) {
    assert.equal(message.notification.title, "Private task");
    assert.equal(JSON.parse(message.data.comment).text, "Private comment");
  }
}

test("comment push: removed follower with push on now refused", async () => {
  const h = harness();
  h.state.project.members = [];
  assert.equal(h.state.task.followers.length, 1);
  await h.run();
  assert.deepEqual(h.calls.preference, [{ userId: 201, type: "Comment", channel: "push" }]);
  assert.deepEqual(h.calls.sent, []);
  assert.equal(h.calls.access.length, 1);
});

test("comment push: current follower still allowed", async () => {
  const h = harness();
  await h.run();
  assertSent(h);
  assert.equal(h.calls.access.length, 1);
});

for (const target of ["task", "project"]) {
  const label = ["project"].includes(target) ? "board" : "task";
  test(`comment push: deleted ${label} now refused`, async () => {
    const h = harness();
    h.state[target].status = "Deleted";
    await h.run();
    assert.deepEqual(h.calls.sent, []);
  });

  test(`comment push: archived ${label} still allowed`, async () => {
    const h = harness();
    h.state[target].status = "Archive";
    await h.run();
    assertSent(h);
  });
}

for (const removed of [true, false]) {
  test(`comment push: resumed per-device delivery ${removed ? "after removal now refused" : "for current follower still allowed"}`, async () => {
    const h = harness();
    h.state.devices.push({ userId: 201, firebaseId: "device-2", sendNotifications: true });
    h.state.failingTokens.add("device-2");
    await assert.rejects(h.run(h.deliveryOptions()), /FCM delivery failed/);
    assertSent(h);
    assert.deepEqual(h.calls.marked, ["device-1"]);
    h.state.failingTokens.clear();
    if (removed) h.state.project.members = [];
    const renewalsBeforeResume = h.calls.renewed;
    await h.run(h.deliveryOptions(new Set(h.calls.marked)));
    const expectedTokens = removed ? ["device-1"] : ["device-1", "device-2"];
    assertSent(h, expectedTokens);
    assert.deepEqual(h.calls.marked, expectedTokens);
    assert.equal(h.calls.renewed - renewalsBeforeResume, removed ? 0 : 1);
    assert.equal(h.calls.access.length, 2);
  });
}

test("comment push: comment author now refused as before", async () => {
  const h = harness();
  h.state.comment.creatorId = 201;
  await h.run(h.deliveryOptions());
  assert.deepEqual(h.calls.sent, []);
  assert.deepEqual(h.calls.marked, []);
  assert.equal(h.calls.renewed, 0);
});

test("comment push: non-author current follower still allowed", async () => {
  const h = harness();
  await h.run(h.deliveryOptions());
  assertSent(h);
  assert.deepEqual(h.calls.marked, ["device-1"]);
});

test("comment push: preference-blocked current follower now refused as before", async () => {
  const h = harness();
  h.state.optedIn = false;
  await h.run(h.deliveryOptions());
  assert.deepEqual(h.calls.sent, []);
  assert.deepEqual(h.calls.marked, []);
  assert.equal(h.calls.renewed, 0);
});

test("comment push: preference-enabled current follower still allowed", async () => {
  const h = harness();
  await h.run();
  assertSent(h);
});

test("comment push: moved to inaccessible board now refused", async () => {
  const h = harness();
  h.state.task.project = { id: 102, ownerId: 300, status: "Normal", members: [] };
  await h.run();
  assert.deepEqual(h.calls.sent, []);
});

test("comment push: moved to readable board still allowed", async () => {
  const h = harness();
  h.state.task.project = { id: 102, ownerId: 201, status: "Normal", members: [] };
  await h.run();
  assertSent(h);
});

test("comment push: unavailable access check now refused", async () => {
  const h = harness();
  h.state.accessError = true;
  await assert.rejects(h.run(h.deliveryOptions()), /Access unavailable/);
  assert.deepEqual(h.calls.sent, []);
  assert.deepEqual(h.calls.marked, []);
});

test("comment push: available access check still allowed", async () => {
  const h = harness();
  await h.run(h.deliveryOptions());
  assertSent(h);
});

test("comment push: missing task ID now refused", async () => {
  const h = harness();
  delete h.state.comment.taskId;
  await h.run();
  assert.deepEqual(h.calls.sent, []);
  assert.equal(h.calls.access.length, 0);
});

test("comment push: valid task ID still allowed", async () => {
  const h = harness();
  await h.run();
  assertSent(h);
});

test("batch readers: mixed users and multiple devices still allowed only with the single-reader rule", async () => {
  const h = harness();
  h.state.devices.push(
    { userId: 202, firebaseId: "removed-device", sendNotifications: true },
    { userId: 201, firebaseId: "device-2", sendNotifications: true },
  );
  await h.run();
  assertSent(h, ["device-1", "device-2"]);
  assert.equal(h.calls.access.length, 2);
  h.state.project.members.push({ userId: 203, agentId: null, status: "Accepted" });
  const candidates = [203, 202, 201, 203, 201];
  const callsBeforeBatch = h.calls.access.length;
  const batch = await h.access.filterTaskReadersNow(candidates, h.state.task.id);
  assert.equal(h.calls.access.length - callsBeforeBatch, new Set(candidates).size);
  const individual = [];
  for (const userId of new Set(candidates)) {
    if (await h.access.canReadTaskNow(userId, h.state.task.id)) individual.push(userId);
  }
  assert.deepEqual(batch, individual);
  assert.deepEqual(batch, [203, 201]);
});
