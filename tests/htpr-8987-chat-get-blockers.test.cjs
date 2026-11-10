const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const load = require("./task-route-loader.cjs").load;

const openBlocker = {
  id: 5959,
  projectId: 15,
  uniqueIndex: 5959,
  ticketNumber: "HTPR-5959",
  title: "Blocker ticket",
  status: "Normal",
  section: "In Progress",
};

const blockedTask = {
  id: 8987,
  ticketNumber: "HTPR-8987",
  uniqueIndex: 8987,
  title: "Blocked task",
  section: "In Progress",
  projectId: 15,
  relatedFromTasks: [{ targetTask: openBlocker }],
};

test("get_tasks exposes open BlockedBy targets like list_tasks", async () => {
  const findMany = async (args) => {
    assert.ok(args.include.relatedFromTasks, "get_tasks must load BlockedBy relations");
    return [blockedTask];
  };

  const prismaMock = {
    __esModule: true,
    default: {
      task: { findMany },
    },
  };
  const attachDeps = {
    "@/lib/prisma": prismaMock,
    "@/utils/controllers/notifications/inboxZero": {
      loadDoneTitlesByProject: async (projectIds) =>
        new Map([...projectIds].map((id) => [id, new Set()])),
    },
    "@/lib/doneColumns": load("src/lib/doneColumns.ts", {}),
    "@/lib/mcp/tasks/blockerStillOpen": load("src/lib/mcp/tasks/blockerStillOpen.ts", {
      "@/lib/doneColumns": load("src/lib/doneColumns.ts", {}),
    }),
    "@/lib/blockingTasks": load("src/lib/blockingTasks.ts", {
      "@/lib/mcp/tasks/blockerStillOpen": load("src/lib/mcp/tasks/blockerStillOpen.ts", {
        "@/lib/doneColumns": load("src/lib/doneColumns.ts", {}),
      }),
    }),
    "@/utils/controllers/tasks/attachOpenBlockingTasks": load(
      "src/utils/controllers/tasks/attachOpenBlockingTasks.ts",
      {
        "@/lib/prisma": prismaMock,
        "@/lib/doneColumns": load("src/lib/doneColumns.ts", {}),
        "@/lib/blockingTasks": load("src/lib/blockingTasks.ts", {
          "@/lib/mcp/tasks/blockerStillOpen": load("src/lib/mcp/tasks/blockerStillOpen.ts", {
            "@/lib/doneColumns": load("src/lib/doneColumns.ts", {}),
          }),
        }),
        "@/utils/controllers/notifications/inboxZero": {
          loadDoneTitlesByProject: async (projectIds) =>
            new Map([...projectIds].map((id) => [id, new Set()])),
        },
      },
    ),
  };

  const mappers = load("src/lib/mcp/tasks/mappers.ts", {
    "@/lib/tasks/sameBoardRelations": { stripForeignTaskRelations: (task) => task },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => false, recordAgentBoardScopeMiss: () => {} },
    "@/lib/mcp/agents": {
      mcpVisibleAgentSelect: () => ({}),
      mapVisibleMcpAgent: () => undefined,
    },
    "@/lib/agents/visibility": { accessibleAgentWhere: {}, isAgentVisibleToUser: () => true },
    "@/lib/staleness": { taskStaleness: () => ({}) },
    "@/lib/pullRequests/githubPullRequests": { derivePullRequestDisplayState: () => "open" },
    "@/lib/blockingTasks": attachDeps["@/lib/blockingTasks"],
    "@/utils/controllers/projects/getAllIncludes": {
      projectContentAccessWhere: () => ({}),
      getProjectWhere: () => ({ members: { some: { userId: 6 } } }),
    },
    "@prisma/client": require("@prisma/client"),
  });

  const { createGetTasksTool } = load("src/lib/ai/tools/getTasks.ts", {
    ...attachDeps,
    "@/lib/prisma": prismaMock,
    "@/lib/flags": {
      isFeatureEnabled: async (key) => key === "htpr-8987-chat-blocker-read",
    },
    "@/lib/flags/definitions/htpr-8987-chat-blocker-read": {
      HTPR_8987_CHAT_BLOCKER_READ_FLAG: "htpr-8987-chat-blocker-read",
    },
    "@/lib/flags/keys": { HTPR_7756_CHAT_OPENS_TASK_FLAG: "htpr-7756" },
    "@/lib/mcp/tasks/mappers": mappers,
    "@/lib/ai/tools/helpers": {
      sanitizeForJson: (value) => value,
      mapTaskToMcpGetResponse: (task, userId) => mappers.mapTaskToMcpGetResponse(task, userId),
    },
    ai: { tool: (definition) => definition },
    zod: require("zod"),
    "@prisma/client": require("@prisma/client"),
  });

  const output = await createGetTasksTool({
    user: { id: 6 },
    sendStatus: () => {},
    send: () => false,
  }).hypertask_get_tasks.execute({ ticket_numbers: ["HTPR-8987"], project_id: 15 });

  assert.equal(output.success, true);
  assert.equal(output.tasks.length, 1);
  assert.deepEqual(output.tasks[0].blockingTasks, [
    {
      id: 5959,
      task_id: 5959,
      ticketNumber: "HTPR-5959",
      uniqueIndex: 5959,
      title: "Blocker ticket",
      section: "In Progress",
      status: "Normal",
      projectId: 15,
      url: "/detail/project-15/5959",
    },
  ]);
});

test("current ticket context lists open blockers", () => {
  const { formatTaskContext } = load("src/app/api/ai/_lib/currentTaskContext.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/flags/keys": { HTPR_7856_SUMMARY_CONTEXT_FLAG: "htpr-7856" },
    "@/lib/prisma": { default: {} },
    "@/utils/controllers/projects/getAllIncludes": {
      blockedByRelationsInclude: () => ({}),
      projectContentAccessWhere: () => ({}),
    },
    "@/utils/controllers/tasks/attachOpenBlockingTasks": {
      attachOpenBlockingTasks: async (tasks) => tasks,
    },
    "@/lib/mcp/webhooks/ssrfGuard": { assertSafeWebhookTarget: async () => ({ ok: true }) },
  });

  const text = formatTaskContext(
    {
      id: 8987,
      title: "Blocked task",
      ticketNumber: "HTPR-8987",
      description_: { content: "" },
      blockingTasks: [openBlocker],
      comments: [],
    },
    "primary",
    false,
    true,
  );

  assert.match(text, /Open blockers \(BlockedBy\):/);
  assert.match(text, /HTPR-5959: Blocker ticket/);
});
