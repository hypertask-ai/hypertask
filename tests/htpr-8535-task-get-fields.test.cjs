const test = require("node:test");
const assert = require("node:assert/strict");
const { withStubs } = require("./helpers/stub-map.cjs");
const { load } = require("./task-route-loader.cjs");

const task = {
  id: 44769,
  projectId: 15,
  uniqueIndex: 8535,
  ticketNumber: "HTPR-8535",
  title: "A single ticket read rejects the field list that the task list accepts",
  section: "Improvements",
  description: "<p>a long description</p>",
};

function stubs(tasks) {
  const prisma = {
    task: { findMany: async () => tasks, findFirst: async () => tasks[0] ?? null },
    projectPrefixAlias: { findMany: async () => [] },
    taskNumberAlias: { findMany: async () => [] },
    section: { findMany: async () => [] },
  };
  return withStubs({
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope,
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "next/server": {
      NextRequest: class {},
      NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
    },
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: null }),
      mcpUnauthorizedResponse: async () => ({ status: 401 }),
    },
    "@/lib/mcp/agents": {},
    "@/lib/agents/visibility": {},
    "@/lib/mcp/tasks/mappers": {
      taskMcpGetInclude: () => ({}),
      mapTaskToMcpGetResponse: (row) => ({
        id: row.id,
        ticketNumber: row.ticketNumber,
        title: row.title,
        section: row.section,
        description: row.description,
        projectId: row.projectId,
      }),
    },
    "@/lib/mcp/tasks/resolveTask": { findTaskByIdentifier: async () => null, taskIdentifierErrorResponse: () => null },
    "@/lib/mcp/pagination/cursor": {},
    "@/lib/flags/keys": require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts"),
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/mcp/priorityFilter": {},
    "@/lib/mcp/listParams": load("src/lib/mcp/listParams.ts", {}),
    "@/lib/doneColumns": load("src/lib/doneColumns.ts", {}),
    "@/lib/mcp/boards/columnRole": load("src/lib/mcp/boards/columnRole.ts", {}),
    "@/utils/controllers/notifications/inboxZero": { loadDoneTitlesByProject: async () => new Map() },
    "@/lib/pullRequests/taskPullRequests": { refreshTaskPullRequests: async () => [] },
  });
}

function read(tasks = [task]) {
  const operation = load("src/lib/mcp/operations/tasks/operation.ts", stubs(tasks));
  return (query) => operation.GET({ nextUrl: { searchParams: new URLSearchParams(query) } });
}

test("a single ticket read stays whole when no fields are asked", async () => {
  const response = await read()({ ticket_number: "HTPR-8535" });
  assert.equal(response.status, 200);
  const [row] = response.body.tasks;
  assert.equal(row.id, 44769);
  assert.equal(row.description, task.description);
  assert.equal(row.title, task.title);
  assert.ok(row.skill_context !== undefined);
});

test("a single ticket read keeps only the asked fields", async () => {
  const response = await read()({ ticket_number: "HTPR-8535", fields: "title,section" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.tasks, [{ title: task.title, section: "Improvements" }]);
});

test("a read asks for no fields with an empty value and stays whole", async () => {
  const response = await read()({ ticket_number: "HTPR-8535", fields: "" });
  assert.equal(response.status, 200);
  assert.equal(response.body.tasks[0].description, task.description);
});

test("a batch read projects every ticket it returns", async () => {
  const second = { ...task, id: 44770, ticketNumber: "HTPR-8536", title: "Another ticket" };
  const response = await read([task, second])({ ticket_number: "HTPR-8535,HTPR-8536", fields: "ticketNumber" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.tasks, [{ ticketNumber: "HTPR-8535" }, { ticketNumber: "HTPR-8536" }]);
});
