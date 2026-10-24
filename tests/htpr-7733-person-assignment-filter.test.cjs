const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7733-person-assignment-filter";
const user = { id: 6, email: "person@example.test" };
const assignments = [
  [{ userId: 6, agentId: "owned-agent" }],
  [{ userId: 6, agentId: null }],
  [{ userId: 6, agentId: "owned-agent" }, { userId: 6, agentId: null }],
  [{ userId: 7, agentId: null }],
  [],
];
const rows = assignments.map((assignees, index) => ({
  id: index + 1, uniqueIndex: index + 1, projectId: 15, project: { title: "Board" },
  title: "Assignment", description: "", status: "Normal", section: "Todo",
  assignees: assignees.map((assignment) => ({
    ...assignment, user: { displayName: assignment.userId === 6 ? "Person" : "Other", email: assignment.userId === 6 ? user.email : "other@example.test" },
  })), subTasks: [], taskLabels: [], _count: { taskLabels: 0, comments: 0 },
  createdAt: new Date("2026-10-24T00:00:00Z"),
}));
rows.push({ ...rows[1], id: 99, projectId: 99 });

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part) => matches(row, part));
    if (key === "AND") return value.every((part) => matches(row, part));
    if (key === "NOT") return !matches(row, value);
    if (value === null || typeof value !== "object") return row[key] === value;
    if ("some" in value) return row[key].some((item) => matches(item, value.some));
    if ("none" in value) return !row[key].some((item) => matches(item, value.none));
    if ("in" in value) return value.in.includes(row[key]);
    if ("equals" in value) return String(row[key]).toLowerCase() === value.equals.toLowerCase();
    if ("contains" in value) return String(row[key] ?? "").toLowerCase().includes(value.contains.toLowerCase());
    return matches(row[key], value);
  });
}

function fixture(surface, enabled, { legacy = false, ranked = false, operatorFilter } = {}) {
  const queries = [];
  const flagReads = [];
  class NextResponse {
    static json(body, init = {}) { return Object.assign(new NextResponse(), { body, status: init.status ?? 200 }); }
  }
  const prisma = {
    project: { findMany: async () => [{ id: 15 }] },
    task: {
      count: async ({ where }) => {
        queries.push(where);
        return rows.filter((row) => matches(row, where)).length;
      },
      findMany: async ({ where }) => {
        queries.push(where);
        return rows.filter((row) => matches(row, where));
      },
    },
  };
  const mocks = {
    ai: { tool: (definition) => definition },
    "next/server": { NextResponse },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user, agentId: "caller-agent" }),
      checkMcpRouteRateLimit: async () => null,
    },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (request, error) => { throw error; } },
    "@/lib/prisma": { default: prisma },
    "@/lib/flags/keys": { HTPR_7733_PERSON_ASSIGNMENT_FILTER_FLAG: flag },
    "@/lib/flags": {
      isFeatureEnabled: async (key, userId) => {
        if (key !== flag) return false;
        flagReads.push({ key, userId });
        return enabled;
      },
    },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}), projectContentAccessWhere: () => ({}) },
    "@/lib/mcp/agents": { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => undefined },
    "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
    "@/lib/mcp/tasks/mappers": {
      mcpTaskUserCommentCount: true, mcpTaskLabelSelect: {},
      mapTaskAssignee: (row) => row, mapTaskDescriptionContent: () => "",
    },
    "@/lib/mcp/tasks/resolveTask": { taskIdentifierErrorResponse: () => null },
    "@/lib/mcp/pagination/cursor": { encodeCursor: () => null },
    "@/lib/mcp/priorityFilter": { parsePriorityFilter: () => [] },
    "@/lib/ai/chatStream/request": { statusSchema: z.string(), sortOrderSchema: z.string() },
    "@/lib/ai/tools/helpers": {
      getAccessibleProjectIds: async () => [15], normalizePriorityInput: () => [],
      sanitizeForJson: (value) => value, mapTaskSearchItem: (row) => ({ id: row.id }),
    },
    "@/app/api/ai/chat/stream/bulkTools": { buildSearchTotalMetadata: (total) => ({ total }) },
    "@/utils/controllers/search/document": { turbopufferSearchTaskIds: async () => ranked ? [1, 2, 3, 4, 5, 99] : [] },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      searchPreviewText: (text) => text,
      searchTasks: async () => rows.map(({ id }) => ({ id })),
      searchComments: async () => [],
    },
    "@/lib/search/serverOperators": {
      parseSearchWithChipNames: async (query) => operatorFilter
        ? { text: ranked ? "Assignment" : "", filters: { assignee: [operatorFilter] } }
        : { text: query, filters: {} },
    },
    ...(operatorFilter ? {} : { "@/lib/search/rankedWhere": {} }),
    ...(legacy ? { "@/lib/mcp/readListQuery": { readListQuery: () => ({ listQuery: null }) } } : {}),
  };
  const files = {
    "MCP list": "src/lib/mcp/operations/tasks/operation.ts",
    "MCP search": "src/lib/mcp/operations/tasks/search/operation.ts",
    "AI list": "src/lib/ai/tools/listTasks.ts",
    "AI search": "src/lib/ai/tools/searchTasks.ts",
    "App search": "src/utils/controllers/search/searchDocuments.ts",
  };
  const implementation = load(files[surface], mocks);
  return {
    queries, flagReads,
    async run(params) {
      if (surface === "App search") {
        const result = await implementation.searchDocuments(user.id, `assignee:${operatorFilter.value}`, [15], "Normal");
        assert.equal(result.status, 200);
        const tasks = result.json.processedData.All.map(({ taskId }) => ({ id: taskId }));
        return { tasks, total: tasks.length };
      }
      if (surface.startsWith("MCP")) {
        const response = await implementation.GET({ nextUrl: { searchParams: new URLSearchParams({ q: "Assignment", ...params }) } });
        assert.equal(response.status, 200);
        assert.equal(response.body.success, true);
        return response.body;
      }
      const context = { user, sendStatus: () => {} };
      const tool = surface === "AI list"
        ? implementation.createListTasksTool(context).hypertask_list_tasks
        : implementation.createSearchTasksTool(context).hypertask_search_tasks;
      const result = await tool.execute({
        query: "Assignment", labels: [], status: "Normal", limit: 50, offset: 0,
        sort: "relevance", sort_by: "updatedAt", sort_order: "desc", ...params,
      });
      assert.equal(result.success, true);
      return result;
    },
  };
}

for (const surface of ["MCP list", "MCP search", "AI list", "AI search"]) {
  const variants = surface.startsWith("MCP") ? ["assigned_to", "filter.assignee"] : ["assigned_to"];
  for (const parameter of variants) {
    const values = surface === "AI search" || (surface === "MCP search" && parameter === "assigned_to")
      ? ["me", "6"] : ["me", "6", "6,7"];
    for (const value of values) {
      for (const enabled of [true, false]) {
        for (const ranked of surface.endsWith("search") ? [false, true] : [false]) {
          test(`${surface} ${parameter}=${value}, flag=${enabled}, ranked=${ranked}: direct and mixed allowed; agent-only ${enabled ? "refused" : "legacy allowed"}`, async () => {
            const f = fixture(surface, enabled, { legacy: parameter === "assigned_to", ranked });
            const result = await f.run({ [parameter]: value });
            const expected = [...(enabled ? [] : [1]), 2, 3, ...(value === "6,7" ? [4] : [])];
            assert.deepEqual(result.tasks.map(({ id }) => id), expected);
            assert.equal(result.total, expected.length);
            assert.equal(f.queries.length, 2);
            for (const where of f.queries) {
              assert.equal(Object.hasOwn(where.assignees.some, "agentId"), enabled);
              if (enabled) assert.equal(where.assignees.some.agentId, null);
            }
            assert.deepEqual(f.flagReads, [{ key: flag, userId: user.id }]);
          });
        }
      }
    }
    for (const enabled of [true, false]) {
      test(`${surface} ${parameter}=unassigned is unchanged, flag=${enabled}`, async () => {
        const result = await fixture(surface, enabled, { legacy: parameter === "assigned_to" }).run({ [parameter]: "unassigned" });
        assert.deepEqual(result.tasks.map(({ id }) => id), [5]);
        assert.equal(result.total, 1);
      });
    }
  }
  test(`${surface} without a person filter keeps agent assignments without a flag lookup`, async () => {
    const f = fixture(surface, true);
    const result = await f.run({});
    assert.deepEqual(result.tasks.map(({ id }) => id), [1, 2, 3, 4, 5]);
    assert.deepEqual(f.flagReads, []);
  });
}

for (const surface of ["MCP search", "App search"]) {
  for (const filter of [
    { value: "6" },
    { value: "Person", userIds: [6] },
    { value: "Person" },
    { value: user.email },
  ]) {
    for (const enabled of [true, false]) {
      for (const ranked of [true, false]) {
        test(`${surface} assignee:${filter.value}, resolved=${Boolean(filter.userIds)}, flag=${enabled}, ranked=${ranked}: agent-only now refused; direct and mixed still allowed`, async () => {
          const f = fixture(surface, enabled, { ranked, operatorFilter: { ...filter, negated: false } });
          const result = await f.run({});
          const expected = [...(enabled ? [] : [1]), 2, 3];
          assert.deepEqual(result.tasks.map(({ id }) => id), expected);
          assert.equal(result.total, expected.length);
          assert.deepEqual(f.flagReads, [{ key: flag, userId: user.id }]);
          for (const where of f.queries) {
            const clause = where.AND.find((part) => part.OR)?.OR[0].assignees.some;
            if (clause) {
              assert.equal(Object.hasOwn(clause, "agentId"), enabled);
              if (enabled) assert.equal(clause.agentId, null);
            }
          }
        });
        test(`${surface} -assignee:${filter.value}, resolved=${Boolean(filter.userIds)}, flag=${enabled}, ranked=${ranked}: human assignments excluded; agent-only retained with flag`, async () => {
          const f = fixture(surface, enabled, { ranked, operatorFilter: { ...filter, negated: true } });
          const result = await f.run({});
          const expected = [...(enabled ? [1] : []), 4, 5];
          assert.deepEqual(result.tasks.map(({ id }) => id), expected);
          assert.equal(result.total, expected.length);
          assert.deepEqual(f.flagReads, [{ key: flag, userId: user.id }]);
        });
      }
    }
  }
}
