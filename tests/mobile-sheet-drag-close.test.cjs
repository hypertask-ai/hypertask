const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadSheetHeightHelper(sheetBundle) {
  const functionStart = sheetBundle.indexOf("function getSheetHeight(");
  assert.notEqual(functionStart, -1, "the sheet bundle must expose safe measurement");

  const bodyStart = sheetBundle.indexOf("{", functionStart);
  let depth = 0;
  for (let index = bodyStart; index < sheetBundle.length; index += 1) {
    if (sheetBundle[index] === "{") depth += 1;
    if (sheetBundle[index] === "}") depth -= 1;
    if (depth === 0) {
      return vm.runInNewContext(
        `(${sheetBundle.slice(functionStart, index + 1)})`,
        { console: { warn() {} } },
      );
    }
  }

  assert.fail("the sheet-height helper body is incomplete");
}

test("closing a mobile sheet during drag release does not measure an unmounted panel", () => {
  const sheetBundle = fs.readFileSync(require.resolve("react-modal-sheet"), "utf8");
  const getSheetHeight = loadSheetHeightHelper(sheetBundle);

  assert.equal(getSheetHeight({ current: null }), 0);
  assert.equal(
    getSheetHeight({
      current: { getBoundingClientRect: () => ({ height: 216.7 }) },
    }),
    217,
  );
  assert.match(
    sheetBundle,
    /onDragEnd[\s\S]*?const sheetHeight = getSheetHeight\(sheetRef\)/,
    "drag release must use the null-safe sheet measurement",
  );
});
