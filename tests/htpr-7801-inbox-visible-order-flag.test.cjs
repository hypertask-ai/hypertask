const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("inbox visible-order bugfix defaults to Everyone with a small release risk", () => {
  const { default: definition, HTPR_7801_INBOX_VISIBLE_ORDER_FLAG } = load("src/lib/flags/definitions/htpr-7801-inbox-visible-order.ts", {});
  assert.equal(HTPR_7801_INBOX_VISIBLE_ORDER_FLAG, "htpr-7801-inbox-visible-order");
  assert.equal(definition.key, HTPR_7801_INBOX_VISIBLE_ORDER_FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(definition.releaseRisk.highRisk, undefined);
});
