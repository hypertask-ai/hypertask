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
  const safeSheetHeight = loadSheetHeightHelper(sheetBundle);
  let measurements = 0;
  let animations = 0;
  let closes = 0;
  const dragEnd = vm.runInNewContext(
    `((_, { velocity }) => ${getDragEndBody(sheetBundle)})`,
    {
      animationOptions: {},
      detent: "content-height",
      dragCloseThreshold: 0.6,
      dragVelocityThreshold: 500,
      getClosestSnapPoint() {
        assert.fail("an unsnapped sheet must not resolve a snap point");
      },
      getSheetHeight(sheetRef) {
        measurements += 1;
        return safeSheetHeight(sheetRef);
      },
      getSnapPoints() {
        assert.fail("an unsnapped sheet must not calculate snap points");
      },
      indicatorRotation: { set() {} },
      onClose() {
        closes += 1;
      },
      onSnap: undefined,
      react: {
        animate() {
          animations += 1;
        },
      },
      sheetRef: { current: null },
      snapPointsProp: undefined,
      y: { get: () => 0 },
    },
  );

  assert.doesNotThrow(() => dragEnd(null, { velocity: { y: 0 } }));
  assert.equal(measurements, 1);
  assert.equal(animations, 1);
  assert.equal(closes, 1);
  assert.equal(
    safeSheetHeight({
      current: { getBoundingClientRect: () => ({ height: 216.7 }) },
    }),
    217,
  );
});
