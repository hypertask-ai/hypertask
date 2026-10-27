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
  const actor = { id: 100, displayName: "Alice" };
  const recipient = { id: 201, displayName: "Bob", email: "bob@example.test" };
  const project = {
    id: 101, ownerId: actor.id, status: "Normal",
    members: [{ userId: recipient.id, agentId: null, status: "Accepted" }],
  };
  const task = {
    id: 1001, userId: actor.id, title: "Private task", status: "Normal", project,
    projectId: project.id, uniqueIndex: 1, sectionId: 2, section: "Doing",
    followers: [{ userId: recipient.id }],
  };
  const comment = {
    id: 77, taskId: task.id, creatorId: recipient.id, agentId: null,
    text: "Private comment", taskTitle: task.title,
  };
  const description = { id: "description-1", creatorId: recipient.id, content: "Private description" };
  const state = {
    task, project, comment, recipient, optedIn: true, accessError: false,
    beforePush: () => {},
    devices: [{ userId: recipient.id, firebaseId: "device-1", sendNotifications: true }],
    assignees: [], followers: [],
  };
  const calls = { sent: [], access: [], pushes: [], preference: [] };
  const assignment = (data) => ({
    id: "assignment-1", agentId: null, agentAssigner: null, agent: null,
    user: recipient, ...data,
  });
  const db = {
    task: {
      findUnique: async () => task,
      findFirst: async ({ where }) => {
        calls.access.push(where);
        if (state.accessError) throw new Error("Access unavailable");
        return matches(task, where) ? task : null;
      },
    },
    userSetting: {
      findMany: async ({ where }) => where.userId.in.map((userId) => ({
        userId, notificationPreference: "all", pushAllowed: state.optedIn,
      })),
    },
    notification: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    subscribedDevices: { findMany: async () => state.devices },
    user: { findFirst: async () => actor, findUnique: async () => actor },
    comment: { findFirst: async () => comment, findMany: async () => [] },
    description: { findFirst: async () => description },
    reaction: {
      findMany: async () => [],
      create: async ({ data }) => ({ id: "reaction-1", ...data, task, comment, description, user: actor }),
    },
    assignees: {
      findFirst: async () => state.assignees[0] ?? null,
      findMany: async () => state.assignees,
      create: async ({ data }) => {
        const row = assignment(data);
        state.assignees.push(row);
        return row;
      },
      deleteMany: async () => {
        const count = state.assignees.length;
        state.assignees = [];
        return { count };
      },
    },
    follower: {
      findFirst: async () => state.followers[0] ?? null,
      create: async ({ data }) => {
        const row = { id: "follower-1", ...data, task };
        state.followers.push(row);
        return row;
      },
      delete: async () => { state.followers = []; },
    },
    $transaction: async (run) => run(db),
  };
  const notify = { default: async () => ({ fromUser: actor, user: recipient }) };
  const mocks = {
    axios: { default: {} },
    "@/utils/api/fcmConfig": { default: {} },
    "@prisma/client": { Status: { Deleted: "Deleted" }, Prisma: { DbNull: null } },
    "@/lib/prisma": { default: db },
    "@/lib/auth/agentScope": {
      agentScopeEnforced: () => true,
      withAgentScopeRequest: (_request, run) => run(),
      prepareAgentScope: async () => {},
      recordAgentBoardScopeMiss: () => {},
    },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: actor.id }) },
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({}) },
    "@/lib/cycles": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
    "@/utils/controllers/notifications/shouldNotify": {
      shouldNotify: async () => state.optedIn,
      resolveNotificationChannelPreference: (setting, type, channel) => {
        calls.preference.push({ userId: setting.userId, type, channel });
        return setting.pushAllowed;
      },
    },
    "../shouldNotify": { shouldNotify: async () => false },
    "../sendNotification": { sendEmailNotification: () => {} },
    "../IdsToSendNotificationsTo": { default: async () => task.followers.map(({ userId }) => userId) },
    "./check-reminder_create-notification": notify,
    "../notifications/creation-service/check-reminder_create-notification": notify,
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": notify,
    "@/utils/controllers/notifications/createAgentMentionNotification": { createAgentMentionNotification: async () => {} },
    "@/utils/controllers/tasks/getSharedTask": { checkIfBoardMember: async () => 200 },
    "@/utils/controllers/tasks/getTask": { getReactionsByDescriptionId: async () => [] },
    "./route": { taskWriteRoute: ({ operation }) => operation },
    "@/lib/realtime/server": { broadcastTaskComment: async () => {} },
    "@/lib/agentWebhooks/commentReaction": {
      prepareCommentReactionWebhook: async () => null,
      persistCommentReactionWebhook: async () => [],
    },
    "@/lib/agentWebhooks/outbox": {
      persistAgentRunTriggerWebhooks: async () => [],
      persistAgentWebhookEvent: async () => null,
      publishAgentWebhookDeliveries: async () => {},
    },
    "@/lib/mcp/webhooks/outbox": {
      persistBoardWebhookEvent: async () => [], publishBoardWebhookDeliveries: async () => {},
    },
    "../activities/createAssignedActivity": { default: async () => 88, assignmentActivityUserSelect: {} },
    "../notifications/sendAssignEmail": { sendAssignEmail: () => {} },
    "@/utils": { taskBaseUri: "detail/" },
    "@/utils/controllers/agents/boardMembers": {},
    "@/lib/mcp/tasks/services": { validateProjectMemberIds: async () => ({ invalidIds: [] }) },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: async () => {},
      cancelAgentMutationLeaseForHumanOverride: async () => {},
    },
    "@/utils/controllers/notifications/projectMute": { isProjectMuted: async () => false },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (route) => route },
    "@/lib/mcp/auth": {},
    "@/lib/mcp/agents/scopes": {},
    "@/lib/mcp/tasks/resolveTask": {},
    "@/lib/mcp/comments/reactionHandler": { createCommentReactionHandler: (dependencies) => dependencies },
    "@/lib/mcp/comments/reactionStore": {},
    "@/lib/mcp/comments/reactionResponse": {},
    "@/lib/mcp/comments/visibleReactionAgents": {},
    "@/lib/firebase-admin": { getFirebaseAdmin: () => ({}) },
    "firebase-admin/messaging": {
      getMessaging: () => ({ send: async (message) => { calls.sent.push(message); return "message-id"; } }),
    },
  };
  const { sendDataNewCommentFCM } = load("src/utils/controllers/FCM/index.ts", mocks);
  const pending = [];
  const fcm = { sendDataNewCommentFCM: (props) => {
    calls.pushes.push(props);
    assert.equal(props.taskId, task.id);
    state.beforePush();
    const delivery = sendDataNewCommentFCM(props);
    pending.push(delivery);
    return delivery;
  } };
  const callerMocks = { ...mocks, "@/utils/controllers/FCM": fcm, "../FCM": fcm, "../../FCM": fcm };
  const post = async (file) => {
    const handler = load(file, callerMocks).default;
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler({ method: "POST", headers: {}, body: {
      taskId: task.id, projectId: project.id, commentId: comment.id,
      userId: file.includes("createMention") ? recipient.id : actor.id,
      emoji: "👍", unified: "1f44d", names: ["thumbs up"],
    } }, res);
    assert.equal(res.statusCode, 200);
  };
  const run = async (path) => {
    if (["task move", "task archive", "task due", "task description"].includes(path)) {
      const types = { "task move": "TaskMoved", "task archive": "TaskArchived", "task due": "TaskDueDate", "task description": "TaskUpdateDescription" };
      await load("src/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove.ts", callerMocks)
        .default(actor.id, types[path], task.id, project.id);
    } else if (["comment reaction"].includes(path)) {
      await post("src/pages/api/comments/addReaction.ts");
    } else if (["MCP comment reaction"].includes(path)) {
      const route = load("src/app/api/mcp/comments/[comment_id]/reactions/route.ts", callerMocks).POST;
      await route.afterChange({
        taskId: task.id, projectId: project.id, commentId: comment.id,
        creatorId: recipient.id, text: comment.text, taskUniqueIndex: task.uniqueIndex,
      }, actor.id, "👍", true, { changed: true, reaction: { id: "reaction-1" } }, { agentId: null });
    } else if (["description reaction"].includes(path)) {
      const route = load("src/lib/api/task-writes/description-reaction.ts", callerMocks).POST;
      const result = await route({ taskId: task.id, descriptionId: description.id, emoji: "👍", unified: "1f44d" }, { userId: actor.id });
      assert.equal(result.status, 200);
    } else if (["follower add"].includes(path)) {
      const { createFollowerService } = load("src/utils/controllers/followers/createFollowerService.ts", callerMocks);
      const result = await createFollowerService({ userId: recipient.id, taskId: task.id, mentionById: actor.id });
      assert.equal(result.status, 200);
    } else if (["mention"].includes(path)) {
      await post("src/pages/api/comments/createMention.ts");
    } else if (["assignment", "unassignment"].includes(path)) {
      if (["unassignment"].includes(path)) state.assignees.push(assignment({ userId: recipient.id, taskId: task.id }));
      const assign = load("src/utils/controllers/assignees/assign.ts", callerMocks).default;
      const result = await assign(actor, recipient.id, task.id, undefined, undefined, {
        intent: ["unassignment"].includes(path) ? "unassign" : "assign",
      });
      assert.equal(result.status, 200);
    } else {
      throw new Error(`Unknown push path: ${path}`);
    }
    await Promise.all(pending.splice(0));
    assert.equal(calls.pushes.length, 1);
    assert.equal(calls.pushes[0].devices[0].sendNotifications, true);
  };
  const direct = (overrides = {}) => sendDataNewCommentFCM({
    taskId: task.id, type: "TaskMoved", notificationTitle: task.title,
    notificationBody: comment.text, taskTitle: task.title, payload: {},
    afterAppDomain: `detail/project-${project.id}/${task.uniqueIndex}`,
    devices: state.devices, ...overrides,
  });
  return { state, calls, run, direct };
}

function assertSent(h, tokens = ["device-1"]) {
  assert.deepEqual(h.calls.sent.map(({ token }) => token), tokens);
  for (const message of h.calls.sent) {
    assert.ok(message.notification.title);
    assert.ok(message.notification.body);
    assert.equal(message.data.click_action, message.webpush.fcmOptions.link);
    const props = h.calls.pushes[0];
    if (props) {
      assert.deepEqual(message.notification, { title: props.notificationTitle, body: props.notificationBody });
      assert.deepEqual(message.data, { ...props.data, click_action: message.webpush.fcmOptions.link });
    }
  }
}

for (const path of [
  "task move", "task archive", "task due", "task description", "comment reaction",
  "MCP comment reaction", "description reaction", "follower add", "mention", "assignment", "unassignment",
]) {
  test(`${path}: removed follower/assignee with push on now refused`, async () => {
    const h = harness();
    h.state.beforePush = () => { h.state.project.members = []; };
    await h.run(path);
    assert.equal(h.state.task.followers.length, 1);
    assertSent(h, []);
    assert.ok(h.calls.access.some((where) => where.status?.not === "Deleted"));
  });

  test(`${path}: current member with push on still allowed`, async () => {
    const h = harness();
    await h.run(path);
    assertSent(h);
  });
}

for (const target of ["task", "project"]) {
  const label = ["project"].includes(target) ? "board" : "task";
  test(`task push: deleted ${label} now refused`, async () => {
    const h = harness();
    h.state[target].status = "Deleted";
    await h.direct();
    assertSent(h, []);
  });

  test(`task push: archived ${label} still allowed`, async () => {
    const h = harness();
    h.state[target].status = "Archive";
    await h.direct();
    assertSent(h);
  });
}

for (const preferences of [
  { skipPreferenceFilter: true },
  { customPreferenceCheck: new Map([[201, true]]) },
]) {
  test(`task push: preference override ${Object.keys(preferences)[0]} now refused after removal`, async () => {
    const h = harness();
    h.state.project.members = [];
    await h.direct(preferences);
    assertSent(h, []);
  });

  test(`task push: preference override ${Object.keys(preferences)[0]} still allowed for current member`, async () => {
    const h = harness();
    await h.direct(preferences);
    assertSent(h);
  });
}

test("task push: unavailable access check now refused", async () => {
  const h = harness();
  h.state.accessError = true;
  await h.direct();
  assertSent(h, []);
});

test("task push: unavailable access check in a fire-and-forget task move now refused without an unhandled rejection", async () => {
  const h = harness();
  h.state.beforePush = () => { h.state.accessError = true; };
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await h.run("task move");
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.deepEqual(unhandled, []);
  assertSent(h, []);
});

test("task push: available access check still allowed", async () => {
  const h = harness();
  await h.direct();
  assertSent(h);
});

test("task push: missing task ID now refused", async () => {
  const h = harness();
  await h.direct({ taskId: undefined });
  assertSent(h, []);
  assert.deepEqual(h.calls.access, []);
});

test("task push: valid task ID still allowed", async () => {
  const h = harness();
  await h.direct();
  assertSent(h);
});

test("task push: mixed readers and multiple devices filter once per user", async () => {
  const h = harness();
  h.state.devices.push(
    { userId: 202, firebaseId: "removed-device", sendNotifications: true },
    { userId: 201, firebaseId: "device-2", sendNotifications: true },
  );
  await h.direct();
  assertSent(h, ["device-1", "device-2"]);
  assert.equal(h.calls.access.length, 2);
});

test("task push: device notifications disabled now refused as before", async () => {
  const h = harness();
  h.state.devices[0].sendNotifications = false;
  await h.direct();
  assertSent(h, []);
});

test("task push: device notifications enabled still allowed", async () => {
  const h = harness();
  await h.direct();
  assertSent(h);
});

test("task push: push preference disabled now refused as before", async () => {
  const h = harness();
  h.state.optedIn = false;
  await h.direct();
  assertSent(h, []);
});

test("task push: push preference enabled still allowed", async () => {
  const h = harness();
  await h.direct();
  assertSent(h);
});
