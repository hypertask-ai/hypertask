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
  whereConstrainsStatus,
} = loadModule("src/lib/db/softDeleteReads.ts");

async function run(args) {
  const seen = [];
  const result = await guardSoftDeleteRead({
    model: "Task",
    query: async (next) => {
      seen.push(next);
      return { rows: [] };
    },
    ...args,
  });
  return { seen, result };
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

test("a read that states its own status keeps it, so trash and restore still work", async () => {
  for (const where of [
    { id: 7, ...anyStatus },
    { id: 7, status: "Deleted" },
    { id: 7, status: { equals: "Deleted" } },
    { id: 7, status: { in: ["Normal", "Archive"] } },
    { id: 7, status: { not: "Deleted" } },
    { id: 7, AND: [{ status: { not: "Deleted" } }] },
    { id: 7, OR: [{ status: "Deleted" }] },
    { id: 7, NOT: { status: "Deleted" } },
  ]) {
    const { seen } = await run({ model: "Task", operation: "findFirst", args: { where } });
    assert.deepEqual(seen[0], { where }, JSON.stringify(where));
    assert.equal(whereConstrainsStatus(where), true);
  }
});

test("the trash scope accepts every status and the default review refuses Deleted", async () => {
  assert.deepEqual(anyStatus.status.in, ["Normal", "Archive", "Deleted"]);
  const { seen } = await run({ model: "Task", operation: "findUnique", args: { where: { id: 7, ...anyStatus } } });
  assert.deepEqual(seen[0], { where: { id: 7, ...anyStatus } });
});

test("a filter on a related row is not the row's own status", async () => {
  const { seen } = await run({
    model: "Task",
    operation: "findMany",
    args: { where: { project: { id: 15, status: "Deleted" } } },
  });
  assert.deepEqual(seen[0].where, { project: { id: 15, status: "Deleted" }, status: VISIBLE_ROW_STATUS });
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

test("the default client hides Deleted rows and the trash paths ask for every status", () => {
  assert.match(fs.readFileSync(path.join(root, "src/lib/prisma.ts"), "utf8"), /excludeDeletedRows\(\)/);
  const trashReads = [
    "src/lib/api/task-writes/recover.ts",
    "src/lib/api/task-writes/delete.ts",
    "src/pages/api/queues/tasks/taskDeleteReminder.ts",
    "src/utils/controllers/tasks/invokeTaskDelete.ts",
  ];
  for (const file of trashReads) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /import \{ anyStatus \} from ["']@\/lib\/db\/softDeleteReads["']/, file);
    assert.match(source, /\.\.\.anyStatus/, file);
  }
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
