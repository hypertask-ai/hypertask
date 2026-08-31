const assert = require("node:assert/strict");
const test = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename, { interopDefault: true });
const {
  getMobileOverlaySheetContainerStyle,
  MOBILE_OVERLAY_SHEET_MAX_HEIGHT_RATIO,
} = jiti("../src/lib/mobileCommentViewport.ts");

test("resting sheet height caps at 85% of layout height", () => {
  const style = getMobileOverlaySheetContainerStyle({
    layoutHeight: 800,
    visibleHeight: 800,
    bottomInset: 0,
  });
  assert.equal(style?.bottom, 0);
  assert.equal(style?.height, `${800 * MOBILE_OVERLAY_SHEET_MAX_HEIGHT_RATIO}px`);
});

test("keyboard-open sheet lifts and shrinks to visible height", () => {
  const style = getMobileOverlaySheetContainerStyle({
    layoutHeight: 800,
    visibleHeight: 420,
    bottomInset: 280,
  });
  assert.equal(style?.bottom, 280);
  assert.equal(style?.height, "420px");
});
