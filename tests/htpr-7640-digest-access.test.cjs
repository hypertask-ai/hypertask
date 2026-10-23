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
    return matches(value, filter);
  });
}

function harness({ fallback = false } = {}) {
  const userId = 201;
  const project = {
    id: 101, ownerId: 100, status: "Normal",
    members: [{ userId, agentId: null, status: "Accepted" }],
  };
  const task = {
    id: 1001, title: "Private task", projectId: project.id, uniqueIndex: 1,
    status: "Normal", project, followers: [{ userId }],
  };
  const body = {
    userId, taskId: task.id, sender: "Alice", recipient: "follower@example.test",
    title: task.title, commentText: "Private comment", link: "https://example.test/task",
  };
  const state = { project, task, muted: false, optedIn: true };
  const calls = { sent: [], cleared: [], access: [], enqueued: [], fallbackReads: 0, contentReads: 0 };
  const db = {
    task: {
      findFirst: async ({ where }) => {
        calls.access.push(where);
        return matches(task, where) ? { id: task.id } : null;
      },
      findUnique: async () => {
        calls.contentReads += 1;
        return task;
      },
    },
    user: {
      findUnique: async () => ({ email: body.recipient, displayName: "Follower", UserSetting: {} }),
    },
    notification: {
      findMany: async () => {
        calls.contentReads += 1;
        return fallback ? [] : [{
          createdAt: new Date("2026-01-01T00:01:00Z"), type: "Comment", commentId: 77,
          fromUser: { displayName: "Alice" }, fromAgent: null, comment: { text: body.commentText },
        }];
      },
      count: async () => 0,
    },
  };
  const mocks = {
    "@prisma/client": { Status: { Deleted: "Deleted" } },
    "@/lib/prisma": { default: db },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true },
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/agents/visibility": {},
    "@/lib/cycles": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
    "@/lib/qstash": { withQstashSignature: (handler) => handler },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/email/sendEmail": { sendEmail: async (message) => { calls.sent.push(message); } },
    "@/lib/email/unsubscribe": { unsubscribeHeaders: () => ({}) },
    "@/lib/email/inboundReply": { createNotificationReplyAddress: () => "reply@example.test" },
    "@/utils/controllers/notifications/projectMute": { isTaskProjectMuted: async () => state.muted },
    "@/utils/controllers/notifications/shouldNotify": {
      resolveNotificationChannelPreference: () => state.optedIn,
    },
    "@/utils/controllers/notifications/emailTemplates": {
      renderDigestEmail: (title, link, events) => ({ subject: title, html: JSON.stringify({ title, link, events }) }),
      renderNotificationEmail: (_type, original) => ({ subject: original.title, html: JSON.stringify(original) }),
    },
    "@/utils/controllers/notifications/digest": {
      enqueueDigest: async (...args) => { calls.enqueued.push(args); return false; },
      clearDigestWindow: async (...args) => { calls.cleared.push(args); },
      getLastDigestedAt: async () => undefined,
      setLastDigestedAt: async () => {},
      getDigestFallback: async () => {
        calls.fallbackReads += 1;
        return { type: "Comment", body };
      },
    },
  };
  for (const name of ["digest", "projectMute", "emailTemplates"]) {
    mocks[`./${name}`] = mocks[`@/utils/controllers/notifications/${name}`];
  }
  const worker = load("src/pages/api/queues/notificationDigestQueue.ts", mocks).default;
  const immediate = load("src/utils/controllers/notifications/sendNotification.ts", mocks).sendEmailNotification;
  const acl = load("src/utils/controllers/projects/getAllIncludes.ts", mocks);
  return {
    state, calls, body,
    canRead: () => matches(project, acl.projectContentAccessWhere(userId)),
    run: async () => {
      const res = {
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
      };
      await worker({ body: { userId, taskId: task.id, since: "2026-01-01T00:00:00Z" } }, res);
      return res;
    },
    immediate: (type = "Comment", original = body) => immediate(type, original),
  };
}

function assertSent(h) {
  assert.equal(h.calls.sent.length, 1);
  assert.equal(h.calls.sent[0].subject, "Private task");
  assert.match(h.calls.sent[0].html, /Private comment/);
  assert.equal(h.calls.sent[0].to, h.body.recipient);
}

for (const fallback of [false, true]) {
  const mode = fallback ? "fallback digest" : "normal digest";

  test(`${mode}: removed follower now refused`, async () => {
    const h = harness({ fallback });
    h.state.project.members = [];
    assert.equal(h.state.task.followers.length, 1);
    assert.equal(h.canRead(), false);
    const res = await h.run();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sent, false);
    assert.deepEqual(h.calls.cleared, [[201, 1001]]);
    assert.equal(h.calls.sent.length, 0);
    assert.equal(h.calls.fallbackReads, 0);
    assert.equal(h.calls.contentReads, 0);
  });

  test(`${mode}: current follower still allowed`, async () => {
    const h = harness({ fallback });
    assert.equal(h.canRead(), true);
    const res = await h.run();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sent, true);
    assertSent(h);
    assert.deepEqual(h.calls.cleared, [[201, 1001]]);
    assert.equal(h.calls.fallbackReads, fallback ? 1 : 0);
  });

  for (const [target, label] of [["task", "task"], ["project", "board"]]) {
    test(`${mode}: deleted ${label} now refused`, async () => {
      const h = harness({ fallback });
      h.state[target].status = "Deleted";
      const res = await h.run();
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.sent, false);
      assert.equal(h.calls.sent.length, 0);
      assert.deepEqual(h.calls.cleared, [[201, 1001]]);
    });

    test(`${mode}: archived ${label} still allowed`, async () => {
      const h = harness({ fallback });
      h.state[target].status = "Archive";
      assert.equal((await h.run()).body.sent, true);
      assertSent(h);
    });
  }

  test(`${mode}: moved to inaccessible board now refused`, async () => {
    const h = harness({ fallback });
    h.state.task.projectId = 102;
    h.state.task.project = { id: 102, ownerId: 300, status: "Normal", members: [] };
    assert.equal((await h.run()).body.sent, false);
    assert.equal(h.calls.sent.length, 0);
    assert.deepEqual(h.calls.cleared, [[201, 1001]]);
  });

  test(`${mode}: moved to readable board still allowed`, async () => {
    const h = harness({ fallback });
    h.state.task.projectId = 102;
    h.state.task.project = { id: 102, ownerId: 201, status: "Normal", members: [] };
    assert.equal((await h.run()).body.sent, true);
    assertSent(h);
  });

  test(`${mode}: muted current follower still receives none`, async () => {
    const h = harness({ fallback });
    h.state.muted = true;
    const res = await h.run();
    assert.equal(res.body.sent, false);
    assert.equal(res.body.reason, "board muted");
    assert.equal(h.calls.sent.length, 0);
    assert.deepEqual(h.calls.cleared, [[201, 1001]]);
  });
}

for (const replyOnly of [false, true]) {
  const mode = replyOnly ? "immediate unassignment replyTaskId" : "immediate enqueue failure";

  test(`${mode}: removed follower now refused`, async () => {
    const h = harness();
    h.state.project.members = [];
    const original = replyOnly ? { ...h.body, taskId: undefined, replyTaskId: 1001 } : h.body;
    assert.equal(await h.immediate(replyOnly ? "Unassigned" : "Comment", original), true);
    assert.equal(h.calls.sent.length, 0);
    assert.equal(h.calls.enqueued.length, replyOnly ? 0 : 1);
    assert.equal(h.calls.access.length, 1);
  });

  test(`${mode}: current follower still allowed`, async () => {
    const h = harness();
    const original = replyOnly ? { ...h.body, taskId: undefined, replyTaskId: 1001 } : h.body;
    assert.equal(await h.immediate(replyOnly ? "Unassigned" : "Comment", original), true);
    assertSent(h);
    assert.equal(h.calls.enqueued.length, replyOnly ? 0 : 1);
  });
}

test("normal digest: opted-out current follower still receives none", async () => {
  const h = harness();
  h.state.optedIn = false;
  assert.equal((await h.run()).body.sent, false);
  assert.equal(h.calls.sent.length, 0);
  assert.deepEqual(h.calls.cleared, [[201, 1001]]);
});

test("immediate fallback: muted current follower still receives none", async () => {
  const h = harness();
  h.state.muted = true;
  await h.immediate();
  assert.equal(h.calls.enqueued.length, 0);
  assert.equal(h.calls.sent.length, 0);
});

test("normal digest: board owner and non-Accepted human membership still allowed", async () => {
  for (const owner of [false, true]) {
    const h = harness();
    h.state.project.members[0].status = "Invited";
    if (owner) {
      h.state.project.members = [];
      h.state.project.ownerId = 201;
    }
    assert.equal((await h.run()).body.sent, true);
    assertSent(h);
  }
});

test("immediate invite still allowed without task authorization", async () => {
  const h = harness();
  h.state.project.members = [];
  await h.immediate("Invite", { ...h.body, taskId: undefined });
  assert.equal(h.calls.sent.length, 1);
  assert.equal(h.calls.access.length, 0);
});
