const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function harness({ removeAt, ok = true, attemptCount = 0, authorized = true, persistenceError } = {}) {
  let exists = true;
  const queued = [];
  const sent = [];
  const row = {
    id: "delivery", subscriptionId: "subscription", event: "webhook.test",
    payload: {}, attemptCount, status: "pending", processingAt: null,
    nextAttemptAt: new Date(0),
    subscription: { active: true, agentId: "agent", projectId: null,
      url: "https://receiver.example.test/hook", secret: "fixture",
      agent: { revokedAt: null, userId: 42 } },
  };
  const db = {
    agentWebhookDelivery: {
      updateMany: async ({ data }) => {
        if (persistenceError && data.status !== "processing") throw persistenceError;
        if (!exists) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ data }) => {
        if (!exists) throw Object.assign(new Error("No record was found for an update"), { code: "P2025" });
        Object.assign(row, data);
        return row;
      },
      findUnique: async () => exists ? { ...row } : null,
    },
    agentWebhookSubscription: {
      updateMany: async () => ({ count: exists ? 1 : 0 }),
      update: async () => {
        if (!exists) throw Object.assign(new Error("Subscription was deleted"), { code: "P2025" });
        return {};
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  const worker = load("src/lib/agentWebhooks/delivery.ts", {
    "@/lib/prisma": { default: db },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/webhooks/credentialScope": { webhookCredentialAllows: async () => {
      if (removeAt === "authorization") exists = false;
      return authorized;
    } },
    "@/lib/mcp/webhooks/delivery": { postSignedWebhook: async (input) => {
      sent.push(input);
      if (removeAt === "send") exists = false;
      return { ok, statusCode: ok ? 204 : 503, error: ok ? null : "unavailable" };
    } },
    "./queue": { queueAgentWebhookDelivery: async (...args) => queued.push(args) },
  });
  return { row, queued, sent, run: () => worker.deliverAgentWebhook(row.id) };
}

for (const ok of [true, false]) {
  for (const attemptCount of [0, 3]) {
    test(`subscription deleted during send is skipped (ok=${ok}, attempts=${attemptCount})`, async (t) => {
      const errors = [];
      t.mock.method(console, "error", (...args) => errors.push(args));
      const h = harness({ removeAt: "send", ok, attemptCount });
      assert.deepEqual(await h.run(), { status: "skipped" });
      assert.equal(h.sent.length, 1);
      assert.deepEqual(h.queued, []);
      assert.deepEqual(errors, []);
    });
  }
}

test("deletion during authorization does not make cancellation throw", async () => {
  const h = harness({ removeAt: "authorization", authorized: false });
  assert.deepEqual(await h.run(), { status: "skipped" });
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.queued, []);
});

test("existing delivery still succeeds and releases its processing lease", async () => {
  const h = harness();
  assert.deepEqual(await h.run(), { status: "delivered", statusCode: 204 });
  assert.equal(h.row.status, "delivered");
  assert.equal(h.row.attemptCount, 1);
  assert.equal(h.row.processingAt, null);
  assert.deepEqual(h.queued, []);
});

test("existing failed delivery still increments attempts and queues a retry", async () => {
  const h = harness({ ok: false });
  assert.deepEqual(await h.run(), { status: "retrying", statusCode: 503, error: "unavailable" });
  assert.equal(h.row.attemptCount, 1);
  assert.equal(h.row.processingAt, null);
  assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0][0], "delivery");
});

test("unrelated persistence failures still reject delivery", async () => {
  const failure = new Error("database unavailable");
  const h = harness({ persistenceError: failure });
  await assert.rejects(h.run(), (error) => error === failure);
  assert.deepEqual(h.queued, []);
});
