import test from "node:test";
import assert from "node:assert/strict";
import type { IProject, ISection, ITask } from "../src/models/model";
import {
  applyTableGroupAction, buildTableSectionsForGrouping, effectiveTableGrouping,
  getActiveTableGroupingFromProject, parseTableGrouping, sanitizeTableGrouping,
  serializeEffectiveTableGrouping,
} from "../src/lib/table-view/tableGroupByTag";

const project = (value: string) => ({ project_view: { user_project_views: [{ appliedView: { table_group_by: value } }] } }) as unknown as IProject;

test("new grouping needs the ticket flag and assignee grouping is stable", () => {
  const value = (setting: string, modes: boolean, legacy: boolean) => serializeEffectiveTableGrouping(effectiveTableGrouping(project(setting), modes, legacy));
  assert.equal(value("assignee", false, true), "column");
  assert.equal(value("tag", false, true), "tag");
  assert.equal(value("tag:l2,l1", true, false), "tag:l2,l1");
  const people = [{ userId: 9, user: { displayName: "Zoe" } }, { userId: 3, user: { displayName: "Ada" } }];
  const titles = (assignees: typeof people) => buildTableSectionsForGrouping([{ section_title: "Backlog", items: [{ id: 1, assignees } as unknown as ITask] }], { mode: "assignee", tagIds: [], allTags: false }).map((section) => section.section_title);
  assert.deepEqual([titles(people), titles([...people].reverse())], [["Ada"], ["Ada"]]);
});

const sections = [{
  sectionId: 10, section_title: "Backlog", items: [
    { id: 1, taskLabels: [{ label: { id: "mobile", value: "Mobile" } }, { label: { id: "desktop", value: "Desktop" } }] },
    { id: 2, taskLabels: [{ label: { id: "desktop", value: "Desktop" } }] },
    { id: 3, taskLabels: [] },
    { id: 4, taskLabels: [{ label: { id: "agents", value: "Agent Features" } }] },
  ],
}] as unknown as ISection[];
const grouping = parseTableGrouping("tag:mobile,desktop,agents");
const memberships = (value: typeof grouping) => buildTableSectionsForGrouping(sections, value)
  .map((group) => [group.section_title, group.items.map((task) => task.id)]);

test("hiding a chosen tag never reassigns multi-tag tickets or changes Other", () => {
  assert.deepEqual(memberships(grouping), [["Mobile", [1]], ["Desktop", [2]], ["Agent Features", [4]], ["Other", [3]]]);
  const hidden = applyTableGroupAction(grouping, "hide", "tag:mobile");
  assert.deepEqual(memberships(hidden), [["Desktop", [2]], ["Agent Features", [4]], ["Other", [3]]]);
  const reloaded = getActiveTableGroupingFromProject(project(serializeEffectiveTableGrouping(hidden)));
  assert.deepEqual(memberships(reloaded), [["Desktop", [2]], ["Agent Features", [4]], ["Other", [3]]]);
  assert.deepEqual(reloaded.tagIds, ["mobile", "desktop", "agents"]);
});

test("filtering uses existing group membership, including Other, and reset restores all groups", () => {
  const hidden = applyTableGroupAction(grouping, "hide", "tag:desktop");
  const filtered = applyTableGroupAction(hidden, "filter", "tag:desktop");
  assert.deepEqual(memberships(filtered), [["Desktop", [2]]]);
  assert.deepEqual(memberships(parseTableGrouping(serializeEffectiveTableGrouping(filtered))), [["Desktop", [2]]]);
  assert.deepEqual(memberships(applyTableGroupAction(grouping, "filter", "tag:other")), [["Other", [3]]]);
  assert.deepEqual(memberships(applyTableGroupAction(filtered, "reset", "")), [["Mobile", [1]], ["Desktop", [2]], ["Agent Features", [4]], ["Other", [3]]]);
  assert.equal(serializeEffectiveTableGrouping(applyTableGroupAction(filtered, "reset", "")), "tag:mobile,desktop,agents");
});

test("hiding every group gives an empty view that can still be reset", () => {
  let hidden = grouping;
  for (const id of ["tag:mobile", "tag:desktop", "tag:agents", "tag:other"]) hidden = applyTableGroupAction(hidden, "hide", id);
  assert.deepEqual(memberships(hidden), []);
  assert.equal(buildTableSectionsForGrouping(sections, applyTableGroupAction(hidden, "reset", "")).length, 4);
  assert.deepEqual(memberships(grouping), [["Mobile", [1]], ["Desktop", [2]], ["Agent Features", [4]], ["Other", [3]]]);
});

test("hide and filter work for column, priority, size and assignee groups", () => {
  const tasks = [{ sectionId: 10, section_title: "Backlog", items: [
    { id: 1, priority: { priority_index: 1, Priority_Value: "Urgent" }, estimate: { estimate_index: 1, estimate_value: "Small" }, assignees: [{ userId: 9, user: { displayName: "Zoe" } }] },
    { id: 2, assignees: [] },
  ] }] as unknown as ISection[];
  for (const [mode, id] of [["column", "10"], ["priority", "priority:1"], ["size", "size:1"], ["assignee", "assignee:user:9"]] as const) {
    const base = parseTableGrouping(mode);
    const filtered = applyTableGroupAction(base, "filter", id);
    assert.deepEqual(buildTableSectionsForGrouping(tasks, filtered).flatMap((group) => group.items.map((task) => task.id)), mode === "column" ? [1, 2] : [1]);
    const hidden = applyTableGroupAction(base, "hide", id);
    assert.deepEqual(buildTableSectionsForGrouping(tasks, hidden).flatMap((group) => group.items.map((task) => task.id)), mode === "column" ? [] : [2]);
    assert.equal(serializeEffectiveTableGrouping(applyTableGroupAction(hidden, "reset", "")), mode);
  }
});

test("visibility never leaks into another grouping mode or the flag-off path", () => {
  const filtered = serializeEffectiveTableGrouping(applyTableGroupAction(grouping, "filter", "tag:mobile"));
  assert.equal(serializeEffectiveTableGrouping(effectiveTableGrouping(project(filtered), false, true)), "tag");
  assert.equal(serializeEffectiveTableGrouping(effectiveTableGrouping(project(filtered), false, false)), "column");
  assert.deepEqual(parseTableGrouping("priority"), { mode: "priority", tagIds: [], allTags: false });
  assert.deepEqual(memberships(grouping), [["Mobile", [1]], ["Desktop", [2]], ["Agent Features", [4]], ["Other", [3]]]);
});

test("view writes sanitize visibility and preserve old settings", () => {
  for (const value of ["column", "tag", "tag:none", "assignee", "priority", "size", "tag:desktop,mobile"]) assert.equal(sanitizeTableGrouping(value), value);
  assert.equal(sanitizeTableGrouping(JSON.stringify({ groupBy: "tag:mobile,desktop", hiddenGroupIds: ["tag:desktop", "tag:desktop"] })), '{"groupBy":"tag:mobile,desktop","hiddenGroupIds":["tag:desktop"]}');
  assert.equal(sanitizeTableGrouping('{"groupBy":"bogus","onlyGroupId":"x"}'), null);
  assert.equal(sanitizeTableGrouping('{"groupBy":"tag","hiddenGroupIds":[3]}'), null);
  assert.equal(sanitizeTableGrouping('{"groupBy":"tag","onlyGroupId":""}'), null);
  assert.equal(sanitizeTableGrouping("{invalid"), null);
  assert.equal(sanitizeTableGrouping('{"groupBy":"tag:none","hiddenGroupIds":[]}'), "tag:none");
});
