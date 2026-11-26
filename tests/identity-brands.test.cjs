const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { agentIdSchema, userIdSchema } = load("src/lib/identity.ts");
const { injectMentionSpans, normalizeMentionSpans } = load("src/utils/controllers/comments/resolveMentions.ts");

test("identity boundaries preserve valid database ids without coercing a different kind", () => {
  assert.equal(agentIdSchema.parse("agent-1"), "agent-1");
  assert.equal(userIdSchema.parse(6), 6);
  for (const input of [6, null, undefined, "", "   "]) {
    assert.equal(agentIdSchema.safeParse(input).success, false);
  }
  for (const input of ["agent-1", "6", 0, -1, 1.5, Infinity, 2_147_483_648]) {
    assert.equal(userIdSchema.safeParse(input).success, false);
  }
});

test("normalized mention insertion preserves the named person and agent", () => {
  const members = [
    { id: userIdSchema.parse(6), displayName: "Alex" },
    { id: agentIdSchema.parse("agent-1"), displayName: "Alex runner" },
  ];
  const input = '<span data-type="mention" data-id="Alex" data-label="agent-agent-1">Alex</span> and @Alex';
  const output = injectMentionSpans(normalizeMentionSpans(input, members), members);
  assert.match(output, /data-label="agent-agent-1">Alex runner<\/span>/);
  assert.match(output, /data-label="name-6"[^>]*>Alex<\/span>/);
  assert.equal((output.match(/<span/g) ?? []).length, 2);
});
