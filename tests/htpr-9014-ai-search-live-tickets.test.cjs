const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const { load } = require("./task-route-loader.cjs");

function moduleWithStubs(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(
    code,
    {
      module: loadedModule,
      exports: loadedModule.exports,
      require: (id) => {
        if (Object.hasOwn(stubs, id)) return stubs[id];
        if (id.startsWith("@/") || id.startsWith("./") || id.startsWith("../")) return {};
        return require(id);
      },
      ReadableStream,
      Response,
      Request,
      TextEncoder,
      TextDecoder,
      Error,
      AbortController,
      URL,
      console: { log() {}, info() {}, warn() {}, error() {} },
    },
    { filename }
  );
  return loadedModule.exports;
}

const statusFilter = load(
  "src/utils/controllers/turbopuffer/searchStatusFilter.ts"
);

test("a search with no status never keeps trashed tickets", () => {
  assert.deepEqual(statusFilter.buildSearchStatusFilter("status"), [
    "status",
    "NotEq",
    "Deleted",
  ]);
});

test("the AI surfaces exclude both trashed and archived tickets by default", () => {
  assert.deepEqual(statusFilter.NON_LIVE_STATUSES, ["Deleted", "Archive"]);
  assert.deepEqual(
    statusFilter.buildSearchStatusFilter(
      "taskStatus",
      undefined,
      statusFilter.NON_LIVE_STATUSES
    ),
    [
      "And",
      [
        ["taskStatus", "NotEq", "Deleted"],
        ["taskStatus", "NotEq", "Archive"],
      ],
    ]
  );
});

test("an explicit status still wins, and repeating an excluded status does not duplicate it", () => {
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
  const knowledge = load("src/lib/rag/retrieveBoardKnowledge.ts", {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        project: { findMany: async () => [{ id: 15 }] },
      },
    },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: () => ({}),
    },
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
    "@/utils/controllers/turbopuffer/searchStatusFilter": statusFilter,
  });

  await knowledge.retrieveBoardKnowledge(
    {
      query: "office kitchen rota",
      limit: 5,
      metadataFilters: { status: "Deleted" },
    },
    { userId: 6 }
  );

  assert.equal(calls.tasks.length, 1);
  assert.equal(calls.comments.length, 1);
  for (const args of [calls.tasks[0], calls.comments[0]]) {
    assert.deepEqual(args.excludeStatuses, statusFilter.NON_LIVE_STATUSES);
    assert.equal(args.status, undefined);
  }
});

test("Task Writer context asks the index for live tickets only", async () => {
  const calls = { tasks: [], comments: [] };
  const editor = moduleWithStubs("src/app/api/ai/_lib/editorAi.ts", {
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
    "@/utils/controllers/turbopuffer/searchStatusFilter": statusFilter,
    "@/lib/rag/authorizeIndexedRows": {
      authorizeIndexedRows: async () => ({ taskRows: [], commentRows: [] }),
    },
    "@/app/api/ai/_lib/customInstructions": {
      retrieveCustomInstructionFileContext: async () => "",
    },
    "@/app/api/ai/_lib/taskWriterPrompt": {
      excludeLoadedTaskRows: ({ taskRows, commentRows }) => ({ taskRows, commentRows }),
    },
    "@/app/api/ai/_lib/taskWriterBoardResearch": {
      mergeTaskWriterContextBudget: (rows) => rows,
    },
  });

  await editor.retrieveTaskWriterContext({
    projectId: 15,
    prompt: "write a ticket about the settings page",
  });

  assert.equal(calls.tasks.length, 1);
  assert.equal(calls.comments.length, 1);
  for (const args of [calls.tasks[0], calls.comments[0]]) {
    assert.deepEqual(args.excludeStatuses, statusFilter.NON_LIVE_STATUSES);
  }
});

function trashHarness({ status }) {
  const index = { deleted: [], restored: [] };
  let rawCall = 0;
  const treeIds = [{ id: 9014 }, { id: 9015 }];
  const lockRows = treeIds.map(({ id }) => ({
    id,
    status: status === "Deleted" ? "Normal" : "Deleted",
    sectionId: 1,
    hardDeleteProcessingAt: null,
  }));
  const task = { id: 9014, projectId: 15, subTasks: [], parentTask: null };

  const tx = {
    $queryRaw: async () => (++rawCall === 1 ? treeIds : lockRows),
    task: {
      findMany: async () => [],
      updateMany: async () => ({ count: 2 }),
      update: async () => task,
      findUniqueOrThrow: async () => task,
    },
    notification: { deleteMany: async () => ({ count: 0 }) },
  };

  const reminder = moduleWithStubs(
    "src/pages/api/queues/tasks/taskDeleteReminder.ts",
    {
      "@/lib/prisma": {
        __esModule: true,
        default: { $transaction: async (run) => run(tx) },
      },
      "@/lib/planLimits": {
        assertProjectTicketRoom: async () => {},
        isPlanLimitsEnabled: async () => false,
      },
      "@/lib/tasks/sameBoardRelations": {
        stripForeignTaskRelations: (value) => value,
      },
      "@/lib/mcp/tasks/agentMutationFence": {
        AgentMutationLeaseConflictError: class extends Error {},
        assertAgentAssignmentChangeAllowed: async () => {},
        cancelAgentMutationLeaseForHumanOverride: async () => {},
      },
      "@/lib/mcp/tasks/agentDoneLifecycle": {
        AgentDoneLifecycleDeniedError: class extends Error {},
        assertAgentMayLeaveDoneForTasks: async () => {},
      },
      "@/utils/controllers/turbopuffer/turbopufferHelper": {
        deleteTasksFromTurbopuffer: async (ids) => index.deleted.push(ids),
        upsertTasksToTurbopuffer: async (ids) => index.restored.push(ids),
      },
    }
  );

  return { reminder, index };
}

test("moving tickets to Trash removes them and their comments from the search index", async () => {
  const { reminder, index } = trashHarness({ status: "Deleted" });

  await reminder.updateTaskAndSubtasks({ id: 9014 }, "Deleted", new Date(), new Date());

  assert.deepEqual(index.deleted, [[9014, 9015]]);
  assert.deepEqual(index.restored, []);
});

test("restoring tickets from Trash puts them back in the search index", async () => {
  const { reminder, index } = trashHarness({ status: "Normal" });

  await reminder.updateTaskAndSubtasks({ id: 9014 }, "Normal");

  assert.deepEqual(index.restored, [[9014, 9015]]);
  assert.deepEqual(index.deleted, []);
});
