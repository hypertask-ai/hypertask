const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const queued = [];
const messages = [
  { id: "message-failed", isDelivered: true },
  { id: "message-pending", isDelivered: true },
  { id: "message-acknowledged", isDelivered: true },
];
let subscriptionDeleted = false;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const delivery = {
  id: "delivery-failed",
  event: "chat.message",
  payload: {
    event: "chat.message",
    chat: { sessionId: "session-1", messageId: "message-failed", text: "Hello" },
  },
  status: "pending",
  attemptCount: 0,
  nextAttemptAt: new Date(0),
  subscriptionId: "subscription-1",
  subscription: {
    id: "subscription-1",
    active: true,
    url: "https://dead.example/webhook",
    secret: "secret",
    agent: { revokedAt: null, userId: 7 },
  },
};

const transaction = {
  $executeRaw: async () => {
    messages.find(
      (message) => message.id === "message-pending",
    ).isDelivered = false;
    return 1;
  },
  agentWebhookDelivery: {
    update: async ({ data }) => Object.assign(delivery, data),
  },
  agentWebhookSubscription: {
    update: async () => ({}),
    delete: async () => {
      subscriptionDeleted = true;
    },
  },
  chatMessage: {
    updateMany: async ({ where, data }) => {
      const ids = where.id.in ?? [where.id];
      for (const message of messages.filter((candidate) => ids.includes(candidate.id))) {
        Object.assign(message, data);
      }
      return { count: ids.length };
    },
  },
};

const prisma = {
  agentWebhookDelivery: {
    updateMany: async () => ({ count: 1 }),
    findUnique: async () => delivery,
    update: transaction.agentWebhookDelivery.update,
  },
  agentWebhookSubscription: transaction.agentWebhookSubscription,
  chatMessage: transaction.chatMessage,
  $transaction: async (operation) =>
    typeof operation === "function" ? operation(transaction) : Promise.all(operation),
};

stubModule("src/lib/prisma.ts", { default: prisma });
stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => true });
stubModule("src/lib/mcp/webhooks/delivery.ts", {
  postSignedWebhook: async () => ({
    ok: false,
    statusCode: 503,
    error: "Receiver returned HTTP 503",
  }),
});
stubModule("src/lib/agentWebhooks/queue.ts", {
  queueAgentWebhookDelivery: async (id) => queued.push(id),
});

const agentDelivery = createJiti(
  path.join(root, "tests/agent-webhook-chat-recovery-entry.cjs"),
  { alias: { "@": path.join(root, "src") }, interopDefault: true },
)(path.join(root, "src/lib/agentWebhooks/delivery.ts"));

test.beforeEach(() => {
  delivery.status = "pending";
  delivery.attemptCount = 0;
  delivery.processingAt = null;
  delivery.deliveredAt = null;
  messages.forEach((message) => {
    message.isDelivered = true;
  });
  queued.length = 0;
  subscriptionDeleted = false;
});

test("a failed chat webhook returns the message to polling without another webhook attempt", async () => {
  const result = await agentDelivery.deliverAgentWebhook(delivery.id);

  assert.equal(result.status, "failed");
  assert.equal(delivery.status, "failed");
  assert.equal(messages[0].isDelivered, false);
  assert.deepEqual(queued, []);
});

test("deleting a webhook releases its unacknowledged chat messages", async () => {
  await agentDelivery.deleteAgentWebhookSubscription("subscription-1");

  assert.equal(subscriptionDeleted, true);
  assert.equal(messages[1].isDelivered, false);
  assert.equal(messages[2].isDelivered, true);
});
