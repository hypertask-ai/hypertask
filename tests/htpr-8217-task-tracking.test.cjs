const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

function fixture(options = {}) {
  const state = {
    followers: options.followers ?? [],
    stars: options.stars ?? [],
    reminders: options.reminders ?? [],
    notificationsArchived: 0,
  };
  const events = [], flags = [];
  let nextReminderId = 100;
  const tx = {
    reminder: {
      findMany: async ({ where }) => state.reminders.filter((row) => row.userId === where.userId && row.taskId === where.taskId),
      update: async ({ where, data }) => {
        const row = state.reminders.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
      create: async ({ data }) => {
        const row = { id: nextReminderId++, status: "Normal", ...data };
        state.reminders.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        for (const row of state.reminders.filter((item) => where.id.in.includes(item.id))) Object.assign(row, data);
        return { count: where.id.in.length };
      },
    },
    notification: {
      updateMany: async () => { state.notificationsArchived += 1; return { count: 1 }; },
    },
    $executeRaw: async () => 1,
  };
  const db = {
    task: { findFirst: async ({ where }) => (where.id === 42 ? { id: 42, projectId: 15 } : null) },
    follower: {
      findFirst: async ({ where }) => state.followers.find((row) => row.taskId === where.taskId
        && row.userId === where.userId
        && (row.agentId ?? null) === (where.agentId ?? null)) ?? null,
      deleteMany: async ({ where }) => {
        const before = state.followers.length;
        state.followers = state.followers.filter((row) => !(row.taskId === where.taskId
          && row.userId === where.userId
          && (row.agentId ?? null) === (where.agentId ?? null)));
        return { count: before - state.followers.length };
      },
    },
    savedContent: {
      findFirst: async ({ where }) => state.stars.find((row) => row.taskId === where.taskId
        && row.userId === where.userId
        && row.commentId === where.commentId) ?? null,
    },
    reminder: { findFirst: async ({ where }) => state.reminders.filter((row) => row.userId === where.userId
      && row.taskId === where.taskId
      && row.status === "Normal").at(-1) ?? null },
    $transaction: async (run) => run(tx),
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/mcp/auth/types": {},
    "@/utils/controllers/followers/createFollowerService": { createFollowerService: async (input) => {
      events.push({ type: "follow", input });
      if (options.followRefused) return { status: 403, body: { message: "User does not belong in this board." } };
      if (!state.followers.some((row) => row.taskId === input.taskId && row.userId === input.userId && (row.agentId ?? null) === (input.agentId ?? null))) {
        state.followers.push({ id: "f1", taskId: input.taskId, userId: input.userId, agentId: input.agentId ?? null });
      }
      return { status: 200, body: { id: "f1" } };
    } },
    "@/lib/taskCardActions/writeLocks": { withTaskStarWriteLock: async (taskId, run) => {
      events.push({ type: "starLock", taskId });
      const star = {
        findFirst: async ({ where }) => state.stars.find((row) => row.taskId === where.taskId && row.userId === where.userId) ?? null,
        create: async ({ data }) => { events.push({ type: "starCreate", data }); state.stars.push({ ...data }); return data; },
        deleteMany: async ({ where }) => {
          const before = state.stars.length;
          state.stars = state.stars.filter((row) => !(row.taskId === where.taskId && row.userId === where.userId));
          return { count: before - state.stars.length };
        },
      };
      return run({ savedContent: star });
    } },
    "@/lib/tasks/setWaitingOn": {},
    "@/utils/controllers/tasks/assertTaskAccess": { taskAccessWhere: (userId, taskId, options) => ({ id: taskId, userId, ...options }) },
    "@/utils/controllers/reminders/revision": { nextReminderRevision: (rows) => new Date(1_800_000_000_000 + rows.length) },
    "@/utils/controllers/tasks/myTasksSnooze": { syncMyTasksSnoozeFromReminder: async () => {} },
    "@/lib/flags": { isFeatureEnabled: async (key) => {
      flags.push(key);
      if (key === "my-tasks-snooze") return false;
      assert.equal(key, "htpr-8217-agent-follow-reminder");
      return options.trackingFlagEnabled !== false;
    }, MY_TASKS_SNOOZE_FLAG: "my-tasks-snooze" },
    "@/lib/realtime/server": { broadcastInboxChange: async () => {} },
    "@/pages/api/queues/inboxQueue": {
      cancelInboxReminderJob: async (userId, taskId) => { events.push({ type: "cancelJob", userId, taskId }); },
      cancelInboxReminderRevisionJob: async (reminder) => { events.push({ type: "cancelRevision", reminderId: reminder?.id ?? null }); },
      cancelLegacyInboxReminderJobIfSafe: async () => {},
      scheduleInboxReminderJob: async (reminder, runAt) => { events.push({ type: "schedule", reminderId: reminder.id, runAt }); },
    },
  };
  const { setTaskTracking } = load("src/lib/tasks/taskTracking.ts", mocks);
  const context = { currentUser: { id: 7 }, agentId: "agent-owner", teamScope: null };
  return { setTaskTracking, state, events, flags, context };
}

test("follow writes the same follower row the app writes and reads the state back", async () => {
  const f = fixture();
  const result = await f.setTaskTracking({ action: "follow", taskId: 42, ...f.context });
  assert.equal(result.status, 200);
  assert.equal(result.body.following, true);
  const follow = f.events.find((event) => event.type === "follow");
  assert.equal(follow.input.taskId, 42);
  assert.equal(follow.input.userId, 7);
  assert.equal(follow.input.agentId, "agent-owner");
  assert.equal(follow.input.mentionById, 7);
});

test("unfollow removes this agent's own row and leaves another agent's row alone", async () => {
  const f = fixture({ followers: [
    { id: "f1", taskId: 42, userId: 7, agentId: "agent-owner" },
    { id: "f2", taskId: 42, userId: 7, agentId: "someone-else" },
  ] });
  const result = await f.setTaskTracking({ action: "unfollow", taskId: 42, ...f.context });
  assert.equal(result.body.following, false);
  assert.deepEqual(f.state.followers.map((row) => row.id), ["f2"]);
});

test("a refused follow keeps the plain refusal and does not report following", async () => {
  const f = fixture({ followRefused: true });
  const result = await f.setTaskTracking({ action: "follow", taskId: 42, ...f.context });
  assert.equal(result.status, 403);
  assert.equal(result.body.message, "User does not belong in this board.");
  assert.equal(f.state.followers.length, 0);
});

test("star writes one private row under the task star lock and star again does not duplicate it", async () => {
  const f = fixture();
  await f.setTaskTracking({ action: "star", taskId: 42, ...f.context });
  await f.setTaskTracking({ action: "star", taskId: 42, ...f.context });
  assert.equal(f.state.stars.length, 1);
  assert.deepEqual(f.state.stars[0], { taskId: 42, userId: 7, type: "Private", commentId: null, projectId: 15 });
  assert.equal(f.events.filter((event) => event.type === "starLock").length, 2);
});

test("unstar removes the private star and reports starred false", async () => {
  const f = fixture({ stars: [{ taskId: 42, userId: 7, type: "Private", commentId: null, projectId: 15 }] });
  const result = await f.setTaskTracking({ action: "unstar", taskId: 42, ...f.context });
  assert.equal(result.body.starred, false);
  assert.equal(f.state.stars.length, 0);
});

test("remind replaces the unsent reminder, cancels its job and schedules the new one", async () => {
  const f = fixture({ reminders: [
    { id: 7, taskId: 42, userId: 7, projectId: 15, status: "Normal", remindAt: new Date("2026-11-01T09:00:00Z"), createdAt: new Date(1), updatedAt: new Date(2) },
    { id: 8, taskId: 42, userId: 7, projectId: 15, status: "Normal", remindAt: new Date("2026-11-01T10:00:00Z"), createdAt: new Date(3), updatedAt: new Date(4) },
  ] });
  const result = await f.setTaskTracking({ action: "remind", taskId: 42, remindAt: "2026-11-02T09:00:00Z", ...f.context });
  assert.equal(result.status, 200);
  assert.equal(result.body.remindAt, "2026-11-02T09:00:00.000Z");
  assert.equal(f.state.reminders.length, 2);
  assert.equal(f.state.reminders[0].remindAt.toISOString(), "2026-11-02T09:00:00.000Z");
  assert.equal(f.state.reminders[1].status, "Archive");
  assert.deepEqual(f.events.filter((event) => ["cancelJob", "cancelRevision", "schedule"].includes(event.type)).map((event) => event.type), ["cancelJob", "cancelRevision", "schedule"]);
  assert.equal(f.events.find((event) => event.type === "schedule").reminderId, 7);
  assert.equal(f.state.notificationsArchived, 1);
});

test("remind on a task with no reminder creates one that the job will fire", async () => {
  const f = fixture();
  await f.setTaskTracking({ action: "remind", taskId: 42, remindAt: "2026-11-02T09:00:00Z", ...f.context });
  assert.equal(f.state.reminders.length, 1);
  assert.equal(f.state.reminders[0].invokeCondition, "DurationComplete");
  assert.equal(f.state.reminders[0].projectId, 15);
});

test("remind without a usable date writes nothing", async () => {
  const f = fixture();
  const result = await f.setTaskTracking({ action: "remind", taskId: 42, remindAt: "not a date", ...f.context });
  assert.equal(result.status, 400);
  assert.equal(f.state.reminders.length, 0);
});

test("read reports following, starred and the live reminder without writing", async () => {
  const f = fixture({
    followers: [{ id: "f1", taskId: 42, userId: 7, agentId: "agent-owner" }],
    stars: [{ taskId: 42, userId: 7, type: "Private", commentId: null, projectId: 15 }],
    reminders: [{ id: 9, taskId: 42, userId: 7, projectId: 15, status: "Normal", remindAt: new Date("2026-11-05T09:00:00Z") }],
  });
  const result = await f.setTaskTracking({ action: "read", taskId: 42, ...f.context });
  assert.deepEqual(result.body, {
    taskId: 42,
    action: "read",
    following: true,
    starred: true,
    remindAt: "2026-11-05T09:00:00.000Z",
    reminderId: 9,
  });
  assert.deepEqual(f.events, []);
});

test("the ticket flag off refuses every action, including the AI chat path that calls this service", async () => {
  const f = fixture({ trackingFlagEnabled: false });
  for (const action of ["follow", "unfollow", "star", "unstar", "read"]) {
    const result = await f.setTaskTracking({ action, taskId: 42, ...f.context });
    assert.equal(result.status, 404, action);
    assert.equal(result.body.message, "Agent task tracking is not enabled");
  }
  assert.deepEqual(f.events, []);
});

test("a task outside the agent's board access is not found and writes nothing", async () => {
  const f = fixture();
  const result = await f.setTaskTracking({ action: "follow", taskId: 43, ...f.context });
  assert.equal(result.status, 404);
  assert.deepEqual(f.events, []);
});
