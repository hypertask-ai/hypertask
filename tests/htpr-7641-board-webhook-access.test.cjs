const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function matches(row, where) {
  if (row == null) return false;
  return Object.entries(where).every(([field, filter]) => {
    if (["OR"].includes(field)) return filter.some((branch) => matches(row, branch));
    if (["AND"].includes(field)) return [filter].flat().every((branch) => matches(row, branch));
    const value = row[field];
    if (filter instanceof Date) return value instanceof Date && value.getTime() === filter.getTime();
    if (filter === null || typeof filter !== "object") return value === filter;
    if ("some" in filter) return (value ?? []).some((item) => matches(item, filter.some));
    if ("not" in filter) return value !== filter.not;
    if ("in" in filter) return filter.in.includes(value);
    if ("has" in filter) return (value ?? []).includes(filter.has);
    if ("isEmpty" in filter) return (value.length === 0) === filter.isEmpty;
    if ("lt" in filter) return value != null && value < filter.lt;
    if ("lte" in filter) return value != null && value <= filter.lte;
    return matches(value, filter);
  });
}

function harness({ agent = false, workspace = false } = {}) {
  const userId = 201;
  const team = { id: "team-1", googleAccount: { userId: 900 }, projects: [{ id: 101 }] };
  const agentRow = { id: "agent-1", userId, revokedAt: null, runtimeGeneration: 0, displayName: "Agent", credentialTeamId: null, credentialTeamAccessBinding: null };
  const project = {
    id: 101, teamId: team.id, team, ownerId: 100, status: "Normal",
    members: [{ userId, agentId: agent ? agentRow.id : null, status: "Accepted", agent: agentRow }],
  };
  const task = { id: 1001, projectId: 101, ticketNumber: "TEST-1", title: "Private task" };
  const subscription = {
    id: "sub-1", active: true, projectId: workspace ? null : project.id,
    teamId: workspace ? team.id : null, team: workspace ? team : null,
    createdById: userId, agentId: agent ? agentRow.id : null,
    events: ["comment.created"], supportsUnassignedEvent: true,
    url: "https://receiver.example.test/events", secret: "fixture-signing-secret",
  };
  const subscriptions = [subscription];
  const deliveries = [];
  const calls = { posts: [], cancelled: [], subscriptionUpdates: [], access: [], taskAccess: [], attempts: [] };
  const state = { team, project, task, subscription, subscriptions, deliveries, agent: agentRow };
  const db = {
    project: {
      findFirst: async ({ where }) => {
        calls.access.push(where);
        return matches(project, where) ? { id: project.id } : null;
      },
    },
    task: {
      findFirst: async ({ where }) => {
        calls.taskAccess.push(where);
        return matches(task, where) ? { id: task.id } : null;
      },
      updateMany: async () => ({ count: 0 }),
    },
    team: { findFirst: async ({ where }) => matches(team, where) ? { id: team.id } : null },
    webhookSubscription: {
      findMany: async ({ where }) => subscriptions.filter((row) => matches(row, where)),
      count: async ({ where }) => subscriptions.filter((row) => matches({ ...row, project }, where)).length,
      create: async ({ data }) => {
        Object.assign(subscription, data, {
          projectId: data.projectId ?? null, teamId: data.teamId ?? null,
          team: data.teamId ? team : null, project, createdBy: { displayName: "Team owner" },
          createdAt: new Date(), lastDeliveryAt: null, lastDeliveryOk: null,
        });
        return subscription;
      },
      update: async () => ({}),
      updateMany: async ({ where, data }) => {
        calls.subscriptionUpdates.push({ where, data });
        const rows = subscriptions.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    boardWebhookDelivery: {
      create: async ({ data }) => {
        const row = { status: "pending", attemptCount: 0, nextAttemptAt: new Date(0), processingAt: null, ...data };
        deliveries.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const rows = deliveries.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      findFirst: async ({ where }) => {
        const row = deliveries.find((candidate) => matches(candidate, where));
        return row ? { ...row, subscription } : null;
      },
      update: async ({ where, data }) => {
        const row = deliveries.find((candidate) => matches(candidate, where));
        Object.assign(row, data);
        if (["cancelled"].includes(data.status)) calls.cancelled.push(row.id);
        return row;
      },
    },
    boardWebhookAttempt: { create: async ({ data }) => { calls.attempts.push(data); return data; } },
    agent: {
      findUnique: async ({ where }) => state.agent && matches(state.agent, where) ? state.agent : null,
      findFirst: async ({ where }) => state.agent && matches(state.agent, where) ? state.agent : null,
      updateMany: async () => ({ count: state.agent ? 1 : 0 }),
      delete: async () => { state.agent = null; return agentRow; },
    },
    member: {
      deleteMany: async ({ where }) => {
        const previous = project.members.length;
        project.members = project.members.filter((member) => !matches(member, where));
        return { count: previous - project.members.length };
      },
    },
    $transaction: async (callback) => callback(db),
    $executeRaw: async () => 0,
  };
  for (const model of [
    "assignees", "comment", "follower", "taskLease", "section", "page", "report", "taskEvidence",
    "taskSession", "decisionRequest", "description", "priority", "estimate", "notification",
    "oAuthAuthorizationCode", "chatSession",
  ]) {
    db[model] = { updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }) };
  }
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true },
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/agents/visibility": {},
    "@/lib/cycles": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
    "@/lib/mcp/managementKeyTeamScope": {},
    "./delivery": {
      postSignedWebhook: async (input) => {
        calls.posts.push(input);
        return { ok: true, statusCode: 200, durationMs: 1 };
      },
    },
    "./queue": { queueBoardWebhookDelivery: async () => {} },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/flags/definitions/htpr-7624-sealed-webhook-keys": { SEALED_WEBHOOK_KEYS_FLAG: "fixture" },
    "@/lib/webhooks/signingKeyStore": { webhookSigningKeyHint: () => "fixture" },
    "./ssrfGuard": { assertSafeWebhookTarget: async () => ({ ok: true }) },
  };
  const sender = load("src/lib/mcp/webhooks/outboxDelivery.ts", mocks);
  const outbox = load("src/lib/mcp/webhooks/outbox.ts", mocks);
  const ownedAgents = load("src/lib/mcp/agents/ownedAgents.ts", mocks);
  const acl = load("src/utils/controllers/projects/getAllIncludes.ts", mocks);
  return {
    state, calls,
    canRead: () => matches(project, acl.getProjectWhere(userId, subscription.agentId)),
    enqueue: () => outbox.persistBoardWebhookEvent(db, project.id, {
      event: "comment.created",
      data: {
        task: { ...task }, comment: { id: 77, text: "Private comment", createdAt: "2026-01-01T00:00:00Z" },
        actor: { userId: 100, agentId: null },
      },
    }),
    deliver: (id) => sender.deliverBoardWebhook(id),
    deleteAgent: () => ownedAgents.deleteOwnedAgent(db, userId, agentRow.id),
    createWorkspace: () => load("src/lib/mcp/webhooks/workspaceManagement.ts", mocks).createWorkspaceWebhook({
      userId, teamId: team.id, projectId: project.id,
      url: subscription.url, events: ["comment.created"],
    }),
  };
}

async function assertCancelled(h, id) {
  assert.deepEqual(await h.deliver(id), { status: "skipped" });
  assert.equal(h.calls.posts.length, 0);
  assert.deepEqual(h.calls.cancelled, [id]);
  assert.equal(h.state.deliveries.find((row) => row.id === id).status, "cancelled");
  assert.equal(h.state.deliveries.find((row) => row.id === id).processingAt, null);
  assert.equal(h.calls.attempts.length, 0);
}

async function assertDelivered(h, id) {
  const original = h.state.deliveries.find((row) => row.id === id).payloadBody;
  assert.deepEqual(await h.deliver(id), { status: "delivered", statusCode: 200 });
  assert.equal(h.calls.posts.length, 1);
  assert.equal(h.calls.posts[0].body, original);
  assert.equal(h.calls.posts[0].url, h.state.subscription.url);
  assert.equal(h.calls.posts[0].secret, h.state.subscription.secret);
  assert.match(h.calls.posts[0].body, /Private comment/);
  assert.equal(h.calls.attempts.length, 1);
}

for (const retry of [false, true]) {
  const mode = retry ? "queued retry" : "new event";

  test(`board webhook ${mode}: removed member now refused`, async () => {
    const h = harness();
    let ids;
    if (retry) ids = await h.enqueue();
    h.state.project.members = [];
    assert.equal(h.canRead(), false);
    if (!retry) ids = await h.enqueue();
    assert.equal(ids.length, 1);
    if (retry) Object.assign(h.state.deliveries[0], { status: "retrying", attemptCount: 1 });
    await assertCancelled(h, ids[0]);
  });

  test(`board webhook ${mode}: current member still allowed`, async () => {
    const h = harness();
    const [id] = await h.enqueue();
    if (retry) Object.assign(h.state.deliveries[0], { status: "retrying", attemptCount: 1 });
    assert.equal(h.canRead(), true);
    await assertDelivered(h, id);
  });

  test(`board webhook ${mode}: revoked agent now refused even when its human owns the team`, async () => {
    const h = harness({ agent: true });
    h.state.team.googleAccount.userId = 201;
    let ids;
    if (retry) ids = await h.enqueue();
    h.state.agent.revokedAt = new Date();
    assert.equal(h.canRead(), false);
    if (!retry) ids = await h.enqueue();
    if (retry) Object.assign(h.state.deliveries[0], { status: "retrying", attemptCount: 1 });
    await assertCancelled(h, ids[0]);
  });

  test(`board webhook ${mode}: active agent still allowed`, async () => {
    const h = harness({ agent: true });
    const [id] = await h.enqueue();
    if (retry) Object.assign(h.state.deliveries[0], { status: "retrying", attemptCount: 1 });
    assert.equal(h.canRead(), true);
    await assertDelivered(h, id);
  });

  test(`board webhook ${mode}: task moved to another board now refused`, async () => {
    const h = harness();
    const [id] = await h.enqueue();
    h.state.task.projectId = 102;
    assert.equal(h.canRead(), true);
    if (retry) Object.assign(h.state.deliveries[0], { status: "retrying", attemptCount: 1 });
    await assertCancelled(h, id);
  });

  test(`board webhook ${mode}: task on subscribed board still allowed`, async () => {
    const h = harness();
    const [id] = await h.enqueue();
    if (retry) Object.assign(h.state.deliveries[0], { status: "retrying", attemptCount: 1 });
    await assertDelivered(h, id);
  });
}

test("board webhook: deleted agent pending retry now refused without human promotion", async () => {
  const h = harness({ agent: true });
  h.state.project.members.push({ userId: 201, agentId: null, status: "Accepted" });
  const [id] = await h.enqueue();
  h.state.agent.revokedAt = new Date();
  const workspace = { ...h.state.subscription, id: "workspace-sub", projectId: null, teamId: "team-1", team: h.state.team };
  h.state.subscriptions.push(workspace);
  assert.equal((await h.deleteAgent()).id, "agent-1");
  assert.equal(h.state.agent, null);
  assert.equal(h.state.subscription.agentId, null);
  assert.equal(h.state.subscription.active, false);
  assert.equal(h.canRead(), true, "the surviving human must not inherit the agent endpoint");
  assert.equal(workspace.agentId, null);
  assert.equal(workspace.active, true, "null-project subscriptions retain existing policy");
  assert.deepEqual(h.calls.subscriptionUpdates, [
    { where: { agentId: "agent-1", projectId: { not: null } }, data: { active: false } },
    { where: { agentId: "agent-1" }, data: { agentId: null } },
  ]);
  Object.assign(h.state.deliveries[0], { status: "retrying", attemptCount: 1 });
  await assertCancelled(h, id);
  h.state.subscriptions.splice(1);
  assert.deepEqual(await h.enqueue(), [], "deleted agent endpoint cannot select new events");
});

test("board webhook: retained active agent still allowed with human membership", async () => {
  const h = harness({ agent: true });
  h.state.project.members.push({ userId: 201, agentId: null, status: "Accepted" });
  const [id] = await h.enqueue();
  await assertDelivered(h, id);
});

test("board webhook: former workspace team owner now refused", async () => {
  const h = harness();
  h.state.project.members = [];
  h.state.team.googleAccount.userId = 201;
  await h.createWorkspace();
  const [id] = await h.enqueue();
  h.state.team.googleAccount.userId = 900;
  await assertCancelled(h, id);
});

test("board webhook: workspace team-owner board endpoint still allowed without board membership", async () => {
  const h = harness();
  h.state.project.members = [];
  h.state.team.googleAccount.userId = 201;
  await h.createWorkspace();
  assert.equal(h.state.subscription.projectId, 101);
  assert.equal(h.state.subscription.teamId, null);
  assert.equal(h.state.subscription.agentId, null);
  assert.equal(h.canRead(), false);
  const [id] = await h.enqueue();
  await assertDelivered(h, id);
});

test("board webhook: missing creator now refused", async () => {
  const h = harness();
  const [id] = await h.enqueue();
  h.state.subscription.createdById = null;
  await assertCancelled(h, id);
});

test("board webhook: current creator still allowed", async () => {
  const h = harness();
  const [id] = await h.enqueue();
  await assertDelivered(h, id);
});

test("board webhook: workspace null-project subscription still allowed with no creator or board access", async () => {
  const h = harness({ workspace: true });
  const [id] = await h.enqueue();
  h.state.project.members = [];
  h.state.subscription.createdById = null;
  h.state.task.projectId = 102;
  await assertDelivered(h, id);
  assert.equal(h.calls.access.length, 0);
  assert.equal(h.calls.taskAccess.length, 0);
});
