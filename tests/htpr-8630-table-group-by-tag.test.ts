import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTableSectionsGroupedByTag,
  dedupeTasksForFlatTableSort,
  sanitizeTableGroupBy,
  NO_TAG_SECTION_TITLE,
  tableGroupSectionId,
} from "../src/components/PageComponents/Kanban/TableView/tableGroupByTag";

test("sanitizeTableGroupBy accepts column and tag", () => {
  assert.equal(sanitizeTableGroupBy("column"), "column");
  assert.equal(sanitizeTableGroupBy("tag"), "tag");
  assert.equal(sanitizeTableGroupBy("other"), null);
});

test("buildTableSectionsGroupedByTag duplicates multi-tag tasks and groups untagged last", () => {
  const taskA = {
    id: 1,
    taskLabels: [{ label: { id: "l1", value: "Beta" } }],
  };
  const taskB = {
    id: 2,
    taskLabels: [
      { label: { id: "l1", value: "Beta" } },
      { label: { id: "l2", value: "Alpha" } },
    ],
  };
  const taskC = { id: 3, taskLabels: [] };
  const sections = buildTableSectionsGroupedByTag([
    { section_title: "Backlog", items: [taskA, taskB, taskC] },
  ]);

  const byTitle = new Map(sections.map((section) => [section.section_title, section]));
  assert.equal(byTitle.get("Alpha")?.items?.length, 1);
  assert.equal(byTitle.get("Beta")?.items?.length, 2);
  assert.equal(byTitle.get(NO_TAG_SECTION_TITLE)?.items?.length, 1);
  assert.equal(byTitle.get(NO_TAG_SECTION_TITLE)?.sectionId, "tag:none");
  assert.equal(sections.at(-1)?.section_title, NO_TAG_SECTION_TITLE);
  assert.equal(byTitle.get("Beta")?.items?.map((task) => task.id).sort().join(","), "1,2");
});

test("tableGroupSectionId prefixes label ids", () => {
  assert.equal(tableGroupSectionId("abc"), "tag:abc");
});

test("dedupeTasksForFlatTableSort keeps first occurrence", () => {
  const tasks = [{ id: 1 }, { id: 2 }, { id: 1 }];
  assert.deepEqual(dedupeTasksForFlatTableSort(tasks).map((task) => task.id), [1, 2]);
});
