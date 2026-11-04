const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const MESSAGE = "assigned_to must be me, unassigned, or a comma-separated list of user ids";

function loadRoute() {
  const taskQueries = [];
  const prisma = {
    project: { findMany: async () => [{ id: 15 }] },
    section: { findMany: async () => [] },
    task: {
      count: async () => 0,
      findMany: async (query) => {
        taskQueries.push(query);
        return [];
      },
    },
  };
  const stubs = {
    "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope,
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user: { id: 6, email: "owner@example.test" }, agentId: null }),
      checkMcpRouteRateLimit: async () => null,
      mcpRouteUnauthorizedResponse: async () => ({ status: 401 }),
    },
    "next/server": {
      NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
    },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/mcp/agents": { mapVisibleMcpAgent: () => undefined, mcpVisibleAgentSelect: () => ({}) },
    "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
    "@/lib/mcp/tasks/mappers": {
      mapMcpTaskLabel: () => ({}),
      mapTaskAssignee: () => undefined,
      mapTaskDescriptionContent: () => "",
      mapTaskToMcpGetResponse: (task) => task,
      mcpTaskLabelSelect: {},
      taskMcpGetInclude: {},
      mcpTaskUserCommentCount: true,
    },
    "@/lib/mcp/pagination/cursor": { decodeCursor: () => null, encodeCursor: () => null },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/mcp/tasks/resolveTask": {
      findTaskByIdentifier: async () => null,
      taskIdentifierErrorResponse: () => null,
      TaskIdentifierAmbiguityError: class TaskIdentifierAmbiguityError extends Error {},
    },
    "@/lib/flags": { isFeatureEnabled: async () => false },
  };
  const route = loadModule("src/lib/mcp/operations/tasks/operation.ts", stubs);
  return { GET: route.GET, taskQueries };
}

async function list(params) {
  const route = loadRoute();
  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ project_id: "15", ...params }) },
  });
  return { response, taskQueries: route.taskQueries };
}

function loadSearch() {
  const taskQueries = [];
  const prisma = {
    project: { findMany: async () => [{ id: 15 }] },
    section: { findMany: async () => [] },
    task: {
      count: async () => 0,
      findMany: async (query) => {
        taskQueries.push(query);
        return [];
      },
    },
  };
  const stubs = {
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user: { id: 6, email: "owner@example.test" }, agentId: null }),
      checkMcpRouteRateLimit: async () => null,
    },
    "next/server": {
      NextResponse: class NextResponse {
        static json(body, init = {}) {
          return Object.assign(new NextResponse(), { body, status: init.status ?? 200 });
        }
      },
    },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (request, error) => { throw error; } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}), projectContentAccessWhere: () => ({}) },
    "@/lib/mcp/agents": { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => undefined },
    "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
    "@/lib/mcp/tasks/mappers": {
      mcpTaskUserCommentCount: true,
      mcpTaskLabelSelect: {},
      mapTaskAssignee: (row) => row,
      mapTaskDescriptionContent: () => "",
      mapMcpTaskLabel: ({ label }) => ({ id: label.id, name: label.value || "" }),
    },
    "@/lib/mcp/tasks/resolveTask": { taskIdentifierErrorResponse: () => null },
    "@/lib/mcp/pagination/cursor": { encodeCursor: () => null },
    "@/lib/mcp/priorityFilter": { parsePriorityFilter: () => [] },
    "@/utils/controllers/search/document": { turbopufferSearchTaskIds: async () => [] },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      searchPreviewText: (text) => text,
      searchTasks: async () => [],
      searchComments: async () => [],
    },
    "@/lib/search/serverOperators": {
      parseSearchWithChipNames: async (query) => ({ text: query, filters: {} }),
    },
  };
  const route = loadModule("src/lib/mcp/operations/tasks/search/operation.ts", stubs);
  return { GET: route.GET, taskQueries };
}

async function search(params) {
  const route = loadSearch();
  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ project_id: "15", q: "Assignment", ...params }) },
  });
  return { response, taskQueries: route.taskQueries };
}

test("HTPR-8340: an assignee name answers 400 instead of listing the whole board", async () => {
  for (const value of ["RUNNER 7", "Runner 7", "6,Runner 7", "0"]) {
    const { response, taskQueries } = await list({ assigned_to: value });
    assert.equal(response.status, 400, value);
    assert.equal(response.body.message, MESSAGE, value);
    assert.equal(taskQueries.length, 0, value);
  }
});

test("HTPR-8340: a valid user id still filters to that assignee", async () => {
  const { response, taskQueries } = await list({ assigned_to: "6" });
  assert.equal(response.status, 200);
  assert.deepEqual(taskQueries[0].where.assignees, { some: { userId: { in: [6] } } });
});

test("HTPR-8340: me and unassigned keep their filters", async () => {
  const me = await list({ assigned_to: "me" });
  assert.deepEqual(me.taskQueries[0].where.assignees, { some: { userId: 6 } });

  const nobody = await list({ assigned_to: "unassigned" });
  assert.deepEqual(nobody.taskQueries[0].where.assignees, { none: {} });
});

test("HTPR-8340: search refuses an assignee name and honours a comma list", async () => {
  const invalid = await search({ assigned_to: "Runner 7" });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.response.body.message, MESSAGE);
  assert.equal(invalid.taskQueries.length, 0);

  const list = await search({ assigned_to: "6,7" });
  assert.equal(list.response.status, 200);
  assert.deepEqual(list.taskQueries[0].where.assignees, { some: { userId: { in: [6, 7] } } });
});
