const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7684-desktop-ai-chat-bearer";
const summary = {
  content: "Stored private AI summary",
  createdAt: new Date("2026-10-20T10:00:00.000Z"),
  updatedAt: new Date("2026-10-21T11:00:00.000Z"),
};
const summaryInclude = {
  take: 1,
  orderBy: { createdAt: "desc" },
  select: { content: true, updatedAt: true, createdAt: true },
};
const identifiers = [
  { task_id: "7684" },
  { ticket_number: "HTPR-7684" },
  { unique_index: "7684", project_id: "15" },
];

function fixture({ flagEnabled = true, flagError = false, agentId = null, management = null, projectId = 15, summaries = [summary], alias = false } = {}) {
  const user = { id: 985, email: "summary@example.test" };
  const task = { id: 7684, ticketNumber: "HTPR-7684", uniqueIndex: 7684, projectId };
  const allowedProjectWhere = { id: { in: [15] } };
  const queries = [];
  const flagReads = [];
  const { GET } = load("src/lib/mcp/operations/tasks/operation.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: handler => handler,
      validateMcpRouteAuth: async () => ({ user, agentId, management }),
      checkMcpRouteRateLimit: async () => null,
    },
    "@/lib/auth/agentScope": {},
    "@/lib/tasks/sameBoardRelations": {},
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: error => { throw error; } },
    "@/lib/flags/keys": { HTPR_7684_DESKTOP_AI_CHAT_BEARER_FLAG: flag },
    "@/lib/flags": {
      isFeatureEnabled: async (key, userId) => {
        flagReads.push({ key, userId });
        if (flagError) throw new Error("Flag lookup failed");
        return flagEnabled;
      },
    },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: (userId, requestedAgentId) => {
        assert.equal(userId, user.id);
        assert.equal(requestedAgentId, agentId);
        return allowedProjectWhere;
      },
    },
    "@/lib/prisma": {
      default: {
        task: {
          findMany: async query => {
            queries.push(query);
            const conditions = query.where.OR ?? [{ id: query.where.id }];
            const matchesIdentifier = conditions.some(condition =>
              condition.id?.in?.includes(task.id) ||
              condition.ticketNumber?.in?.includes(task.ticketNumber) ||
              (condition.projectId === task.projectId && condition.uniqueIndex === task.uniqueIndex));
            if (query.where.project !== allowedProjectWhere || task.projectId !== 15 || !matchesIdentifier) return [];
            const selected = { ...task };
            if (query.include.Task_Summary) {
              selected.Task_Summary = [...summaries]
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, query.include.Task_Summary.take);
            }
            return [selected];
          },
        },
      },
    },
    "@/lib/mcp/agents": {},
    "@/lib/agents/visibility": {},
    "@/lib/mcp/tasks/mappers": {
      taskMcpGetInclude: () => ({}),
      mapTaskToMcpGetResponse: task => ({ id: task.id, ticketNumber: task.ticketNumber }),
    },
    "@/lib/mcp/tasks/resolveTask": { findTaskByIdentifier: async () => alias ? { id: task.id } : null },
    "@/lib/mcp/pagination/cursor": {},
    "@/lib/mcp/listQuery": {},
    "@/lib/mcp/readListQuery": {},
    "@/lib/mcp/priorityFilter": {},
  });
  return {
    queries,
    flagReads,
    get: (query = identifiers[0]) => GET({ nextUrl: { searchParams: new URLSearchParams(query) } }),
  };
}

test("person with flag on can read the newest AI summary through every task identifier", async () => {
  for (const query of identifiers) {
    const older = { ...summary, content: "Older summary", createdAt: new Date("2026-10-19T00:00:00.000Z") };
    const f = fixture({ summaries: [older, summary] });
    const response = await f.get(query);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.tasks[0].ai_summary, {
      content: summary.content,
      updated_at: summary.updatedAt.toISOString(),
    });
    assert.equal(f.queries.length, 1);
    assert.deepEqual(f.queries[0].include.Task_Summary, summaryInclude);
    assert.deepEqual(f.flagReads, [{ key: flag, userId: 985 }]);
  }
});

test("person with flag on cannot read a summary from a board they cannot open", async () => {
  for (const query of identifiers) {
    const f = fixture({ projectId: 99 });
    const response = await f.get(query);
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "Task not found or access denied");
    assert.ok(!JSON.stringify(response.body).includes(summary.content));
    assert.deepEqual(f.queries[0].include.Task_Summary, summaryInclude);
  }
});

test("flag off omits ai_summary and the Task_Summary include", async () => {
  const f = fixture({ flagEnabled: false });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body.tasks[0], "ai_summary"), false);
  assert.equal(Object.hasOwn(f.queries[0].include, "Task_Summary"), false);
});

test("agent caller omits ai_summary without looking up the person flag", async () => {
  const f = fixture({ agentId: "agent-7684" });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body.tasks[0], "ai_summary"), false);
  assert.equal(Object.hasOwn(f.queries[0].include, "Task_Summary"), false);
  assert.deepEqual(f.flagReads, []);
});

test("person with flag on receives null when the task has no AI summary", async () => {
  const f = fixture({ summaries: [] });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal(response.body.tasks[0].ai_summary, null);
  assert.deepEqual(f.queries[0].include.Task_Summary, summaryInclude);
});

test("management caller omits ai_summary without looking up the person flag", async () => {
  const f = fixture({ management: { id: "management-7684" } });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body.tasks[0], "ai_summary"), false);
  assert.equal(Object.hasOwn(f.queries[0].include, "Task_Summary"), false);
  assert.deepEqual(f.flagReads, []);
});

test("failed flag lookup leaves task reads working without AI summary data", async () => {
  const f = fixture({ flagError: true });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body.tasks[0], "ai_summary"), false);
  assert.equal(Object.hasOwn(f.queries[0].include, "Task_Summary"), false);
  assert.deepEqual(f.flagReads, [{ key: flag, userId: 985 }]);
});

test("AI summary updated_at falls back to createdAt when updatedAt is null", async () => {
  const f = fixture({ summaries: [{ ...summary, updatedAt: null }] });
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.tasks[0].ai_summary, {
    content: summary.content,
    updated_at: summary.createdAt.toISOString(),
  });
});

test("alias re-query shares the authorized summary include", async () => {
  const f = fixture({ alias: true });
  const response = await f.get({ ticket_number: "OLD-7684" });
  assert.equal(response.status, 200);
  assert.equal(response.body.tasks[0].ai_summary.content, summary.content);
  assert.equal(f.queries.length, 2);
  assert.equal(f.queries[1].where.project, f.queries[0].where.project);
  assert.equal(f.queries[1].include, f.queries[0].include);
  assert.deepEqual(f.queries[1].include.Task_Summary, summaryInclude);
});

test("alias re-query cannot expose a summary from an inaccessible destination board", async () => {
  const f = fixture({ alias: true, projectId: 99 });
  const response = await f.get({ ticket_number: "OLD-7684" });
  assert.equal(response.status, 404);
  assert.equal(response.body.error, "Task not found or access denied");
  assert.ok(!JSON.stringify(response.body).includes(summary.content));
  assert.equal(f.queries.length, 2);
  assert.equal(f.queries[1].where.project, f.queries[0].where.project);
  assert.equal(f.queries[1].include, f.queries[0].include);
});
