const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const read = (file) => fs.readFileSync(require.resolve(`../${file}`), "utf8");

test("Agent Chat turn controls stay gated and visible", () => {
  const history = read("src/app/api/agent-chat/[sessionId]/route.ts");
  const stop = read("src/app/api/agent-chat/[sessionId]/stop/route.ts");
  const reply = read("src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts");
  const client = read("src/app/agents/chat/AgentChatClient.tsx");
  assert.match(history, /isFeatureEnabled[\s\S]*AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG/);
  assert.match(stop, /browserMutationIsSameOrigin[\s\S]*isFeatureEnabled/);
  assert.match(reply, /NOT:[\s\S]*AGENT_CHAT_TIMEOUT_MESSAGE[\s\S]*take: 50/);
  assert.match(client, />Queued<\/span>[\s\S]*sessionIdRef\.current !== targetSessionId[\s\S]*"Stopping…" : "Stop"/);
});
