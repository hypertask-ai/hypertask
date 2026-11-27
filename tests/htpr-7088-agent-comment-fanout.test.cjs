const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let entryId = 0;

function load() {
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

test("human comment gives assigned and following agents a row and a live inbox update", async () => {
  const { notifications } = load();
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
});

test("the author agent gets no inbox row, others still do", async () => {
  const { notifications } = load();
  const { created, broadcasts, deps } = notificationDeps({
    assignees: [agentRow("agent-a", 40)],
    followers: [agentRow("agent-b", 41)],
  });
  await notifications.createNotificationForComment(deps, task, comment, 7, [], "agent-a");
  assert.deepEqual(created.map((r) => [r.agentId, r.fromAgentId]), [["agent-b", "agent-a"]]);
  assert.deepEqual(broadcasts.map((b) => b.userId), [41]);
});

test("an author agent that only follows gets no row either", async () => {
  const { notifications } = load();
  const { created, deps } = notificationDeps({ followers: [agentRow("agent-b", 41)] });
  await notifications.createNotificationForComment(deps, task, comment, 7, [], "agent-b");
  assert.deepEqual(created, []);
});

test("human assignee and follower rows are unchanged", async () => {
  const { notifications } = load();
  const sent = [];
  const { deps } = notificationDeps({});
  deps.checkRemindersAndCreateNotifications = async (ids, projectId, taskId, data) => {
    sent.push([ids, projectId, taskId, data]);
  };
  await notifications.createNotificationForComment(deps, task, comment, 7, [11, 12], null);
  assert.deepEqual(sent, [
    [[11, 12], 15, 99, { type: "Comment", commentId: 501, taskId: 99, projectId: 15, fromUserId: 7 }],
  ]);
});

test("no agent recipients: no inbox rows", async () => {
  const { notifications } = load();
  const { created, deps } = notificationDeps({});
  await notifications.createNotificationForComment(deps, task, comment, 7, [], null);
  assert.deepEqual(created, []);
});

function webhookTx({ assignees, followers }) {
  return {
    assignees: { findMany: async () => assignees.map((agentId) => ({ agentId })) },
    follower: { findMany: async () => followers.map((agentId) => ({ agentId })) },
  };
}

test("webhook targets: assigned and following agents, deduped, never the author", async () => {
  const { fanout } = load();
  const ids = await fanout.findCommentWebhookAgentIds(
    webhookTx({ assignees: ["agent-a", "agent-c"], followers: ["agent-b", "agent-a"] }),
    { taskId: 99, authorAgentId: "agent-c" },
  );
  assert.deepEqual(ids.sort(), ["agent-a", "agent-b"]);
  const human = await fanout.findCommentWebhookAgentIds(
    webhookTx({ assignees: ["agent-a"], followers: ["agent-b"] }),
    { taskId: 99, authorAgentId: null },
  );
  assert.deepEqual(human.sort(), ["agent-a", "agent-b"]);
});
