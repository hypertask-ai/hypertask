const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
let active, fresh, rows, deliveries, delivery, attemptOk, sentPayloads, claims;
const stub = (file, exports) => {
  const id = path.join(root, file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const prisma = {
  $transaction: async (fn) => typeof fn === "function" ? fn(prisma) : Promise.all(fn),
  $queryRaw: async (strings) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "Agent"')) return [{ id: "agent-1", heartbeatAt: fresh ? new Date() : null }];
    if (sql.includes("WITH pending AS")) {
      claims++;
      return rows.filter((row) => !row.isDelivered).map((row) => { row.isDelivered = true; return { id: row.id, sessionId: row.sessionId, text: row.content, userName: "Owner" }; });
    }
    throw new Error("Unexpected query");
  },
  user: { findUnique: async () => ({ displayName: "Owner" }) },
  chatSession: { update: async () => null },
  chatSessionParticipant: { updateMany: async () => ({ count: 1 }) },
  chatMessage: {
    create: async ({ data }) => { const row = { id: `prompt-${rows.length}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }) => Object.assign(rows.find((row) => row.id === where.id), data),
  },
  agentWebhookSubscription: {
    findUnique: async () => ({ active }), update: async () => null,
  },
  agentWebhookDelivery: {
    updateMany: async () => {
      if (!["pending", "retrying"].includes(delivery.status) || delivery.nextAttemptAt > new Date()) return { count: 0 };
      delivery.status = "processing"; return { count: 1 };
    },
    findUnique: async () => delivery,
    update: async ({ data }) => Object.assign(delivery, data),
  },
};
stub("src/lib/prisma.ts", { default: prisma });
stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => ({ userId: 6 }) });
stub("src/lib/agents/chatAccess.ts", {
  sidebarChatProjectId: () => 15,
  ensureChatParticipant: async () => null,
  loadUserAgentChatSession: async () => ({ ok: true, agentId: "agent-1", session: { id: "session-1", agent: { runtimeType: "EXTERNAL" } } }),
});
stub("src/lib/flags.ts", { isFeatureEnabled: async () => false });
stub("src/lib/agents/chatBrief.ts", { buildAgentChatBrief: async () => null });
stub("src/lib/agents/chatBroadcast.ts", { broadcastChatSession: async () => null });
stub("src/lib/agentWebhooks/outbox.ts", {
  persistAgentRunTriggerWebhooks: async () => deliveries,
  publishAgentWebhookDeliveries: async () => null,
});
stub("src/lib/mcp/routeWrapper.ts", {
  wrapMcpRoute: (handler) => handler,
  checkMcpRouteRateLimit: async () => null,
  validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: "agent-1" }),
});
stub("src/lib/agentWebhooks/queue.ts", { queueAgentWebhookDelivery: async () => null });
stub("src/lib/mcp/webhooks/delivery.ts", {
  postSignedWebhook: async ({ body }) => { sentPayloads.push(JSON.parse(body)); return { ok: attemptOk, statusCode: attemptOk ? 200 : 503, error: attemptOk ? null : "retry" }; },
});
const load = (file) => createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true })(path.join(root, file));
const sendRoute = load("src/app/api/agent-chat/[sessionId]/messages/route.ts");
const pendingRoute = load("src/app/api/mcp/chat/pending/route.ts");
const { deliverAgentWebhook } = load("src/lib/agentWebhooks/delivery.ts");
const { agentChatDeliveryMode } = load("src/lib/agents/chatAvailability.ts");
test.beforeEach(() => {
  active = true; fresh = true; rows = []; deliveries = ["delivery-1"]; attemptOk = true; sentPayloads = []; claims = 0;
  delivery = { id: "delivery-1", event: "chat.message", status: "pending", attemptCount: 0, nextAttemptAt: new Date(0), subscriptionId: "sub-1",
    payload: { chat: { sessionId: "session-1", messageId: "prompt-0", text: "hello" } },
    subscription: { active: true, url: "https://example.invalid/hook", secret: "fixture", agent: { revokedAt: null, userId: 6 } } };
});
async function send() {
  const response = await sendRoute.POST(new Request("https://app.hypertask.ai/api/agent-chat/session-1/messages", {
    method: "POST", body: JSON.stringify({ text: "hello" }),
  }), { params: Promise.resolve({ sessionId: "session-1" }) });
  assert.equal(response.status, 200);
}
async function pending() {
  const response = await pendingRoute.GET(new Request("https://app.hypertask.ai/api/mcp/chat/pending"));
  assert.equal(response.status, 200); return (await response.json()).messages;
}
test("successful signed webhook delivery cannot requeue the persisted sidebar prompt", async () => {
  await send();
  assert.equal(rows[0].isDelivered, true);
  assert.equal((await deliverAgentWebhook(delivery.id)).status, "delivered");
  assert.deepEqual(await pending(), []); assert.equal(claims, 0);
  active = false;
  assert.deepEqual(await pending(), []);
  assert.equal(rows.length, 1);
});
test("failed webhook retry keeps one prompt and one delivery identity, never a polling copy", async () => {
  await send(); attemptOk = false;
  assert.equal((await deliverAgentWebhook(delivery.id)).status, "retrying");
  assert.deepEqual(await pending(), []); assert.equal(claims, 0);
  delivery.nextAttemptAt = new Date(0); attemptOk = true;
  assert.equal((await deliverAgentWebhook(delivery.id)).status, "delivered");
  assert.equal((await deliverAgentWebhook(delivery.id)).status, "skipped");
  assert.deepEqual(sentPayloads.map((payload) => payload.chat.messageId), ["prompt-0", "prompt-0"]);
  assert.equal(rows.length, 1); assert.equal(rows[0].isDelivered, true);
});
test("fresh polling claims the prompt exactly once", async () => {
  active = false; deliveries = []; await send();
  assert.equal(rows[0].isDelivered, false);
  assert.equal((await pending()).length, 1);
  assert.deepEqual(await pending(), []);
});
test("an active non-chat webhook is not advertised as polling or chat capable", () => {
  assert.equal(agentChatDeliveryMode({ heartbeatAt: new Date(), subscription: { active: true, events: ["task.assigned"] } }), null);
});
