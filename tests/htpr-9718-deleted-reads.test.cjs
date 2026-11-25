const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Linter } = require("eslint");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const baseline = JSON.parse(fs.readFileSync(path.join(root, "eslint-local-rules/soft-delete-reads-baseline.json"), "utf8"));
const {
  SOFT_DELETE_MODELS,
  SOFT_DELETE_READ_OPERATIONS,
  VISIBLE_ROW_STATUS,
  anyStatus,
  guardSoftDeleteRead,
  statusExcludesDeleted,
} = loadModule("src/lib/db/softDeleteReads.ts");

async function run(args) {
  const seen = [];
  await guardSoftDeleteRead({
    model: "Task",
    query: async (next) => {
      seen.push(next);
      return { rows: [] };
    },
    ...args,
  });
  return { seen };
}

function prismaOperationsHook() {
  let hook;
  const previous = globalThis.prismaGlobal;
  delete globalThis.prismaGlobal;
  loadModule("src/lib/prisma.ts", {
    "@prisma/client": { PrismaClient: class { $extends(extension) { hook = extension.query.$allOperations; return this } } },
    "@prisma/adapter-pg": { PrismaPg: class {} },
    "@/lib/mcp/dbTiming": { createMcpTimingPool: () => ({}), mcpDbTimings: { getStore: () => undefined } },
    "@/lib/queryCountTracker": { trackPrismaQuery: () => {} },
    "@/lib/apiKeyExpiry": { isApiKeyAuthLookup: () => false },
  });
  if (previous === undefined) delete globalThis.prismaGlobal;
  else globalThis.prismaGlobal = previous;
  assert.ok(hook, "the default client must install a query extension");
  return hook;
}

test("every read of a soft-delete model excludes Deleted rows by default", async () => {
  for (const model of SOFT_DELETE_MODELS) {
    for (const operation of SOFT_DELETE_READ_OPERATIONS) {
      const { seen } = await run({ model, operation, args: { where: { projectId: 15 } } });
      assert.deepEqual(seen[0].where, { projectId: 15, status: VISIBLE_ROW_STATUS }, `${model}.${operation}`);
    }
  }
});

test("a read without a where clause still excludes Deleted rows", async () => {
  const { seen } = await run({ model: "Project", operation: "findMany" });
  assert.deepEqual(seen[0].where, { status: VISIBLE_ROW_STATUS });
  const noArgs = await run({ model: "Project", operation: "count" });
  assert.deepEqual(noArgs.seen[0].where, { status: VISIBLE_ROW_STATUS });
});

test("a scope that cannot match Deleted keeps its own filter", async () => {
  for (const status of ["Normal", "Archive", { equals: "Normal" }, { in: ["Normal", "Archive"] }, { not: "Deleted" }]) {
    const { seen } = await run({ model: "Task", operation: "findFirst", args: { where: { id: 7, status } } });
    assert.deepEqual(seen[0], { where: { id: 7, status } }, JSON.stringify(status));
    assert.equal(statusExcludesDeleted(status), true);
  }
});

test("a caller that asks for Deleted without the marker still gets only live rows", async () => {
  for (const status of ["Deleted", { equals: "Deleted" }, { in: ["Normal", "Deleted"] }, { not: "Normal" }]) {
    const { seen } = await run({ model: "Project", operation: "findMany", args: { where: { id: 7, status } } });
    assert.deepEqual(seen[0].where, { id: 7, status: VISIBLE_ROW_STATUS }, JSON.stringify(status));
    assert.equal(statusExcludesDeleted(status), false);
  }
});

test("a nested status filter never lifts the row's own filter", async () => {
  const { seen } = await run({
    model: "Task",
    operation: "findMany",
    args: { where: { project: { id: 15, status: "Deleted" } } },
  });
  assert.deepEqual(seen[0].where, { project: { id: 15, status: "Deleted" }, status: VISIBLE_ROW_STATUS });
});

test("spreading anyStatus opts a trash or restore read into every status", async () => {
  assert.deepEqual(anyStatus.status.in, ["Normal", "Archive", "Deleted"]);
  const { seen } = await run({ model: "Task", operation: "findUnique", args: { where: { id: 7, ...anyStatus } } });
  assert.deepEqual(seen[0], { where: { id: 7, status: { in: ["Normal", "Archive", "Deleted"] } } });
});

test("writes and models without a trash column pass through untouched", async () => {
  const write = { where: { id: 7 }, data: { status: "Deleted" } };
  const written = await run({ model: "Task", operation: "update", args: write });
  assert.deepEqual(written.seen[0], write);
  const comment = { where: { taskId: 7 } };
  const read = await run({ model: "Comment", operation: "findMany", args: comment });
  assert.deepEqual(read.seen[0], comment);
});

test("a deleted board can no longer answer a board lookup", async () => {
  const { seen } = await run({ model: "Project", operation: "findFirst", args: { where: { id: 15 }, select: { id: true } } });
  assert.deepEqual(seen[0], { where: { id: 15, status: VISIBLE_ROW_STATUS }, select: { id: true } });
});

test("the default client filters a board read and lets the trash scope through", async () => {
  const hook = prismaOperationsHook();
  const seen = [];
  const query = async (args) => { seen.push(args); return { rows: [] }; };
  await hook({ model: "Project", operation: "findMany", args: { where: { ownerId: 7 } }, query });
  await hook({ model: "Task", operation: "findFirst", args: { where: { id: 9, ...anyStatus } }, query });
  assert.deepEqual(seen[0].where, { ownerId: 7, status: VISIBLE_ROW_STATUS });
  assert.deepEqual(seen[1].where, { id: 9, status: { in: ["Normal", "Archive", "Deleted"] } });
});

async function lint(code, file = "src/lib/soft-delete-probe.ts") {
  const { softDeleteReadsLintConfig } = await import("../eslint-local-rules/soft-delete-reads.mjs");
  return new Linter({ cwd: root }).verify(code, [softDeleteReadsLintConfig], { filename: path.join(root, file) });
}

test("the lint rejects the call site HTPR-8431 fixed", async () => {
  const messages = await lint('prisma.task.findFirst({ where: { id: 7, project: access, status: "Deleted" }, select: { projectId: true } })');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /anyStatus/);
});

test("the lint rejects a trash include that bypasses the trash scope", async () => {
  const messages = await lint('prisma.project.findFirst({ where: { id: 7 }, include: { tasks: { where: { status: "Deleted" } } } })');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /anyStatus/);
});

test("the lint rejects the search call sites HTPR-9014 fixed", async () => {
  for (const code of [
    "searchTasks({ searchQuery: prompt, projectIds, topK: 50 })",
    "searchComments({ searchQuery: prompt, projectIds, topK: 60 })",
  ]) {
    const messages = await lint(code);
    assert.equal(messages.length, 1, code);
    assert.match(messages[0].message, /excludeStatuses/);
  }
});

test("the lint rejects the delivery update HTPR-9085 fixed", async () => {
  const messages = await lint('prisma.agentWebhookDelivery.update({ where: { id }, data: { status: "delivered" } })');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /updateMany/);
});

test("the lint accepts the shared paths", async () => {
  for (const code of [
    "prisma.task.findFirst({ where: { id: 7, ...anyStatus } })",
    "prisma.task.findMany({ where: { projectId: 15 } })",
    'prisma.task.count({ where: { projectId: 15, status: { not: "Deleted" } } })',
    'searchTasks({ searchQuery: prompt, projectIds, excludeStatuses: ["Deleted"], topK: 50 })',
    "prisma.agentWebhookDelivery.updateMany({ where: { id }, data: { status: \"delivered\" } })",
    'prisma.agentWebhookSubscription.update({ where: { id }, data: { url } })',
  ]) {
    assert.deepEqual(await lint(code), [], code);
  }
});

test("the allowance baseline holds only the trash listing and may only shrink", () => {
  assert.deepEqual(Object.keys(baseline), ["src/utils/controllers/trash/getByProjectId.ts"]);
  assert.deepEqual(baseline["src/utils/controllers/trash/getByProjectId.ts"], { "no-inline-deleted-read": 1 });
  const counts = Object.values(baseline).flatMap((perRule) => Object.values(perRule));
  assert.ok(counts.every((count) => Number.isInteger(count) && count >= 0));
  assert.equal(counts.reduce((total, count) => total + count, 0), 1);
});
