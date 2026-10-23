const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function matches(row, where) {
  if (row == null) return false;
  return Object.entries(where).every(([field, filter]) => {
    if (["OR"].includes(field)) return filter.some((branch) => matches(row, branch));
    const value = row[field];
    if (filter === null || typeof filter !== "object") return value === filter;
    if ("some" in filter) return (value ?? []).some((item) => matches(item, filter.some));
    if ("not" in filter) return value !== filter.not;
    if ("in" in filter) return filter.in.includes(value);
    if ("lt" in filter) return value != null && value < filter.lt;
    if ("lte" in filter) return value != null && value <= filter.lte;
    return matches(value, filter);
  });
}

function harness({ projectId = 101, taskId = 1001, subscriptionProjectId = 101 } = {}) {
  const agent = { id: "agent-1", userId: 201, revokedAt: null, credentialTeamId: null, credentialTeamAccessBinding: null };
  const project = {
    id: 101, ownerId: agent.userId, status: "Normal",
    members: [{ id: 1, projectId: 101, agentId: agent.id, userId: agent.userId, status: "Accepted" }],
  };
  const task = { id: 1001, projectId: project.id, status: "Normal" };
  const subscription = {
    id: "sub-1", agentId: agent.id, projectId: subscriptionProjectId, active: true,
    events: ["comment.mention", "chat.message"],
    url: "https://receiver.example.test/events", secret: "fixture-signing-secret",
  };
  const deliveries = [];
  const calls = { posts: [], queued: [], access: [], taskAccess: [], cancelled: [] };
  const state = {
    agent, project, task, subscription, deliveries,
    postResult: { ok: true, statusCode: 200, error: null },
  };
  const db = {
    agent: {
      findUnique: async ({ where }) => matches(agent, where) ? { ...agent } : null,
    },
    project: {
      findFirst: async ({ where }) => {
        calls.access.push(where);
        return matches(project, where) ? { id: project.id } : null;
      },
    },
    task: {
      findFirst: async ({ where }) => {
        calls.taskAccess.push(where);
        return matches(state.task, where) ? { id: state.task.id } : null;
      },
    },
    agentWebhookSubscription: {
      findUnique: async ({ where, select }) => {
        if (!matches(subscription, where)) return null;
        const memberWhere = select.agent.select.members.where;
        return {
          ...subscription,
          agent: {
            ...agent,
            members: project.members.filter((member) =>
              member.agentId === agent.id && matches(member, memberWhere)),
          },
        };
      },
      update: async ({ data }) => Object.assign(subscription, data),
    },
    agentWebhookDelivery: {
      create: async ({ data }) => {
        const row = {
          status: "pending", attemptCount: 0, processingAt: null,
          nextAttemptAt: new Date(0), ...data,
        };
        deliveries.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const rows = deliveries.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      findUnique: async ({ where }) => {
        const row = deliveries.find((candidate) => matches(candidate, where));
        return row ? { ...row, subscription: { ...subscription, agent: { ...agent } } } : null;
      },
      findFirst: async ({ where }) => {
        const row = deliveries.find((candidate) => matches(candidate, where));
        return row ? { ...row, subscription: { ...subscription } } : null;
      },
      update: async ({ where, data }) => {
        const row = deliveries.find((candidate) => matches(candidate, where));
        assert.ok(row);
        Object.assign(row, data);
        if (["cancelled"].includes(data.status)) calls.cancelled.push(row.id);
        return row;
      },
    },
    $transaction: async (input) => Array.isArray(input) ? Promise.all(input) : input(db),
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@prisma/client": { Status: { Deleted: "Deleted" } },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/agentRuns/model": { AGENT_RUN_FEATURE_FLAG: "fixture-agent-runs" },
    "@/lib/mcp/webhooks/delivery": {
      postSignedWebhook: async (input) => {
        calls.posts.push(input);
        return state.postResult;
      },
    },
    "./queue": { queueAgentWebhookDelivery: async (id) => { calls.queued.push(id); } },
  };
  const sender = load("src/lib/agentWebhooks/delivery.ts", mocks);
  const outbox = load("src/lib/agentWebhooks/outbox.ts", mocks);
  return {
    state, calls,
    enqueue: () => outbox.persistAgentWebhookEvent(db, {
      event: taskId == null && projectId == null ? "chat.message" : "comment.mention",
      agentId: agent.id, projectId, taskId,
      taskTitle: taskId == null ? null : "Private task",
      ticketNumber: taskId == null ? null : "TEST-1",
      actor: { userId: 100, displayName: "Author" },
      ...(taskId == null
        ? { chat: { sessionId: "session-1", messageId: "message-1", text: "Hello", userName: "Author" } }
        : { commentHtml: "<p>Private comment</p>" }),
    }),
    deliver: (id) => sender.deliverAgentWebhook(id),
    replay: (id) => outbox.replayAgentWebhookDelivery({ deliveryId: id, subscriptionId: subscription.id }),
  };
}

async function assertCancelled(h, id) {
  assert.equal(typeof id, "string");
  const postsBefore = h.calls.posts.length;
  const queuedBefore = h.calls.queued.length;
  const row = h.state.deliveries.find((delivery) => delivery.id === id);
  const attemptsBefore = row.attemptCount;
  assert.deepEqual(await h.deliver(id), { status: "skipped" });
  assert.equal(h.calls.posts.length, postsBefore);
  assert.equal(h.calls.queued.length, queuedBefore);
  assert.ok(h.calls.cancelled.includes(id));
  assert.equal(row.status, "cancelled");
  assert.equal(row.processingAt, null);
  assert.equal(row.attemptCount, attemptsBefore);
}

async function assertDelivered(h, id) {
  assert.equal(typeof id, "string");
  const row = h.state.deliveries.find((delivery) => delivery.id === id);
  const originalBody = JSON.stringify(row.payload);
  const postsBefore = h.calls.posts.length;
  assert.deepEqual(await h.deliver(id), { status: "delivered", statusCode: 200 });
  assert.equal(h.calls.posts.length, postsBefore + 1);
  assert.deepEqual(h.calls.posts.at(-1), {
    url: h.state.subscription.url, secret: h.state.subscription.secret,
    event: row.event, deliveryId: id, body: originalBody,
  });
  assert.equal(row.status, "delivered");
  assert.equal(row.processingAt, null);
}

async function prepareDelivery(h, mode) {
  const id = await h.enqueue();
  assert.equal(typeof id, "string", "the real fanout must initially authorize this event");
  if (["retrying"].includes(mode)) {
    h.state.postResult = { ok: false, statusCode: 503, error: "Temporarily unavailable" };
    assert.equal((await h.deliver(id)).status, "retrying");
    assert.equal(h.calls.posts.length, 1);
    assert.equal(h.state.deliveries[0].attemptCount, 1);
    h.state.deliveries[0].nextAttemptAt = new Date(0);
    h.state.postResult = { ok: true, statusCode: 200, error: null };
  }
  if (["replay"].includes(mode)) await assertDelivered(h, id);
  return id;
}

for (const mode of ["pending", "retrying", "replay"]) {
  test(`agent webhook ${mode} delivery after membership removal now refused`, async () => {
    const h = harness();
    const sourceId = await prepareDelivery(h, mode);
    h.state.project.members = [{ id: 2, projectId: 101, userId: 201, agentId: null }];
    assert.equal(await h.enqueue(), null, "the human owner's membership must not authorize the agent");
    const id = ["replay"].includes(mode) ? await h.replay(sourceId) : sourceId;
    await assertCancelled(h, id);
    assert.deepEqual(h.calls.access.at(-1), {
      id: 101, status: { not: "Deleted" }, members: { some: { agentId: "agent-1" } },
    });
  });

  test(`agent webhook ${mode} delivery: agent still a member still allowed`, async () => {
    const h = harness();
    const sourceId = await prepareDelivery(h, mode);
    const id = ["replay"].includes(mode) ? await h.replay(sourceId) : sourceId;
    await assertDelivered(h, id);
  });
}

for (const [reason, mutate] of [
  ["task moved to another board", (h) => { h.state.task.projectId = 102; }],
  ["deleted task", (h) => { h.state.task.status = "Deleted"; }],
  ["deleted board", (h) => { h.state.project.status = "Deleted"; }],
  ["subscription board changed", (h) => { h.state.subscription.projectId = 102; }],
  ["missing task", (h) => { h.state.task = null; }],
]) {
  test(`agent webhook: ${reason} now refused`, async () => {
    const h = harness();
    const id = await h.enqueue();
    mutate(h);
    await assertCancelled(h, id);
  });

  test(`agent webhook: unchanged board and task still allowed (${reason} control)`, async () => {
    const h = harness();
    await assertDelivered(h, await h.enqueue());
  });
}

for (const subscriptionProjectId of [101, null]) {
  test(`agent webhook: board-only payload after removal now refused (subscription ${subscriptionProjectId})`, async () => {
    const h = harness({ taskId: null, subscriptionProjectId });
    const id = await h.enqueue();
    h.state.project.members = [];
    await assertCancelled(h, id);
  });

  test(`agent webhook: board-only payload with current membership still allowed (subscription ${subscriptionProjectId})`, async () => {
    const h = harness({ taskId: null, subscriptionProjectId });
    await assertDelivered(h, await h.enqueue());
    assert.equal(h.calls.taskAccess.length, 0);
  });
}

test("agent webhook: subscription-only board scope after removal now refused", async () => {
  const h = harness({ projectId: null, taskId: null });
  const id = await h.enqueue();
  h.state.project.members = [];
  await assertCancelled(h, id);
});

test("agent webhook: subscription-only board scope with current membership still allowed", async () => {
  const h = harness({ projectId: null, taskId: null });
  await assertDelivered(h, await h.enqueue());
});

test("agent webhook: task without an identifiable board now refused", async () => {
  const h = harness({ projectId: null, subscriptionProjectId: null });
  await assertCancelled(h, await h.enqueue());
});

test("agent webhook: task on an identifiable board still allowed", async () => {
  const h = harness({ subscriptionProjectId: null });
  await assertDelivered(h, await h.enqueue());
});

test("agent webhook: revoked agent now refused and still cancelled as before", async () => {
  const h = harness();
  const id = await h.enqueue();
  h.state.agent.revokedAt = new Date();
  await assertCancelled(h, id);
  assert.equal(h.calls.access.length, 0);
});

test("agent webhook: active agent still allowed", async () => {
  const h = harness();
  await assertDelivered(h, await h.enqueue());
});

test("agent webhook: inactive subscription now refused", async () => {
  const h = harness();
  const id = await h.enqueue();
  h.state.subscription.active = false;
  await assertCancelled(h, id);
  assert.equal(h.calls.access.length, 0);
});

test("agent webhook: active subscription still allowed", async () => {
  const h = harness();
  await assertDelivered(h, await h.enqueue());
});

test("agent webhook: non-board agent event still allowed after all memberships removed", async () => {
  const h = harness({ projectId: null, taskId: null, subscriptionProjectId: null });
  const id = await h.enqueue();
  h.state.project.members = [];
  await assertDelivered(h, id);
  assert.equal(h.calls.access.length, 0);
  assert.equal(h.calls.taskAccess.length, 0);
});

test("agent webhook: archived task and board still allowed", async () => {
  const h = harness();
  const id = await h.enqueue();
  h.state.task.status = "Archive";
  h.state.project.status = "Archive";
  await assertDelivered(h, id);
});
