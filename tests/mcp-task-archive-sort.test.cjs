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

function loadRoute(tasks = []) {
  const taskQueries = [];
  const prisma = {
    project: {
      findMany: async () => [{ id: 15 }],
    },
    task: {
      count: async () => 2,
      findMany: async (query) => {
        taskQueries.push(query);
        return tasks.map((task) => Object.fromEntries(
          Object.keys(query.select).map((key) => [key, task[key]]),
        ));
      },
    },
  };
  const stubs = {
    "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope,
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
    "@/lib/flags/keys": {
      HTPR_7684_DESKTOP_AI_CHAT_BEARER_FLAG: "htpr-7684-desktop-ai-chat-bearer",
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

test("task lists select and return stored blocker comment markers", async () => {
  const route = loadRoute([101, null].map((blockerCommentId, index) => ({
    id: 42 + index,
    projectId: 15,
    blockerCommentId,
    title: "Blocked task",
    section: "In Progress",
    status: "Normal",
    project: { id: 15, title: "Board" },
    assignees: [],
    taskLabels: [],
    subTasks: [],
    savedContent: [],
    _count: { taskLabels: 0, comments: 1 },
    createdAt: new Date("2026-10-24T12:00:00Z"),
  })));
  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ project_id: "15" }) },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(route.taskQueries.length, 1);
  assert.equal(route.taskQueries[0].select.blockerCommentId, true);
  assert.deepEqual(response.body.tasks.map(({ id, blockerCommentId }) => ({ id, blockerCommentId })), [
    { id: 42, blockerCommentId: 101 },
    { id: 43, blockerCommentId: null },
  ]);
});

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

test("HTPR-7344: ids too large for the database answer 400 before any task query", async () => {
  for (const params of [
    { task_id: "99999999999" },
    { unique_index: "99999999999" },
    { section_id: "99999999999" },
    { created_by: "99999999999" },
    { assigned_to: "6,99999999999" },
  ]) {
    const route = loadRoute();
    const response = await route.GET({
      nextUrl: { searchParams: new URLSearchParams({ project_id: "15", ...params }) },
    });

    assert.equal(response.status, 400, JSON.stringify(params));
    assert.match(response.body.message, /too large/, JSON.stringify(params));
    assert.equal(route.taskQueries.length, 0);
  }
});

test("HTPR-7344: ids at the database maximum still list", async () => {
  const route = loadRoute();
  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ project_id: "15", created_by: "2147483647", assigned_to: "6" }) },
  });

  assert.equal(response.status, 200);
  assert.equal(route.taskQueries[0].where.userId, 2147483647);
});
