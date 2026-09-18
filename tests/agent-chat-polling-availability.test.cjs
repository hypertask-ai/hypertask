const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const {
  AGENT_CHAT_HEARTBEAT_MAX_AGE_MS,
  agentChatDeliveryMode,
} = createJiti(path.join(root, "tests/agent-chat-polling-availability-entry.cjs"), {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
})(path.join(root, "src/lib/agents/chatAvailability.ts"));

const now = new Date("2026-09-17T12:00:00.000Z");
const noWebhook = { subscription: null };

test("a fresh runtime heartbeat enables polling chat", () => {
  assert.equal(
    agentChatDeliveryMode(
      {
        ...noWebhook,
        heartbeatAt: new Date(now.getTime() - AGENT_CHAT_HEARTBEAT_MAX_AGE_MS + 1),
      },
      now,
    ),
    "polling",
  );
});

test("polling chat expires after two minutes", () => {
  assert.equal(
    agentChatDeliveryMode(
      {
        ...noWebhook,
        heartbeatAt: new Date(now.getTime() - AGENT_CHAT_HEARTBEAT_MAX_AGE_MS),
      },
      now,
    ),
    null,
  );
});

test("an active webhook remains the first and only delivery mode", () => {
  assert.equal(
    agentChatDeliveryMode(
      {
        heartbeatAt: now,
        subscription: { active: true, events: ["chat.message"] },
      },
      now,
    ),
    "webhook",
  );
  assert.equal(
    agentChatDeliveryMode(
      {
        heartbeatAt: now,
        subscription: { active: true, events: ["task.assigned"] },
      },
      now,
    ),
    null,
    "polling must not change an existing non-chat webhook setup",
  );
});
