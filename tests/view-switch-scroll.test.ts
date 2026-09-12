import assert from "node:assert/strict";
import test from "node:test";

import {
  preferredScrollLeftToShowFocus,
  scrollBoardToShowFocusFromLeft,
  shouldRevealFocusOnViewSwitch,
} from "../src/utils/helperFunctions/Views/scrollBoardColumnIntoView";

const rect = (left: number, right: number) =>
  ({ left, right } as DOMRect);

const scrollerElement = ({
  scrollLeft,
  clientWidth,
  scrollWidth,
  overflowX = "auto",
}: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  overflowX?: string;
}) => {
  const element = {
    scrollLeft,
    clientWidth,
    scrollWidth,
    overflowX,
    getBoundingClientRect: () => rect(0, clientWidth),
    closest: () => element,
    classList: { contains: (name: string) => name === "homepage-container-tag" },
  } as unknown as HTMLElement & { overflowX: string };
  return element;
};

const cardElement = (left: number, right: number) =>
  ({
    getBoundingClientRect: () => rect(left, right),
  }) as unknown as HTMLElement;

const documentFor = ({
  scroller,
  card,
}: {
  scroller: HTMLElement;
  card?: HTMLElement | null;
}) =>
  ({
    getElementById: (id: string) => {
      if (id === "kanban-sections-container") return scroller;
      if (id === "sectionsContainer") return scroller;
      if (id.startsWith("task-")) return card ?? null;
      return null;
    },
    defaultView: {
      getComputedStyle: (element: HTMLElement) =>
        ({
          overflowX:
            (element as HTMLElement & { overflowX?: string }).overflowX ?? "auto",
        }) as CSSStyleDeclaration,
    },
    scrollingElement: null,
  }) as unknown as Pick<Document, "getElementById">;

test("view-switch scroll behavior", () => {
  assert.equal(
    preferredScrollLeftToShowFocus({
      scrollLeft: 420,
      viewportWidth: 800,
      cardLeftInViewport: 80,
      cardRightInViewport: 280,
    }),
    0,
  );

  assert.equal(
    preferredScrollLeftToShowFocus({
      scrollLeft: 0,
      viewportWidth: 800,
      cardLeftInViewport: 720,
      cardRightInViewport: 1040,
    }),
    240,
  );

  assert.equal(
    preferredScrollLeftToShowFocus({
      scrollLeft: 180,
      viewportWidth: 800,
      cardLeftInViewport: null,
      cardRightInViewport: null,
    }),
    0,
  );

  assert.equal(
    shouldRevealFocusOnViewSwitch(null, { projectId: 15, viewId: "primary" }),
    false,
  );
  assert.equal(
    shouldRevealFocusOnViewSwitch(
      { projectId: 15, viewId: "blocked" },
      { projectId: 15, viewId: "primary" },
    ),
    true,
  );
  assert.equal(
    shouldRevealFocusOnViewSwitch(
      { projectId: 15, viewId: "primary" },
      { projectId: 22, viewId: "primary" },
    ),
    false,
  );

  const fitted = scrollerElement({
    scrollLeft: 420,
    clientWidth: 800,
    scrollWidth: 1600,
  });
  assert.equal(
    scrollBoardToShowFocusFromLeft(
      7,
      documentFor({
        scroller: fitted,
        card: cardElement(80, 280),
      }),
    ),
    true,
  );
  assert.equal(fitted.scrollLeft, 0);

  const clipped = scrollerElement({
    scrollLeft: 0,
    clientWidth: 800,
    scrollWidth: 1600,
  });
  assert.equal(
    scrollBoardToShowFocusFromLeft(
      9,
      documentFor({
        scroller: clipped,
        card: cardElement(720, 1040),
      }),
    ),
    true,
  );
  assert.equal(clipped.scrollLeft, 240);

  const missing = scrollerElement({
    scrollLeft: 360,
    clientWidth: 800,
    scrollWidth: 1600,
  });
  assert.equal(
    scrollBoardToShowFocusFromLeft(11, documentFor({ scroller: missing, card: null })),
    true,
  );
  assert.equal(missing.scrollLeft, 0);

  console.log("view-switch scroll tests passed");
});
