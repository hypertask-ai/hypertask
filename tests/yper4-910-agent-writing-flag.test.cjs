const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const definition = load("src/lib/flags/definitions/yper4-910-agent-writing.ts", {});

test("agent writing policy ships for everyone with release-risk metadata", () => {
  assert.equal(definition.YPER4_910_AGENT_WRITING_FLAG, "yper4-910-agent-writing");
  assert.equal(definition.default.key, "yper4-910-agent-writing");
  assert.equal(definition.default.kind, "improvement");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  assert.match(definition.default.shippedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(definition.default.releaseRisk.highRisk, undefined);
  assert.ok(definition.default.releaseRisk.reason.trim());
  assert.ok(definition.default.description.trim());
});

function enforcement(candidates) {
  return load("src/lib/agents/writingEnforcement.ts", {
    "@/lib/flags": { featureFlagCandidateUserIds: async () => candidates },
    "@/lib/flags/definitions/yper4-910-agent-writing": definition,
  });
}

const long = "This deliberately long sentence contains far too many words for a brief update that people can scan easily.";

test("policy is on for Everyone and every unrestricted mode, off only when the flag excludes everyone", async () => {
  assert.equal(await enforcement(null).agentWritingPolicyEnabled(), true);
  assert.equal(await enforcement([6]).agentWritingPolicyEnabled(), true);
  assert.equal(await enforcement([]).agentWritingPolicyEnabled(), false);
});

test("flag on refuses the same text the guard refuses, flag off accepts it again", async () => {
  await assert.rejects(enforcement(null).enforceAgentWriting("agent", { text: long }), /twelve/);
  await assert.rejects(enforcement([6]).enforceAgentWriting("agent", { text: "Next: waiting for checks." }), /agent log/);
  await enforcement([]).enforceAgentWriting("agent", { text: long });
  await enforcement([]).enforceAgentWriting("agent", { text: "Next: waiting for checks." });
  await enforcement(null).enforceAgentWriting(null, { text: long });
});

test("standalone CLI switches count as technical text", () => {
  const { assertAgentWriting, AgentWritingError } = load("src/lib/agents/writing.ts", {});
  for (const text of ["Run --force now.", "Use --dry-run here."]) {
    assert.throws(() => assertAgentWriting("agent", { text }), (error) => error instanceof AgentWritingError && error.field === "text");
  }
  assert.doesNotThrow(() => assertAgentWriting("agent", { text: "Saved views stay unchanged." }));
});
