const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

/**
 * Load the outbox module against a fake database that records every write.
 *
 * A worker can POST successfully and then die before persisting the result. The
 * sweep must treat that abandoned claim as a spent attempt, otherwise the same
 * event is redelivered forever even though the row advertises a six-attempt
 * limit.
 */
const load = () => {
  const updates = [];
  const prisma = {
    boardWebhookDelivery: {
      updateMany: async ({ where, data }) => {
        updates.push({ where, data });
        return { count: 1 };
      },
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
      findFirst: async () => null,
      update: async () => ({}),
    },
    webhookSubscription: { update: async () => ({}) },
    $transaction: async (operation) => operation(prisma),
  };

  const files = [
    "src/lib/prisma.ts",
    "src/lib/mcp/webhooks/delivery.ts",
    "src/lib/mcp/webhooks/queue.ts",
    "src/lib/mcp/webhooks/outboxDelivery.ts",
  ];
  for (const file of files) delete require.cache[path.join(root, file)];
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/lib/mcp/webhooks/delivery.ts", {
    postSignedWebhook: async () => ({ ok: true, statusCode: 200, error: null }),
  });
  stubModule("src/lib/mcp/webhooks/queue.ts", {
    queueBoardWebhookDelivery: async () => ({}),
  });

  const jiti = require("jiti")(
    path.join(root, `tests/board-webhook-attempt-limit-${++loadId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return {
    updates,
    module: jiti(path.join(root, "src/lib/mcp/webhooks/outboxDelivery.ts")),
  };
};

test("reclaiming a stale lease spends an attempt", async () => {
  const { updates, module } = load();
  await module.sweepBoardWebhookDeliveries();

  const reclaim = updates.find((u) => u.where.status === "processing");
  assert.ok(reclaim, "the sweep must reclaim stale processing rows");
  assert.deepEqual(
    reclaim.data.attemptCount,
    { increment: 1 },
    "an abandoned claim counts against BOARD_WEBHOOK_MAX_ATTEMPTS",
  );
});

test("a reclaimed row past the attempt limit is failed, not retried", async () => {
  const { updates, module } = load();
  await module.sweepBoardWebhookDeliveries();

  const giveUp = updates.find((u) => u.data.status === "failed");
  assert.ok(giveUp, "rows at the attempt limit must stop retrying");
  assert.deepEqual(giveUp.where.attemptCount, {
    gte: module.BOARD_WEBHOOK_MAX_ATTEMPTS,
  });
});

test("a delivery at the attempt limit cannot be claimed", async () => {
  const { updates, module } = load();
  await module.deliverBoardWebhook("d1");

  const claim = updates.find((u) => u.data.status === "processing");
  assert.ok(claim, "deliverBoardWebhook must claim through updateMany");
  assert.deepEqual(
    claim.where.attemptCount,
    { lt: module.BOARD_WEBHOOK_MAX_ATTEMPTS },
    "the claim itself must refuse an exhausted row",
  );
});
