const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routePath = path.join(root, "src/lib/mcp/operations/tasks/operation.ts");
const routeJavascript = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadRoute() {
  const taskQueries = [];
  const prisma = {
    project: {
      findMany: async () => [{ id: 15 }],
    },
    task: {
      count: async () => 2,
      findMany: async (query) => {
        taskQueries.push(query);
        return [];
      },
    },
  };
  const stubs = {
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/tasks/sameBoardRelations": require("./task-route-loader.cjs").load("src/lib/tasks/sameBoardRelations.ts", {}),
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200 }),
      },
    },
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({
        user: { id: 6, email: "owner@example.test" },
        agentId: null,
      }),
      mcpUnauthorizedResponse: async () => ({ status: 401 }),
    },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: () => ({}),
    },
    "@/lib/mcp/agents": {
      mapVisibleMcpAgent: () => undefined,
      mcpVisibleAgentSelect: () => ({}),
    },
    "@/lib/agents/visibility": {
      accessibleAgentWhere: () => ({}),
    },
    "@/lib/mcp/tasks/mappers": {
      mapMcpTaskLabel: () => ({}),
      mapTaskAssignee: () => undefined,
      mapTaskDescriptionContent: () => "",
      mapTaskToMcpGetResponse: (task) => task,
      mcpTaskLabelSelect: {},
      taskMcpGetInclude: {},
      mcpTaskUserCommentCount: true,
    },
    "@/lib/mcp/pagination/cursor": {
      decodeCursor: () => null,
      encodeCursor: () => null,
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/mcp/tasks/resolveTask": {
      findTaskByIdentifier: async () => null,
      TaskIdentifierAmbiguityError: class TaskIdentifierAmbiguityError extends Error {},
    },
    "@/lib/flags": {

      isFeatureEnabled: async () => false,
    },
    "@/lib/mcp/listQuery": {
      hasPrWhere: () => null,
      normalizeTaskStatus: (status) => status,
      parseTaskStatusParam: (status) => status || "Normal",
      parseAssigneeFilter: () => ({ ok: true, value: null }),
      parseNumericCursor: () => null,
      projectRows: (rows) => rows,
      resolveListLimit: (_, fallback) => fallback,
      withTaskPresentation: (task) => task,
    },
    "@/lib/mcp/readListQuery": {
      readListQuery: () => ({ listQuery: null }),
    },
    "@/lib/mcp/priorityFilter": {
      parsePriorityFilter: () => [],
    },
    "@/lib/mcp/listParams": require("./task-route-loader.cjs").load("src/lib/mcp/listParams.ts", {}),
  };
  const routeModule = { exports: {} };

  new Function("module", "exports", "require", routeJavascript)(
    routeModule,
    routeModule.exports,
    (request) => request === "@/lib/mcp/routeWrapper"
      ? require("./helpers/mcp-route-wrapper.cjs").loadRouteWrapper(stubs)
      : stubs[request] ?? require(request),
  );

  return { GET: routeModule.exports.GET, taskQueries };
}

test("archived task lists sort missing update timestamps after recent tasks", async () => {
  const route = loadRoute();
  const response = await route.GET({
    nextUrl: {
      searchParams: new URLSearchParams({
        project_id: "15",
        status: "Archive",
        section: "Done",
        sort_by: "updatedAt",
        sort_order: "desc",
        limit: "10",
      }),
    },
  });

  assert.equal(response.status, 200);
  assert.equal(route.taskQueries.length, 1);
  assert.deepEqual(route.taskQueries[0].where, {
    projectId: 15,
    status: "Archive",
    section: "Done",
  });
  assert.deepEqual(route.taskQueries[0].orderBy, [
    { updatedAt: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ]);
});

test("HTPR-7344: uppercase sort_order lists like lowercase instead of answering 500", async () => {
  const route = loadRoute();
  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ project_id: "15", sort_order: "DESC" }) },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(route.taskQueries[0].orderBy, [
    { updatedAt: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ]);
});

test("HTPR-7344: unknown sort_order and NUL bytes answer 400 before any task query", async () => {
  for (const params of [{ sort_order: "ascending" }, { search: "a\0b" }, { section: "\0" }]) {
    const route = loadRoute();
    const response = await route.GET({
      nextUrl: { searchParams: new URLSearchParams({ project_id: "15", ...params }) },
    });

    assert.equal(response.status, 400, JSON.stringify(params));
    assert.equal(route.taskQueries.length, 0);
  }
});
