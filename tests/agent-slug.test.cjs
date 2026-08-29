const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  slugifyAgentName,
  assignAgentSlugs,
  resolveAgentRef,
  looksLikeAgentId,
} = jiti(path.join(root, "src/lib/agents/slug.ts"));

const agent = (id, displayName, createdAt) => ({ id, displayName, createdAt });

test("a display name becomes a readable URL segment", () => {
  assert.equal(slugifyAgentName("Board Maintainer"), "board-maintainer");
  assert.equal(slugifyAgentName("CLI/MCP/API & AI Chat"), "cli-mcp-api-ai-chat");
  assert.equal(slugifyAgentName("  Trailing --- dashes  "), "trailing-dashes");
  assert.equal(slugifyAgentName("Café Agent"), "cafe-agent");
});

test("a name with nothing sluggable still gets a URL", () => {
  // An emoji-only or punctuation-only name would otherwise produce "", and
  // /agents/ is the register, not that agent.
  assert.equal(slugifyAgentName("🤖"), "agent");
  assert.equal(slugifyAgentName("!!!"), "agent");
  assert.equal(slugifyAgentName(""), "agent");
});

test("two agents with the same name get stable, distinct slugs", () => {
  // The older one keeps the bare slug: adding a second agent with an existing
  // name must not silently move the first one's URL.
  const older = agent("a", "QA Agent", "2026-01-01T00:00:00.000Z");
  const newer = agent("b", "QA Agent", "2026-06-01T00:00:00.000Z");
  const slugs = assignAgentSlugs([newer, older]);
  assert.equal(slugs.get("a"), "qa-agent");
  assert.equal(slugs.get("b"), "qa-agent-2");

  // Same answer whatever order the rows arrive in.
  const again = assignAgentSlugs([older, newer]);
  assert.equal(again.get("a"), "qa-agent");
  assert.equal(again.get("b"), "qa-agent-2");
});

test("a duplicate name never lands on a slug another agent already owns", () => {
  // Without this, "QA Agent 2" and the second "QA Agent" both answer to
  // /agents/qa-agent-2, so one card links to the other agent — and archive or
  // delete on that page would hit the wrong one.
  const literal = agent("a", "QA Agent 2", "2026-01-01T00:00:00.000Z");
  const first = agent("b", "QA Agent", "2026-02-01T00:00:00.000Z");
  const second = agent("c", "QA Agent", "2026-03-01T00:00:00.000Z");
  const slugs = assignAgentSlugs([second, first, literal]);
  assert.equal(slugs.get("a"), "qa-agent-2");
  assert.equal(slugs.get("b"), "qa-agent");
  assert.equal(slugs.get("c"), "qa-agent-3");
  assert.equal(new Set([...slugs.values()]).size, 3);
});

test("a slug or an id both resolve, and anything else does not", () => {
  const agents = [
    agent("11111111-1111-4111-8111-111111111111", "Board Maintainer", "2026-01-01T00:00:00.000Z"),
    agent("22222222-2222-4222-8222-222222222222", "Board Maintainer", "2026-02-01T00:00:00.000Z"),
  ];
  assert.equal(resolveAgentRef(agents, "board-maintainer"), agents[0].id);
  assert.equal(resolveAgentRef(agents, "board-maintainer-2"), agents[1].id);
  assert.equal(resolveAgentRef(agents, "BOARD-MAINTAINER"), agents[0].id);
  // Ids keep working, which is what makes every existing link and API caller
  // survive the change.
  assert.equal(resolveAgentRef(agents, agents[1].id), agents[1].id);
  assert.equal(resolveAgentRef(agents, "someone-elses-agent"), null);
  assert.equal(resolveAgentRef(agents, ""), null);
});

test("an id is recognised as an id, a slug is not", () => {
  assert.equal(looksLikeAgentId("be6887e6-6c12-4007-967c-3070bab34a7b"), true);
  assert.equal(looksLikeAgentId("board-maintainer"), false);
});
