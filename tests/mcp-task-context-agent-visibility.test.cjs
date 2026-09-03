const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routePath = path.join(root, "src/app/api/mcp/tasks/context/route.ts");
const routeSource = fs.readFileSync(routePath, "utf8");

function loadRoute(comments) {
  const javascript = ts.transpileModule(routeSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  let commentQuery;
  const prisma = {
    task: {
      findFirst: async () => ({ pullRequests: [] }),
    },
    comment: {
      count: async () => comments.length,
      findMany: async (query) => {
        if (query.select.id) {
          commentQuery = query;
          return comments;
        }
        return [];
      },
    },
    taskRelations: {
      findMany: async () => [],
    },
  };
  const stubs = {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200 }),
      },
    },
    "@prisma/client": { Prisma: { DbNull: Symbol("DbNull") } },
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: null }),
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/mcp/tasks/extractPrLinks": { extractPrLinks: () => [] },
    "@/lib/pullRequests/githubPullRequests": {
      derivePullRequestDisplayState: () => "open",
      parseGithubPullRequestUrl: () => null,
    },
    "@/lib/mcp/tasks/mappers": {
      taskMcpGetInclude: () => ({}),
      mapTaskToMcpGetResponse: () => ({
        id: 42,
        title: "Agent visibility",
        description: "",
        section: "QA",
        labels: [],
        assignees: [],
        sub_tasks: [],
      }),
    },
    "@/lib/mcp/tasks/resolveTask": {
      findTaskByIdentifier: async () => ({ id: 42, projectId: 15 }),
    },
    "@/lib/mcp/agents": {
      mcpVisibleAgentSelect: (userId, projectId) => ({ viewerId: userId, projectId }),
      mapVisibleMcpAgent: (agent, userId, projectId) =>
        agent &&
        (agent.userId === userId ||
          (agent.visibility === "TEAM" &&
            agent.members.some((member) => member.projectId === projectId)))
          ? { id: agent.id, displayName: agent.displayName }
          : undefined,
    },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: () => ({}),
    },
  };
  const loaded = new Module(routePath);
  loaded.filename = routePath;
  loaded.require = (request) => stubs[request] ?? require(request);
  loaded._compile(javascript, routePath);
  return { GET: loaded.exports.GET, getCommentQuery: () => commentQuery };
}

const createdAt = new Date("2026-09-03T00:00:00.000Z");

function comment(overrides) {
  return {
    id: 1,
    text: "Context",
    createdAt,
    agentDisplayName: null,
    agent: null,
    creator: null,
    ...overrides,
  };
}

test("task context redacts deleted, private, and unshared team agent names", async () => {
  const privateAgent = {
    id: "private-agent",
    displayName: "Private helper",
    userId: 9,
    visibility: "PRIVATE",
    members: [],
  };
  const route = loadRoute([
    comment({ id: 1, agentDisplayName: "Deleted helper" }),
    comment({ id: 2, agentDisplayName: "Private helper", agent: privateAgent }),
    comment({
      id: 3,
      agentDisplayName: "Team helper",
      agent: {
        ...privateAgent,
        id: "team-agent",
        visibility: "TEAM",
        members: [{ projectId: 99 }],
      },
    }),
    comment({
      id: 4,
      agentDisplayName: "Shared helper",
      agent: {
        ...privateAgent,
        id: "shared-agent",
        displayName: "Shared helper",
        visibility: "TEAM",
        members: [{ projectId: 15 }],
      },
    }),
    comment({ id: 5, creator: { displayName: "Human", email: "human@test" } }),
  ]);

  const response = await route.GET({
    nextUrl: {
      searchParams: new URLSearchParams({ task_id: "42", project_id: "15" }),
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.comments.map(({ author }) => author),
    ["Human", "Shared helper", "Private agent", "Private agent", "Private agent"],
  );
  assert.deepEqual(route.getCommentQuery().select.agent.select, {
    viewerId: 6,
    projectId: 15,
  });
});
