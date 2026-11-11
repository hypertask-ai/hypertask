const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const { agentChatDeliveryMode, retainUndeliveredAgentChat } = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
})(path.join(root, "src/lib/agents/chatAvailability.ts"));

const now = new Date("2026-11-11T01:00:00.000Z");
const fresh = new Date(now.getTime() - 30_000);

test("flag off still shuts out a webhook that does not include chat", () => {
  assert.equal(agentChatDeliveryMode({
    heartbeatAt: fresh,
    subscription: { active: true, events: ["task.assigned"] },
  }, now, false), null);
});

test("flag on lets that webhook fall through to a fresh heartbeat", () => {
  assert.equal(agentChatDeliveryMode({
    heartbeatAt: fresh,
    subscription: { active: true, events: ["task.assigned"] },
  }, now, true), "polling");
});

test("flag on keeps a chat webhook on the webhook path", () => {
  assert.equal(agentChatDeliveryMode({
    heartbeatAt: fresh,
    subscription: { active: true, events: ["chat.message"] },
  }, now, true), "webhook");
});

test("offline send is retained only when the next poll can read it", () => {
  assert.equal(retainUndeliveredAgentChat({
    webhookDeliveryCount: 0,
    mode: null,
    pollingFallbackEnabled: false,
    subscriptionActive: false,
    subscriptionHasChat: false,
  }), false);
  assert.equal(retainUndeliveredAgentChat({
    webhookDeliveryCount: 0,
    mode: null,
    pollingFallbackEnabled: true,
    subscriptionActive: false,
    subscriptionHasChat: false,
  }), true);
  assert.equal(retainUndeliveredAgentChat({
    webhookDeliveryCount: 0,
    mode: "webhook",
    pollingFallbackEnabled: true,
    subscriptionActive: true,
    subscriptionHasChat: true,
  }), false);
  assert.equal(retainUndeliveredAgentChat({
    webhookDeliveryCount: 1,
    mode: null,
    pollingFallbackEnabled: true,
    subscriptionActive: false,
    subscriptionHasChat: false,
  }), false);
});

test("the rendered sidebar describes delivery honestly and preserves flag-off wording", () => {
  const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
  let enabled = true;
  const noop = () => {};
  const source = loader({
    "@/hooks/useFlag": { useFlag: (key) => key === "htpr-7742-agent-chat-all" && enabled },
    "@/components/Agents/AgentAvatar": { default: () => null },
    "@/components/AI_CHAT/AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
    "@/components/AI_CHAT/TypingIndicator": { TypingIndicator: () => null },
    "@/components/RTE/Components/AudioButton": { AudioButton: () => null },
    "@/lib/configs/general.config": { MOBILE_TARGET: "" },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "./AgentChatFeedItems": { emptyFeedText: () => "No messages" },
  });
  const { AgentChatPane } = source("src/app/agents/chat/AgentChatPane.tsx");
  const view = mount();
  try {
    const render = (deliveryMode, deliveryNotice = false) => view.render(React.createElement(AgentChatPane, {
      embedded: true, active: true, isExternal: true, reuseAiComposer: true,
      selectedAgent: { id: "agent", displayName: "Agent" },
      messages: [], visibleFeed: [], queuedMessages: [], draft: "",
      setIsRecording: noop, deliveryMode, deliveryNotice,
    }));
    render(null);
    assert.ok(view.container.textContent.includes("Reads when it next runs"));
    assert.ok(!view.container.textContent.includes("runtime has not enabled chat"));
    for (const mode of ["webhook", "polling"]) {
      render(mode);
      assert.ok(view.container.textContent.includes("Online"));
      assert.ok(!view.container.textContent.includes("Reads when it next runs"));
    }
    enabled = false;
    render(null, true);
    assert.ok(view.container.textContent.includes("This agent's runtime has not enabled chat yet."));
    render(null);
    assert.ok(!view.container.textContent.includes("runtime has not enabled chat"));
  } finally { view.close(); }
});

test("heartbeat accepts only an enabled authenticated agent and updates only its own presence", async () => {
  const { load } = require("./task-route-loader.cjs");
  let ctx = null;
  let enabled = true;
  let revoked = false;
  const updates = [];
  const route = load("src/app/api/mcp/chat/heartbeat/route.ts", {
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ctx,
    },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/prisma": { default: { agent: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: "agent", userId: 985, revokedAt: null });
        return revoked ? null : { heartbeatAt: null };
      },
      updateMany: async (input) => { updates.push(input); return { count: 1 }; },
    } } },
  });
  const request = (body = {}) => new Request("https://app.hypertask.ai/api/mcp/chat/heartbeat", {
    method: "POST", body: JSON.stringify(body),
  });
  assert.equal((await route.POST(request())).status, 401);
  ctx = { user: { id: 985 } };
  assert.equal((await route.POST(request())).status, 403);
  ctx = { agentId: "agent", user: { id: 985 } };
  enabled = false;
  assert.equal((await route.POST(request())).status, 404);
  enabled = true;
  assert.equal((await route.POST(request({ agentId: "other" }))).status, 400);
  assert.equal(updates.length, 0);
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, "agent");
  assert.equal(updates[0].where.userId, 985);
  assert.equal(updates[0].where.revokedAt, null);
  assert.ok(updates[0].data.heartbeatAt instanceof Date);
  revoked = true;
  assert.equal((await route.POST(request())).status, 404);
  assert.equal(updates.length, 1);
});

test("MCP chat tools appear only for enabled agent tokens and dispatch to inbox and reply", async () => {
  const { load } = require("./task-route-loader.cjs");
  let enabled = true;
  const calls = [];
  const apiClient = { makeRequest: async (url, options) => {
    calls.push({ url, options });
    return { success: true, messages: [] };
  } };
  const { appendAgentChatTools } = load("src/lib/mcp-server/tools/chat-inbox.tool.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "../utils/executeWithService": { executeWithService: async (_token, Service, execute, input) =>
      execute(new Service(apiClient), input) },
  });
  for (const ctx of [undefined, { user: { id: 985 } }, { agentId: "agent", user: { id: 985 }, management: true }]) {
    assert.deepEqual(await appendAgentChatTools([], ctx), []);
  }
  const ctx = { agentId: "agent", user: { id: 985 } };
  enabled = false;
  assert.deepEqual(await appendAgentChatTools([], ctx), []);
  enabled = true;
  const tools = await appendAgentChatTools([], ctx);
  assert.deepEqual(tools.map((tool) => tool.name), ["hypertask_chat_inbox", "hypertask_chat_reply"]);
  assert.equal((await appendAgentChatTools(tools, ctx)).length, 2);
  await tools[0].execute({}, "own-token");
  assert.equal(calls[0].url, "/mcp/chat/pending?unanswered=true");
  assert.equal(calls[0].options.method, "GET");
  await tools[1].execute({ session_id: "session/1", reply_to_message_id: "message-1", text: "Here" }, "own-token");
  assert.equal(calls[1].url, "/mcp/chat/sessions/session%2F1/messages");
  assert.deepEqual(JSON.parse(calls[1].options.body), { text: "Here", replyToMessageId: "message-1" });
  await assert.rejects(tools[1].execute({ session_id: "session", text: "Here" }, "own-token"));
});
