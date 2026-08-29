// HTPR-5201. Saving a view moved the keyboard focus to the last card of the
// active column instead of leaving it on the card the user was on.
//
// Two things caused it. The board's "restore focus after a modal closes" effect
// did not know about the save-view modal, so closing it left DOM focus on
// <body>. And horizontal navigation then read the focused row number off
// whatever element happened to hold focus; from <body> that produced a junk
// index, and moveFocusToSection's "column is shorter than that row" fallback
// selects the LAST item in the column.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveFocusedCardIndex } from "../src/utils/helperFunctions/Kanban/columnFocus";

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

// What moveFocusToSection does with the row number it is handed.
const pickItem = (items: string[], itemIndex: number | undefined) => {
  if (items.length === 0) return null;
  if (items.length < (itemIndex as number) + 1) return items[items.length - 1];
  if (itemIndex) return items[itemIndex];
  return items[0];
};

test("a focused card resolves to its own row in the column", () => {
  assert.equal(
    resolveFocusedCardIndex({
      elementId: "task-42",
      parentElementId: "tasks-list-2",
      indexInParent: 3,
    }),
    3,
  );
});

test("focus on the document body resolves to no row", () => {
  assert.equal(
    resolveFocusedCardIndex({
      elementId: "",
      parentElementId: "",
      indexInParent: 1,
    }),
    undefined,
  );
});

test("focus outside a column list resolves to no row", () => {
  assert.equal(
    resolveFocusedCardIndex({
      elementId: "task-42",
      parentElementId: "sectionsContainer",
      indexInParent: 1,
    }),
    undefined,
  );
  assert.equal(
    resolveFocusedCardIndex({
      elementId: "save-view-modal-list-container",
      parentElementId: "tasks-list-2",
      indexInParent: 1,
    }),
    undefined,
  );
  assert.equal(resolveFocusedCardIndex(null), undefined);
});

test("no resolved row navigates to the top of the column, never the bottom", () => {
  const column = ["first", "second"];
  const strayIndex = resolveFocusedCardIndex({
    elementId: "",
    parentElementId: "",
    indexInParent: 5,
  });
  assert.equal(pickItem(column, strayIndex), "first");
  // The old behaviour, kept here so the regression is visible: a junk row
  // number longer than the column selected its last card.
  assert.equal(pickItem(column, 5), "second");
});

test("the board restores focus to the active card when the save-view modal closes", () => {
  const source = read("src/hooks/Homepage/useHandleKeyDownOperations.ts");
  const refocusEffect = source.slice(
    source.indexOf("bring focus back to the active element"),
  );
  const effectDeps = refocusEffect.slice(0, refocusEffect.indexOf("])"));
  assert.match(effectDeps, /showSaveModal/);
  assert.match(effectDeps, /spaceship\.refocus\(activeItem\)/);
});

test("horizontal navigation reads the focused row through the helper", () => {
  const source = read("src/hooks/useUniversalMovement.ts");
  assert.equal(source.includes("parentNode?.children!"), false);
  assert.equal(
    source.split("focusedCardIndexInColumn(activeElement)").length - 1,
    2,
  );
});
