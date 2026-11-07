const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { load } = require("./task-route-loader.cjs");

const user = { id: 6, email: "person@example.test" };
const callerAgent = "caller-agent";
const designPassLabel = "f2fe3edf-735a-44de-a0b5-e40845b4839d";

function taskRow({ id, section, projectId = 15 }) {
  const at = new Date("2026-11-04T00:00:00.000Z");
  return {
    id,
    blockerCommentId: null,
    ticketNumber: `HTPR-${id}`,
    uniqueIndex: id,
    title: `Task ${id}`,
    section,
    description_: null,
    sectionId: null,
    parentTaskId: null,
    projectId,
    project: { id: projectId, title: "Board", staleWarnDays: 1, staleHotDays: 3 },
    parentTask: null,
    status: "Normal",
    priority: { Priority_Value: "Medium" },
    dueDate: null,
    createdAt: at,
    updatedAt: at,
    permanentlyDeleteAt: null,
    sectionChangedAt: null,
    lastCommentAt: null,
    agent: null,
    assignees: [],
    taskLabels: [],
    savedContent: [],
    _count: { taskLabels: 0, comments: 0 },
    subTasks: [],
  };
}

function fixture(rows, doneTitles, { showWaiting = false } = {}) {
  const doneTitleCalls = [];
  class NextResponse {
    static json(body, init = {}) { return Object.assign(new NextResponse(), { body, status: init.status ?? 200 }); }
  }
  const prisma = {
    project: { findMany: async () => [{ id: 15 }] },
    task: {
      count: async () => rows.length,
      findMany: async () => rows,
    },
  };
  const mocks = {
    ai: { tool: (definition) => definition },
    "next/server": { NextResponse },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user, agentId: callerAgent }),
      checkMcpRouteRateLimit: async () => null,
    },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (request, error) => { throw error; } },
    "@/lib/prisma": { default: prisma },
    "@/lib/flags/keys": {
      HTPR_7733_PERSON_ASSIGNMENT_FILTER_FLAG: "htpr-7733-person-assignment-filter",
      HTPR_8295_AGENT_ME_ASSIGNEE_FLAG: "htpr-8295-agent-me-assignee",
      HTPR_7684_DESKTOP_AI_CHAT_BEARER_FLAG: "htpr-7684-desktop-ai-chat-bearer",
      HTPR_8738_PICKER_SKIPS_PARKED_FLAG: "htpr-8738-picker-skips-parked",
    },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => showWaiting && key === "htpr-8738-picker-skips-parked",
    },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
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
    "@/lib/search/serverOperators": { parseSearchWithChipNames: async (query) => ({ text: query, filters: {} }) },
    "@/lib/search/rankedWhere": {},
    "@/utils/controllers/notifications/inboxZero": {
      loadDoneTitlesByProject: async (projectIds, nameFallback) => {
        doneTitleCalls.push({ projectIds: [...projectIds], nameFallback });
        return doneTitles;
      },
    },
  };
  const implementation = load("src/lib/mcp/operations/tasks/operation.ts", mocks);
  return {
    doneTitleCalls,
    async run(params) {
      const response = await implementation.GET({
        nextUrl: { searchParams: new URLSearchParams({ project_id: "15", ...params }) },
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      return response.body.tasks;
    },
  };
}

test("a label-filtered task list says which column is a finished column", async () => {
  const f = fixture(
    [taskRow({ id: 1, section: "Flag: Everyone" }), taskRow({ id: 2, section: "Bugs" })],
    new Map([[15, new Set(["flag: everyone"])]]),
  );
  const tasks = await f.run({ labels: designPassLabel });
  assert.deepEqual(
    tasks.map((task) => ({ section: task.section, sectionIsDone: task.sectionIsDone })),
    [
      { section: "Flag: Everyone", sectionIsDone: true },
      { section: "Bugs", sectionIsDone: false },
    ],
  );
});

test("the list asks each board once for its finished columns", async () => {
  const f = fixture(
    [taskRow({ id: 1, section: "Flag: Everyone" }), taskRow({ id: 2, section: "Bugs" })],
    new Map([[15, new Set(["flag: everyone"])]]),
  );
  await f.run({ labels: designPassLabel });
  assert.equal(f.doneTitleCalls.length, 1);
  assert.deepEqual(f.doneTitleCalls[0].projectIds, [15]);
});

test("a board that answers with no finished column marks every task as unfinished", async () => {
  const f = fixture([taskRow({ id: 1, section: "Done" })], new Map([[15, new Set()]]));
  const tasks = await f.run({});
  assert.equal(tasks[0].sectionIsDone, false);
});

test("task list includes the waiting person only while the parked-pick flag is on", async () => {
  const row = taskRow({ id: 1, section: "Bugs" });
  row.waitingOnUserId = 6;
  const hidden = await fixture([row], new Map()).run({});
  assert.equal(Object.hasOwn(hidden[0], "waitingOnUserId"), false);
  const shown = await fixture([row], new Map(), { showWaiting: true }).run({});
  assert.equal(shown[0].waitingOnUserId, 6);
});

test("a board missing from the finished-column answer falls back to the column name", async () => {
  const f = fixture([taskRow({ id: 1, section: "Done" })], new Map());
  const tasks = await f.run({});
  assert.equal(tasks[0].sectionIsDone, true);
});
