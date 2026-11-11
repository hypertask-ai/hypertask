const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function comment(id, taskId, createdAt, text = "The launch was delayed by the supplier.") {
  return {
    id: String(id), taskId: String(taskId), projectId: 15,
    createdAt, commentText: text, taskProjectId: 15,
    taskProjectTitle: "Product", taskTicketNumber: `HTPR-${taskId}`,
    taskTitle: "Launch", taskStatus: "Normal", taskUniqueIndex: taskId,
  };
}

const rankedComments = [
  comment(101, 1, "2020-01-01"),
  comment(102, 1, "2026-11-10", "A newer, less relevant comment."),
  comment(103, 2, "2021-01-01"),
  comment(104, 3, "2026-11-11", "Another recent, weak match."),
];

function searchFixture(rows, { hybrid = false, failHybrid = false } = {}) {
  const queries = [];
  const search = load("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
    "@/lib/prisma": { default: {} },
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/lib/ai/spend/embeddingRoute": {
      embeddingSpendMode: async () => hybrid ? { mode: "customer-key", httpKey: "test-key" } : { mode: "keyword" },
    },
    "@/lib/turbopuffer": {
      default: { namespace: () => ({ query: async (args) => {
        queries.push(args);
        if (args.queries && failHybrid) throw new Error("hybrid unavailable");
        return args.queries ? { results: [{ rows }] } : { rows };
      } }) },
      turbopufferNamespaces: { comment: { name: "comments" } },
    },
  });
  return { search, queries };
}

for (const mode of ["keyword", "hybrid", "fallback"]) {
  test(`${mode} comment search preserves rank before grouping and limiting`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] }));
    const { search, queries } = searchFixture(rankedComments, { hybrid: mode !== "keyword", failHybrid: mode === "fallback" });
    const rows = await search.searchComments({ searchQuery: "launch supplier delay", projectIds: [15], limit: 2, preserveRanking: true });
    assert.deepEqual(rows.map(row => row.id), ["101", "103"]);
    assert.equal(rows[0].commentText, "The launch was delayed by the supplier.");
    assert.equal(queries.length, mode === "fallback" ? 2 : 1);
    if (mode !== "keyword") assert.deepEqual(queries[0].rerank_by, ["RRF"]);
    const legacy = await search.searchComments({ searchQuery: "launch supplier delay", projectIds: [15], limit: 2 });
    assert.deepEqual(legacy.map(row => row.id), ["104", "102"]);
  });
}

const tasks = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1), projectId: 15, ticketNumber: `HTPR-${index + 1}`,
  title: "Launch", descriptionText: "Launch planning", projectTitle: "Product",
  status: "Normal", updatedAt: "2026-11-11", uniqueIndex: index + 1,
}));

function retrievalFixture({ enabled = true, taskRows = tasks, commentRows = rankedComments, authorize } = {}) {
  const { search } = searchFixture(commentRows);
  let requestedRanking;
  const { retrieveBoardKnowledge } = load("src/lib/rag/retrieveBoardKnowledge.ts", {
    "@/lib/prisma": { default: { project: { findMany: async () => [{ id: 15 }] } } },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/auth/agentScope": { recordAgentBoardScopeMiss: () => {} },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "./authorizeIndexedRows": { authorizeIndexedRows: authorize ?? (async (taskRows, commentRows) => ({ taskRows, commentRows })) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      searchTasks: async () => taskRows,
      searchComments: async (args) => { requestedRanking = args.preserveRanking; return search.searchComments(args); },
    },
  });
  return {
    retrieve: (limit = 10, metadataFilters) => retrieveBoardKnowledge({ query: "launch supplier delay", limit, metadataFilters }, { userId: 985 }),
    requestedRanking: () => requestedRanking,
  };
}

test("AI retrieval includes the best comment with ten competing tickets; reports paired recall@10", async () => {
  const baseline = retrievalFixture({ enabled: false });
  const enabled = retrievalFixture();
  const before = await baseline.retrieve();
  const after = await enabled.retrieve();
  assert.equal(before.success, true);
  assert.equal(after.success, true);
  assert.equal(baseline.requestedRanking(), false);
  assert.equal(enabled.requestedRanking(), true);
  const hit = result => Number(result.documents.some(doc => doc.type === "comment" && doc.commentId === 101));
  assert.equal(hit(before), 0);
  assert.equal(hit(after), 1);
  assert.deepEqual(after.documents.map(doc => doc.type), ["task", "comment", "task", "comment", "task", "comment", "task", "task", "task", "task"]);
  assert.deepEqual(after.documents.filter(doc => doc.type === "comment").map(doc => doc.commentId), [101, 103, 104]);
  assert.match(after.documents[1].content, /Comment: The launch was delayed by the supplier\./);
  assert.equal(after.total, 10);
  console.log("HTPR-9013 controlled fixture comment recall@10: flag-off=0/1 (0%); flag-on=1/1 (100%); not a corpus-wide relevance score.");
});

test("each lane keeps its rank and fills unused slots from the other lane", async () => {
  const taskOnly = await retrievalFixture({ commentRows: [] }).retrieve(3);
  assert.deepEqual(taskOnly.documents.map(doc => doc.taskId), [1, 2, 3]);
  const commentOnly = await retrievalFixture({ taskRows: [] }).retrieve(2);
  assert.deepEqual(commentOnly.documents.map(doc => doc.commentId), [101, 103]);
  const small = await retrievalFixture().retrieve(2);
  assert.deepEqual(small.documents.map(doc => doc.type), ["task", "comment"]);
  const single = await retrievalFixture().retrieve(1);
  assert.deepEqual(single.documents.map(doc => doc.type), ["task"]);
  const empty = await retrievalFixture({ taskRows: [], commentRows: [] }).retrieve();
  assert.deepEqual(empty.documents, []);
});

test("authorization and metadata filters apply before mixing, with allowed rows retained", async () => {
  const f = retrievalFixture({ authorize: async (taskRows, commentRows) => ({
    taskRows: taskRows.filter(row => row.id !== "1"),
    commentRows: commentRows.filter(row => row.id !== "101"),
  }) });
  const result = await f.retrieve(10, { ticketNumber: "HTPR-2" });
  assert.deepEqual(result.documents.map(doc => [doc.type, doc.taskId]), [["task", 2], ["comment", 2]]);
  assert.equal(result.documents[1].commentId, 103);
  assert.equal(result.total, 2);
});
