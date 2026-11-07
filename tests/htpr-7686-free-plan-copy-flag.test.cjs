const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("free plan copy ships to Everyone because charges stay the same", () => {
  const { default: definition, HTPR_7686_FREE_PLAN_COPY_FLAG } = load("src/lib/flags/definitions/htpr-7686-free-plan-copy.ts", {});
  assert.equal(HTPR_7686_FREE_PLAN_COPY_FLAG, "htpr-7686-free-plan-copy");
  assert.equal(definition.key, HTPR_7686_FREE_PLAN_COPY_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.highRisk, undefined);
  assert.match(definition.releaseRisk.reason, /charges stay the same/);
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.deepEqual(definition.related, ["htpr-7686-free-plan-limits", "htpr-7923-unlimited-free-tickets"]);
});
