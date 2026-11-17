const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const key = "htpr-9071-inbox-zero-tabs";

test("the inbox zero tab bar fix is live for everyone", () => {
  const { default: flag, HTPR_9071_INBOX_ZERO_TABS_FLAG: exported } = loadModule(
    "src/lib/flags/definitions/htpr-9071-inbox-zero-tabs.ts",
  );
  assert.equal(exported, key);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.shippedOn, "2026-11-17");
  assert.ok(flag.description.length > 0);
});

test("the fix is reversible with the switch and changes no saved data", () => {
  const { default: flag } = loadModule(
    "src/lib/flags/definitions/htpr-9071-inbox-zero-tabs.ts",
  );
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason.length > 0);
  assert.equal(flag.releaseRisk.highRisk, undefined);
  assert.equal(flag.releaseRisk.ownerRequest, undefined);
});
