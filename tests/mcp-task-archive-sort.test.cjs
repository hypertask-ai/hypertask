const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routePath = path.join(root, "src/app/api/mcp/tasks/route.ts");
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
    "@/lib/flags": {
      HTPR_6530_MCP_LIST_QUERY_FLAG: "htpr-6530-mcp-list-query",
      isFeatureEnabled: async () => false,
    },
    "@/lib/mcp/listQuery": {
      hasPrWhere: () => null,
      normalizeTaskStatus: (status) => status,
      parseAssigneeFilter: () => ({ ok: true, value: null }),
      parseNumericCursor: () => null,
      projectRows: (rows) => rows,
      resolveListLimit: (_, fallback) => fallback,
      withTaskPresentation: (task) => task,
    },
    "@/lib/mcp/readListQuery": {
      readEnabledListQuery: () => ({ listQuery: null }),
    },
  };
  const routeModule = { exports: {} };

  new Function("module", "exports", "require", routeJavascript)(
    routeModule,
    routeModule.exports,
    (request) => stubs[request] ?? require(request),
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
