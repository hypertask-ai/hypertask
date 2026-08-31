const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("closing a mobile sheet during drag release does not measure an unmounted panel", () => {
  const sheetBundle = fs.readFileSync(require.resolve("react-modal-sheet"), "utf8");

  assert.doesNotMatch(
    sheetBundle,
    /sheetRef\.current\.getBoundingClientRect\(\)/,
    "drag release must not dereference the sheet ref after a close unmounts it",
  );
  assert.match(
    sheetBundle,
    /if \(!sheetEl\)/,
    "sheet measurement must handle a panel that unmounted before drag release",
  );
});
