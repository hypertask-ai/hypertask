const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Agent Chat turn controls stay gated, durable, and race-safe", () => {
  const service = read("src/lib/agentRuns/service.ts");
  const history = read("src/app/api/agent-chat/[sessionId]/route.ts");
  const stop = read("src/app/api/agent-chat/[sessionId]/stop/route.ts");
  const reply = read("src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts");
  const client = read("src/app/agents/chat/AgentChatClient.tsx");

  assert.match(history, /isFeatureEnabled\([\s\S]*AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG/);
  assert.match(stop, /browserMutationIsSameOrigin[\s\S]*isFeatureEnabled/);
  assert.match(service, /userId: principal\.userId[\s\S]*AGENT_RUN_STALE_AFTER_MS/);
  assert.match(service, /chatMessage\.createMany[\s\S]*agentRun\.updateMany/);
  assert.match(service, /isDelivered: false[\s\S]*replyToMessageId: message\.id/);
  assert.match(reply, /agentChatSystemMessageKind\(existing\)[\s\S]*no longer active/);
  assert.match(client, /setAwaiting\(Boolean\(data\.awaiting\)\)/);
  assert.match(client, />Queued<\/span>[\s\S]*>\s*Cancel\s*<\/button>/);
  assert.match(client, /\{stopping \? "Stopping…" : "Stop"\}/);
});
