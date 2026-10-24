const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("task waiting-on has its own Everyone-default feature flag with a release risk", () => {
  const { default: definition, HTPR_7723_TASK_WAITING_ON_FLAG } = load("src/lib/flags/definitions/htpr-7723-task-waiting-on.ts", {});
  assert.equal(HTPR_7723_TASK_WAITING_ON_FLAG, "htpr-7723-task-waiting-on");
  assert.equal(definition.key, HTPR_7723_TASK_WAITING_ON_FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-24");
  assert.equal(definition.description, "Agents can set and clear blocked by person on a ticket through MCP and the CLI.");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(definition.releaseRisk.highRisk, undefined);
  assert.equal(require("../e2e/smoke/production-flag-modes.json").modes[definition.key], "EVERYONE");
});
