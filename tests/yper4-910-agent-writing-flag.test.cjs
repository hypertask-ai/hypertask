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

function enforcement(enabled) {
  const reads = [];
  const module = load("src/lib/agents/writingEnforcement.ts", {
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { reads.push([key, userId]); return enabled; } },
    "@/lib/flags/definitions/yper4-910-agent-writing": definition,
  });
  return { module, reads };
}

const long = "This deliberately long sentence contains far too many words for a brief update that people can scan easily.";
const agent = "85b985ac-afe8-41a3-a1ac-d9549a9310c7";

test("the policy reads the ticket flag for the acting user", async () => {
  const { module, reads } = enforcement(true);
  assert.equal(await module.agentWritingPolicyEnabled(6), true);
  assert.deepEqual(reads, [["yper4-910-agent-writing", 6]]);
  assert.equal(await enforcement(false).module.agentWritingPolicyEnabled(6), false);
});

test("flag on refuses what the guard refuses, flag off accepts the same text again", async () => {
  const on = enforcement(true).module;
  await assert.rejects(on.enforceAgentWriting(6, agent, { text: long }), /twelve/);
  await assert.rejects(on.enforceAgentWriting(6, agent, { text: "Next: waiting for checks." }), /agent log/);
  const off = enforcement(false).module;
  await off.enforceAgentWriting(6, agent, { text: long });
  await off.enforceAgentWriting(6, agent, { text: "Next: waiting for checks." });
});

test("a broken flag read keeps the declared Everyone default instead of failing the write", async () => {
  const module = load("src/lib/agents/writingEnforcement.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => { throw new Error("flag store unavailable"); } },
    "@/lib/flags/definitions/yper4-910-agent-writing": definition,
  });
  assert.equal(await module.agentWritingPolicyEnabled(6), true);
  await assert.rejects(module.enforceAgentWriting(6, agent, { text: long }), /twelve/);
});

test("human writes skip the flag read entirely", async () => {
  const { module, reads } = enforcement(true);
  await module.enforceAgentWriting(6, null, { text: long });
  assert.deepEqual(reads, []);
});

test("standalone CLI switches count as technical text", () => {
  const { assertAgentWriting, AgentWritingError } = load("src/lib/agents/writing.ts", {});
  for (const text of ["Run --force now.", "Use --dry-run here."]) {
    assert.throws(() => assertAgentWriting(agent, { text }), (error) => error instanceof AgentWritingError && error.field === "text");
  }
  assert.doesNotThrow(() => assertAgentWriting(agent, { text: "Saved views stay unchanged." }));
});
