const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture, matches } = require("./helpers/agent-board-scope.cjs");

function commentsFor(f) {
  const onBoard = f.tasks.find((task) => task.id === 40600);
  const outside = f.tasks.find((task) => task.id === 21280);
  const createdAt = new Date("2026-10-01T00:00:00.000Z");
  return [
    {
      id: 1,
      taskId: onBoard.id,
      task: onBoard,
      text: "on-board",
      commentText: null,
      activity: null,
      createdAt,
      agentDisplayName: null,
      agent: null,
      creator: { displayName: "Owner", email: "scope@example.invalid" },
    },
    {
      id: 2,
      taskId: onBoard.id,
      task: outside,
      text: "wrong-board",
      commentText: null,
      activity: null,
      createdAt,
      agentDisplayName: null,
      agent: null,
      creator: { displayName: "Outsider", email: "out@example.invalid" },
    },
    {
      id: 3,
      taskId: outside.id,
      task: outside,
      text: "owner-board",
      commentText: null,
      activity: null,
      createdAt,
      agentDisplayName: null,
      agent: null,
      creator: { displayName: "Owner", email: "scope@example.invalid" },
    },
  ];
}

function loadContext(f, comments) {
  f.prisma.comment = {
    count: async ({ where }) => comments.filter((row) => matches(row, where)).length,
    findMany: async (args = {}) => comments.filter((row) => matches(row, args.where)).slice(0, args.take ?? comments.length),
  };
  f.prisma.taskRelations = { findMany: async () => [] };
  return f.load("src/lib/mcp/operations/tasks/context/operation.ts", {
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/mcp/skills/context": {
      getMcpSkillContext: async () => ({ summary: "none", active_skills: [], instructions: "" }),
    },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/pullRequests/taskPullRequests": {
      refreshTaskPullRequests: async (_taskId, pullRequests) => pullRequests ?? [],
    },
    "@/lib/mcp/tasks/relatedTaskContext": {
      loadTaskAgentActivities: async () => [],
      mapRelatedTaskContext: async () => ({}),
      relatedTaskContextSelect: () => ({ id: true }),
    },
    "@/lib/mcp/tasks/mappers": {
      taskMcpGetInclude: () => ({}),
      mapTaskToMcpGetResponse: (task) => ({
        id: task.id,
        ticketNumber: task.ticketNumber,
        title: task.title,
        description: "",
        section: task.section,
        labels: [],
        assignees: [],
        priority: null,
        dueDate: null,
        savedContent: [],
        parent_task: null,
        sub_tasks: [],
      }),
    },
  });
}

for (const [actor, taskId, projectId, status, texts] of [
  ["an agent on the board", 40600, 4060, 200, ["on-board"]],
  ["an agent outside the board", 21280, 2128, 404, null],
  ["the board owner", 21280, 2128, 200, ["owner-board"]],
]) {
  test(`task context comments for ${actor} return ${status}`, async () => {
    const f = fixture();
    if (actor === "the board owner") f.state.ctx.agentId = null;
    const comments = commentsFor(f);
    const { GET } = loadContext(f, comments);
    const response = await GET(new NextRequest(
      `https://app.hypertask.ai/api/mcp/tasks/context?task_id=${taskId}&project_id=${projectId}`,
    ));
    assert.equal(response.status, status);
    const body = await response.json();
    if (status === 404) {
      assert.equal(body.error, "Task not found or access denied");
      return;
    }
    assert.deepEqual(body.comments.map((comment) => comment.text), texts);
    assert.equal(body.commentCount, texts.length);
    assert.equal(JSON.stringify(body).includes("wrong-board"), false);
  });
}
