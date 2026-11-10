const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const load = require("./task-route-loader.cjs").load;

test("list and MCP task reads wire BlockedBy relations through attachOpenBlockingTasks", () => {
  const listSource = fs.readFileSync(path.join(root, "src/lib/ai/tools/listTasks.ts"), "utf8");
  const mcpSource = fs.readFileSync(
    path.join(root, "src/lib/mcp/operations/tasks/operation.ts"),
    "utf8",
  );
  assert.match(listSource, /relatedFromTasks:\s*blockedByRelationsInclude/);
  assert.match(listSource, /blockingTasks:\s*mapOpenBlockingTasksForRead/);
  assert.match(mcpSource, /relatedFromTasks:\s*blockedByRelationsInclude/);
  assert.match(mcpSource, /blockingTasks:\s*mapOpenBlockingTasksForRead/);
});

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
  description_: { content: "" },
  sectionId: 1,
  parentTaskId: null,
  projectId: 15,
  project: { id: 15, title: "Hypertask Product" },
  parentTask: null,
  status: "Normal",
  priority: { Priority_Value: "Urgent" },
  dueDate: null,
  createdAt: new Date("2026-11-10T00:00:00.000Z"),
  updatedAt: new Date("2026-11-10T00:00:00.000Z"),
  agent: null,
  assignees: [],
  subTasks: [],
  relatedFromTasks: [{ targetTask: openBlocker }],
  _count: { taskLabels: 0, comments: 0 },
};

test("AI list_tasks exposes open BlockedBy targets like the board payload", async () => {
  const findMany = async (args) => {
    assert.ok(args.select.relatedFromTasks, "list_tasks must load BlockedBy relations");
    assert.equal(args.select.relatedFromTasks.where.relationType, "BlockedBy");
    return [blockedTask];
  };

  const { createListTasksTool } = load("src/lib/ai/tools/listTasks.ts", {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        task: { findMany, count: async () => 1 },
        section: { findMany: async () => [{ section_title: "In Progress", projectId: 15 }] },
      },
    },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/flags/keys": { HTPR_7733_PERSON_ASSIGNMENT_FILTER_FLAG: "htpr-7733" },
    "@/lib/mcp/listQuery": require("./task-route-loader.cjs").load("src/lib/mcp/listQuery.ts", {}),
    "@/lib/mcp/agents": require("./task-route-loader.cjs").load("src/lib/mcp/agents.ts", {
      "@/lib/prisma": { __esModule: true, default: {} },
    }),
    "@/lib/mcp/tasks/mappers": { mcpTaskUserCommentCount: {}, mapTaskDescriptionContent: () => "" },
    "@/lib/ai/chatStream/request": {
      statusSchema: require("zod").z.string(),
      sortOrderSchema: require("zod").z.string(),
    },
    "@/lib/ai/tools/helpers": {
      getAccessibleProjectIds: async () => [15],
      normalizePriorityInput: () => [],
      sanitizeForJson: (value) => value,
    },
    ai: { tool: (definition) => definition },
    zod: require("zod"),
    "@prisma/client": require("@prisma/client"),
  });

  const output = await createListTasksTool({
    user: { id: 6 },
    sendStatus: () => {},
  }).hypertask_list_tasks.execute({
    project_id: 15,
    labels: [],
    status: "Normal",
    limit: 50,
    offset: 0,
    sort_by: "updatedAt",
    sort_order: "desc",
  });

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
