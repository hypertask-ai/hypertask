const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

test("htpr-8962 flag ships to everyone as an improvement", () => {
  const mod = load("src/lib/flags/definitions/htpr-8962-one-send-clears-inbox.ts");
  assert.equal(mod.HTPR_8962_ONE_SEND_CLEARS_INBOX_FLAG, "htpr-8962-one-send-clears-inbox");
  assert.equal(mod.default.key, mod.HTPR_8962_ONE_SEND_CLEARS_INBOX_FLAG);
  assert.equal(mod.default.defaultMode, "EVERYONE");
  assert.equal(mod.default.kind, "improvement");
});
