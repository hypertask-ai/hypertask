// HTPR-6215. Sorting My Tasks by priority only reordered tasks within each
// board's group; the boards themselves never interleaved (HTPR-4887 kept that
// grouping on purpose, because most sort columns aren't comparable across
// boards). Priority is the exception: it's a fixed level already comparable
// across every board, so it flattens the rows once the flag is on, but only
// for that one sort column.
import assert from "node:assert/strict";
import test from "node:test";

import { shouldFlattenSortedRows } from "../src/components/PageComponents/Kanban/TableView/tableSortFlatten";
import { sortByPriorityAndRankingOrder } from "../src/utils/helperFunctions/helperFunctions";

test("no active sort never flattens, on a board or on My Tasks", () => {
  assert.equal(shouldFlattenSortedRows(true, false, false, true), false);
  assert.equal(shouldFlattenSortedRows(false, false, true, true), false);
});

test("a real board always flattens an active sort, flag or no flag", () => {
  assert.equal(shouldFlattenSortedRows(true, true, false, false), true);
  assert.equal(shouldFlattenSortedRows(true, true, false, true), true);
});

test("My Tasks stays grouped by board while the flag is off (HTPR-4887)", () => {
  assert.equal(shouldFlattenSortedRows(false, true, true, false), false);
});

test("My Tasks stays grouped when sorted by a non-priority column, even with the flag on", () => {
  assert.equal(shouldFlattenSortedRows(false, true, false, true), false);
});

test("My Tasks flattens across boards when sorted by priority with the flag on", () => {
  assert.equal(shouldFlattenSortedRows(false, true, true, true), true);
});

test("priority sort interleaves tasks from different boards by priority level", () => {
  const taskFromBoardA = { id: 1, sectionId: 100, priority: { priority_index: 3 } }; // Medium
  const taskFromBoardB = { id: 2, sectionId: 200, priority: { priority_index: 1 } }; // Urgent
  const otherTaskFromBoardA = { id: 3, sectionId: 100, priority: { priority_index: 2 } }; // High

  const acrossBoards = [taskFromBoardA, taskFromBoardB, otherTaskFromBoardA];
  const sorted = [...acrossBoards].sort(sortByPriorityAndRankingOrder("Descending"));

  // Descending by priority_index: Urgent(1) < High(2) < Medium(3), regardless
  // of which board each task came from.
  assert.deepEqual(
    sorted.map((task) => task.id),
    [taskFromBoardB.id, otherTaskFromBoardA.id, taskFromBoardA.id]
  );
});
