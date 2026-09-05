const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

// One shared record of what the fakes should answer, so the module graph is
// loaded once and each test only changes the answers.
const state = {
  enabledFlags: new Set(),
  delivery: {
    id: "wd_1",
    event: "run.created",
    status: "delivered",
    attemptCount: 1,
    statusCode: 200,
    error: null,
    createdAt: new Date("2026-09-05T09:00:00.000Z"),
    lastAttemptAt: new Date("2026-09-05T09:00:01.000Z"),
    deliveredAt: new Date("2026-09-05T09:00:01.000Z"),
    payload: { event: "run.created", runId: "run_1", agentId: "agent-a" },
  },
};

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule("src/lib/prisma.ts", {
  default: {
    agent: { findFirst: async () => ({ id: "agent-a", userId: 6 }) },
    agentWebhookSubscription: {
      findUnique: async () => ({
        id: "sub-a",
        agentId: "agent-a",
        projectId: 15,
        url: "https://example.com/hook",
        secret: "whsec_abcd",
        events: ["run.created"],
        active: true,
        createdAt: state.delivery.createdAt,
        updatedAt: state.delivery.createdAt,
        lastDeliveryAt: state.delivery.deliveredAt,
        lastDeliveryOk: true,
        deliveries: [state.delivery],
      }),
    },
  },
});
stubModule("src/lib/flags.ts", {
  isFeatureEnabled: async (key) => state.enabledFlags.has(key),
});

const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { manageAgentWebhook } = jiti(
  path.join(root, "src/lib/agentWebhooks/management.ts"),
);

const RUNS_FLAG = "htpr-6115-agent-sdk";
const DEV_LOOP_FLAG = "htpr-6124-agent-dev-loop";

async function getWebhook(flags) {
  state.enabledFlags = new Set(flags);
  return manageAgentWebhook({ userId: 6, agentId: "agent-a", action: "get" });
}

test("the recorded payload only reaches an author whose local dev loop is on", async () => {
  const off = await getWebhook([RUNS_FLAG]);
  assert.equal(off.deliveries.length, 1);
  assert.equal(
    "payload" in off.deliveries[0],
    false,
    "a run payload names tickets and prompts, so it stays behind its own flag",
  );

  const on = await getWebhook([RUNS_FLAG, DEV_LOOP_FLAG]);
  assert.deepEqual(on.deliveries[0].payload, state.delivery.payload);
  assert.equal(
    on.deliveries[0].id,
    "wd_1",
    "replay needs the delivery id alongside the payload it re-sends",
  );
});

test("only a run delivery carries its payload", async () => {
  const runPayload = state.delivery.payload;
  state.delivery = {
    ...state.delivery,
    event: "comment.mention",
    payload: { event: "comment.mention", commentHtml: "<p>hello</p>" },
  };
  const result = await getWebhook([RUNS_FLAG, DEV_LOOP_FLAG]);
  assert.equal(
    "payload" in result.deliveries[0],
    false,
    "replay reads run deliveries only, so comment body text never travels",
  );
  state.delivery = { ...state.delivery, event: "run.created", payload: runPayload };
});

test("the payload never travels without the agent run flag that records it", async () => {
  const devLoopOnly = await getWebhook([DEV_LOOP_FLAG]);
  assert.deepEqual(
    devLoopOnly.deliveries,
    [],
    "run deliveries are filtered out entirely when agent runs are off",
  );
});
