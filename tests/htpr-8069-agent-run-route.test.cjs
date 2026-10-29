const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const principal = { userId: 985, agentId: null, source: "browser" };

function route(identity, run) {
  return load("src/app/api/mcp/agents/runs/[id]/route.ts", {
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (handler) => handler },
    "@/lib/mcp/auth": { checkMcpRateLimit: async () => null },
    "@/lib/agentRuns/service": {
      authenticateAgentRunRequest: async () => identity,
      readAgentRun: async (caller, id) => {
        assert.equal(caller, identity);
        assert.equal(id, "run-1");
        return run;
      },
    },
  }).GET;
}

const request = new Request("https://app.hypertask.ai/api/mcp/agents/runs/run-1");
const context = { params: Promise.resolve({ id: "run-1" }) };

test("run read succeeds without a rollout check", async () => {
  const response = await route(principal, { id: "run-1", status: "active" })(request, context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true, run: { id: "run-1", status: "active" },
  });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("run read still refuses unauthenticated and inaccessible runs", async () => {
  const anonymous = await route(null, null)(request, context);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, "Invalid or missing authentication");
  const inaccessible = await route(principal, null)(request, context);
  assert.equal(inaccessible.status, 404);
  assert.equal((await inaccessible.json()).error, "Run not found");
});
