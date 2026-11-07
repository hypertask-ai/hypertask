const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const callerAgentId = "11111111-1111-4111-8111-111111111111";
const otherAgentId = "22222222-2222-4222-8222-222222222222";
const flag = "htpr-8896-skip-taken-work";

function at(second) {
  return new Date(`2026-11-07T00:00:${String(second).padStart(2, "0")}.000Z`);
}

function task(id, extra = {}) {
  return {
    id,
    ticketNumber: `HTPR-${id}`,
    title: `Task ${id}`,
    section: "Ready",
    status: "Normal",
    projectId: 15,
    waitingOnUserId: null,
    blockerCommentId: null,
    priority: null,
    dueDate: null,
    createdAt: at(id),
    taskLabels: [],
    relatedFromTasks: [],
    relatedToTasks: [],
    pullRequests: [],
    decisionRequests: [],
    agentRuns: [],
    ...extra,
  };
}

function rowMatches(row, none) {
  if (none.lifecycle !== undefined && row.lifecycle !== none.lifecycle) return false;
  if (none.status !== undefined) {
    if (none.status.in) {
      if (!none.status.in.includes(row.status)) return false;
    } else if (row.status !== none.status) return false;
  }
  if (none.NOT && Object.prototype.hasOwnProperty.call(none.NOT, "agentId") && row.agentId === none.NOT.agentId) {
    return false;
  }
  return true;
}

function takenBy(rows, none) {
  return Boolean(none) && (rows ?? []).some((row) => rowMatches(row, none));
}

function matchesSection(candidate, section) {
  if (!section) return true;
  if (typeof section === "string") return candidate.section === section;
  if (section.notIn) {
    const excluded = new Set(section.notIn.map((title) => (
      section.mode === "insensitive" ? title.toLowerCase() : title
    )));
    const candidateSection = section.mode === "insensitive"
      ? candidate.section.toLowerCase()
      : candidate.section;
    return !excluded.has(candidateSection);
  }
  return true;
}

function visibleTasks(tasks, where) {
  return tasks.filter((candidate) => {
    if (candidate.status !== where.status) return false;
    if (!matchesSection(candidate, where.section)) return false;
    if (takenBy(candidate.pullRequests, where.pullRequests && where.pullRequests.none)) return false;
    if (takenBy(candidate.decisionRequests, where.decisionRequests && where.decisionRequests.none)) return false;
    if (takenBy(candidate.agentRuns, where.agentRuns && where.agentRuns.none)) return false;
    return true;
  });
}

const doneTitles = new Map([
  [15, new Set(["done"])],
  [22, new Set()],
  [23, new Set(["done"])],
]);

function loadNext({ tasks, agentId = callerAgentId, skipTaken = true }) {
  const prisma = {
    project: { findFirst: async () => ({ id: 15 }) },
    section: { findMany: async () => [] },
    task: {
      findMany: async (query) => visibleTasks(tasks, query.where).slice(0, query.take),
    },
  };
  const { GET } = load("src/lib/mcp/operations/tasks/next/operation.ts", {
    "next/server": {
      NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
    },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId }),
    },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => skipTaken && key === flag,
    },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/notifications/inboxZero": {
      loadDoneTitlesByProject: async (projectIds) => new Map(
        [...projectIds].map((projectId) => [projectId, doneTitles.get(projectId) ?? new Set()]),
      ),
    },
    "@/lib/mcp/tasks/priorityScore": { priorityScore: () => 0 },
  });
  return GET;
}

async function pick(GET, query = {}) {
  const response = await GET({
    nextUrl: { searchParams: new URLSearchParams({ project_id: "15", ...query }) },
  });
  assert.equal(response.status, 200);
  return response.body.tasks.map((task) => task.id);
}

const openDesign = {
  targetTask: { status: "Normal", section: "In Progress", projectId: 22 },
};
const finishedDesign = {
  targetTask: { status: "Normal", section: "Done", projectId: 23 },
};
const openIncidentBlocker = {
  sourceTask: { status: "Normal", section: "In Progress", projectId: 22 },
};

test("an unanswered owner decision stays out after the waiting fields are cleared", async () => {
  const tasks = [
    task(4, { decisionRequests: [{ status: "Pending" }] }),
    task(5, { decisionRequests: [{ status: "Answered" }] }),
  ];
  assert.equal(tasks[0].waitingOnUserId, null);
  assert.equal(tasks[0].blockerCommentId, null);

  const ids = await pick(loadNext({ tasks }));

  assert.deepEqual(ids, [5]);
});

test("the same pending decision is picked again while the taken-work filter is off", async () => {
  const ids = await pick(loadNext({
    tasks: [
      task(4, { decisionRequests: [{ status: "Pending" }] }),
      task(5, { decisionRequests: [{ status: "Answered" }] }),
    ],
    skipTaken: false,
  }));

  assert.deepEqual(ids, [4, 5]);
});

test("a ticket whose required design is still open is left out, and a finished design is pickable", async () => {
  const ids = await pick(loadNext({
    tasks: [
      task(1, { relatedFromTasks: [openDesign] }),
      task(2, { relatedFromTasks: [finishedDesign] }),
      task(3),
    ],
  }));

  assert.deepEqual(ids, [2, 3]);
});

test("a parked incident with a recorded blocker is left out when its waiting fields are clear", async () => {
  const incident = task(8, {
    section: "Incidents",
    relatedToTasks: [openIncidentBlocker],
  });
  assert.equal(incident.waitingOnUserId, null);
  assert.equal(incident.blockerCommentId, null);

  const ids = await pick(loadNext({ tasks: [incident, task(9, { section: "Incidents" })] }));

  assert.deepEqual(ids, [9]);
});

test("an open pull request and another agent's active run stay out, while this agent's run and a merged pull request stay in", async () => {
  const ids = await pick(loadNext({
    tasks: [
      task(10, { pullRequests: [{ lifecycle: "open" }] }),
      task(11, { agentRuns: [{ status: "ACTIVE", agentId: otherAgentId }] }),
      task(12, { agentRuns: [{ status: "ACTIVE", agentId: callerAgentId }] }),
      task(13, {
        pullRequests: [{ lifecycle: "merged" }],
        agentRuns: [{ status: "DONE", agentId: otherAgentId }],
      }),
    ],
  }));

  assert.deepEqual(ids, [12, 13]);
});

test("a column-scoped lead watch still leaves out an open pull request and a pending decision", async () => {
  const ids = await pick(loadNext({
    tasks: [
      task(20, { section: "In Progress", pullRequests: [{ lifecycle: "open" }] }),
      task(21, { section: "In Progress", decisionRequests: [{ status: "Pending" }] }),
      task(22, { section: "In Progress" }),
      task(23, { section: "Ready" }),
    ],
  }), { section: "In Progress" });

  assert.deepEqual(ids, [22]);
});

function contextStubs(showLog, activities) {
  const prisma = {
    task: { findFirst: async () => ({ id: 42, pullRequests: [] }) },
    comment: {
      count: async () => 0,
      findMany: async () => [],
    },
    taskRelations: { findMany: async () => [] },
    agentRunActivity: {
      findMany: async (query) => {
        const allowed = query.where.run.status && query.where.run.status.in;
        return activities.filter((activity) => {
          if (activity.run.taskId !== query.where.run.taskId) return false;
          if (allowed && !allowed.includes(activity.run.status)) return false;
          return true;
        }).slice(0, query.take);
      },
    },
  };
  return {
    stubs: {
      ai: { tool: (definition) => definition },
      "next/server": {
        NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
      },
      "@/lib/mcp/routeWrapper": {
        wrapMcpRoute: (handler) => handler,
        checkMcpRouteRateLimit: async () => null,
        validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: callerAgentId }),
      },
      "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
      "@/lib/prisma": { default: prisma },
      "@/lib/flags": { isFeatureEnabled: async (key) => showLog && key === flag },
      "@/lib/mcp/tasks/resolveTask": {
        findTaskByIdentifier: async () => ({ id: 42, projectId: 15 }),
      },
      "@/lib/mcp/tasks/mappers": {
        taskMcpGetInclude: () => ({}),
        mapTaskToMcpGetResponse: () => ({
          id: 42,
          title: "Claimed ticket",
          description: "",
          section: "Doing",
          labels: [],
          assignees: [],
          sub_tasks: [],
        }),
      },
      "@/lib/mcp/tasks/extractPrLinks": { extractPrLinks: () => [] },
      "@/lib/pullRequests/githubPullRequests": {
        derivePullRequestDisplayState: () => "open",
        parseGithubPullRequestUrl: () => null,
      },
      "@/lib/pullRequests/taskPullRequests": {
        refreshTaskPullRequests: async () => [],
      },
      "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
      "@/lib/ai/tools/execution": { withToolErrors: (fn) => fn },
      "@/lib/ai/tools/helpers": {
        mapTaskToMcpGetResponse: () => ({
          id: 42,
          title: "Claimed ticket",
          description: "",
          section: "Doing",
          labels: [],
          assignees: [],
          sub_tasks: [],
        }),
        stripInlineDataUris: (text) => text,
        sanitizeForJson: (value) => value,
      },
    },
  };
}

const logEntries = [
  {
    id: "active-log",
    type: "THOUGHT",
    text: "Claimed by Runner C",
    createdAt: new Date("2026-11-07T01:00:00.000Z"),
    run: { taskId: 42, status: "ACTIVE", agent: null },
  },
  {
    id: "finished-log",
    type: "THOUGHT",
    text: "Finished earlier",
    createdAt: new Date("2026-11-07T00:00:00.000Z"),
    run: { taskId: 42, status: "DONE", agent: null },
  },
];

test("task context includes the active agent log and leaves out a finished run", async () => {
  logEntries[0].run.agent = {
    id: otherAgentId,
    displayName: "Runner C",
    userId: 6,
    visibility: "PRIVATE",
    members: [],
  };
  logEntries[1].run.agent = logEntries[0].run.agent;
  const { stubs } = contextStubs(true, logEntries);
  const { GET } = load("src/lib/mcp/operations/tasks/context/operation.ts", stubs);
  const response = await GET({
    nextUrl: { searchParams: new URLSearchParams({ task_id: "42", project_id: "15" }) },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.agentActivities.map((activity) => ({
      agentName: activity.agentName,
      text: activity.text,
    })),
    [{ agentName: "Runner C", text: "Claimed by Runner C" }],
  );
  assert.equal(JSON.stringify(response.body).includes("Finished earlier"), false);

  const { createTaskContextTool } = load("src/lib/ai/tools/taskContext.ts", stubs);
  const toolResult = await createTaskContextTool({
    user: { id: 6 },
    sendStatus() {},
  }).hypertask_task_context.execute({ task_id: 42, project_id: 15, summary: false });
  assert.deepEqual(
    toolResult.agentActivities.map((activity) => activity.text),
    ["Claimed by Runner C"],
  );
});

test("task context hides the agent log while the taken-work filter is off", async () => {
  const { stubs } = contextStubs(false, logEntries);
  const { GET } = load("src/lib/mcp/operations/tasks/context/operation.ts", stubs);
  const response = await GET({
    nextUrl: { searchParams: new URLSearchParams({ task_id: "42", project_id: "15" }) },
  });
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body, "agentActivities"), false);
});

test("the in-app picker leaves out owned, blocked, decided, and open-pull-request work", async () => {
  const tasks = [
    task(30, { pullRequests: [{ lifecycle: "open" }] }),
    task(31, { decisionRequests: [{ status: "Pending" }] }),
    task(32, { agentRuns: [{ status: "STALE", agentId: otherAgentId }] }),
    task(33, { relatedFromTasks: [openDesign] }),
    task(34),
  ];
  const prisma = {
    project: {
      findFirst: async () => ({ id: 15, section: [] }),
    },
    task: {
      findMany: async (query) => visibleTasks(tasks, query.where),
    },
  };
  const { createNextTasksTool } = load("src/lib/ai/tools/nextTasks.ts", {
    ai: { tool: (definition) => definition },
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === flag },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/notifications/inboxZero": {
      loadDoneTitlesByProject: async (projectIds) => new Map(
        [...projectIds].map((projectId) => [projectId, doneTitles.get(projectId) ?? new Set()]),
      ),
    },
    "@/lib/mcp/tasks/priorityScore": { priorityScore: () => 0 },
    "@/app/api/ai/chat/stream/bulkTools": {
      buildLimitedScanMetadata: (count, limit) => ({ truncated: count > limit }),
    },
    "@/lib/ai/tools/execution": { withToolErrors: (fn) => fn },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value) => value },
  });
  const result = await createNextTasksTool({
    user: { id: 6 },
    actingAgentId: callerAgentId,
    sendStatus() {},
  }).hypertask_next_tasks.execute({
    project_id: 15,
    limit: 10,
    exclude_blocked: false,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.tasks.map((task) => task.id), [34]);
});
