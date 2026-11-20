const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function taskRow() {
  return {
    id: "7",
    ticketNumber: "HTPR-7",
    title: "Launch the beta",
    descriptionText: "Ship it on Monday.",
    projectId: 15,
    creatorName: "QA Runner",
    status: "Normal",
    updatedAt: "2026-11-17T13:32:00.000Z",
    searchText: "HTPR-7 Launch the beta Ship it on Monday.",
    uniqueIndex: 7,
    projectTitle: "Product",
  };
}

function helperFixture({ embeddingFails }) {
  const writes = [];
  const warnings = [];
  const errors = [];
  const helper = load("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
    "@/lib/prisma": { default: {} },
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/lib/ai/spend/embeddingRoute": {
      embeddingSpendMode: async () => ({ mode: "customer-key", httpKey: "test-key" }),
      withSpendCharge: async (_route, _teamId, _texts, run) => run(),
    },
    "@/lib/turbopuffer": {
      default: { namespace: () => ({ write: async (args) => { writes.push(args); } }) },
      turbopufferNamespaces: { task: { name: "tasks" }, comment: { name: "comments" } },
    },
  });
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); };
  return {
    helper,
    writes,
    warnings,
    errors,
    restore() {
      console.warn = originalWarn;
      console.error = originalError;
    },
    fetchFor() {
      return embeddingFails
        ? async () => Response.json({ error: "provider down" }, { status: 400 })
        : async () => Response.json({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] });
    },
  };
}

test("an embeddings outage still writes the task row for keyword search and marks it for repair", async (t) => {
  const fixture = helperFixture({ embeddingFails: true });
  t.after(() => fixture.restore());
  t.mock.method(globalThis, "fetch", fixture.fetchFor());

  await fixture.helper.upsertTaskRowsToTurbopuffer([taskRow()]);

  assert.equal(fixture.writes.length, 1, "the task row reaches the index instead of being dropped");
  const [written] = fixture.writes[0].upsert_rows;
  assert.equal(written.id, "7");
  assert.equal(written.title, "Launch the beta");
  assert.equal(written.keywordOnly, true, "the placeholder vector is marked so the repair re-embeds the row");
  assert.equal(written.vector.length, 1536);
  assert.deepEqual(fixture.errors, [], "a provider outage is a warning, not an application error");
  assert.match(fixture.warnings.join("\n"), /embeddings unavailable/);
});

test("a healthy embedding writes a real vector and clears the repair marker", async (t) => {
  const fixture = helperFixture({ embeddingFails: false });
  t.after(() => fixture.restore());
  t.mock.method(globalThis, "fetch", fixture.fetchFor());

  await fixture.helper.upsertTaskRowsToTurbopuffer([taskRow()]);

  const [written] = fixture.writes[0].upsert_rows;
  assert.equal(written.keywordOnly, false, "a repaired row is not repaired again");
  assert.deepEqual(written.vector.slice(0, 3), [0.1, 0.1, 0.1]);
  assert.deepEqual(fixture.errors, []);
});

test("a keyword board is not marked for repair, so the sweep cannot loop on it", async () => {
  const writes = [];
  const helper = load("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
    "@/lib/prisma": { default: {} },
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/lib/ai/spend/embeddingRoute": {
      embeddingSpendMode: async () => ({ mode: "keyword" }),
      withSpendCharge: async (_route, _teamId, _texts, run) => run(),
    },
    "@/lib/turbopuffer": {
      default: { namespace: () => ({ write: async (args) => { writes.push(args); } }) },
      turbopufferNamespaces: { task: { name: "tasks" }, comment: { name: "comments" } },
    },
  });

  await helper.upsertTaskRowsToTurbopuffer([taskRow()]);

  const [written] = writes[0].upsert_rows;
  assert.equal(written.keywordOnly, false);
  assert.equal(written.vector[0], 1);
});

test("the search index drift repair re-embeds a keyword-only row once the provider recovers", () => {
  const drift = load("src/lib/search/indexDrift.ts", {
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      upsertTaskToTurbopuffer: async () => {},
      upsertAllCommentsToTurbopuffer: async () => {},
    },
  });
  const task = { id: 7, title: "Launch the beta", updatedAt: "2026-11-17T13:32:00.000Z", commentCount: 2 };

  assert.equal(
    drift.taskRowDrifted(task, { updatedAt: task.updatedAt, keywordOnly: true }),
    true,
    "a placeholder vector is drift even when the row is present and fresh",
  );
  assert.equal(drift.taskRowDrifted(task, { updatedAt: task.updatedAt, keywordOnly: false }), false);
  assert.equal(
    drift.commentCopyDrifted(task, { taskTitle: task.title, taskUpdatedAt: task.updatedAt, keywordOnly: true }),
    true,
  );
  assert.equal(
    drift.commentCopyDrifted(task, { taskTitle: task.title, taskUpdatedAt: task.updatedAt, keywordOnly: false }),
    false,
  );
});
