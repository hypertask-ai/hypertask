const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const routePath = path.resolve(
  __dirname,
  "../src/lib/mcp/operations/projects/archive/operation.ts",
);

function loadRoute({ authenticated = true, accessible = true, result } = {}) {
  const calls = [];
  const statusCalls = [];
  const routeJavascript = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const stubs = {
    "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope,
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/planLimits": { isPlanLimitReachedError: () => false, planLimitResponse: () => ({ status: 402, body: {} }) },
    "@/utils/controllers/projects/boardQuota": { updateProjectStatus: async (projectId, status, actor) => {
      statusCalls.push({ projectId, status, actor });
      return { id: projectId, status };
    } },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => null },
    "@/utils/controllers/projects/getAllIncludes": require("./helpers/agent-board-scope.cjs").access,
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200 }),
      },
    },
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () =>
        authenticated ? { user: { id: 6 }, agentId: "agent-1" } : null,
    },
    "@/lib/prisma": {
      __esModule: true,
      default: { project: { findFirst: async () => accessible ? { id: 15 } : null } },
    },
    "@/lib/flags": {
      isFeatureEnabled: async () => { throw new Error("Feature flags unavailable"); },
    },
    "@/utils/controllers/projects/delete": {
      __esModule: true,
      default: async (projectId, userId) => {
        calls.push({ projectId, userId });
        return result ?? { status: 200, json: { message: "Success" } };
      },
    },
  };
  const routeModule = { exports: {} };
  new Function("module", "exports", "require", routeJavascript)(
    routeModule,
    routeModule.exports,
    (request) => request === "@/lib/mcp/routeWrapper"
      ? require("./helpers/mcp-route-wrapper.cjs").loadRouteWrapper(stubs)
      : stubs[request] ?? require(request),
  );
  return { POST: routeModule.exports.POST, calls, statusCalls };
}

const request = (body) => ({ json: async () => body });

test("project deletion no longer depends on feature flag availability", async () => {
  const route = loadRoute();
  const response = await route.POST(request({ project_id: 15, status: "Deleted" }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { message: "Success" });
  assert.deepEqual(route.calls, [{ projectId: 15, userId: 6 }]);
});

test("project deletion still refuses boards outside the agent's scope", async () => {
  const route = loadRoute({ accessible: false });
  const response = await route.POST(request({ project_id: 15, status: "Deleted" }));

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { success: false, error: "Board not found" });
  assert.deepEqual(route.calls, []);
});

for (const status of [undefined, "Archive", "Normal"]) {
  test(`board status ${status ?? "default archive"} still uses the quota-aware controller`, async () => {
    const route = loadRoute();
    const response = await route.POST(request({ project_id: 15, status }));

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true, project: { id: 15, status: status ?? "Archive" } });
    assert.deepEqual(route.statusCalls, [{
      projectId: 15,
      status: status ?? "Archive",
      actor: { actorUserId: 6, agentId: "agent-1", entryPoint: "mcp.projects.archive" },
    }]);
    assert.deepEqual(route.calls, []);
  });
}

test("project deletion requires MCP authentication", async () => {
  const route = loadRoute({ authenticated: false });
  const response = await route.POST(request({ project_id: 15, status: "Deleted" }));

  assert.equal(response.status, 401);
  assert.deepEqual(route.calls, []);
});

test("project deletion rejects an invalid project id", async () => {
  const route = loadRoute();
  const response = await route.POST(request({ project_id: "not-a-number", status: "Deleted" }));

  assert.equal(response.status, 400);
  assert.deepEqual(route.calls, []);
});

test("project deletion uses the web UI deletion controller for the authenticated user", async () => {
  const route = loadRoute();
  const response = await route.POST(request({ project_id: 15, status: "Deleted" }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { message: "Success" });
  assert.deepEqual(route.calls, [{ projectId: 15, userId: 6 }]);
});

test("project deletion preserves authorization failures from the web UI controller", async () => {
  const route = loadRoute({
    result: {
      status: 401,
      json: { message: "Only Board owner or admin can delete this board." },
    },
  });
  const response = await route.POST(request({ project_id: 15, status: "Deleted" }));

  assert.equal(response.status, 401);
  assert.deepEqual(route.calls, [{ projectId: 15, userId: 6 }]);
});
