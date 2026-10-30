const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

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
        assert.ok(
          where.processingAt instanceof Date,
          "delivery re-read must revalidate the lease",
        );
        return {
          id: where.id,
          event: "task.created",
          payload: { event: "task.created" },
          payloadBody: '{"event":"task.created"}',
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
    boardWebhookAttempt: {
      create: async ({ data }) => {
        writes.push(`attempt:${data.attemptNumber}:${data.durationMs}`);
        return data;
      },
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
      durationMs: 42,
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
  assert.deepEqual(success.writes, [
    "delivery:delivered",
    "attempt:1:42",
    "subscription:true",
  ]);

  const failure = load({ reclaimed: false, ok: false });
  await failure.module.deliverBoardWebhook("d1");
  assert.deepEqual(failure.writes, [
    "delivery:retrying",
    "attempt:1:42",
    "subscription:false",
  ]);
});
