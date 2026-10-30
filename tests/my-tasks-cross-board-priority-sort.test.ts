import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldFlattenSortedRows,
  sortedTaskRowSectionKey,
} from "../src/components/PageComponents/Kanban/TableView/tableSortFlatten";
import { sortByPriorityAndRankingOrder } from "../src/utils/helperFunctions/helperFunctions";

for (const hasCurrentProject of [true, false]) {
  for (const isPrioritySort of [true, false]) {
    test(`no active sort keeps grouping: board=${hasCurrentProject}, priority=${isPrioritySort}`, () => {
      assert.equal(shouldFlattenSortedRows(hasCurrentProject, false, isPrioritySort), false);
    });
  }
}

test("a real board flattens every active sort", () => {
  assert.equal(shouldFlattenSortedRows(true, true, false), true);
  assert.equal(shouldFlattenSortedRows(true, true, true), true);
});

test("My Tasks keeps non-priority sorts grouped by board", () => {
  assert.equal(shouldFlattenSortedRows(false, true, false), false);
});

test("My Tasks permanently flattens priority sorts across boards", () => {
  assert.equal(shouldFlattenSortedRows(false, true, true), true);
});

test("flat rows keep section ids on boards and board ids on My Tasks", () => {
  const task = { projectId: 200, sectionId: 300 };
  assert.equal(sortedTaskRowSectionKey(true, task), task.sectionId);
  assert.equal(sortedTaskRowSectionKey(false, task), task.projectId);
  assert.equal(sortedTaskRowSectionKey(true, { projectId: 200, sectionId: null }), "flat");
});

test("priority sort interleaves tasks from different boards by priority level", () => {
  const taskFromBoardA = { id: 1, sectionId: 100, priority: { priority_index: 3 } };
  const taskFromBoardB = { id: 2, sectionId: 200, priority: { priority_index: 1 } };
  const otherTaskFromBoardA = { id: 3, sectionId: 100, priority: { priority_index: 2 } };

  const acrossBoards = [taskFromBoardA, taskFromBoardB, otherTaskFromBoardA];
  const sorted = [...acrossBoards].sort(sortByPriorityAndRankingOrder("Descending"));

  assert.deepEqual(
    sorted.map((task) => task.id),
    [taskFromBoardB.id, otherTaskFromBoardA.id, taskFromBoardA.id]
  );
});
