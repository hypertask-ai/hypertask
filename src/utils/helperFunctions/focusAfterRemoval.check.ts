// Runnable check for the PERT-5 next-logical-focus math.
// Run: node --experimental-strip-types src/utils/helperFunctions/focusAfterRemoval.check.ts
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { nextFocusAfterRemoval } from "./focusAfterRemoval.ts";

const col = (...ids: number[]) => ({ items: ids.map((id) => ({ id })) });

// Middle task removed -> focus the task below (slides into the freed slot).
assert.strictEqual(
  nextFocusAfterRemoval([col(1, 2, 3)], 0, 1),
  3,
  "middle -> task below",
);

// First task removed -> focus the (old) second task.
assert.strictEqual(
  nextFocusAfterRemoval([col(1, 2, 3)], 0, 0),
  2,
  "first -> next task",
);

// LAST task removed -> focus the task above (the new last). PERT-5 core complaint.
assert.strictEqual(
  nextFocusAfterRemoval([col(1, 2, 3)], 0, 2),
  2,
  "last -> task above",
);

// Only task in the column removed -> jump to the nearest adjacent column (right first).
assert.strictEqual(
  nextFocusAfterRemoval([col(9), col(5, 6)], 0, 0),
  5,
  "empty column -> right neighbour top",
);

// Only task, no column to the right -> fall back to the left column's bottom task.
assert.strictEqual(
  nextFocusAfterRemoval([col(5, 6), col(9)], 1, 0),
  6,
  "empty column -> left neighbour bottom",
);

// Index could not be located but tasks remain -> stay in column, never jump random.
assert.strictEqual(
  nextFocusAfterRemoval([col(1, 2, 3)], 0, -1),
  1,
  "unknown index -> stay in column",
);

// Board fully empty after removal -> nothing to focus.
assert.strictEqual(
  nextFocusAfterRemoval([col(9)], 0, 0),
  null,
  "last task on board -> null",
);

console.log("focusAfterRemoval: all checks passed");
