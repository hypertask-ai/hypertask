const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);

function loadDescriptionService(featureEnabled = true) {
  const calls = [];
  const transaction = {
    $executeRaw: async () => {},
    description: {
      findUnique: async () => null,
      upsert: async (args) => {
        calls.push(args);
        return args.create;
      },
    },
    docVersion: {
      count: async () => 0,
      create: async () => {},
    },
  };
  const prisma = {
    $transaction: async (run) => run(transaction),
  };

  for (const relativePath of [
    "src/utils/controllers/description/common-description-create.ts",
    "src/lib/prisma.ts",
    "src/lib/mcp/tasks/agentMutationFence.ts",
    "src/lib/flags.ts",
  ]) {
    delete require.cache[modulePath(relativePath)];
  }

  require.cache[modulePath("src/lib/prisma.ts")] = {
    id: modulePath("src/lib/prisma.ts"),
    filename: modulePath("src/lib/prisma.ts"),
    loaded: true,
    exports: { default: prisma },
  };
  require.cache[modulePath("src/lib/mcp/tasks/agentMutationFence.ts")] = {
    id: modulePath("src/lib/mcp/tasks/agentMutationFence.ts"),
    filename: modulePath("src/lib/mcp/tasks/agentMutationFence.ts"),
    loaded: true,
    exports: { assertAgentAssignmentChangeAllowed: async () => {} },
  };
  require.cache[modulePath("src/lib/flags.ts")] = {
    id: modulePath("src/lib/flags.ts"),
    filename: modulePath("src/lib/flags.ts"),
    loaded: true,
    exports: { isFeatureEnabled: async () => featureEnabled },
  };

  const jiti = require("jiti")(
    path.join(root, `tests/task-description-save-${Date.now()}-${Math.random()}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false },
  );
  const loaded = jiti(modulePath("src/utils/controllers/description/common-description-create.ts"));
  return { upsertTaskDescription: loaded.default, calls };
}

test("the shared description save path wraps bare text in editor blocks", async () => {
  const { upsertTaskDescription, calls } = loadDescriptionService();

  await upsertTaskDescription({
    taskId: 1705,
    creatorId: 6,
    actingUserId: 6,
    content: "Problem context\n\nAdd to cart is also restricted.",
  });

  assert.equal(
    calls[0].create.content,
    "<p>Problem context</p><p>Add to cart is also restricted.</p>",
  );
});

test("the shared description save path keeps the previous behavior when the flag is off", async () => {
  const { upsertTaskDescription, calls } = loadDescriptionService(false);

  await upsertTaskDescription({
    taskId: 1705,
    creatorId: 7,
    actingUserId: 7,
    content: "Problem context\n\nAdd to cart is also restricted.",
  });

  assert.equal(
    calls[0].create.content,
    "Problem context\n\nAdd to cart is also restricted.",
  );
});
