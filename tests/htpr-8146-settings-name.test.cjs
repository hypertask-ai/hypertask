const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

test("Settings accessible-name bug fix defaults to Everyone", () => {
  const { default: flag, HTPR_8146_SETTINGS_NAME_FLAG: key } = loadModule("src/lib/flags/definitions/htpr-8146-settings-name.ts");
  assert.equal(key, "htpr-8146-settings-name");
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});
