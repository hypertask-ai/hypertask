import test from "node:test";
import assert from "node:assert/strict";
import type { ITask } from "../src/models/model";
import {
  buildTableSectionsGroupedByTag,
  dedupeTasksForFlatTableSort,
  sanitizeTableGroupBy,
  NO_TAG_SECTION_TITLE,
} from "../src/lib/table-view/tableGroupByTag";

test("tag grouping and sanitize", () => {
  assert.equal(sanitizeTableGroupBy("tag"), "tag");
  assert.equal(sanitizeTableGroupBy("bad"), null);
  const taskA = { id: 1, taskLabels: [{ label: { id: "l1", value: "Beta" } }] } as ITask;
  const taskB = {
    id: 2,
    taskLabels: [
      { label: { id: "l1", value: "Beta" } },
      { label: { id: "l2", value: "Alpha" } },
    ],
  } as ITask;
  const taskC = { id: 3, taskLabels: [] } as unknown as ITask;
  const sections = buildTableSectionsGroupedByTag([
    { section_title: "Backlog", items: [taskA, taskB, taskC] },
  ]);
  const byTitle = new Map(sections.map((section) => [section.section_title, section]));
  assert.equal(byTitle.get("Alpha")?.items?.length, 1);
  assert.equal(byTitle.get("Beta")?.items?.length, 2);
  assert.equal(sections.at(-1)?.section_title, NO_TAG_SECTION_TITLE);
  assert.deepEqual(dedupeTasksForFlatTableSort([{ id: 1 }, { id: 2 }, { id: 1 }] as ITask[]).map((t) => t.id), [1, 2]);
});
