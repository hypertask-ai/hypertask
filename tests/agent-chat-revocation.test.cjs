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
  const end = access.indexOf("export async function userTeamIds", start);
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

test("the user rule keeps a thread inside the team it belongs to", () => {
  const rule = userSessionRule();
  // HTPR-6002: the thread is shared with everyone the agent is shared with, so
  // the requester no longer has to own it. What still bounds it is the
  // conversation's own recorded team, which is what stops an agent that later
  // moved teams handing its old team's transcript to the new one.
  assert.match(
    rule,
    /OR:\s*\[[\s\S]*\{\s*userId\s*\}/,
    "the row's own person keeps the thread they had before it was shared",
  );
  assert.match(
    rule,
    /teamId:\s*\{\s*in:\s*\[\.\.\.teamIds\]\s*\}/,
    "a conversation with a team is readable only by that team's members",
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
