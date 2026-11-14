const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const statusFilter = loadModule("src/utils/controllers/search/rankHits.ts");
const liveOnly = ["Deleted", "Archive"];

test("a search with no status never keeps trashed tickets", () => {
  assert.deepEqual(statusFilter.buildSearchStatusFilter("status"), [
    "status",
    "NotEq",
    "Deleted",
  ]);
});

test("the AI surfaces exclude both trashed and archived tickets by default", () => {
  assert.deepEqual(statusFilter.TRASHED_STATUSES, ["Deleted"]);
  assert.deepEqual(
    statusFilter.buildSearchStatusFilter("taskStatus", undefined, liveOnly),
    [
      "And",
      [
        ["taskStatus", "NotEq", "Deleted"],
        ["taskStatus", "NotEq", "Archive"],
      ],
    ]
  );
});

test("an explicit status still wins, and a repeated excluded status is not duplicated", () => {
  assert.deepEqual(
    statusFilter.buildSearchStatusFilter("status", "Normal", ["Archive"]),
    ["status", "Eq", "Normal"]
  );
  assert.deepEqual(
    statusFilter.buildSearchStatusFilter("status", null, [
      "Deleted",
      "Deleted",
      "Archive",
    ]),
    [
      "And",
      [
        ["status", "NotEq", "Deleted"],
        ["status", "NotEq", "Archive"],
      ],
    ]
  );
  assert.equal(statusFilter.buildSearchStatusFilter("status", null, []), null);
});

test("AI chat search asks the index for live tickets only and drops a Deleted status request", async () => {
  const calls = { tasks: [], comments: [] };
  const knowledge = loadModule("src/lib/rag/retrieveBoardKnowledge.ts", {
    "@/lib/prisma": {
      default: { project: { findMany: async () => [{ id: 15 }] } },
    },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/auth/agentScope": { recordAgentBoardScopeMiss: () => {} },
    "./authorizeIndexedRows": {
      authorizeIndexedRows: async (tasks, comments) => ({
        taskRows: tasks,
        commentRows: comments,
      }),
    },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      searchTasks: async (args) => {
        calls.tasks.push(args);
        return [];
      },
      searchComments: async (args) => {
        calls.comments.push(args);
        return [];
      },
    },
  });

  const response = await knowledge.retrieveBoardKnowledge(
    {
      query: "office kitchen rota",
      limit: 5,
      metadataFilters: { status: "Deleted" },
    },
    { userId: 6 }
  );

  assert.equal(response.success, true);
  assert.equal(calls.tasks.length, 1);
  assert.equal(calls.comments.length, 1);
  for (const args of [calls.tasks[0], calls.comments[0]]) {
    assert.deepEqual(args.excludeStatuses, liveOnly);
    assert.equal(args.status, undefined);
  }
});

test("Trash removes a task tree from the index and restore puts it back", async () => {
  const index = { deleted: [], restored: [] };
  const sync = loadModule(
    "src/utils/controllers/turbopuffer/syncTaskTreeSearchIndex.ts",
    {
      "./turbopufferHelper": {
        deleteTasksFromTurbopuffer: async (ids) => index.deleted.push(ids),
        upsertTasksToTurbopuffer: async (ids) => index.restored.push(ids),
      },
    }
  );

  await sync.syncTaskTreeSearchIndex([9014, 9015], "Deleted");
  assert.deepEqual(index.deleted, [[9014, 9015]]);
  assert.deepEqual(index.restored, []);

  await sync.syncTaskTreeSearchIndex([9014, 9015], "Normal");
  assert.deepEqual(index.restored, [[9014, 9015]]);

  await sync.syncTaskTreeSearchIndex([], "Deleted");
  assert.equal(index.deleted.length, 1);
});

