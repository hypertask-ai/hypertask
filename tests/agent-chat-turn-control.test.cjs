const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
test("Agent Chat turns stay gated, durable, and race-safe", () => {
  const [service, history, stop, reply, client] = [
    "src/lib/agentRuns/service.ts",
    "src/app/api/agent-chat/[sessionId]/route.ts",
    "src/app/api/agent-chat/[sessionId]/stop/route.ts",
    "src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts",
    "src/app/agents/chat/AgentChatClient.tsx",
  ].map((file) => fs.readFileSync(require.resolve(`../${file}`), "utf8"));
  assert.match(history, /isFeatureEnabled\([\s\S]*AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG/);
  assert.match(stop, /browserMutationIsSameOrigin[\s\S]*isFeatureEnabled/);
  assert.match(service, /userId: principal\.userId[\s\S]*AGENT_RUN_STALE_AFTER_MS[\s\S]*chatMessage\.createMany[\s\S]*agentRun\.updateMany[\s\S]*replyToMessageId: target\.id/);
  assert.match(reply, /agentChatSystemMessageKind\(existing\)[\s\S]*no longer active/);
  assert.match(client, />Queued<\/span>[\s\S]*setAwaiting\(Boolean\(data\.awaiting\)\)[\s\S]*\{stopping \? "Stopping…" : "Stop"\}/);
});
