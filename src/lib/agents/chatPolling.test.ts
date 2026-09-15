import assert from "node:assert/strict";
import {
  AGENT_CHAT_POLL_HEARTBEAT_TTL_MS,
  isAgentChatPollingActive,
} from "./chatAccess";

const now = new Date("2026-09-16T12:00:00.000Z");
assert.equal(isAgentChatPollingActive(null, now), false);
assert.equal(isAgentChatPollingActive(now, now), true);
assert.equal(
  isAgentChatPollingActive(
    new Date(now.getTime() - AGENT_CHAT_POLL_HEARTBEAT_TTL_MS),
    now,
  ),
  true,
);
assert.equal(
  isAgentChatPollingActive(
    new Date(now.getTime() - AGENT_CHAT_POLL_HEARTBEAT_TTL_MS - 1),
    now,
  ),
  false,
);

console.log("chatPolling.test.ts: all assertions passed");
