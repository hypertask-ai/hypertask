const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const mapperPath = path.join(root, "src/lib/mcp/tasks/mappers.ts");
const mapperSource = fs.readFileSync(mapperPath, "utf8");

function loadMappers() {
  const javascript = ts.transpileModule(mapperSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const stubs = {
    "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope,
    "@/lib/tasks/sameBoardRelations": require("./task-route-loader.cjs").load("src/lib/tasks/sameBoardRelations.ts", {}),
    "@/utils/controllers/projects/getAllIncludes": require("./helpers/agent-board-scope.cjs").access,
    "@/lib/mcp/agents": {
      mapVisibleMcpAgent: (agent, userId, projectId) =>
        agent &&
        (agent.userId === userId ||
          (agent.visibility === "TEAM" &&
            agent.members.some((member) => member.projectId === projectId)))
          ? { id: agent.id, displayName: agent.displayName }
          : undefined,
      mcpVisibleAgentSelect: () => ({}),
    },
    "@/lib/agents/visibility": {
      accessibleAgentWhere: (userId) => ({ userId }),
    },
    "@/lib/staleness": {
      taskStaleness: () => ({}),
    },
    "@/lib/pullRequests/githubPullRequests": {
      derivePullRequestDisplayState: (lifecycle, checkState) =>
        lifecycle === "merged"
          ? "merged"
          : checkState === "failing"
            ? "checks_red"
            : "open",
    },
  };
  const loaded = new Module(mapperPath);
  loaded.filename = mapperPath;
  loaded.require = (request) => stubs[request] ?? require(request);
  loaded._compile(javascript, mapperPath);
  return loaded.exports;
}

test("task list counts only assignees visible to the task board", () => {
  const { mapTaskAssignee } = loadMappers();
  const owner = {
    user: { id: 9, email: "owner@example.test", displayName: "Owner" },
  };
  const privateAgent = {
    id: "private-agent",
    displayName: "Private helper",
    userId: 9,
    visibility: "PRIVATE",
    members: [],
  };
  const teamAgent = {
    id: "team-agent",
    displayName: "Team helper",
    userId: 9,
    visibility: "TEAM",
    members: [{ projectId: 15 }],
  };

  const assignees = [
    owner,
    { ...owner, agent: privateAgent },
    { ...owner, agent: teamAgent },
  ]
    .map((assignee) => mapTaskAssignee(assignee, 6, 15))
    .filter(Boolean);

  assert.equal(assignees.length, 2);
  assert.equal(assignees[0].agent, undefined);
  assert.equal(assignees[0].displayName, "Owner");
  assert.equal(assignees[1].agent.id, "team-agent");
  assert.equal(assignees[1].displayName, "Team helper");
});

test("list and detail labels share the exact id/name mapping", () => {
  const { mapMcpTaskLabel, mapTaskToMcpGetResponse } = loadMappers();
  const taskLabels = [
    { label: { id: "label-1", value: "Bug" } },
    { label: { id: "label-2", value: null } },
  ];

  const listLabels = taskLabels.map(mapMcpTaskLabel);
  const detail = mapTaskToMcpGetResponse({
    id: 5063,
    uniqueIndex: 5063,
    projectId: 15,
    title: "List labels",
    section: "In Progress",
    status: "Normal",
    project: { title: "Hypertask Product" },
    taskLabels,
    assignees: [],
    followers: [],
    attachments: [],
    customFieldValues: [],
    subTasks: [],
    _count: { comments: 0 },
    createdAt: new Date("2026-08-07T00:00:00.000Z"),
    updatedAt: new Date("2026-08-07T00:00:00.000Z"),
  }, 6);

  assert.deepEqual(listLabels, [
    { id: "label-1", name: "Bug" },
    { id: "label-2", name: "" },
  ]);
  assert.deepEqual(detail.labels, listLabels);
  assert.deepEqual(detail.pullRequests, []);
  assert.deepEqual(Object.keys(listLabels[0]).sort(), ["id", "name"]);
});

test("task responses redact agents that are not visible to the viewer", () => {
  const { mapTaskToMcpGetResponse, taskDetailInclude } = loadMappers();
  const agent = {
    id: "private-agent",
    displayName: "Private helper",
    userId: 9,
    visibility: "PRIVATE",
    members: [],
  };
  const task = {
    id: 5065,
    uniqueIndex: 5065,
    projectId: 15,
    title: "Private agent task",
    section: "In Progress",
    status: "Normal",
    project: { title: "Hypertask Product" },
    agent,
    taskLabels: [],
    assignees: [{
      user: { id: 9, email: "owner@example.test", displayName: "Owner" },
      agent,
      agentAssigner: agent,
    }],
    followers: [],
    attachments: [],
    customFieldValues: [],
    subTasks: [],
    _count: { comments: 0 },
    createdAt: new Date("2026-08-07T00:00:00.000Z"),
    updatedAt: new Date("2026-08-07T00:00:00.000Z"),
  };

  const hidden = mapTaskToMcpGetResponse(task, 6);
  assert.equal(hidden.agent, undefined);
  assert.deepEqual(hidden.assignees, []);

  const owner = mapTaskToMcpGetResponse(task, 9);
  assert.equal(owner.agent.id, agent.id);
  assert.equal(owner.assignees[0].agentAssigner.id, agent.id);

  assert.equal(
    mapTaskToMcpGetResponse(
      { ...task, agent: { ...agent, visibility: "TEAM", members: [] } },
      6,
    ).agent,
    undefined,
  );
  assert.equal(
    mapTaskToMcpGetResponse(
      { ...task, agent: { ...agent, visibility: "TEAM", members: [{ projectId: 15 }] } },
      6,
    ).agent.id,
    agent.id,
  );
  assert.equal(
    mapTaskToMcpGetResponse(
      { ...task, agent: { ...agent, visibility: "TEAM", members: [{ projectId: 99 }] } },
      6,
    ).agent,
    undefined,
  );
  assert.deepEqual(taskDetailInclude(6).assignees.where, {
    OR: [{ agentId: null }, { agent: { userId: 6 } }],
  });
});

test("task responses expose the permanent-delete deadline", () => {
  const { mapTaskToMcpGetResponse } = loadMappers();
  const permanentlyDeleteAt = new Date("2026-09-10T12:00:00.000Z");
  const detail = mapTaskToMcpGetResponse({
    id: 5064,
    uniqueIndex: 5064,
    projectId: 15,
    title: "Permanent-delete deadline",
    section: "Trash",
    status: "Deleted",
    project: { title: "Hypertask Product" },
    taskLabels: [],
    assignees: [],
    followers: [],
    attachments: [],
    customFieldValues: [],
    subTasks: [],
    _count: { comments: 0 },
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    permanentlyDeleteAt,
  }, 6);

  assert.equal(
    detail.permanentlyDeleteAt,
    "2026-09-10T12:00:00.000Z",
  );

  const withoutDeadline = mapTaskToMcpGetResponse({
    ...detail,
    permanentlyDeleteAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    project: { title: "Hypertask Product" },
    taskLabels: [],
    assignees: [],
    followers: [],
    attachments: [],
    customFieldValues: [],
    subTasks: [],
    _count: { comments: 0 },
  }, 6);
  assert.equal(withoutDeadline.permanentlyDeleteAt, null);
});

test("task get returns linked pull requests in selected order", () => {
  const { mapTaskToMcpGetResponse } = loadMappers();
  const updatedAt = new Date("2026-09-02T03:28:24.064Z");
  const detail = mapTaskToMcpGetResponse({
    id: 36202,
    uniqueIndex: 5899,
    projectId: 15,
    title: "Linked pull requests",
    section: "QA",
    status: "Normal",
    project: { title: "Hypertask Product" },
    taskLabels: [],
    assignees: [],
    followers: [],
    attachments: [],
    customFieldValues: [],
    savedContent: [],
    subTasks: [],
    pullRequests: [
      {
        id: "pr-first",
        repositoryOwner: "hypertask-ai",
        repositoryName: "hypertask",
        number: 144,
        url: "https://github.com/hypertask-ai/hypertask/pull/144",
        title: "First PR",
        lifecycle: "open",
        checkState: "failing",
        headSha: "abc123",
        updatedAt,
      },
      {
        id: "pr-second",
        repositoryOwner: "hypertask-ai",
        repositoryName: "hypertask",
        number: 145,
        url: "https://github.com/hypertask-ai/hypertask/pull/145",
        title: "Second PR",
        lifecycle: "merged",
        checkState: "pending",
        headSha: null,
        updatedAt,
      },
    ],
    _count: { comments: 0 },
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt,
  }, 6);

  assert.deepEqual(
    detail.pullRequests.map(({ number, displayState, headSha, updatedAt: value }) => ({
      number,
      displayState,
      headSha,
      updatedAt: value,
    })),
    [
      {
        number: 144,
        displayState: "checks_red",
        headSha: "abc123",
        updatedAt: "2026-09-02T03:28:24.064Z",
      },
      {
        number: 145,
        displayState: "merged",
        headSha: null,
        updatedAt: "2026-09-02T03:28:24.064Z",
      },
    ],
  );
});

test("task detail reads expose the single blocker comment after replacement and clearing", () => {
  const { mapTaskToMcpGetResponse, mapTaskToDetail } = loadMappers();
  const task = {
    id: 42, uniqueIndex: 7724, projectId: 15, title: "Blocked", section: "In Progress", status: "Normal",
    project: { title: "Board" }, createdAt: new Date("2026-10-24T12:00:00Z"), _count: { comments: 2 },
  };
  for (const blockerCommentId of [101, 102, null]) {
    assert.equal(mapTaskToMcpGetResponse({ ...task, blockerCommentId }, 7).blockerCommentId, blockerCommentId);
    assert.equal(mapTaskToDetail({ ...task, blockerCommentId }, 7).blockerCommentId, blockerCommentId);
  }
});
