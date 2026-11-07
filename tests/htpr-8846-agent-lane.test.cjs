const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loadId = 0;

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadService({ laneEnabled = false, activities = [] } = {}) {
  const servicePath = path.join(root, "src/lib/agentRuns/service.ts");
  delete require.cache[servicePath];
  const queries = [];
  const runs = [];
  const comments = [];
  const tasks = {
    1854: { id: 1854, projectId: 339, readable: true, member: false },
    77: { id: 77, projectId: 4060, readable: false, member: false },
    42: { id: 42, projectId: 15, readable: true, member: true },
  };
  const prisma = {
    $transaction: async (callback) => callback(prisma),
    task: {
      findFirst: async ({ where }) => {
        queries.push(where);
        const task = tasks[where.id];
        if (!task?.readable) return null;
        const needsMember = where.project?.members?.some?.agentId === "chief-of-staff";
        if (needsMember && !task.member) return null;
        return { id: task.id, projectId: task.projectId };
      },
    },
    agentRun: {
      createMany: async ({ data }) => {
        runs.push({ ...data[0], stoppedById: null });
        return { count: 1 };
      },
      updateMany: async () => ({ count: 0 }),
      findFirst: async ({ where }) =>
        runs.find((run) => run.agentId === where.agentId && run.taskId === where.taskId) ?? null,
    },
    agentRunActivity: {
      findMany: async () => activities,
    },
    comment: {
      create: async () => {
        comments.push("comment");
        throw new Error("people comment");
      },
    },
  };
  stub("src/lib/prisma.ts", { default: prisma });
  stub("src/lib/flags.ts", {
    isFeatureEnabled: async () => laneEnabled,
  });
  stub("src/lib/auth/agentScope.ts", {
    agentScopeEnforced: () => false,
    recordAgentBoardScopeMiss: () => {},
    withAgentScopeRequest: (_request, run) => run(),
    prepareAgentScope: async () => {},
  });
  stub("src/lib/mcp/tasks/agentMutationFence.ts", {
    lockTaskTeamScope: async () => {},
    TaskTeamScopeError: class TaskTeamScopeError extends Error {},
  });
  stub("src/lib/realtime/server.ts", {
    AGENT_CHAT_EVENT: "agent-chat:changed",
    broadcast: async () => {},
    broadcastTaskComment: async () => {},
    userChannel: (id) => `user-${id}`,
  });
  stub("src/lib/agentStatus/boardRefresh.ts", {
    refreshBoardForAgentRun: async () => {},
  });
  stub("src/lib/agents/chatContentScope.ts", {
    chatContentScopeWhere: async () => ({}),
  });
  stub("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => null,
  });
  stub("src/lib/agentWebhooks/outbox.ts", {
    persistAgentRunStoppedWebhook: async () => {},
    persistAgentWebhookEvent: async () => {},
    publishAgentWebhookDeliveries: async () => {},
  });
  stub("src/lib/agents/chatBroadcast.ts", {
    broadcastChatSession: async () => {},
  });
  stub("src/lib/mcp/auth.ts", {
    validateMcpAuth: async () => null,
  });
  stub("src/lib/agentRuns/persistence.ts", {
    persistAgentRunActivity: async () => {
      throw new Error("people path");
    },
    persistAgentRunSelection: async () => {
      throw new Error("people path");
    },
  });
  stub("src/utils/helperFunctions/toStoredHtml.ts", {
    toStoredHtml: (value) => value,
  });
  stub("src/utils/controllers/projects/getAllIncludes.ts", {
    projectContentAccessWhere: () => ({ access: "readable-board" }),
  });
  const jiti = createJiti(path.join(root, `tests/htpr-8846-lane-${++loadId}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  return { service: jiti(servicePath), queries, runs, comments };
}

const chief = {
  userId: 6,
  agentId: "chief-of-staff",
  displayName: "Valentin",
  source: "agent",
};

test("a human login cannot open an agent log note", async () => {
  const { service, queries, comments } = loadService({ laneEnabled: true });
  const run = await service.createRuntimeAgentRun(
    { userId: 6, agentId: null, displayName: "Valentin", source: "browser" },
    { taskId: 1854, title: null, source: "runtime" },
  );
  assert.equal(run, null);
  assert.equal(queries.length, 0);
  assert.equal(comments.length, 0);
});

test("an agent log note on a readable board uses the agent, not the human", async () => {
  const off = loadService({ laneEnabled: false });
  const denied = await off.service.createRuntimeAgentRun(chief, {
    taskId: 1854,
    title: null,
    source: "runtime",
  });
  assert.equal(denied, null);
  assert.equal(off.queries.at(-1).project.access, "readable-board");
  assert.equal(off.queries.at(-1).project.members.some.agentId, "chief-of-staff");
  assert.equal(off.comments.length, 0);

  const on = loadService({ laneEnabled: true });
  const run = await on.service.createRuntimeAgentRun(chief, {
    taskId: 1854,
    title: null,
    source: "runtime",
  });
  assert.equal(run.agentId, "chief-of-staff");
  assert.equal(run.taskId, 1854);
  assert.equal(on.queries.at(-1).project.access, "readable-board");
  assert.equal(on.queries.at(-1).project.members, undefined);
  assert.equal(on.runs[0].agentId, "chief-of-staff");
  assert.notEqual(on.runs[0].agentId, String(chief.userId));
  assert.equal(on.comments.length, 0);
});

test("a board the agent cannot read stays closed", async () => {
  const { service, queries, comments } = loadService({ laneEnabled: true });
  const run = await service.createRuntimeAgentRun(chief, {
    taskId: 77,
    title: null,
    source: "runtime",
  });
  assert.equal(run, null);
  assert.equal(queries.at(-1).project.access, "readable-board");
  assert.equal(queries.at(-1).project.members, undefined);
  assert.equal(comments.length, 0);
});

test("a board member can still open a note when the fix is off", async () => {
  const { service, comments } = loadService({ laneEnabled: false });
  const run = await service.createRuntimeAgentRun(chief, {
    taskId: 42,
    title: null,
    source: "runtime",
  });
  assert.equal(run.agentId, "chief-of-staff");
  assert.equal(run.taskId, 42);
  assert.equal(comments.length, 0);
});

test("the saved note names Chief Of Staff", async () => {
  const { service } = loadService({
    laneEnabled: true,
    activities: [{
      id: "activity-1",
      runId: "run-1",
      type: "THOUGHT",
      text: "lane note",
      link: null,
      options: null,
      selectedValue: null,
      selectedLabel: null,
      selectedAt: null,
      selectedById: null,
      createdAt: new Date("2026-11-07T12:00:00.000Z"),
      run: { agent: { displayName: "Chief Of Staff" } },
    }],
  });
  const [note] = await service.listTaskAgentRunActivities(6, 1854);
  assert.equal(note.agentName, "Chief Of Staff");
  assert.equal(note.text, "lane note");
  assert.equal(Object.hasOwn(note, "displayName"), false);
});

test("a person's ordinary comment is not routed into the agent log", async () => {
  const jiti = createJiti(path.join(root, `tests/htpr-8846-route-${++loadId}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  const routing = jiti(path.join(root, "src/lib/mcp/operations/comments/agentChatterRouting.ts"));
  assert.equal(routing.routeComment({ agentId: null }), "comments");
  assert.equal(routing.routeComment({ agentId: "chief-of-staff", kind: "question" }), "comments");
  assert.equal(routing.routeComment({ agentId: "chief-of-staff" }), "log");
});
