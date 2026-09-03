const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let entryNumber = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadOutbox() {
  delete require.cache[path.join(root, "src/lib/agentWebhooks/outbox.ts")];
  stubModule("src/lib/prisma.ts", { default: {} });
  stubModule("src/lib/agentWebhooks/queue.ts", {
    queueAgentWebhookDelivery: async () => {},
  });
  const jiti = createJiti(
    path.join(root, `tests/agent-webhook-outbox-${++entryNumber}.cjs`),
    {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
    },
  );
  return jiti(path.join(root, "src/lib/agentWebhooks/outbox.ts"));
}

function fakeTransaction() {
  const rows = [];
  const subscriptionQueries = [];
  const taskUpdates = [];
  const subscriptions = [
    { id: "sub-a", agentId: "agent-a", events: ["comment.created", "task.created", "task.updated"] },
    { id: "sub-b", agentId: "agent-b", events: ["task.created", "task.updated"] },
  ];
  const tx = {
    rows,
    subscriptionQueries,
    taskUpdates,
    $queryRaw: async () => [{ id: 42 }],
    task: {
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => {
        taskUpdates.push(data);
        return { id: 42 };
      },
      findUnique: async () => ({
        id: 42,
        ticketNumber: "HTPR-42",
        projectId: 15,
        title: "Webhook payload",
        assignees: [
          { userId: 6, agentId: "agent-a" },
          { userId: 7, agentId: null },
        ],
        taskLabels: [
          { label: { id: "label-1", value: "Urgent" } },
        ],
      }),
    },
    agentWebhookSubscription: {
      findMany: async ({ where }) => {
        subscriptionQueries.push(where);
        return subscriptions
          .filter((subscription) =>
            !where.agentId?.in || where.agentId.in.includes(subscription.agentId),
          )
          .filter((subscription) => subscription.events.includes(where.events.has));
      },
    },
    agentWebhookDelivery: {
      create: async ({ data }) => {
        rows.push(data);
        return data;
      },
    },
    agent: {
      findUnique: async ({ where }) =>
        where.id === "agent-a" ? { displayName: "Agent A" } : null,
    },
    label: {
      findMany: async ({ where }) =>
        [
          { id: "label-1", value: "Urgent", projectId: 15 },
          { id: "label-2", value: "Needs review", projectId: 15 },
          { id: "foreign-label", value: "Other board", projectId: 99 },
        ].filter(
          (label) =>
            where.id.in.includes(label.id) && label.projectId === where.projectId,
        ),
    },
    user: { findUnique: async () => null },
  };
  return tx;
}

const actor = { userId: 6, displayName: "Valentin" };

function fakeSingleEventTransaction(subscription) {
  const rows = [];
  const membersWhere = [];
  const tx = {
    rows,
    membersWhere,
    agentWebhookSubscription: {
      findUnique: async ({ select }) => {
        membersWhere.push(select.agent.select.members.where);
        return subscription;
      },
    },
    agentWebhookDelivery: {
      create: async ({ data }) => {
        rows.push(data);
        return data;
      },
    },
  };
  return tx;
}

function chatSubscription({ events, members } = {}) {
  return {
    id: "sub-chat",
    active: true,
    projectId: null,
    events: events ?? ["chat.message"],
    agent: {
      revokedAt: null,
      members: members === undefined ? [{ id: "member-1" }] : members,
    },
  };
}

test("chat.message persists a board-free chat payload", async () => {
  const { persistAgentWebhookEvent } = loadOutbox();
  const tx = fakeSingleEventTransaction(chatSubscription());

  const deliveryId = await persistAgentWebhookEvent(tx, {
    event: "chat.message",
    agentId: "agent-a",
    projectId: null,
    taskId: null,
    ticketNumber: null,
    taskTitle: null,
    actor,
    chat: {
      sessionId: "session-1",
      messageId: "message-1",
      text: "Can you update the board?",
      userName: "Valentin",
    },
  });

  assert.equal(typeof deliveryId, "string");
  assert.equal(tx.rows.length, 1);
  assert.equal(tx.rows[0].event, "chat.message");
  assert.equal(tx.rows[0].payload.event, "chat.message");
  assert.equal(tx.rows[0].payload.projectId, null);
  assert.equal(tx.rows[0].payload.taskId, null);
  assert.deepEqual(tx.rows[0].payload.chat, {
    sessionId: "session-1",
    messageId: "message-1",
    text: "Can you update the board?",
    userName: "Valentin",
  });
  assert.deepEqual(tx.rows[0].payload.actor, actor);
});

test("chat.message accepts a null project when the agent sits on any owner board", async () => {
  const { persistAgentWebhookEvent } = loadOutbox();

  // Membership cannot be narrowed to a board for a chat event; the where
  // clause must not demand projectId null.
  const accepted = fakeSingleEventTransaction(chatSubscription());
  const deliveryId = await persistAgentWebhookEvent(accepted, {
    event: "chat.message",
    agentId: "agent-a",
    projectId: null,
    taskId: null,
    ticketNumber: null,
    taskTitle: null,
    actor,
    chat: { sessionId: "s", messageId: "m", text: "hi", userName: null },
  });
  assert.equal(typeof deliveryId, "string");
  assert.deepEqual(accepted.membersWhere[0], {});

  // Board events keep the board-narrowed grant.
  const scoped = fakeSingleEventTransaction(
    chatSubscription({ events: ["comment.created"] })
  );
  await persistAgentWebhookEvent(scoped, {
    event: "comment.created",
    agentId: "agent-a",
    projectId: 15,
    taskId: 42,
    ticketNumber: "HTPR-42",
    taskTitle: "Webhook payload",
    actor,
    commentId: 99,
    commentHtml: "<p>Plain comment</p>",
  });
  assert.deepEqual(scoped.membersWhere[0], { projectId: 15 });

  // An agent on no board of the owner is still skipped for chat events.
  const noBoards = fakeSingleEventTransaction(
    chatSubscription({ members: [] })
  );
  const skipped = await persistAgentWebhookEvent(noBoards, {
    event: "chat.message",
    agentId: "agent-a",
    projectId: null,
    taskId: null,
    ticketNumber: null,
    taskTitle: null,
    actor,
    chat: { sessionId: "s", messageId: "m", text: "hi", userName: null },
  });
  assert.equal(skipped, null);
  assert.equal(noBoards.rows.length, 0);
});

test("assigned comments target only assigned agents and keep the event payload", async () => {
  const { persistAgentWebhookEvents } = loadOutbox();
  const tx = fakeTransaction();

  const ids = await persistAgentWebhookEvents(tx, {
    event: "comment.created",
    agentIds: ["agent-a"],
    projectId: 15,
    taskId: 42,
    ticketNumber: "HTPR-42",
    taskTitle: "Webhook payload",
    commentId: 99,
    commentHtml: "<p>Plain comment</p>",
    actor,
    broadcast: false,
  });

  assert.equal(ids.length, 1);
  assert.equal(tx.rows[0].event, "comment.created");
  assert.equal(tx.rows[0].payload.agentId, "agent-a");
  assert.equal(tx.rows[0].payload.commentId, 99);
  assert.equal(tx.rows[0].payload.commentHtml, "<p>Plain comment</p>");
  assert.equal(tx.rows[0].payload.agentIds, undefined);
  assert.deepEqual(tx.subscriptionQueries[0].agentId, { in: ["agent-a"] });
});

test("task lifecycle payloads carry final assignees and before/after labels", async () => {
  const {
    persistAgentTaskCreatedWebhook,
    persistAgentTaskUpdatedWebhook,
  } = loadOutbox();
  const tx = fakeTransaction();
  const agentActor = { ...actor, agentId: "agent-a" };

  const createdIds = await persistAgentTaskCreatedWebhook(tx, {
    taskId: 42,
    actor: agentActor,
  });
  const createdPayload = tx.rows[0].payload;
  assert.equal(createdIds.length, 2);
  assert.deepEqual(createdPayload.actor, {
    userId: 6,
    agentId: "agent-a",
    displayName: "Agent A",
  });
  assert.deepEqual(createdPayload.assignees, [
    { userId: 6, agentId: "agent-a" },
    { userId: 7, agentId: null },
  ]);
  assert.deepEqual(createdPayload.labels, [
    { id: "label-1", value: "Urgent" },
  ]);
  assert.equal(tx.taskUpdates.length, 1);
  assert.ok(tx.taskUpdates[0].agentTaskCreatedEmittedAt instanceof Date);

  const updatedIds = await persistAgentTaskUpdatedWebhook(tx, {
    taskId: 42,
    actor: agentActor,
    changes: {
      labels: {
        from: [{ id: "label-1", value: "Urgent" }],
        to: [{ id: "label-2", value: "Needs review" }],
      },
    },
  });
  assert.equal(updatedIds.length, 2);
  const updatedPayload = tx.rows[2].payload;
  assert.equal(updatedPayload.event, "task.updated");
  assert.deepEqual(updatedPayload.changes.labels, {
    from: [{ id: "label-1", value: "Urgent" }],
    to: [{ id: "label-2", value: "Needs review" }],
  });
});

test("task update payloads omit labels from another board", async () => {
  const { persistAgentTaskUpdatedWebhook } = loadOutbox();
  const tx = fakeTransaction();

  await persistAgentTaskUpdatedWebhook(tx, {
    taskId: 42,
    actor,
    changes: {
      labels: {
        from: [{ id: "label-1", value: "Urgent" }],
        to: [{ id: "foreign-label", value: "Other board" }],
      },
    },
  });

  const payload = tx.rows[0].payload;
  assert.deepEqual(payload.changes.labels, {
    from: [{ id: "label-1", value: "Urgent" }],
    to: [],
  });
  assert.equal(payload.labelsRedacted, true);
  assert.equal(payload.changes.labelsRedacted, undefined);
  assert.doesNotMatch(JSON.stringify(payload), /Other board/);
});
