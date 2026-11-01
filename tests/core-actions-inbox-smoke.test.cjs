const SELF_FOLLOW_FLAG = "yper4-651-self-follow-quiet";
const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");
require("tsx/cjs");
const { runCoreActionsSmoke } = require("../src/lib/productionSmoke/coreActions.ts");
const { CoreSmokeRunDeadlineError } = require("../src/lib/productionSmoke/lock.ts");

const fixture = {
  projectId: 71, taskId: 81, baseSectionId: 91, altSectionId: 92,
  userId: 17, userDisplayName: "Smoke User", agentId: "smoke-agent", agentDisplayName: "Smoke Agent",
};
const inboxSteps = [
  "inbox add task", "inbox list added task", "inbox task detail",
  "inbox task-page remove", "inbox verify task-page removal",
  "inbox undo task-page removal", "inbox verify task-page undo",
  "inbox row archive", "inbox verify row archive",
  "inbox undo row archive", "inbox verify row undo",
];

function fakeApp(options = {}) {
  const state = {
    sectionId: fixture.baseSectionId, assignees: [], comments: [], notifications: [],
    nextId: 100, toggles: 0, lists: 0, added: false, calls: [],
  };
  const task = () => ({ id: fixture.taskId, projectId: fixture.projectId, uniqueIndex: 1,
    sectionId: state.sectionId, ranking: "original", assignees: state.assignees });
  const active = () => state.notifications.filter((row) => row.status === "Normal");
  const json = (data, status = 200) => Response.json(data, { status });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    state.calls.push({ path, query: url.searchParams, method: init.method || "GET", body, signal: init.signal });
    assert.equal(init.headers.Cookie, "ht_session=smoke");
    assert.equal(url.origin, "https://app.hypertask.ai");
    init.signal?.throwIfAborted();
    if (path === "/api/tasks/single") return json(task());
    if (path === "/api/projects/boardTasks") return json({ tasks: [task()] });
    if (path === "/api/comments/getByTask") return json({ comments: state.comments });
    if (path === "/api/comments/create") {
      const row = { id: state.nextId++, text: body.text, creatorId: fixture.userId };
      state.comments.push(row);
      await options.onComment?.(body, row.id);
      return json(row);
    }
    if (path === "/api/comments/updateComment") {
      const row = state.comments.find((row) => row.id === body.commentId);
      row.text = body.text;
      await options.onComment?.(body, row.id);
      return json(row);
    }
    if (path === "/api/comments/deleteCommentById") {
      state.comments = state.comments.filter((row) => row.id !== body.id);
      return json({});
    }
    if (path === "/api/section/getProjectSections") return json([{ id: 91 }, { id: 92 }]);
    if (path === "/api/tasks/moveTask") {
      const row = { id: state.nextId++, activity: { type: "TaskMove", data: {
        fromUserId: fixture.userId, fromSection: { sectionId: state.sectionId }, toSection: { sectionId: body.sectionId },
      } } };
      state.comments.push(row);
      state.sectionId = body.sectionId;
      return json({ newComment: row });
    }
    if (path === "/api/assignees/assign") {
      state.assignees = body.intent === "assign" ? [{ userId: fixture.userId }] : [];
      if (body.intent === "assign") options.onAssign?.();
      const row = { id: state.nextId++, activity: { type: "TaskAssigned", data: {
        fromUserId: fixture.userId, toUser: { userId: fixture.userId }, updatedStatus: body.intent === "assign" ? "Assigned" : "Unassigned",
      } } };
      state.comments.push(row);
      return json({ activityCommentIds: [row.id] });
    }
    if (path === "/api/search/document") return json({ processedData: { All: [{ taskId: fixture.taskId }] } });
    if (path === "/api/notifications/moveTaskToInbox") {
      assert.deepEqual(body, { taskId: 81, projectId: 71, userId: 17 });
      state.added = true;
      const row = { id: 201, taskId: 81, projectId: 71, userId: 17, fromUserId: 17,
        agentId: null, type: "TaskMovedToInbox", status: "Normal", archivedAt: null };
      state.notifications.push(row);
      if (options.loseAdd) throw new Error("connection lost after inbox write");
      if (options.deadline) options.deadline.abort(new CoreSmokeRunDeadlineError());
      return json(options.addError ? { error: "add failed" } : { message: "Success" });
    }
    if (path === "/api/notifications/getAll") {
      state.lists += 1;
      if (options.failList === state.lists) return json({ message: "list failed" }, 500);
      if (options.malformedList === state.lists) return json({});
      if ((options.hideAdded && state.lists === 2) || options.hideList === state.lists) return json({ notifications: [] });
      if (options.staleList === state.lists) return json({ notifications: [{ id: 201, taskId: 81 }] });
      return json({ notifications: active() });
    }
    if (path === "/api/notifications/getAllInbox") return json(state.notifications.filter((row) => row.status === "Archive"));
    if (path === "/api/tasks/getTask") {
      assert.equal(url.searchParams.get("project"), "project-71");
      assert.equal(url.searchParams.get("uniqueIndex"), "1");
      const notifications = active().filter((row) => row.taskId === fixture.taskId && row.userId === fixture.userId && !row.agentId);
      return json({ ...task(), notifications: options.missingDetailRow ? [] : notifications,
        _count: { notifications: options.missingDetailCount ? 0 : notifications.length } });
    }
    if (path === "/api/notifications/markAsDone") {
      state.toggles += 1;
      assert.deepEqual(body, { id: 201, taskId: 81, userId: 17, type: "TaskMovedToInbox" });
      assert.equal(init.method, "POST");
      if (options.failToggle === state.toggles) return json({ message: "This task is not in inbox" }, options.errorStatus || 400);
      const row = state.notifications.find((row) => row.id === 201);
      row.status = row.status === "Normal" ? "Archive" : "Normal";
      row.archivedAt = row.status === "Archive" ? "2026-10-03T00:00:00Z" : null;
      if (options.badUndo && state.toggles === 4) row.archivedAt = "stale";
      return json(row);
    }
    if (path === "/api/notifications/(un)archiveBulk") {
      assert.deepEqual(body, { notificationIds: [{ notificationId: 201, userId: 17 }], status: "Deleted" });
      if (options.failCleanup) return json({ error: "cleanup unavailable" }, 500);
      if (!options.staleCleanup) {
        state.notifications.find((row) => row.id === 201).status = "Deleted";
      }
      return json({ archivedCount: 1 });
    }
    throw new Error(`Unhandled ${path}`);
  };
  return { state, run: () => runCoreActionsSmoke({ baseUrl: "https://app.hypertask.ai", cookieHeader: "ht_session=smoke",
    fixture, runId: "inbox-test", fetchImpl, signal: options.deadline?.signal }) };
}

function assertClean(app) {
  assert.deepEqual(app.state.comments, []);
  assert.equal(app.state.sectionId, fixture.baseSectionId);
  assert.deepEqual(app.state.assignees, []);
  assert.equal(app.state.notifications.find((row) => row.id === 201)?.status, "Deleted");
}

test("all named inbox routines use the UI paths and clean up their notification", async () => {
  const app = fakeApp();
  const result = await app.run();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.steps.filter((step) => step.startsWith("inbox ")), inboxSteps);
  assert.ok(result.cleanup.includes("inbox deleted smoke notifications"));
  assertClean(app);
});

test("smoke requests mention only the agent and keep inbox coverage without direct follower or email requests", async () => {
  const app = fakeApp();
  const result = await app.run();
  assert.equal(result.ok, true, JSON.stringify(result));
  const assertSafe = (calls) => {
    for (const call of calls) {
      assert.doesNotMatch(call.path, /follower|email/i);
      assert.equal(call.body.agentId, undefined, "mutations must act as the user, not an agent");
      if (call.body.text) {
        assert.doesNotMatch(call.body.text, /data-label=["']name-/);
        assert.match(call.body.text, /data-label="agent-smoke-agent"/);
      }
      if (call.body.userId !== undefined) assert.equal(call.body.userId, fixture.userId);
      if (call.body.creatorId !== undefined) assert.equal(call.body.creatorId, fixture.userId);
      if (call.body.ownerId !== undefined) assert.equal(call.body.ownerId, fixture.userId);
    }
  };
  assertSafe(app.state.calls);
  assert.ok(app.state.calls.some((call) => call.path === "/api/comments/create"));
  assert.ok(app.state.calls.some((call) => call.path === "/api/comments/updateComment"));
  assert.ok(result.steps.includes("post comment and mention agent"));
  assert.ok(result.steps.includes("move task"));
  assert.ok(result.steps.includes("assign and unassign"));
  assert.ok(result.steps.includes("search"));
  assert.deepEqual(result.steps.filter((step) => step.startsWith("inbox ")), inboxSteps);
  assert.throws(() => assertSafe([{ path: "/api/comments/create", body: {
    text: '<span data-label="name-6">Valentin</span><span data-label="agent-smoke-agent">Agent</span>',
  } }]));
  assert.throws(() => assertSafe([{ path: "/api/follower/createFollower", body: { userId: 6 } }]));
  assert.throws(() => assertSafe([{ path: "/api/notifications/sendEmailToFollower", body: { receiver: 6 } }]));
  assertClean(app);
});

for (const [toggle, action] of [[1, "inbox task-page remove"], [2, "inbox undo task-page removal"],
  [3, "inbox row archive"], [4, "inbox undo row archive"]]) {
  for (const status of [400, 200]) {
    test(`${action}: not in inbox response at HTTP ${status} fails and cleans up`, async () => {
      const app = fakeApp({ failToggle: toggle, errorStatus: status });
      const result = await app.run();
      assert.equal(result.ok, false);
      assert.equal(result.kind, "application");
      assert.equal(result.action, action);
      assert.match(result.detail, /not in inbox/);
      assert.ok(!result.steps.includes(action));
      assertClean(app);
    });
  }
}

for (const [options, action] of [
  [{ addError: true }, "inbox add task"], [{ hideAdded: true }, "inbox list added task"],
  [{ missingDetailCount: true }, "inbox task detail"], [{ missingDetailRow: true }, "inbox task detail"],
  [{ staleList: 3 }, "inbox verify task-page removal"], [{ staleList: 6 }, "inbox verify row archive"],
  [{ failList: 2 }, "inbox list added task"], [{ malformedList: 2 }, "inbox list added task"],
  [{ hideList: 4 }, "inbox verify task-page undo"], [{ hideList: 7 }, "inbox verify row undo"],
  [{ failList: 8 }, "inbox cleanup discover active"],
  [{ badUndo: true }, "inbox undo row archive"], [{ loseAdd: true }, "inbox add task"],
  [{ failCleanup: true }, "inbox cleanup delete"], [{ staleCleanup: true }, "inbox cleanup verify"],
]) {
  test(`${action}: ${JSON.stringify(options)} is never green`, async () => {
    const app = fakeApp(options);
    const result = await app.run();
    assert.equal(result.ok, false);
    assert.equal(result.action, action, JSON.stringify(result));
    assert.deepEqual(app.state.comments, []);
    if (!options.failCleanup && !options.staleCleanup) assertClean(app);
  });
}

test("inbox cleanup failure preserves the original failed step and still cleans core data", async () => {
  const app = fakeApp({ failToggle: 1, failCleanup: true });
  const result = await app.run();
  assert.equal(result.action, "inbox task-page remove");
  assert.match(result.detail, /cleanup failed at inbox cleanup delete/);
  assert.deepEqual(app.state.comments, []);
  assert.deepEqual(app.state.assignees, []);
  assert.equal(app.state.sectionId, 91);
});

test("cleanup never deletes baseline, other-task, other-user, or agent notifications", async () => {
  const app = fakeApp();
  const rows = [
    { id: 202, taskId: 81, projectId: 71, userId: 17, fromUserId: 17, type: "TaskMovedToInbox", status: "Archive" },
    { id: 203, taskId: 99, projectId: 71, userId: 17, fromUserId: 17, type: "TaskMovedToInbox", status: "Normal" },
    { id: 204, taskId: 99, projectId: 71, userId: 18, fromUserId: 17, type: "TaskMovedToInbox", status: "Normal" },
    { id: 205, taskId: 99, projectId: 71, userId: 17, fromUserId: 17, agentId: "agent", type: "TaskMovedToInbox", status: "Normal" },
  ];
  app.state.notifications.push(...rows);
  const before = structuredClone(rows);
  const result = await app.run();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(rows, before);
  assertClean(app);
});

test("an occupied fixture inbox fails preflight without adding or deleting anything", async () => {
  const app = fakeApp();
  app.state.notifications.push({ id: 202, taskId: 81, status: "Normal" });
  const result = await app.run();
  assert.equal(result.action, "inbox baseline");
  assert.equal(result.ok, false);
  assert.ok(!app.state.calls.some((call) => call.path === "/api/notifications/moveTaskToInbox"));
  assert.ok(!app.state.calls.some((call) => call.path === "/api/notifications/(un)archiveBulk"));
});

test("safe-deadline cleanup uses a fresh signal", async () => {
  const deadline = new AbortController();
  const app = fakeApp({ deadline });
  await app.run();
  const deletes = app.state.calls.filter((call) => call.path === "/api/notifications/(un)archiveBulk");
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].signal.aborted, false);
  assertClean(app);
});

function followerApp(taskOwnerId = 99, flagEnabled = true) {
  const flagReads = [];
  const followers = [];
  const notifications = [];
  const mentions = [];
  const pushes = [];
  const task = { id: fixture.taskId, userId: taskOwnerId, projectId: fixture.projectId,
    title: "Core actions smoke fixture", uniqueIndex: 1, agentId: null };
  const { createFollowerService } = load("src/utils/controllers/followers/createFollowerService.ts", {
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flagReads.push({ key, userId });
      return flagEnabled;
    } },
    "@/lib/prisma": { default: {
      task: { findUnique: async () => task },
      agent: { findFirst: async () => ({ id: fixture.agentId, userId: fixture.userId }) },
      assignees: { findFirst: async () => null },
      follower: {
        findFirst: async ({ where }) => followers.find((row) =>
          row.userId === where.userId && row.taskId === where.taskId &&
          (where.agentId === undefined || row.agentId === where.agentId)),
        create: async ({ data }) => {
          const row = { id: followers.length + 1, ...data, task };
          followers.push(row);
          return row;
        },
      },
      subscribedDevices: { findMany: async () => [] },
      user: { findFirst: async () => ({ displayName: "Health Check" }) },
    } },
    "@/utils/controllers/tasks/getSharedTask": { checkIfBoardMember: async () => 200 },
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": {
      default: async (_userId, _projectId, _taskId, payload) => {
        notifications.push(payload);
        return payload;
      },
    },
    "@/utils/controllers/notifications/createAgentMentionNotification": {
      createAgentMentionNotification: async (payload) => { mentions.push(payload); },
    },
    "@/utils/controllers/FCM": { sendDataNewCommentFCM: async (body) => { pushes.push(body); } },
  });
  return { createFollowerService, followers, notifications, mentions, pushes, flagReads };
}

test("self-follow creates the follower without a follower-added notification or push", async () => {
  const app = followerApp();
  const result = await app.createFollowerService({
    userId: fixture.userId, mentionById: fixture.userId, taskId: fixture.taskId,
  });
  assert.equal(result.status, 200);
  assert.equal(app.followers.length, 1);
  assert.deepEqual(app.notifications, []);
  assert.deepEqual(app.pushes, []);
  assert.deepEqual(app.flagReads, [{ key: SELF_FOLLOW_FLAG, userId: fixture.userId }]);
});

test("a different user adding a follower still creates the notification and push", async () => {
  const app = followerApp();
  const result = await app.createFollowerService({
    userId: fixture.userId, mentionById: 18, taskId: fixture.taskId,
  });
  assert.equal(result.status, 200);
  assert.equal(app.followers.length, 1);
  assert.deepEqual(app.notifications, [{
    userId: fixture.userId, fromUserId: 18, type: "AddedToFollowerInTask",
    taskId: fixture.taskId, projectId: fixture.projectId,
  }]);
  assert.equal(app.pushes.length, 1);
  assert.deepEqual(app.flagReads, []);
});

test("an acting agent adding its owner as follower still notifies the human", async () => {
  const app = followerApp();
  const result = await app.createFollowerService({
    userId: fixture.userId, mentionById: fixture.userId, taskId: fixture.taskId,
    fromAgentId: "acting-agent",
  });
  assert.equal(result.status, 200);
  assert.equal(app.notifications.length, 1);
  assert.equal(app.pushes.length, 1);
  assert.deepEqual(app.flagReads, []);
});

for (const flagEnabled of [true, false]) {
  test(`smoke agent follower recreation ${flagEnabled ? "suppresses" : "preserves"} self-added follower events with the flag ${flagEnabled ? "on" : "off"}`, async () => {
    const followers = followerApp(fixture.userId, flagEnabled);
    let creations = 0;
    const app = fakeApp({
      onComment: async (body, commentId) => {
        assert.match(body.text, /data-label="agent-smoke-agent"/);
        const result = await followers.createFollowerService({
          agentId: fixture.agentId, mentionById: fixture.userId, taskId: fixture.taskId, commentId,
        });
        assert.ok([200, 201].includes(result.status));
        if (result.status === 200) creations += 1;
      },
      onAssign: () => {
        const index = followers.followers.findIndex((row) => row.userId === fixture.userId);
        if (index >= 0) followers.followers.splice(index, 1);
      },
    });
    const result = await app.run();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(creations, 2, "assignment removes the agent follower and marker edits recreate it");
    assert.equal(followers.followers.length, 1);
    assert.equal(followers.followers[0].agentId, fixture.agentId);
    assert.ok(followers.mentions.length > 1, "agent mention delivery is preserved on marker edits");
    assert.equal(followers.notifications.length, flagEnabled ? 0 : creations, "flag off restores follower-added rows for the human digest");
    for (const notification of followers.notifications) {
      assert.equal(notification.type, "AddedToFollowerInTask");
      assert.equal(notification.userId, fixture.userId);
      assert.equal(notification.fromUserId, fixture.userId);
      assert.equal(notification.agentId, fixture.agentId);
    }
    assert.deepEqual(followers.pushes, []);
    assertClean(app);
  });
}

test("a different user adding an agent follower still notifies its owner and mentions the agent", async () => {
  const app = followerApp(fixture.userId);
  const result = await app.createFollowerService({
    agentId: fixture.agentId, mentionById: 18, taskId: fixture.taskId, commentId: 123,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(app.notifications, [{
    userId: fixture.userId, fromUserId: 18, type: "AddedToFollowerInTask",
    taskId: fixture.taskId, projectId: fixture.projectId, agentId: fixture.agentId,
  }]);
  assert.deepEqual(app.mentions, [{
    agentId: fixture.agentId, mentionedBy: 18, taskId: fixture.taskId,
    projectId: fixture.projectId, commentId: 123, fromAgentId: undefined,
  }]);
  assert.deepEqual(app.pushes, []);
});

for (const agentId of [undefined, fixture.agentId]) {
  test(`flag off restores self-follow notifications for ${agentId ? "an agent follower" : "a human follower"}`, async () => {
    const app = followerApp(99, false);
    const result = await app.createFollowerService({
      userId: fixture.userId, mentionById: fixture.userId, taskId: fixture.taskId, agentId,
    });
    assert.equal(result.status, 200);
    assert.equal(app.followers.length, 1);
    assert.deepEqual(app.notifications, [{
      userId: fixture.userId, fromUserId: fixture.userId, type: "AddedToFollowerInTask",
      taskId: fixture.taskId, projectId: fixture.projectId, ...(agentId ? { agentId } : {}),
    }]);
    assert.equal(app.pushes.length, agentId ? 0 : 1);
    assert.equal(app.mentions.length, agentId ? 1 : 0);
    assert.deepEqual(app.flagReads, [{ key: SELF_FOLLOW_FLAG, userId: fixture.userId }]);
  });
}
