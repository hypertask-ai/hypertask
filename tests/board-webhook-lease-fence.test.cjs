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
 * Load deliverBoardWebhook against a fake database.
 *
 * `reclaimed` simulates a sweep taking the lease away while the POST is in
 * flight: the fenced delivery update then matches zero rows.
 */
const load = ({ reclaimed, ok = true }) => {
  const writes = [];
  const prisma = {
    boardWebhookDelivery: {
      updateMany: async ({ where, data }) => {
        if (data.status === "processing") return { count: 1 };
        writes.push(`delivery:${data.status}`);
        return { count: reclaimed ? 0 : 1 };
      },
      findFirst: async ({ where }) => {
        // The re-read must carry the lease token, not just the id.
        assert.ok(
          where.processingAt instanceof Date,
          "delivery re-read must revalidate the lease",
        );
        return {
          id: where.id,
          event: "task.created",
          payload: { event: "task.created" },
          attemptCount: 0,
          subscriptionId: "sub-1",
          subscription: {
            active: true,
            url: "https://example.test/hook",
            secret: "s",
          },
        };
      },
      update: async () => ({}),
    },
    webhookSubscription: {
      update: async ({ data }) => {
        writes.push(`subscription:${data.lastDeliveryOk}`);
        return {};
      },
    },
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
    postSignedWebhook: async () => ({
      ok,
      statusCode: ok ? 200 : 500,
      error: ok ? null : "boom",
    }),
  });
  stubModule("src/lib/mcp/webhooks/queue.ts", {
    queueBoardWebhookDelivery: async () => ({}),
  });

  const jiti = require("jiti")(
    path.join(root, `tests/board-webhook-lease-fence-${++loadId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false },
  );
  return {
    writes,
    module: jiti(path.join(root, "src/lib/mcp/webhooks/outboxDelivery.ts")),
  };
};

// Subscription health is what an integrator reads to decide whether their
// endpoint is working. A worker whose lease was reclaimed no longer knows the
// outcome of the attempt that owns the row, so it must not report one.
test("a reclaimed worker does not write subscription health", async () => {
  const success = load({ reclaimed: true, ok: true });
  await success.module.deliverBoardWebhook("d1");
  assert.deepEqual(success.writes, ["delivery:delivered"]);

  const failure = load({ reclaimed: true, ok: false });
  await failure.module.deliverBoardWebhook("d1");
  assert.deepEqual(failure.writes, ["delivery:retrying"]);
});

test("the owning worker records the outcome on both rows", async () => {
  const success = load({ reclaimed: false, ok: true });
  await success.module.deliverBoardWebhook("d1");
  assert.deepEqual(success.writes, ["delivery:delivered", "subscription:true"]);

  const failure = load({ reclaimed: false, ok: false });
  await failure.module.deliverBoardWebhook("d1");
  assert.deepEqual(failure.writes, ["delivery:retrying", "subscription:false"]);
});
