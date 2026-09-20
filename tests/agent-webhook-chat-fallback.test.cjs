const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loadId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadDelivery({ webhookResult, delivery }) {
  const messageUpdates = [];
  const queued = [];
  const prisma = {
    agentWebhookDelivery: {
      updateMany: async ({ data }) => {
        Object.assign(delivery, data);
        return { count: 1 };
      },
      findUnique: async () => delivery,
      update: async ({ data }) => Object.assign(delivery, data),
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
    agentWebhookSubscription: {
      update: async () => ({}),
    },
    chatMessage: {
      updateMany: async (args) => {
        messageUpdates.push(args);
        return { count: 1 };
      },
    },
    $transaction: async (operation) =>
      typeof operation === "function" ? operation(prisma) : Promise.all(operation),
  };
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => true });
  stubModule("src/lib/mcp/webhooks/delivery.ts", {
    postSignedWebhook: async () => webhookResult,
  });
  stubModule("src/lib/agentWebhooks/queue.ts", {
    queueAgentWebhookDelivery: async (...args) => queued.push(args),
  });

  const deliveryPath = path.join(root, "src/lib/agentWebhooks/delivery.ts");
  delete require.cache[deliveryPath];
  const deliveryModule = createJiti(
    path.join(root, `tests/agent-webhook-chat-fallback-delivery-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(deliveryPath);
  return { ...deliveryModule, messageUpdates, queued };
}

function chatDelivery() {
  return {
    id: "delivery-1",
    event: "chat.message",
    payload: {
      event: "chat.message",
      chat: { messageId: "message-1", sessionId: "session-1", text: "Hello" },
    },
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: new Date(0),
    subscriptionId: "subscription-1",
    subscription: {
      id: "subscription-1",
      active: true,
      url: "https://agent.example/webhook",
      secret: "secret",
      agent: { revokedAt: null, userId: 6 },
    },
  };
}

test("a failed chat webhook releases the message to polling without another webhook attempt", async () => {
  const delivery = chatDelivery();
  const { deliverAgentWebhook, messageUpdates, queued } = loadDelivery({
    delivery,
    webhookResult: {
      ok: false,
      statusCode: 503,
      error: "Receiver returned HTTP 503",
      durationMs: 20,
    },
  });

  const result = await deliverAgentWebhook(delivery.id);

  assert.equal(result.status, "failed");
  assert.equal(delivery.status, "failed");
  assert.deepEqual(messageUpdates, [
    {
      where: { id: "message-1", role: "human" },
      data: { isDelivered: false },
    },
  ]);
  assert.deepEqual(queued, []);
});

test("a successful chat webhook acknowledges the message", async () => {
  const delivery = chatDelivery();
  const { deliverAgentWebhook, messageUpdates } = loadDelivery({
    delivery,
    webhookResult: { ok: true, statusCode: 204, error: null, durationMs: 12 },
  });

  const result = await deliverAgentWebhook(delivery.id);

  assert.equal(result.status, "delivered");
  assert.deepEqual(messageUpdates, [
    {
      where: { id: "message-1", role: "human" },
      data: { isDelivered: true },
    },
  ]);
});

test("deleting a webhook releases every outstanding chat message before deliveries cascade", async () => {
  const messageUpdates = [];
  const deleted = [];
  const subscription = {
    id: "subscription-1",
    agentId: "agent-a",
    deliveries: [],
  };
  const tx = {
    agentWebhookDelivery: {
      findMany: async () => [
        { payload: { chat: { messageId: "message-1" } } },
        { payload: { chat: { messageId: "message-2" } } },
      ],
    },
    chatMessage: {
      updateMany: async (args) => {
        messageUpdates.push(args);
        return { count: 2 };
      },
    },
    agentWebhookSubscription: {
      delete: async ({ where }) => deleted.push(where),
    },
  };
  const prisma = {
    agent: { findFirst: async () => ({ id: "agent-a" }) },
    agentWebhookSubscription: { findUnique: async () => subscription },
    $transaction: async (operation) => operation(tx),
  };
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => false });
  stubModule("src/lib/mcp/webhooks/ssrfGuard.ts", {
    assertSafeWebhookTarget: async () => ({ ok: true }),
  });
  stubModule("src/utils/controllers/agents/boardMembers.ts", {
    isAgentOnBoard: async () => true,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
  });
  stubModule("src/lib/agentWebhooks/outbox.ts", {
    createAgentWebhookTestDelivery: async () => "test-delivery",
    replayAgentWebhookDelivery: async () => "replay-delivery",
  });

  const managementPath = path.join(root, "src/lib/agentWebhooks/management.ts");
  delete require.cache[managementPath];
  const { manageAgentWebhook } = createJiti(
    path.join(root, `tests/agent-webhook-chat-fallback-management-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(managementPath);

  const result = await manageAgentWebhook({
    userId: 6,
    agentId: "agent-a",
    action: "delete",
  });

  assert.equal(result.deleted, subscription.id);
  assert.deepEqual(messageUpdates, [
    {
      where: { id: { in: ["message-1", "message-2"] }, role: "human" },
      data: { isDelivered: false },
    },
  ]);
  assert.deepEqual(deleted, [{ id: subscription.id }]);
});
