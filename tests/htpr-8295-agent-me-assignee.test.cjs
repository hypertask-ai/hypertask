const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { load } = require("./task-route-loader.cjs");

const personFlag = "htpr-7733-person-assignment-filter";
const agentFlag = "htpr-8295-agent-me-assignee";
const user = { id: 6, email: "person@example.test" };
const callerAgent = "caller-agent";

function fixture(surface, { personFilter = true, agentFilter = true, agentId = callerAgent } = {}) {
  const queries = [];
  const flagReads = [];
  class NextResponse {
    static json(body, init = {}) { return Object.assign(new NextResponse(), { body, status: init.status ?? 200 }); }
  }
  const prisma = {
    project: { findMany: async () => [{ id: 15 }] },
    task: {
      count: async ({ where }) => { queries.push(where); return 0; },
      findMany: async ({ where }) => { queries.push(where); return []; },
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
      searchTasks: async () => [],
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
    // Every assignee predicate the handler put in a where, so the test does not depend on query order.
    assigneeFilters() {
      return queries.map((where) => where.assignees).filter(Boolean);
    },
    flagKeys() {
      return flagReads.map(({ key }) => key);
    },
    async run(params) {
      const response = await implementation.GET({ nextUrl: { searchParams: new URLSearchParams({ q: "Assignment", ...params }) } });
      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      return response.body;
    },
  };
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
  test(`${surface} assignee=me as an agent filters by that agent's assignment`, async () => {
    const f = fixture(surface);
    await f.run({ assigned_to: "me" });
    const filters = f.assigneeFilters();
    assert.ok(filters.length > 0, "the handler must filter on an assignee");
    for (const filter of filters) assert.deepEqual(filter, { some: { agentId: callerAgent } });
    assert.deepEqual(f.flagKeys(), [personFlag, agentFlag]);
  });

  test(`${surface} assignee=me as an agent with the flag off keeps owner matching`, async () => {
    const f = fixture(surface, { agentFilter: false });
    await f.run({ assigned_to: "me" });
    const filters = f.assigneeFilters();
    assert.ok(filters.length > 0);
    for (const filter of filters) assert.deepEqual(filter, { some: { userId: user.id, agentId: null } });
    assert.deepEqual(f.flagKeys(), [personFlag, agentFlag]);
  });

  test(`${surface} assignee=me as a person is unchanged and reads no agent flag`, async () => {
    const f = fixture(surface, { agentId: null });
    await f.run({ assigned_to: "me" });
    const filters = f.assigneeFilters();
    assert.ok(filters.length > 0);
    for (const filter of filters) assert.deepEqual(filter, { some: { userId: user.id, agentId: null } });
    assert.deepEqual(f.flagKeys(), [personFlag]);
  });

  test(`${surface} assignee=me as an agent with both flags off keeps every owner-backed row`, async () => {
    const f = fixture(surface, { personFilter: false, agentFilter: false });
    await f.run({ assigned_to: "me" });
    const filters = f.assigneeFilters();
    assert.ok(filters.length > 0);
    for (const filter of filters) assert.deepEqual(filter, { some: { userId: user.id } });
  });

  test(`${surface} unassigned is unchanged for an agent`, async () => {
    const f = fixture(surface);
    await f.run({ assigned_to: "unassigned" });
    const filters = f.assigneeFilters();
    assert.ok(filters.length > 0);
    for (const filter of filters) assert.deepEqual(filter, { none: {} });
  });

  test(`${surface} an explicit user id is unchanged for an agent`, async () => {
    const f = fixture(surface);
    await f.run({ assigned_to: "6" });
    const filters = f.assigneeFilters();
    assert.ok(filters.length > 0);
    for (const filter of filters) assert.deepEqual(filter, { some: { userId: { in: [6] }, agentId: null } });
  });
}
