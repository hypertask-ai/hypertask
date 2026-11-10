import assert from "node:assert/strict";
import test from "node:test";
import type { ITask } from "../src/models/model";
import { buildTableSectionsGroupedByTag } from "../src/lib/table-view/tableGroupByTag";
import { getSortComparator } from "../src/components/PageComponents/Kanban/TableView/tableViewShared";
import { shouldFlattenSortedRows } from "../src/components/PageComponents/Kanban/TableView/tableSortFlatten";
import {
  parseTableCollapsedSections,
  serializeTableCollapsedSections,
  tableTaskRowKey,
} from "../src/lib/table-view/tableGroupByTag";
import { getTableRowDragData } from "../src/components/PageComponents/Kanban/TableView/tableRowDrag";

test("board table sort keeps section groups", () => {
  assert.equal(shouldFlattenSortedRows(true, true, false), false);
  assert.equal(shouldFlattenSortedRows(true, true, true), false);
});

test("rows sort inside each tag group without flattening the board", () => {
  const taskA = {
    id: 1,
    updatedAt: "2026-11-01T10:00:00.000Z",
    taskLabels: [{ label: { id: "l1", value: "Alpha" } }],
  } as ITask;
  const taskB = {
    id: 2,
    updatedAt: "2026-11-03T10:00:00.000Z",
    taskLabels: [{ label: { id: "l1", value: "Alpha" } }],
  } as ITask;
  const sections = buildTableSectionsGroupedByTag([
    { section_title: "Backlog", items: [taskA, taskB] },
  ]);
  const comparator = getSortComparator("updated", "desc", new Map());
  const sorted = [...(sections[0]?.items ?? [])].sort(comparator);
  assert.deepEqual(sorted.map((task) => task.id), [2, 1]);
});

test("collapsed section keys round-trip through the view field", () => {
  const collapsed = new Set(["tag:l1", "3"]);
  const serialized = serializeTableCollapsedSections(collapsed);
  assert.equal(serialized, JSON.stringify(["3", "tag:l1"]));
  assert.deepEqual([...parseTableCollapsedSections(serialized!)].sort(), ["3", "tag:l1"]);
});

test("duplicate tag rows get distinct dom keys", () => {
  assert.equal(tableTaskRowKey(9, "tag:a"), "9:tag:a");
  assert.notEqual(tableTaskRowKey(9, "tag:a"), tableTaskRowKey(9, "tag:b"));
});

test("tag grouping disables row drag between pseudo sections", () => {
  assert.equal(
    getTableRowDragData(1, 10, new Set([10]), false, true),
    null,
  );
});
