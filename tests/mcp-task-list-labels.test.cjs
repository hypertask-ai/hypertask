const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(
  path.join(root, "src/app/api/mcp/tasks/route.ts"),
  "utf8",
);
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
    "@/lib/mcp/agents": {
      mapAttributedMcpAgent: (agent) =>
        agent ? { id: agent.id, displayName: agent.displayName } : undefined,
      mapVisibleMcpAgent: (agent, userId, projectId) =>
        agent &&
        (agent.userId === userId ||
          (agent.visibility === "TEAM" &&
            agent.members.some((member) => member.projectId === projectId)))
          ? { id: agent.id, displayName: agent.displayName }
          : undefined,
      mcpAgentSelect: { id: true, displayName: true, photoURL: true },
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

test("the MCP task list applies the shared query, filter, fields contract", () => {
  assert.match(routeSource, /readEnabledListQuery/);
  assert.match(routeSource, /hasPrWhere/);
  assert.match(routeSource, /HTPR_6530_MCP_LIST_QUERY_FLAG/);
  assert.match(routeSource, /projectRows/);
  assert.match(routeSource, /withTaskPresentation/);
});

test("the MCP task list selects labels in the paginated task query", () => {
  const listQueryStart = routeSource.indexOf("// Get tasks");
  const listQueryEnd = routeSource.indexOf("// Get metadata counts");
  assert.notEqual(listQueryStart, -1);
  assert.notEqual(listQueryEnd, -1);

  const listQuery = routeSource.slice(listQueryStart, listQueryEnd);
  assert.match(
    listQuery,
    /taskLabels:\s*{\s*select:\s*{\s*label:\s*{\s*select:\s*mcpTaskLabelSelect/,
  );
  assert.match(
    routeSource,
    /labels:\s*task\.taskLabels\.map\(mapMcpTaskLabel\)/,
  );
});

test("task list counts only assignees visible to the task board", () => {
  assert.match(routeSource, /assigneeCount:\s*assignees\.length/);
  assert.match(
    routeSource,
    /mapTaskAssignee\(assignee, user\.id, task\.projectId\)/,
  );
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

test("task responses name the bot already on the ticket, even when it is private", () => {
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

  const teammate = mapTaskToMcpGetResponse(task, 6);
  assert.equal(teammate.agent.id, agent.id);
  assert.equal(teammate.assignees[0].displayName, "Private helper");
  assert.equal(teammate.assignees[0].agentAssigner.id, agent.id);
  assert.equal(taskDetailInclude(6).assignees.where, undefined);
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

test("the paginated task list selects and serializes the permanent-delete deadline", () => {
  const listQueryStart = routeSource.indexOf("// Get tasks");
  const listQueryEnd = routeSource.indexOf("// Get metadata counts", listQueryStart);
  const listResponseStart = routeSource.indexOf(
    "// Transform to response format",
    listQueryEnd,
  );
  const listResponseEnd = routeSource.indexOf(
    "// A full page implies there may be more rows",
    listResponseStart,
  );
  assert.notEqual(listQueryStart, -1);
  assert.notEqual(listQueryEnd, -1);
  assert.notEqual(listResponseStart, -1);
  assert.notEqual(listResponseEnd, -1);

  const listQuery = routeSource.slice(listQueryStart, listQueryEnd);
  const listResponse = routeSource.slice(listResponseStart, listResponseEnd);

  assert.match(listQuery, /permanentlyDeleteAt:\s*true/);
  assert.match(
    listResponse,
    /permanentlyDeleteAt:\s*task\.permanentlyDeleteAt\?\.toISOString\(\) \|\| null/,
  );
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
  assert.match(
    mapperSource,
    /pullRequests:\s*{\s*orderBy:\s*{\s*createdAt:\s*['"]asc['"] as const\s*}/,
  );
});
