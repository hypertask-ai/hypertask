const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/mobile-comment-viewport-jiti-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  }
);

const {
  getMobileCommentViewportGeometry,
  getMobileVisualViewportGeometry,
} = jiti(
  path.join(root, "src/lib/mobileCommentViewport.ts")
);

const geometry = (overrides = {}) =>
  getMobileCommentViewportGeometry({
    layoutViewportHeight: 844,
    visualViewportHeight: 844,
    visualViewportOffsetTop: 0,
    dockInset: 0,
    composerChromeHeight: 44,
    requestedEditorHeight: null,
    ...overrides,
  });

test("default composer stays at the visible viewport bottom", () => {
  const result = geometry();

  assert.equal(result.bottomInset, 0);
  assert.equal(result.autoEditorMaxHeight, 464.20000000000005);
  assert.equal(result.renderedEditorHeight, null);
});

test("visible dock lifts the composer and reduces its available height", () => {
  const result = geometry({ dockInset: 64, requestedEditorHeight: 700 });

  assert.equal(result.bottomInset, 64);
  assert.equal(result.autoEditorMaxHeight, 429.00000000000006);
  assert.equal(result.manualEditorMaxHeight, 580);
  assert.equal(result.renderedEditorHeight, 580);
});

test("dragged composer keeps its requested height when it fits", () => {
  const result = geometry({ requestedEditorHeight: 500 });

  assert.equal(result.manualEditorMaxHeight, 631.2);
  assert.equal(result.renderedEditorHeight, 500);
});

test("keyboard moves and clamps default and dragged composers", () => {
  const defaultResult = geometry({
    visualViewportHeight: 420,
    visualViewportOffsetTop: 24,
    dockInset: 64,
  });
  const draggedResult = geometry({
    visualViewportHeight: 420,
    visualViewportOffsetTop: 24,
    dockInset: 64,
    requestedEditorHeight: 500,
  });

  assert.equal(defaultResult.bottomInset, 400);
  assert.equal(defaultResult.autoEditorMaxHeight, 231.00000000000003);
  assert.equal(defaultResult.renderedEditorHeight, null);
  assert.equal(draggedResult.manualEditorMaxHeight, 292);
  assert.equal(draggedResult.renderedEditorHeight, 292);
});

test("hidden dock does not add a bottom inset", () => {
  const result = geometry({ dockInset: 0 });

  assert.equal(result.bottomInset, 0);
  assert.equal(result.autoEditorMaxHeight, 464.20000000000005);
});

test("layout-resizing keyboards do not add a second bottom offset", () => {
  const result = geometry({
    layoutViewportHeight: 420,
    visualViewportHeight: 420,
    visualViewportOffsetTop: 0,
    requestedEditorHeight: 500,
  });

  assert.equal(result.bottomInset, 0);
  assert.equal(result.renderedEditorHeight, 292);
});

test("rotation clamps without losing the preferred drag height", () => {
  const portrait = geometry({ requestedEditorHeight: 500 });
  const landscape = geometry({
    layoutViewportHeight: 390,
    visualViewportHeight: 390,
    requestedEditorHeight: 500,
  });
  const restoredPortrait = geometry({ requestedEditorHeight: 500 });

  assert.equal(portrait.renderedEditorHeight, 500);
  assert.equal(landscape.renderedEditorHeight, 268);
  assert.equal(restoredPortrait.renderedEditorHeight, 500);
});

test("shared visual viewport geometry positions a sheet above the keyboard", () => {
  const result = getMobileVisualViewportGeometry({
    layoutViewportHeight: 844,
    visualViewportHeight: 420,
    visualViewportOffsetTop: 24,
  });

  assert.deepEqual(result, {
    bottomInset: 400,
    visibleHeight: 420,
  });
});

test("layout-resizing keyboards do not create a duplicate sheet inset", () => {
  const result = getMobileVisualViewportGeometry({
    layoutViewportHeight: 420,
    visualViewportHeight: 420,
    visualViewportOffsetTop: 0,
  });

  assert.deepEqual(result, {
    bottomInset: 0,
    visibleHeight: 420,
  });
});
