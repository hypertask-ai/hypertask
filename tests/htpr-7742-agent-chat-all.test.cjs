const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("the sidebar sentence is Online or Reads when it next runs when the flag is on", () => {
  const source = fs.readFileSync(path.join(root, "src/app/agents/chat/AgentChatPane.tsx"), "utf8");
  assert.match(source, /chatAllEnabled/);
  assert.match(source, /"Online"/);
  assert.match(source, /"Reads when it next runs"/);
  assert.match(source, /This agent's runtime has not enabled chat yet\./);
});
