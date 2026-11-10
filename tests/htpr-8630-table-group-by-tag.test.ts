import test from "node:test";
import assert from "node:assert/strict";
import type { IProject, ITask } from "../src/models/model";
import { buildTableSectionsForGrouping, buildTableSectionsGroupedByTag, effectiveTableGrouping, parseTableGrouping, sanitizeTableGroupBy, serializeEffectiveTableGrouping, serializeTableGrouping, OTHER_GROUP_TITLE } from "../src/lib/table-view/tableGroupByTag";

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

test("chosen tag order wins, Other holds the rest and other grouping modes work", () => {
  const task = (id: number, value: Partial<ITask>) => ({ id, taskLabels: [], ...value }) as ITask;
  const items = [
    task(1, { taskLabels: [{ label: { id: "l1", value: "Mobile" } }] as unknown as ITask["taskLabels"], assignees: [{ userId: 7, user: { displayName: "Valentin" } }] as unknown as ITask["assignees"] }),
    task(2, { taskLabels: [{ label: { id: "l1", value: "Mobile" } }, { label: { id: "l2", value: "Desktop" } }] as unknown as ITask["taskLabels"], priority: { priority_index: 2, Priority_Value: "High" } as unknown as ITask["priority"] }),
    task(3, {}),
  ];
  const tags = buildTableSectionsGroupedByTag([{ section_title: "Backlog", items }], ["l2", "l1"]);
  assert.deepEqual(tags.map((section) => [section.section_title, section.items.length]), [["Desktop", 1], ["Mobile", 1], ["Other", 1]]);
  const byMode = (mode: "assignee" | "priority") => buildTableSectionsForGrouping([{ section_title: "Backlog", items }], { mode, tagIds: [], allTags: false }).map((section) => section.section_title);
  assert.deepEqual(byMode("assignee"), ["Valentin", "Unassigned"]);
  assert.deepEqual(byMode("priority"), ["High", "No priority"]);
  assert.equal(serializeTableGrouping("tag", ["l2", "l1"]), "tag:l2,l1");
  assert.deepEqual(parseTableGrouping("tag:l2,l1"), { mode: "tag", tagIds: ["l2", "l1"], allTags: false });
});

test("each flag keeps its own grouping and the legacy flag turns off cleanly", () => {
  const project = (value: string) =>
    ({
      project_view: {
        user_project_views: [{ appliedView: { table_group_by: value } }],
      },
    }) as unknown as IProject;
  assert.deepEqual(effectiveTableGrouping(project("assignee"), false, true), { mode: "column", tagIds: [], allTags: false });
  assert.equal(serializeEffectiveTableGrouping(effectiveTableGrouping(project("assignee"), false, true)), "column");
  assert.deepEqual(effectiveTableGrouping(project("tag"), false, true), { mode: "tag", tagIds: [], allTags: true });
  assert.equal(serializeEffectiveTableGrouping(effectiveTableGrouping(project("tag"), false, true)), "tag");
  assert.deepEqual(effectiveTableGrouping(project("tag:l2,l1"), false, true), { mode: "tag", tagIds: [], allTags: true });
  assert.deepEqual(effectiveTableGrouping(project("tag:l2,l1"), true, false), { mode: "tag", tagIds: ["l2", "l1"], allTags: false });
  assert.equal(serializeEffectiveTableGrouping(effectiveTableGrouping(project("tag:l2,l1"), true, false)), "tag:l2,l1");
  assert.equal(serializeEffectiveTableGrouping(effectiveTableGrouping(project("priority"), true, false)), "priority");
});

test("a ticket with several assignees lands in one deterministic assignee group", () => {
  const people = [
    { userId: 9, user: { displayName: "Zoe" } },
    { userId: 3, user: { displayName: "Ada" } },
  ];
  const rows = (assignees: typeof people) =>
    buildTableSectionsForGrouping([{ section_title: "Backlog", items: [{ id: 1, assignees } as unknown as ITask] }], {
      mode: "assignee",
      tagIds: [],
      allTags: false,
    }).map((section) => section.section_title);
  assert.deepEqual(rows(people), ["Ada"]);
  assert.deepEqual(rows([...people].reverse()), ["Ada"]);
});
