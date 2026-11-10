import test from "node:test";
import assert from "node:assert/strict";
import type { IProject, ITask } from "../src/models/model";
import { buildTableSectionsForGrouping, buildTableSectionsGroupedByTag, effectiveTableGrouping, serializeEffectiveTableGrouping, OTHER_GROUP_TITLE } from "../src/lib/table-view/tableGroupByTag";

test("chosen tags group once, Other holds the rest, and each mode groups", () => {
  const task = (id: number, taskLabels: ITask["taskLabels"], extra: Partial<ITask> = {}) => ({ id, taskLabels, ...extra }) as ITask;
  const items = [
    task(1, [{ label: { id: "l1", value: "Mobile" } }] as ITask["taskLabels"], { assignees: [{ userId: 9, user: { displayName: "Zoe" } }, { userId: 3, user: { displayName: "Ada" } }] as unknown as ITask["assignees"] }),
    task(2, [{ label: { id: "l1", value: "Mobile" } }, { label: { id: "l2", value: "Desktop" } }] as ITask["taskLabels"]),
    task(3, []),
  ];
  const sections = [{ section_title: "Backlog", items }];
  assert.deepEqual(buildTableSectionsGroupedByTag(sections, ["l2", "l1"]).map((section) => [section.section_title, section.items.length]), [["Desktop", 1], ["Mobile", 1], [OTHER_GROUP_TITLE, 1]]);
  const titles = (grouping: Parameters<typeof buildTableSectionsForGrouping>[1]) => buildTableSectionsForGrouping([{ section_title: "Backlog", items: [...items].reverse() }], grouping).map((section) => section.section_title);
  assert.deepEqual(titles({ mode: "assignee", tagIds: [], allTags: false }), ["Ada", "Unassigned"]);
  assert.deepEqual(titles({ mode: "priority", tagIds: [], allTags: false }), ["No priority"]);
});

test("each flag keeps its own grouping", () => {
  const project = (value: string) => ({ project_view: { user_project_views: [{ appliedView: { table_group_by: value } }] } }) as unknown as IProject;
  const value = (setting: string, modes: boolean, legacy: boolean) => serializeEffectiveTableGrouping(effectiveTableGrouping(project(setting), modes, legacy));
  assert.equal(value("assignee", false, true), "column");
  assert.equal(value("tag", false, true), "tag");
  assert.equal(value("tag:l2,l1", false, true), "tag");
  assert.equal(value("tag:l2,l1", true, false), "tag:l2,l1");
});
