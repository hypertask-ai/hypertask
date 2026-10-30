import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveFocusedCardIndex } from "../src/utils/helperFunctions/Kanban/columnFocus";

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

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
  assert.equal(pickItem(column, 5), "second");
});

test("the board restores focus to the active card when the save-view modal closes", () => {
  const source = read("src/hooks/Homepage/useHandleKeyDownOperations.ts");
  const refocusEffect = source.slice(
    source.indexOf("useEffect(() => {\n\n            const activeItem"),
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
