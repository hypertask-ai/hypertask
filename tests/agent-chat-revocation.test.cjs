const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const route = fs.readFileSync(
  path.join(__dirname, "../src/app/api/agent-chat/[sessionId]/messages/route.ts"),
  "utf8",
);

function sessionLookup() {
  const start = route.indexOf("const session = await prisma.chatSession.findFirst(");
  const end = route.indexOf("if (!session || !session.agentId)", start);
  assert.notEqual(start, -1, "message route must look up the chat session");
  assert.notEqual(end, -1, "message route must validate the session lookup");
  return route.slice(start, end);
}

test("message sends require the linked agent to remain active", () => {
  const lookup = sessionLookup();
  assert.match(
    lookup,
    /agent:\s*\{[^}]*\brevokedAt:\s*null\b/,
    "an existing session must not remain writable after its agent is revoked",
  );
  assert.match(
    lookup,
    /\.\.\.accessibleAgentWhere\(userId\)/,
    "message sends must retain the agent access filter",
  );
});
