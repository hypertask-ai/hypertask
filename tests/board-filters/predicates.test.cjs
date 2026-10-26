const test = require("node:test");
const assert = require("node:assert/strict");
const { NOW, fixture, sectionIds, BASE, human } = require("./fixture.cjs");
const { filters, load, restore } = require("./runtime.cjs");
const { getAppliedSearchedTasks } = load("utils/helperFunctions/Views/SearchFilterHelperFunction.ts");
const { applySubTaskSetting } = load("utils/helperFunctions/Views/SubtaskHelperFunction.ts");
const { getFilteredEmptySections } = load("utils/helperFunctions/Views/EmptySectionsHelperFunction.ts");
const { BUILTIN_VIEWS, buildBuiltinViewContext } = load("lib/constants/builtinViews.ts");
const builtinCases = [
  ["builtin:my-tasks", "My Tasks excludes owned agents", ["a", "c", "h"]],
  ["builtin:overdue", "Overdue excludes Done Archive Deleted and missing dates", ["b"]],
  ["builtin:blocked", "Blocked person or ticket dependency", ["a", "b", "c"]],
  ["builtin:blocked-by-me", "Blocked by current viewer only", ["a"]],
  ["builtin:agents", "Agents", ["b", "c", "h", "e"]],
  ["builtin:current-cycle", "Current cycle", ["a", "b"]],
  ["builtin:next-cycle", "Next cycle", ["c"]],
  ["builtin:decisions", "Decisions reviewer and UX Sign-off", ["e", "f"]],
];
for (const [id, label, expected] of builtinCases) {
  test(`filter builtin ${label}`, () => {
    const { project, sections } = fixture();
    project.project_view.user_project_views[0].appliedView = { board_filters: {
      matchFilters: "ALL", addedFilters: [{ type: "Priority", searchPayload: [{ priority_index: 99 }] }],
    } };
    const context = { ...buildBuiltinViewContext(project, 6, NOW, "Valentin"),
      cyclesEnabled: true, currentCycleId: 1, nextCycleId: 2 };
    const result = filters.getFilteredSections(sections, project, id, context);
    assert.deepEqual(sectionIds(result), expected);
    if (id === "builtin:decisions") assert.deepEqual(result.map((section) => section.id), [4, 5]);
  });
}
test("filter builtin registry exactly matches coverage", () => {
  assert.deepEqual(builtinCases.map(([id]) => id).sort(), BUILTIN_VIEWS.map((view) => view.id).sort());
});
for (const id of ["builtin:current-cycle", "builtin:next-cycle"]) {
  test(`filter ${id} unavailable falls back to saved filters`, () => {
    const project = restore({ board_filters: { matchFilters: "ALL", addedFilters: [{ type: "Priority", searchPayload: [{ priority_index: 1 }] }] } });
    assert.deepEqual(sectionIds(filters.getFilteredSections(project.sections, project, id, { cyclesEnabled: false })), ["a"]);
  });
}
for (const [keyword, label, expected] of [
  ["bravo", "title", ["a"]], ["BRAVO", "case insensitive", ["a"]],
  ["HTPR-10", "ticket number", ["b", "c"]], ["", "blank", BASE],
  ["missing", "no match", []], ["needle", "description is not searched", []],
]) {
  test(`filter Find in view ${label}`, () => {
    assert.deepEqual(sectionIds(getAppliedSearchedTasks(fixture().sections, keyword)), expected);
  });
}
for (const [setting, expected] of [
  ["None", ["a", "b", "g", "d", "e", "f"]], ["Parent", ["a", "b", "g", "d", "e", "f"]],
  ["Card", ["a", "b", "g", "h", "d", "e", "f"]],
  ["Flattened", BASE], ["Flattened_Card", BASE],
]) {
  test(`filter Subtasks ${setting}`, () => {
    const { sections, tasks } = fixture();
    tasks[2].parentTask = { id: "a" };
    tasks[7].parentTask = { id: "a" };
    tasks[7].subTasks = [{ id: "nested" }];
    assert.deepEqual(sectionIds(applySubTaskSetting(sections, setting)), expected);
  });
}
for (const setting of ["Show", "Hidden"]) {
  test(`filter Empty sections ${setting}`, () => {
    const project = restore({ board_empty_sections: setting });
    const result = getFilteredEmptySections(project.sections, project);
    assert.deepEqual(result.map((section) => section.id), setting === "Show" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);
    assert.deepEqual(sectionIds(result), BASE);
  });
}
for (const [type, expected] of [
  ["NoRecentComment", ["c", "h", "d"]], ["StuckInColumn", ["c", "h", "d"]],
  ["StaleOnBoard", ["c", "h", "d", "e"]], ["NotStale", ["a", "b", "g", "e", "f"]],
]) {
  test(`filter ${type} nondefault warn threshold`, (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    const { project, sections } = fixture();
    project.staleWarnDays = 6;
    project.staleHotDays = 17;
    assert.deepEqual(sectionIds(filters.applyFilters(sections, [{ type, searchPayload: [] }], "ALL", project)), expected);
  });
}
for (const type of ["NoRecentComment", "StuckInColumn", "StaleOnBoard"]) {
  for (const [age, expected] of [[6, []], [7, ["a"]], [8, ["a"]], [19, ["a"]], [20, ["a"]], [21, ["a"]]]) {
    test(`filter ${type} age ${age} threshold boundary`, (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: NOW });
      const { tasks, project } = fixture();
      const row = tasks[0];
      row.createdAt = new Date(NOW - age * 86400000).toISOString();
      row.sectionChangedAt = undefined;
      row.lastCommentAt = undefined;
      assert.deepEqual(sectionIds(filters.applyFilters([{ items: [row] }], [{ type, searchPayload: [] }], "ALL", project)), expected);
    });
  }
}
test("filter RunningTimer loading to ready narrows real running IDs", () => {
  const { sections, project, runtime, tasks } = fixture();
  const entry = [{ type: "RunningTimer", searchPayload: [] }];
  assert.deepEqual(sectionIds(filters.applyFilters(sections, entry, "ALL", project, { runningTaskIds: new Set(tasks.map((task) => task.id)) })), BASE);
  assert.deepEqual(sectionIds(filters.applyFilters(sections, entry, "ALL", project, runtime)), ["a", "e"]);
});
test("filter Assignees saved Assigned to me remains author not later viewer", () => {
  const project = restore({ board_filters: { matchFilters: "ALL", addedFilters: [{ type: "Assignees", searchPayload: [human], match: "ALL" }] } });
  project.currentUserId = 7;
  assert.deepEqual(sectionIds(filters.getFilteredSections(project.sections, project)), ["a", "c", "h"]);
});

for (const [label, settings, pending, browser, expected] of [
  ["Show", { board_show_archived: true }, null, false, true],
  ["Hide", { board_show_archived: false }, null, true, false],
  ["browser fallback", {}, null, true, true],
  ["pending board override", { board_show_archived: false }, { projectId: 15, value: true }, false, true],
  ["foreign pending ignored", { board_show_archived: false }, { projectId: 16, value: true }, true, false],
]) {
  test(`filter Show archived ${label}`, () => {
    const project = restore(settings);
    const { views } = require("./runtime.cjs");
    assert.equal(views.resolveShowArchivedForBoard(project, pending, browser), expected);
  });
}
