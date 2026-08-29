import assert from "node:assert/strict";
import test from "node:test";

import {
  revealBoardColumnAfterRender,
  scrollBoardColumnIntoView,
} from "../src/utils/helperFunctions/Views/scrollBoardColumnIntoView";

const rect = (left: number, right: number) =>
  ({ left, right } as DOMRect);

const element = (
  left: number,
  right: number,
  scrollBy?: (options: ScrollToOptions) => void,
  overflowX = "auto",
  closest?: () => HTMLElement | null,
) =>
  ({
    getBoundingClientRect: () => rect(left, right),
    scrollWidth: right - left + 320,
    clientWidth: right - left,
    ...(scrollBy ? { scrollBy } : {}),
    overflowX,
    ...(closest ? { closest } : {}),
  } as unknown as HTMLElement);

const documentFor = (
  board: HTMLElement,
  column: HTMLElement,
  page?: HTMLElement,
) =>
  ({
    getElementById: (id: string) =>
      id === "kanban-sections-container"
        ? board
        : id === "droppable-section-container-42"
          ? column
          : null,
    defaultView: {
      getComputedStyle: (element: HTMLElement) =>
        ({ overflowX: (element as HTMLElement & { overflowX: string }).overflowX } as CSSStyleDeclaration),
      innerWidth: 840,
    },
    scrollingElement: page ?? null,
  } as unknown as Pick<Document, "getElementById">);

test("new columns outside the right edge scroll the board into view", () => {
  const scrolls: ScrollToOptions[] = [];
  const board = element(0, 800, (options) => scrolls.push(options));
  const column = element(800, 1120);

  assert.equal(scrollBoardColumnIntoView(42, documentFor(board, column)), true);
  assert.deepEqual(scrolls, [{ left: 320, behavior: "auto" }]);
});

test("a visible column does not move the board", () => {
  const scrolls: ScrollToOptions[] = [];
  const board = element(0, 800, (options) => scrolls.push(options));
  const column = element(320, 640);

  assert.equal(scrollBoardColumnIntoView(42, documentFor(board, column)), true);
  assert.deepEqual(scrolls, []);
});

test("scrolling waits when the created column is not rendered yet", () => {
  const board = element(0, 800, () => undefined);
  const documentLike = {
    getElementById: (id: string) =>
      id === "kanban-sections-container" ? board : null,
    defaultView: {
      getComputedStyle: () => ({ overflowX: "auto" }),
      innerWidth: 840,
    },
    scrollingElement: null,
  } as unknown as Pick<Document, "getElementById">;

  assert.equal(scrollBoardColumnIntoView(42, documentLike), false);
});

test("a slow board render still reveals the new column", () => {
  const scrolls: ScrollToOptions[] = [];
  const board = element(0, 800, (options) => scrolls.push(options));
  const column = element(800, 1120);
  let columnChecks = 0;
  let scheduledChecks = 0;
  const documentLike = {
    getElementById: (id: string) => {
      if (id === "kanban-sections-container") return board;
      if (id === "droppable-section-container-42") {
        columnChecks += 1;
        return columnChecks > 10 ? column : null;
      }
      return null;
    },
    defaultView: {
      getComputedStyle: () => ({ overflowX: "auto" }),
      innerWidth: 840,
    },
    scrollingElement: null,
  } as unknown as Pick<Document, "getElementById">;

  revealBoardColumnAfterRender(42, {
    documentLike,
    schedule: (callback) => {
      scheduledChecks += 1;
      callback();
    },
  });

  assert.equal(columnChecks, 11);
  assert.equal(scheduledChecks, 10);
  assert.deepEqual(scrolls, [{ left: 320, behavior: "auto" }]);
});

test("a page scroller is used when the board wrapper is not scrollable", () => {
  const scrolls: ScrollToOptions[] = [];
  const board = element(0, 800, undefined, "visible");
  const page = element(0, 800, (options) => scrolls.push(options), "visible");
  const column = element(800, 1120);

  assert.equal(scrollBoardColumnIntoView(42, documentFor(board, column, page)), true);
  assert.deepEqual(scrolls, [{ left: 320, behavior: "auto" }]);
});

test("the nearest homepage wrapper is used when it owns horizontal scrolling", () => {
  const scrolls: ScrollToOptions[] = [];
  const wrapper = element(0, 800, (options) => scrolls.push(options));
  const board = element(0, 800, undefined, "visible", () => wrapper);
  const column = element(800, 1120);

  assert.equal(scrollBoardColumnIntoView(42, documentFor(board, column)), true);
  assert.deepEqual(scrolls, [{ left: 320, behavior: "auto" }]);
});
