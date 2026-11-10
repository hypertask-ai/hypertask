import test from "node:test";
import assert from "node:assert/strict";
import type { IProject, ITask } from "../src/models/model";
import { buildTableSectionsForGrouping, effectiveTableGrouping, serializeEffectiveTableGrouping } from "../src/lib/table-view/tableGroupByTag";

test("new grouping needs the ticket flag and assignee grouping is stable", () => {
  const project = (value: string) => ({ project_view: { user_project_views: [{ appliedView: { table_group_by: value } }] } }) as unknown as IProject;
  const value = (setting: string, modes: boolean, legacy: boolean) => serializeEffectiveTableGrouping(effectiveTableGrouping(project(setting), modes, legacy));
  assert.equal(value("assignee", false, true), "column");
  assert.equal(value("tag", false, true), "tag");
  assert.equal(value("tag:l2,l1", true, false), "tag:l2,l1");
  const people = [{ userId: 9, user: { displayName: "Zoe" } }, { userId: 3, user: { displayName: "Ada" } }];
  const titles = (assignees: typeof people) => buildTableSectionsForGrouping([{ section_title: "Backlog", items: [{ id: 1, assignees } as unknown as ITask] }], { mode: "assignee", tagIds: [], allTags: false }).map((section) => section.section_title);
  assert.deepEqual([titles(people), titles([...people].reverse())], [["Ada"], ["Ada"]]);
});
