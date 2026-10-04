const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// HTPR-6930: Escape in a picker on My Tasks must only close the picker,
// not also trigger the page back action.
test("OptionPicker Escape stops propagation before closing", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/components/Modals/OptionPicker/index.tsx"), "utf8");
  const escape = src.slice(src.indexOf('event.key === "Escape"'));
  const close = escape.indexOf("onClose()");
  assert.ok(close > 0);
  assert.ok(escape.slice(0, close).includes("event.stopImmediatePropagation()"));
  assert.ok(escape.slice(0, close).includes("event.preventDefault()"));
});
