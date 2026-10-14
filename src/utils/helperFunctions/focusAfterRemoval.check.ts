import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { nextFocusAfterRemoval } from "./focusAfterRemoval.ts";

const col = (...ids: number[]) => ({ items: ids.map((id) => ({ id })) });

assert.strictEqual(
  nextFocusAfterRemoval([col(1, 2, 3)], 0, 1),
  3,
  "middle -> task below",
);

assert.strictEqual(
  nextFocusAfterRemoval([col(1, 2, 3)], 0, 0),
  2,
  "first -> next task",
);

assert.strictEqual(
  nextFocusAfterRemoval([col(1, 2, 3)], 0, 2),
  2,
  "last -> task above",
);

assert.strictEqual(
  nextFocusAfterRemoval([col(9), col(5, 6)], 0, 0),
  5,
  "empty column -> right neighbour top",
);

assert.strictEqual(
  nextFocusAfterRemoval([col(5, 6), col(9)], 1, 0),
  6,
  "empty column -> left neighbour bottom",
);

assert.strictEqual(
  nextFocusAfterRemoval([col(1, 2, 3)], 0, -1),
  1,
  "unknown index -> stay in column",
);

assert.strictEqual(
  nextFocusAfterRemoval([col(9)], 0, 0),
  null,
  "last task on board -> null",
);

console.log("focusAfterRemoval: all checks passed");
