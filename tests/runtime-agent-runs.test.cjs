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

function loadRoute({ principal = null, enabled = true, createRun = async () => null } = {}) {
  stub("src/lib/agentRuns/service.ts", {
    authenticateAgentRunRequest: async () => principal,
    runtimeAgentRunsEnabledFor: async () => enabled,
    createRuntimeAgentRun: createRun,
  });
  stub("src/lib/mcp/auth.ts", { checkMcpRateLimit: async () => null });
  stub("src/lib/mcp/agents/delete.ts", { handleDeleteAgentRequest: async () => null });
  stub("src/lib/mcp/agents/get.ts", { handleGetAgentRequest: async () => null });
  stub("src/lib/mcp/agents/lifecycleRequests.ts", {
    handlePatchAgentRequest: async () => null,
  });
  const filename = path.join(
    root,
    "src/app/api/mcp/agents/[agentId]/route.ts",
  );
  delete require.cache[filename];
  return createJiti(
    path.join(root, `tests/runtime-agent-runs-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(filename);
}

function request(body) {
  return new Request("http://localhost/api/mcp/agents/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loadStopRoute({
  principal,
  runtimeEnabled = true,
  stopRun = async () => null,
} = {}) {
  stub("src/lib/agentRuns/service.ts", {
    agentRunsEnabledFor: async () => true,
    authenticateAgentRunRequest: async () => principal,
    browserMutationIsSameOrigin: () => true,
    runtimeAgentRunsEnabledFor: async () => runtimeEnabled,
    stopAgentRun: stopRun,
  });
  stub("src/lib/mcp/auth.ts", { checkMcpRateLimit: async () => null });
  const filename = path.join(
    root,
    "src/app/api/mcp/agents/runs/[id]/stop/route.ts",
  );
  delete require.cache[filename];
  return createJiti(
    path.join(root, `tests/runtime-agent-run-stop-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(filename);
}

function stopRequest(body) {
  return new Request("http://localhost/api/mcp/agents/runs/run-1/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body }),
  });
}

const agentPrincipal = {
  userId: 6,
  agentId: "agent-1",
  displayName: "Runtime agent",
  source: "agent",
};
const routeContext = { params: Promise.resolve({ agentId: "runs" }) };

test("runtime run open rejects missing authentication", async () => {
  const { POST } = loadRoute();
  const response = await POST(
    request({ taskId: 42, source: "runtime" }),
    routeContext,
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "Invalid or missing authentication");
});

test("runtime run open requires an agent identity", async () => {
  const { POST } = loadRoute({
    principal: { ...agentPrincipal, agentId: null, source: "browser" },
  });
  const response = await POST(
    request({ taskId: 42, source: "runtime" }),
    routeContext,
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Opening runs requires an agent token");
});

test("runtime run open hides tasks outside the agent's scope", async () => {
  const { POST } = loadRoute({ principal: agentPrincipal });
  const response = await POST(
    request({ taskId: 999, source: "runtime" }),
    routeContext,
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Task not found");
});

test("runtime run open validates and returns the created run", async () => {
  let received;
  const run = {
    id: "run-runtime-1",
    agentId: "agent-1",
    taskId: 42,
    chatSessionId: null,
    trigger: "runtime",
    title: "Investigate quiet activity",
    status: "active",
    createdAt: "2026-09-17T12:00:00.000Z",
    lastActivityAt: "2026-09-17T12:00:00.000Z",
    stoppedBy: null,
  };
  const { POST } = loadRoute({
    principal: agentPrincipal,
    createRun: async (_principal, input) => {
      received = input;
      return run;
    },
  });

  const response = await POST(
    request({
      taskId: 42,
      title: "  Investigate quiet activity  ",
      source: "runtime",
    }),
    routeContext,
  );
  assert.equal(response.status, 201);
  assert.deepEqual(received, {
    taskId: 42,
    title: "Investigate quiet activity",
    source: "runtime",
  });
  assert.deepEqual(await response.json(), { success: true, run });
});

test("runtime run close rejects malformed JSON without stopping the run", async () => {
  let stops = 0;
  const { POST } = loadStopRoute({
    principal: agentPrincipal,
    stopRun: async () => {
      stops += 1;
      return null;
    },
  });

  const response = await POST(stopRequest('{"status":'), {
    params: Promise.resolve({ id: "run-1" }),
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Invalid JSON request body");
  assert.equal(stops, 0);
});

test("runtime final statuses are gated while legacy bodyless stop remains available", async () => {
  const received = [];
  const run = { id: "run-1", status: "stopped" };
  const { POST } = loadStopRoute({
    principal: agentPrincipal,
    runtimeEnabled: false,
    stopRun: async (_principal, _id, _now, finalStatus) => {
      received.push(finalStatus);
      return run;
    },
  });
  const context = { params: Promise.resolve({ id: "run-1" }) };

  const explicit = await POST(stopRequest('{"status":"done"}'), context);
  assert.equal(explicit.status, 404);
  assert.deepEqual(received, []);

  const legacy = await POST(stopRequest(), context);
  assert.equal(legacy.status, 200);
  assert.deepEqual(await legacy.json(), { success: true, run });
  assert.deepEqual(received, ["STOPPED"]);
});
