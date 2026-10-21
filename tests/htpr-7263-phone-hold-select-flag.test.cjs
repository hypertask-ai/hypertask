const test = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./helpers/htpr-7260-ui.cjs");

test("phone hold selection is an explicitly default-Off feature with release-risk metadata", () => {
  const { default: definition, HTPR_7263_PHONE_HOLD_SELECT_FLAG: key } = loader()(
    "src/lib/flags/definitions/htpr-7263-phone-hold-select.ts",
  );
  assert.equal(key, "htpr-7263-phone-hold-select");
  assert.equal(definition.key, key);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OFF");
  assert.match(definition.shippedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(definition.releaseRisk.risk, "new");
  assert.ok(definition.releaseRisk.reason.trim());
  assert.equal(definition.releaseRisk.highRisk, undefined);
  assert.ok(definition.description.trim());
});
