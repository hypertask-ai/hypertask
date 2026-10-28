const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const execution = loadModule("src/app/api/ai/_lib/heartbeatExecution.ts", {
  "@/lib/redis": { getRedis: async () => assert.fail("Unexpected Redis operation") },
});
const envelope = loadModule("src/lib/nativeAgent/heartbeatTurnEnvelope.ts");
const { hasValidCronAuthorization } = loadModule("src/lib/cronAuthorization.ts");
const originalEnv = { CRON_SECRET: process.env.CRON_SECRET, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };
test.beforeEach(() => {
  process.env.CRON_SECRET = "fixture-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://fixture.test";
});
test.afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function heartbeat(t, { avoidRepeatedWork = false, probeFails = false, pending = false } = {}) {
  const agent = { id: "native-1", userId: 985, displayName: "QA agent", heartbeatAt: null };
  const notifications = [];
  const messages = new Map();
  const executions = new Map();
  const streams = [];
  const usageRows = [];
  const errors = [];
  let now = Date.parse("2026-10-01T00:00:00.000Z");
  const inWindow = (after, through) => notifications.filter((item) =>
    envelope.isNotificationInHeartbeatWindow(item.createdAt, after?.toISOString() ?? null, through.toISOString()));
  const db = {
    agent: {
      findMany: async () => [{ ...agent }],
      findFirst: async ({ select }) => {
        if (probeFails) throw new Error("probe unavailable");
        const window = select.notificationsToAgent.where;
        return { notificationsToAgent: inWindow(window.after, window.through).slice(0, 1) };
      },
      updateMany: async ({ where, data }) => {
        if (where.heartbeatAt?.getTime() !== agent.heartbeatAt?.getTime()) return { count: 0 };
        agent.heartbeatAt = data.heartbeatAt;
        return { count: 1 };
      },
    },
    chatSession: { upsert: async () => ({ id: "session-1" }) },
    chatMessage: {
      findMany: async ({ where }) => where.id.in.flatMap((id) => messages.has(id) ? [messages.get(id)] : []),
      findUnique: async ({ where }) => messages.get(where.id) ?? null,
      create: async ({ data }) => { messages.set(data.id, data); return data; },
    },
    aiUsage: { create: async ({ data }) => { usageRows.push(data); return data; } },
    $queryRaw: async () => [{ databaseNow: new Date(now + 1_000) }],
    $transaction: async (callback) => callback(db),
  };
  const dependencies = {
    "next/server": { NextResponse: Response, after: () => {} },
    "@prisma/client": { Prisma: { sql: () => ({}), TransactionIsolationLevel: { Serializable: "Serializable" } } },
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/cronAuthorization": { hasValidCronAuthorization },
    "@/lib/ai/chatAlerts/service": { sweepAiChatAlerts: async () => {} },
    "@/utils/controllers/notifications/getStructuredInboxForAgent": {
      agentInboxVisibilityWhere: (_userId, window) => window,
      getStructuredInboxForAgent: async ({ window }) => ({ ok: true, notifications: inWindow(window.after, window.through) }),
    },
    "@/lib/flags": {
      HTPR_7042_NEON_WORK_AVOIDANCE_FLAG: "database-probe",
      isFeatureEnabled: async () => avoidRepeatedWork,
      withFeatureFlagSnapshot: (callback) => callback(),
    },
    "@/lib/realtime/server": { broadcastInboxChange: async () => {} },
    "@/app/api/ai/_lib/heartbeatExecution": {
      ...execution,
      getHeartbeatExecution: async (id) => executions.get(id) ?? null,
      reserveHeartbeatExecution: async (state) => { executions.set(state.executionId, state); return state; },
      completeHeartbeatExecution: async (id) => { executions.get(id).status = "completed"; },
      markHeartbeatNotificationDelivered: async (id) => { executions.get(id).notificationDelivered = true; },
    },
    "@/lib/aiAllowancePolicy": {},
    "./agentMessageDelivery": { deliverAgentMessageNotification: async () => "created" },
    "@/lib/nativeAgent/heartbeatTurnEnvelope": envelope,
  };
  const route = loadModule("src/app/api/cron/native-agent-heartbeat/route.ts", dependencies);
  t.mock.method(console, "error", (...args) => errors.push(args));
  t.mock.method(global, "fetch", async (url, options) => {
      const body = JSON.parse(options.body);
      const turn = envelope.decodeHeartbeatTurnMessage(body.message);
      assert.equal(url, "https://fixture.test/api/ai/chat/stream");
      assert.equal(options.headers["x-hypertask-heartbeat-execution-id"], turn.metadata.executionId);
      streams.push(turn);
      await db.aiUsage.create({ data: { feature: "chat", agentId: agent.id } });
      messages.set(body.assistant_message_id, { content: "New inbox work processed." });
      return new Response("event: done\ndata: {}\n\n");
  });
  if (pending) {
    agent.heartbeatAt = new Date(now - 60_000);
    const ids = execution.heartbeatExecutionIds(agent.id, agent.heartbeatAt);
    executions.set(ids.executionId, {
      ...ids, agentId: agent.id, userId: agent.userId,
      claimedAt: agent.heartbeatAt.toISOString(), updatedAt: new Date().toISOString(),
      status: "running", mutationStarted: true, notificationDelivered: false,
    });
  }
  return {
    agent, streams, usageRows, messages,
    addNotification: (createdAt = new Date(now)) => notifications.push({ id: notifications.length + 1, createdAt }),
    advance: () => { now += 15 * 60_000; },
    run: async (authorization = "Bearer fixture-secret") => {
      const response = await route.GET(new Request("https://fixture.test/api/cron/native-agent-heartbeat", {
        headers: { authorization },
      }));
      const body = await response.json();
      assert.equal(errors.length, 0, JSON.stringify(errors));
      return { status: response.status, body };
    },
  };
}

for (const avoidRepeatedWork of [false, true]) {
  test(`96 idle GET ticks create no model requests or usage; one new item runs once (probe ${avoidRepeatedWork})`, async (t) => {
    const h = heartbeat(t, { avoidRepeatedWork });
    for (let tick = 0; tick < 96; tick++) {
      assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 0, failed: [] } });
      assert.equal(h.agent.heartbeatAt.toISOString(), new Date(Date.parse("2026-10-01T00:00:00.000Z") + tick * 15 * 60_000).toISOString());
      h.advance();
    }
    assert.equal(h.streams.length, 0);
    assert.equal(h.usageRows.length, 0);
    assert.equal(h.messages.size, 0);
    h.addNotification();
    assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 1, failed: [] } });
    assert.equal(h.streams.length, 1);
    assert.deepEqual(h.usageRows, [{ feature: "chat", agentId: "native-1" }]);
    assert.equal(h.streams[0].metadata.previousHeartbeatAt, "2026-10-01T23:45:00.000Z");
    h.advance();
    assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 0, failed: [] } });
    assert.equal(h.streams.length, 1);
    assert.equal(h.usageRows.length, 1);
  });
}

test("a failed empty-inbox probe falls back without dropping new work", async (t) => {
  const h = heartbeat(t, { avoidRepeatedWork: true, probeFails: true });
  assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 0, failed: [] } });
  h.advance();
  h.addNotification();
  assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 1, failed: [] } });
  assert.equal(h.streams.length, 1);
  assert.equal(h.usageRows.length, 1);
});

test("work arriving after the scan watermark waits for the next tick", async (t) => {
  const h = heartbeat(t);
  h.addNotification(new Date("2026-10-01T00:00:00.001Z"));
  assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 0, failed: [] } });
  assert.equal(h.streams.length, 0);
  h.advance();
  assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 1, failed: [] } });
  assert.equal(h.streams.length, 1);
  assert.equal(h.streams[0].metadata.previousHeartbeatAt, "2026-10-01T00:00:00.000Z");
});

test("an active prior execution prevents another stream and preserves the cursor", async (t) => {
  const h = heartbeat(t, { pending: true });
  h.addNotification();
  assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 0, failed: [] } });
  assert.equal(h.agent.heartbeatAt.toISOString(), "2026-09-30T23:59:00.000Z");
  assert.equal(h.streams.length, 0);
  assert.equal(h.usageRows.length, 0);
});

test("unauthorized cron requests cannot advance the inbox cursor or call AI", async (t) => {
  const h = heartbeat(t);
  h.addNotification();
  assert.deepEqual(await h.run("Bearer wrong-secret"), { status: 401, body: { error: "unauthorized" } });
  assert.equal(h.agent.heartbeatAt, null);
  assert.equal(h.streams.length, 0);
  assert.deepEqual(await h.run(), { status: 200, body: { agents: 1, woken: 1, failed: [] } });
  assert.equal(h.streams.length, 1);
});
