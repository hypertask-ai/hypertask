const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const { HTPR_7681_AGENT_TEAM_OPENAI_DEFAULT_FLAG, default: definition } = load(
  "src/lib/flags/definitions/htpr-7681-agent-team-openai-default.ts",
  {},
);

test("agent team OpenAI default remains restricted for independent money review", () => {
  assert.equal(HTPR_7681_AGENT_TEAM_OPENAI_DEFAULT_FLAG, "htpr-7681-agent-team-openai-default");
  assert.equal(definition.key, HTPR_7681_AGENT_TEAM_OPENAI_DEFAULT_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "money");
  assert.ok(definition.releaseRisk.reason);
});
