import test from "node:test";
import assert from "node:assert/strict";
import type { ITask } from "../src/models/model";
import { buildTableSectionsGroupedByTag, sanitizeTableGroupBy, OTHER_GROUP_TITLE } from "../src/lib/table-view/tableGroupByTag";

test("tag grouping and sanitize", () => {
  assert.equal(sanitizeTableGroupBy("tag"), "tag");
  const taskB = {
    id: 2,
    taskLabels: [
      { label: { id: "l1", value: "Beta" } },
      { label: { id: "l2", value: "Alpha" } },
    ],
  } as ITask;
  const sections = buildTableSectionsGroupedByTag([
    { section_title: "Backlog", items: [{ id: 1, taskLabels: [{ label: { id: "l1", value: "Beta" } }] } as ITask, taskB, { id: 3, taskLabels: [] } as unknown as ITask] },
  ], ["l1", "l2"]);
  const byTitle = new Map(sections.map((section) => [section.section_title, section]));
  assert.equal(byTitle.get("Beta")?.items?.length, 2);
  assert.equal(sections.at(-1)?.section_title, OTHER_GROUP_TITLE);
});
