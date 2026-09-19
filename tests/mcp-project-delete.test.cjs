const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const routePath = path.resolve(
  __dirname,
  "../src/app/api/mcp/projects/archive/route.ts",
);

function loadRoute({ authenticated = true, enabled = true, result } = {}) {
  const calls = [];
  const routeJavascript = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const stubs = {
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
      default: { project: {} },
    },
    "@/lib/flags": {
      HTPR_6470_PROJECT_DELETE_FLAG: "htpr-6470-project-delete",
      isFeatureEnabled: async () => enabled,
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
    (request) => stubs[request] ?? require(request),
  );
  return { POST: routeModule.exports.POST, calls };
}

const request = (body) => ({ json: async () => body });

test("project deletion is unavailable while its feature flag is off", async () => {
  const route = loadRoute({ enabled: false });
  const response = await route.POST(request({ project_id: 15, status: "Deleted" }));

  assert.equal(response.status, 404);
  assert.deepEqual(route.calls, []);
});

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
