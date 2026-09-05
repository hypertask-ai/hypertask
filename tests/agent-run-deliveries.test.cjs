const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loadId = 0;

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function load(relativePath) {
  return createJiti(
    path.join(root, `tests/agent-run-deliveries-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(path.join(root, relativePath));
}

const runRecord = {
  id: "run-1",
  agentId: "agent-1",
  taskId: 42,
  chatSessionId: null,
  trigger: "mention",
  status: "done",
  createdAt: "2026-09-04T10:00:00.000Z",
  lastActivityAt: "2026-09-04T10:05:00.000Z",
  stoppedBy: null,
};

const state = {
  principal: { userId: 6, agentId: "agent-1" },
  run: runRecord,
  deliveries: [],
  queries: [],
  flagEnabled: true,
};

stub("src/lib/prisma.ts", {
  default: {
    agentWebhookDelivery: {
      findMany: async (query) => {
        state.queries.push(query);
        return state.deliveries;
      },
    },
  },
});
stub("src/lib/agentRuns/service.ts", {
  authenticateAgentRunRequest: async () => state.principal,
  agentRunsEnabledFor: async () => true,
  readAgentRun: async () => state.run,
});
stub("src/lib/mcp/auth.ts", { checkMcpRateLimit: async () => null });
stub("src/lib/flags.ts", { isFeatureEnabled: async () => state.flagEnabled });

const route = load("src/app/api/mcp/agents/runs/[id]/deliveries/route.ts");

function scenario(overrides = {}) {
  Object.assign(state, {
    principal: { userId: 6, agentId: "agent-1" },
    run: runRecord,
    deliveries: [],
    queries: [],
    flagEnabled: true,
    ...overrides,
  });
  return state;
}

function request() {
  const { NextRequest } = require("next/server");
  return new NextRequest("https://app.hypertask.ai/api/mcp/agents/runs/run-1/deliveries");
}

test("run deliveries return the recorded payloads a local handler can replay", async () => {
  const payload = {
    event: "run.created",
    deliveryId: "delivery-1",
    agentId: "agent-1",
    projectId: 15,
    taskId: 42,
    runId: "run-1",
    run: runRecord,
  };
  const { queries } = scenario({
    deliveries: [
      {
        id: "delivery-1",
        event: "run.created",
        createdAt: new Date("2026-09-04T10:00:00.000Z"),
        payload,
      },
    ],
  });

  const response = await route.GET(request(), { params: Promise.resolve({ id: "run-1" }) });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.deliveries, [
    {
      id: "delivery-1",
      event: "run.created",
      createdAt: "2026-09-04T10:00:00.000Z",
      payload,
    },
  ]);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].where, {
    subscription: { agentId: "agent-1" },
    event: { in: ["run.created", "run.prompted"] },
    payload: { path: ["runId"], equals: "run-1" },
  }, "deliveries are scoped to this run's own agent and lifecycle events");
});

test("an unreadable run exposes no delivery payloads", async () => {
  const { queries } = scenario({ run: null });
  const response = await route.GET(request(), { params: Promise.resolve({ id: "run-1" }) });
  assert.equal(response.status, 404);
  assert.equal(queries.length, 0, "the run access check runs before any payload read");
});

test("an unauthenticated caller exposes no delivery payloads", async () => {
  const { queries } = scenario({ principal: null });
  const response = await route.GET(request(), { params: Promise.resolve({ id: "run-1" }) });
  assert.equal(response.status, 401);
  assert.equal(queries.length, 0);
});

test("the ticket feature flag gates the recorded payloads", async () => {
  const { queries } = scenario({ flagEnabled: false });
  const response = await route.GET(request(), { params: Promise.resolve({ id: "run-1" }) });
  assert.equal(response.status, 404);
  assert.equal(queries.length, 0);
});
