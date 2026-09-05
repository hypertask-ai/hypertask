const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// The revocation rule moved out of the individual routes into one shared
// module (HTPR-6002), so this asserts the rule where it now lives and that
// every chat route still goes through it.
const access = fs.readFileSync(
  path.join(__dirname, "../src/lib/agents/chatAccess.ts"),
  "utf8",
);

const USER_ROUTES = [
  "src/app/api/agent-chat/[sessionId]/route.ts",
  "src/app/api/agent-chat/[sessionId]/messages/route.ts",
  "src/app/api/agent-chat/[sessionId]/proposals/[proposalId]/route.ts",
];

function userSessionRule() {
  const start = access.indexOf("export function userAgentChatSessionWhere");
  const end = access.indexOf("type ChatSessionOf", start);
  assert.notEqual(start, -1, "the shared layer must expose the user rule");
  assert.notEqual(end, -1, "the user rule must be a bounded block");
  return access.slice(start, end);
}

test("message sends require the linked agent to remain active", () => {
  assert.match(
    userSessionRule(),
    /agent:\s*\{[\s\S]*\.\.\.accessibleAgentWhere\(userId\),[\s\S]*revokedAt:\s*null,/,
    "revoked must come after the spread, or a key collision could silently unrevoke",
  );
});

test("the user rule keeps a thread private to its owner", () => {
  const rule = userSessionRule();
  assert.match(
    rule,
    /^\s*userId,$/m,
    "the session must belong to the requester",
  );
  assert.match(
    rule,
    /agentId:\s*\{\s*not:\s*null\s*\}/,
    "only agent threads go through the agent chat routes",
  );
});

for (const route of USER_ROUTES) {
  test(`${route} authorizes through the shared layer`, () => {
    const source = fs.readFileSync(path.join(__dirname, "..", route), "utf8");
    assert.match(
      source,
      /loadUserAgentChatSession\(/,
      "the route must use the shared authorization layer",
    );
    assert.doesNotMatch(
      source,
      /prisma\.chatSession\.findFirst\(/,
      "a route-local session lookup would be a second copy of the rule",
    );
  });
}

test("the agent token route refuses another agent's thread", () => {
  const route = fs.readFileSync(
    path.join(
      __dirname,
      "../src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts",
    ),
    "utf8",
  );
  assert.equal(
    (route.match(/loadAgentTokenChatSession\(/g) || []).length,
    2,
    "both the transcript read and the reply write must be authorized",
  );
  assert.doesNotMatch(
    route,
    /prisma\.chatSession\.findFirst\(/,
    "a route-local session lookup would be a second copy of the rule",
  );
  assert.match(
    access,
    /session\.agentId !== agentId[\s\S]{0,120}status: 403/,
    "a mismatched agent identity is refused, not silently hidden",
  );
});
