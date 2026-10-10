// HTPR-7088: agents following a ticket get comment inbox rows, live inbox
// updates and comment.created webhooks like assigned agents, and an agent never
// gets an inbox row or webhook for a comment it wrote itself. Flag off keeps
// today's behaviour.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7088-agent-comment-fanout";
let entryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function load(flagOn, flagChecks) {
  stubModule("src/lib/flags.ts", {
    isFeatureEnabled: async (key, userId) => {
      flagChecks.push([key, userId]);
      return flagOn;
    },
  });
  const jiti = require("jiti")(path.join(root, `tests/htpr-7088-${++entryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  return {
    notifications: jiti(path.join(root, "src/utils/controllers/comments/commentNotifications.ts")),
    fanout: jiti(path.join(root, "src/utils/controllers/comments/agentCommentFanout.ts")),
  };
}

const agentRow = (agentId, userId) => ({ agentId, agent: { id: agentId, userId } });

function notificationDeps({ assignees = [], followers = [] }) {
  const created = [];
  const broadcasts = [];
  return {
    created,
    broadcasts,
    deps: {
      prisma: {
        assignees: { findMany: async () => assignees },
        follower: { findMany: async () => followers },
        notification: {
          findMany: async () => [],
          createMany: async ({ data }) => {
            created.push(...data);
            return { count: data.length };
          },
        },
      },
      checkRemindersAndCreateNotifications: async () => {},
      broadcastInboxChange: async (userId, options) => {
        broadcasts.push({ userId, originUserId: options?.originUserId });
      },
    },
  };
}

const task = { id: 99, projectId: 15, userId: 8 };
const comment = { id: 501 };

test("flag on: human comment gives assigned and following agents a row and a live inbox update", async () => {
  const checks = [];
  const { notifications } = load(true, checks);
  const { created, broadcasts, deps } = notificationDeps({
    assignees: [agentRow("agent-a", 40)],
    followers: [agentRow("agent-b", 41), agentRow("agent-a", 40)],
  });
  await notifications.createNotificationForComment(deps, task, comment, 7, [], null);
  assert.deepEqual(
    created.map((r) => [r.agentId, r.userId, r.commentId, r.fromUserId, "fromAgentId" in r]),
    [["agent-a", 40, 501, 7, false], ["agent-b", 41, 501, 7, false]],
  );
  assert.deepEqual(broadcasts.map((b) => b.userId).sort(), [40, 41]);
  assert.deepEqual(checks[0], [flagKey, 7]);
});

test("flag off: follower agent still gets a row but no live inbox update (today)", async () => {
  const { notifications } = load(false, []);
  const { created, broadcasts, deps } = notificationDeps({
    assignees: [agentRow("agent-a", 40)],
    followers: [agentRow("agent-b", 41)],
  });
  await notifications.createNotificationForComment(deps, task, comment, 7, [], null);
  assert.deepEqual(created.map((r) => r.agentId), ["agent-a", "agent-b"]);
  assert.deepEqual(broadcasts.map((b) => b.userId), [40]);
});

test("flag on: the author agent gets no inbox row, others still do", async () => {
  const { notifications } = load(true, []);
  const { created, broadcasts, deps } = notificationDeps({
    assignees: [agentRow("agent-a", 40)],
    followers: [agentRow("agent-b", 41)],
  });
  await notifications.createNotificationForComment(deps, task, comment, 7, [], "agent-a");
  assert.deepEqual(created.map((r) => [r.agentId, r.fromAgentId]), [["agent-b", "agent-a"]]);
  assert.deepEqual(broadcasts.map((b) => b.userId), [41]);
});

test("flag on: an author agent that only follows gets no row either", async () => {
  const { notifications } = load(true, []);
  const { created, deps } = notificationDeps({ followers: [agentRow("agent-b", 41)] });
  await notifications.createNotificationForComment(deps, task, comment, 7, [], "agent-b");
  assert.deepEqual(created, []);
});

test("flag off: the author agent still notifies itself (today's bug)", async () => {
  const { notifications } = load(false, []);
  const { created, deps } = notificationDeps({ assignees: [agentRow("agent-a", 40)] });
  await notifications.createNotificationForComment(deps, task, comment, 7, [], "agent-a");
  assert.deepEqual(created.map((r) => [r.agentId, r.fromAgentId]), [["agent-a", "agent-a"]]);
});

test("human assignee and follower rows are unchanged with the flag on or off", async () => {
  for (const flagOn of [true, false]) {
    const { notifications } = load(flagOn, []);
    const sent = [];
    const { deps } = notificationDeps({});
    deps.checkRemindersAndCreateNotifications = async (ids, projectId, taskId, data) => {
      sent.push([ids, projectId, taskId, data]);
    };
    await notifications.createNotificationForComment(deps, task, comment, 7, [11, 12], null);
    assert.deepEqual(sent, [
      [[11, 12], 15, 99, { type: "Comment", commentId: 501, taskId: 99, projectId: 15, fromUserId: 7 }],
    ]);
  }
});

test("no agent recipients: the flag is not even read", async () => {
  const checks = [];
  const { notifications } = load(true, checks);
  const { created, deps } = notificationDeps({});
  await notifications.createNotificationForComment(deps, task, comment, 7, [], null);
  assert.deepEqual(created, []);
  assert.deepEqual(checks, []);
});

function webhookTx({ assignees, followers }) {
  return {
    assignees: { findMany: async () => assignees.map((agentId) => ({ agentId })) },
    follower: { findMany: async () => followers.map((agentId) => ({ agentId })) },
  };
}

test("webhook targets with flag off: assigned agents only, author included (today)", async () => {
  const { fanout } = load(false, []);
  const ids = await fanout.findCommentWebhookAgentIds(
    webhookTx({ assignees: ["agent-a"], followers: ["agent-b"] }),
    { taskId: 99, authorAgentId: "agent-a", fixOn: false },
  );
  assert.deepEqual(ids, ["agent-a"]);
});

test("webhook targets with flag on: assigned and following agents, deduped, never the author", async () => {
  const { fanout } = load(true, []);
  const ids = await fanout.findCommentWebhookAgentIds(
    webhookTx({ assignees: ["agent-a", "agent-c"], followers: ["agent-b", "agent-a"] }),
    { taskId: 99, authorAgentId: "agent-c", fixOn: true },
  );
  assert.deepEqual(ids.sort(), ["agent-a", "agent-b"]);
  const human = await fanout.findCommentWebhookAgentIds(
    webhookTx({ assignees: ["agent-a"], followers: ["agent-b"] }),
    { taskId: 99, authorAgentId: null, fixOn: true },
  );
  assert.deepEqual(human.sort(), ["agent-a", "agent-b"]);
});

test("persistComment feeds comment.created through the shared target helper", () => {
  const source = require("node:fs").readFileSync(
    path.join(root, "src/utils/controllers/comments/persistComment.ts"),
    "utf8",
  );
  assert.match(source, /findCommentWebhookAgentIds\(tx, \{/);
  assert.match(source, /event: "comment\.created",\s*agentIds: assignedAgentIds/);
});
