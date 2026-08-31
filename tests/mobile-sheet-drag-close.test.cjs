const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function extractBlock(source, bodyStart) {
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart, index + 1);
  }

  assert.fail("the expected block is incomplete");
}

function loadSheetHeightHelper(sheetBundle) {
  const functionStart = sheetBundle.indexOf("function getSheetHeight(");
  assert.notEqual(functionStart, -1, "the sheet bundle must expose safe measurement");

  const bodyStart = sheetBundle.indexOf("{", functionStart);
  const functionBody = extractBlock(sheetBundle, bodyStart);
  return vm.runInNewContext(
    `(${sheetBundle.slice(functionStart, bodyStart)}${functionBody})`,
    { console: { warn() {} } },
  );
}

function getDragEndBody(sheetBundle) {
  const callbackStart = sheetBundle.indexOf("const onDragEnd =");
  assert.notEqual(callbackStart, -1, "the sheet bundle must include drag release");

  const arrowStart = sheetBundle.indexOf("=>", callbackStart);
  return extractBlock(sheetBundle, sheetBundle.indexOf("{", arrowStart));
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
    getDragEndBody(sheetBundle),
    /const sheetHeight = getSheetHeight\(sheetRef\)/,
    "drag release must use the null-safe sheet measurement",
  );
});
