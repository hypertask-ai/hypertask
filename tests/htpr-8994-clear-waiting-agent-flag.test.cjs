const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("clearing a waiting agent has its own Everyone bugfix flag", () => {
  const { default: definition, HTPR_8994_CLEAR_WAITING_AGENT_FLAG } = load(
    "src/lib/flags/definitions/htpr-8994-clear-waiting-agent.ts",
    {},
  );
  assert.equal(HTPR_8994_CLEAR_WAITING_AGENT_FLAG, "htpr-8994-clear-waiting-agent");
  assert.equal(definition.key, HTPR_8994_CLEAR_WAITING_AGENT_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-11-10");
  assert.match(definition.description, /Waiting on/);
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(definition.releaseRisk.highRisk, undefined);
});
