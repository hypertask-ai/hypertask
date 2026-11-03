const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { load } = require("./task-route-loader.cjs");

const personFlag = "htpr-7733-person-assignment-filter";
const agentFlag = "htpr-8295-agent-me-assignee";
const user = { id: 6, email: "person@example.test" };
const callerAgent = "caller-agent";
const assignments = [
  [{ userId: 6, agentId: callerAgent }],
  [{ userId: 6, agentId: null }],
  [{ userId: 6, agentId: "other-agent" }],
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

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part) => matches(row, part));
    if (key === "AND") return value.every((part) => matches(row, part));
    if (key === "NOT") return !matches(row, value);
    if (value === null || typeof value !== "object") return row[key] === value;
    if ("some" in value) return row[key].some((item) => matches(item, value.some));
    if ("none" in value) return !row[key].some((item) => matches(item, value.none));
    if ("in" in value) return value.in.includes(row[key]);
    return matches(row[key], value);
  });
}

function fixture(surface, { personFilter = true, agentFilter = true, agentId = callerAgent } = {}) {
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
      validateMcpRouteAuth: async () => (agentId ? { user, agentId } : { user }),
      checkMcpRouteRateLimit: async () => null,
    },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (request, error) => { throw error; } },
    "@/lib/prisma": { default: prisma },
    "@/lib/flags/keys": {
      HTPR_7733_PERSON_ASSIGNMENT_FILTER_FLAG: personFlag,
      HTPR_8295_AGENT_ME_ASSIGNEE_FLAG: agentFlag,
      HTPR_7684_DESKTOP_AI_CHAT_BEARER_FLAG: "htpr-7684-desktop-ai-chat-bearer",
    },
    "@/lib/flags": {
      isFeatureEnabled: async (key, userId) => {
        flagReads.push({ key, userId });
        if (key === personFlag) return personFilter;
        if (key === agentFlag) return agentFilter;
        return false;
      },
    },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}), projectContentAccessWhere: () => ({}) },
    "@/lib/mcp/agents": { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => undefined },
    "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
    "@/lib/mcp/tasks/mappers": {
      mcpTaskUserCommentCount: true, mcpTaskLabelSelect: {},
      mapTaskAssignee: (row) => row, mapTaskDescriptionContent: () => "",
      mapMcpTaskLabel: ({ label }) => ({ id: label.id, name: label.value || "" }),
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
    "@/utils/controllers/search/document": { turbopufferSearchTaskIds: async () => [] },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      searchPreviewText: (text) => text,
      searchTasks: async () => rows.map(({ id }) => ({ id })),
      searchComments: async () => [],
    },
    "@/lib/search/serverOperators": {
      parseSearchWithChipNames: async (query) => ({ text: query, filters: {} }),
    },
    "@/lib/search/rankedWhere": {},
  };
  const files = {
    "MCP list": "src/lib/mcp/operations/tasks/operation.ts",
    "MCP search": "src/lib/mcp/operations/tasks/search/operation.ts",
  };
  const implementation = load(files[surface], mocks);
  return {
    queries, flagReads,
    async run(params) {
      const response = await implementation.GET({ nextUrl: { searchParams: new URLSearchParams({ q: "Assignment", ...params }) } });
      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      return response.body;
    },
  };
}

function assigneeWhere(fixtureState) {
  const [where] = fixtureState.queries;
  return where.assignees.some;
}

test("agent me filter is a low-risk bugfix on for Everyone by default", () => {
  const definition = load("src/lib/flags/definitions/htpr-8295-agent-me-assignee.ts", {});
  const flag = definition.default;
  assert.equal(definition.HTPR_8295_AGENT_ME_ASSIGNEE_FLAG, agentFlag);
  assert.equal(flag.key, definition.HTPR_8295_AGENT_ME_ASSIGNEE_FLAG);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason.length > 0);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

for (const surface of ["MCP list", "MCP search"]) {
  test(`${surface} assignee=me as an agent returns only that agent's tickets`, async () => {
    const f = fixture(surface);
    const result = await f.run({ assigned_to: "me" });
    assert.deepEqual(result.tasks.map(({ id }) => id), [1]);
    assert.equal(result.total, 1);
    assert.deepEqual(assigneeWhere(f), { agentId: callerAgent });
    assert.deepEqual(f.flagReads.map(({ key }) => key), [personFlag, agentFlag]);
  });

  test(`${surface} assignee=me as an agent with the flag off keeps owner matching`, async () => {
    const f = fixture(surface, { agentFilter: false });
    const result = await f.run({ assigned_to: "me" });
    assert.deepEqual(result.tasks.map(({ id }) => id), [2]);
    assert.deepEqual(assigneeWhere(f), { userId: user.id, agentId: null });
  });

  test(`${surface} assignee=me as a person is unchanged and reads no agent flag`, async () => {
    const f = fixture(surface, { agentId: undefined });
    const result = await f.run({ assigned_to: "me" });
    assert.deepEqual(result.tasks.map(({ id }) => id), [2]);
    assert.deepEqual(assigneeWhere(f), { userId: user.id, agentId: null });
    assert.deepEqual(f.flagReads.map(({ key }) => key), [personFlag]);
  });

  test(`${surface} assignee=me as an agent with both flags off keeps every owner-backed row`, async () => {
    const f = fixture(surface, { personFilter: false, agentFilter: false });
    const result = await f.run({ assigned_to: "me" });
    assert.deepEqual(result.tasks.map(({ id }) => id), [1, 2, 3]);
    assert.deepEqual(assigneeWhere(f), { userId: user.id });
  });

  test(`${surface} unassigned is unchanged for an agent`, async () => {
    const f = fixture(surface);
    const result = await f.run({ assigned_to: "unassigned" });
    assert.deepEqual(result.tasks.map(({ id }) => id), [5]);
    assert.equal(result.total, 1);
  });

  test(`${surface} an explicit user id is unchanged for an agent`, async () => {
    const f = fixture(surface);
    const result = await f.run({ assigned_to: "6" });
    assert.deepEqual(result.tasks.map(({ id }) => id), [2]);
    assert.deepEqual(assigneeWhere(f), { userId: { in: [6] }, agentId: null });
  });
}
