const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const { boardEdgeScrollStep } = jiti(
  path.join(root, "src/lib/kanban/boardEdgeAutoScroll.ts"),
);

const board = {
  viewportWidth: 1200,
  viewportLeft: 0,
  scrollLeft: 400,
  maxScrollLeft: 2000,
};

test("dragging into the right edge scrolls the board right", () => {
  const delta = boardEdgeScrollStep({ ...board, pointerX: 1190 });
  assert.ok(delta > 0, `expected a rightward scroll, got ${delta}`);
});

test("dragging into the left edge scrolls the board left", () => {
  const delta = boardEdgeScrollStep({ ...board, pointerX: 10 });
  assert.ok(delta < 0, `expected a leftward scroll, got ${delta}`);
});

test("a pointer past the window edge keeps scrolling", () => {
  assert.ok(boardEdgeScrollStep({ ...board, pointerX: 1400 }) > 0);
  assert.ok(boardEdgeScrollStep({ ...board, pointerX: -50 }) < 0);
});

test("scrolling accelerates closer to the edge", () => {
  const near = boardEdgeScrollStep({ ...board, pointerX: 1195 });
  const far = boardEdgeScrollStep({ ...board, pointerX: 1120 });
  assert.ok(near > far, `${near} should exceed ${far}`);
});

test("the middle of the board never scrolls", () => {
  assert.equal(boardEdgeScrollStep({ ...board, pointerX: 600 }), 0);
});

test("scrolling stops at both ends instead of overshooting", () => {
  assert.equal(
    boardEdgeScrollStep({ ...board, pointerX: 10, scrollLeft: 0 }),
    0,
  );
  assert.equal(
    boardEdgeScrollStep({ ...board, pointerX: 1190, scrollLeft: 2000 }),
    0,
  );
  assert.equal(
    boardEdgeScrollStep({ ...board, pointerX: 1190, scrollLeft: 1997 }),
    3,
  );
});

test("a board with nothing off-screen never scrolls", () => {
  assert.equal(
    boardEdgeScrollStep({
      ...board,
      pointerX: 1190,
      scrollLeft: 0,
      maxScrollLeft: 0,
    }),
    0,
  );
});

test("edge zones are measured against the scroller box, not the window", () => {
  // Board inset by the app-shell rail: x=60 is the scroller's own left edge.
  const delta = boardEdgeScrollStep({
    ...board,
    pointerX: 60,
    viewportLeft: 48,
    viewportWidth: 1152,
  });
  assert.ok(delta < 0, `expected a leftward scroll, got ${delta}`);
  assert.equal(
    boardEdgeScrollStep({
      ...board,
      pointerX: 200,
      viewportLeft: 48,
      viewportWidth: 1152,
    }),
    0,
  );
});

test("a narrow board keeps a usable neutral middle", () => {
  const narrow = { viewportWidth: 360, viewportLeft: 0, scrollLeft: 200, maxScrollLeft: 2000 };
  assert.equal(boardEdgeScrollStep({ ...narrow, pointerX: 180 }), 0);
  assert.ok(boardEdgeScrollStep({ ...narrow, pointerX: 355 }) > 0);
});

const { canScrollX } = jiti(
  path.join(root, "src/lib/kanban/boardEdgeAutoScroll.ts"),
);

test("an overflowing but non-scrollable wrapper is not a scroller", () => {
  // Non-rail / mobile board wrapper: content overflows, overflow-x is visible,
  // so assigning scrollLeft would do nothing (HTPR-5561).
  assert.equal(
    canScrollX({ scrollWidth: 3000, clientWidth: 1200, overflowX: "visible" }),
    false,
  );
});

test("an auto or scroll overflow wrapper is a scroller", () => {
  assert.equal(
    canScrollX({ scrollWidth: 3000, clientWidth: 1200, overflowX: "auto" }),
    true,
  );
  assert.equal(
    canScrollX({ scrollWidth: 3000, clientWidth: 1200, overflowX: "scroll" }),
    true,
  );
});

test("the page scroller counts even with visible overflow", () => {
  assert.equal(
    canScrollX({
      scrollWidth: 3000,
      clientWidth: 1200,
      overflowX: "visible",
      isPageScroller: true,
    }),
    true,
  );
});

test("a wrapper with no overflow is never a scroller", () => {
  assert.equal(
    canScrollX({ scrollWidth: 1200, clientWidth: 1200, overflowX: "auto" }),
    false,
  );
  assert.equal(
    canScrollX({
      scrollWidth: 1200,
      clientWidth: 1200,
      overflowX: "visible",
      isPageScroller: true,
    }),
    false,
  );
});

test("overflow-x hidden still scrolls programmatically, clip does not", () => {
  assert.equal(
    canScrollX({ scrollWidth: 3000, clientWidth: 1200, overflowX: "hidden" }),
    true,
  );
  assert.equal(
    canScrollX({ scrollWidth: 3000, clientWidth: 1200, overflowX: "clip" }),
    false,
  );
});
