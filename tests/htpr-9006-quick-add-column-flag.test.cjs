const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

test("htpr-9006 quick add column flag ships to everyone as a small bugfix", () => {
  const mod = load("src/lib/flags/definitions/htpr-9006-quick-add-column.ts");
  assert.equal(mod.HTPR_9006_QUICK_ADD_COLUMN_FLAG, "htpr-9006-quick-add-column");
  assert.equal(mod.default.key, mod.HTPR_9006_QUICK_ADD_COLUMN_FLAG);
  assert.equal(mod.default.kind, "bugfix");
  assert.equal(mod.default.defaultMode, "EVERYONE");
  assert.equal(mod.default.releaseRisk.risk, "small");
  assert.ok(mod.default.releaseRisk.reason.length > 0);
});
