const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, human, agent, columns, sectionIds, ids } = require("./fixture.cjs");
const { filters, views, board, table, sanitizer, url, savedProject, restore, load } = require("./runtime.cjs");
const { hydrateBoardSections } = load("lib/firstScreen/boardPayload.ts");
const { shouldFlattenSortedRows } = load("components/PageComponents/Kanban/TableView/tableSortFlatten.ts");
const { getViewAppliedArchivedTasks } = load("utils/helperFunctions/Views/ArchivedTasksHelper.ts");

test("sort saved URL board recomputes order from another active view", { todo: "HTPR-7775 saved URL board keeps the previous view order" }, () => {
  const { project, link } = savedProject({ board_sorting_mode: "Priority", board_sorting_order: "Descending" }, "board");
  const row = project.project_view.user_project_views[0];
  row.unsavedView = undefined;
  row.appliedView = { ...row.appliedView, board_sorting_mode: "Manual" };
  hydrateBoardSections(project);
  const pinned = views.pinProjectToUrlView(project, link.searchParams.get("view"));
  assert.deepEqual(sectionIds(pinned.filteredSections), ["a", "b", "g", "h", "c", "d", "e", "f"]);
});

test("sort saved URL table section preparation uses selected view order", () => {
  const { project, link } = savedProject({ board_sorting_mode: "Priority", board_sorting_order: "Descending" }, "table");
  const row = project.project_view.user_project_views[0];
  row.unsavedView = undefined;
  row.appliedView = { ...row.appliedView, board_sorting_mode: "Manual" };
  hydrateBoardSections(project);
  const pinned = views.pinProjectToUrlView(project, link.searchParams.get("view"));
  const sections = pinned.filteredSections.map((section) => ({
    ...section, items: board.returnSortedItems([...section.items], pinned),
  }));
  assert.deepEqual(sectionIds(sections), ["a", "b", "g", "h", "c", "d", "e", "f"]);
});

for (const surface of ["board", "table"]) {
  test(`filter saved URL ${surface} restores columns hidden by another active view`, { todo: "HTPR-7775 saved URL keeps columns hidden by the previous view" }, () => {
    const { project, link } = savedProject({ board_filters: {
      matchFilters: "ALL", addedFilters: [{ type: "Labels", searchPayload: [{ id: "red" }] }],
    } }, surface);
    const row = project.project_view.user_project_views[0];
    row.unsavedView = undefined;
    row.appliedView = { ...row.appliedView, board_columns_view: columns.map((column) => ({ ...column, visibility: column.id !== 2 && column.visibility })) };
    hydrateBoardSections(project);
    const pinned = views.pinProjectToUrlView(project, link.searchParams.get("view"));
    assert.deepEqual(pinned.filteredSections.map((section) => section.id), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(sectionIds(pinned.filteredSections), ["a", "h", "c", "e"]);
  });
  test(`filter and sort saved JSON ${surface} restores the same selected ticket order`, () => {
    const settings = { board_filters: { matchFilters: "ALL", addedFilters: [{ type: "Labels", searchPayload: [{ id: "red" }] }] },
      board_sorting_mode: "Title", board_sorting_order: "Ascending", table_sort_column: "ticket", table_sort_direction: "desc" };
    const selected = restore(settings, surface);
    const direct = fixture().project;
    direct.project_view.user_project_views[0].appliedView = settings;
    hydrateBoardSections(direct);
    hydrateBoardSections(selected);
    const expected = ["a", "c", "h", "e"];
    assert.deepEqual(sectionIds(direct.filteredSections), expected);
    assert.deepEqual(sectionIds(selected.filteredSections), expected);
    if (surface === "table") {
      const [sort] = table.resolveSortState(selected);
      const compare = table.getSortComparator(sort.column, sort.direction, new Map());
      assert.deepEqual(ids(selected.filteredSections.flatMap((section) => section.items).sort(compare)), ["c", "e", "h", "a"]);
    }
  });
}

test("filter Assignees saved JSON strips callbacks but preserves human uid and agent identity", () => {
  const value = sanitizer.sanitizeBoardFilters({ matchFilters: "ALL", addedFilters: [{
    type: "Assignees", searchPayload: [human, agent], match: "ALL", condition: filters.assigneeFilterCondition,
  }] });
  const stored = JSON.parse(JSON.stringify(value));
  assert.equal("condition" in stored.addedFilters[0], false);
  assert.equal(stored.addedFilters[0].searchPayload[0].uid, human.uid);
  assert.equal("uid" in stored.addedFilters[0].searchPayload[1], false);
  const project = restore({ board_filters: stored });
  assert.deepEqual(sectionIds(filters.getFilteredSections(project.sections, project)), ["c", "h"]);
});

test("filter saved default applies without a personal project-view row", { todo: "HTPR-7776 default filters require a personal project-view row" }, () => {
  const { project } = fixture();
  project.project_view.user_project_views = [];
  project.project_view.default_view = { board_filters: { matchFilters: "ALL", addedFilters: [{ type: "Priority", searchPayload: [{ priority_index: 1 }] }] } };
  assert.deepEqual(sectionIds(filters.getFilteredSections(project.sections, project)), ["a"]);
});

for (const [source, expected] of [["unsaved", ["c"]], ["applied", ["b", "h"]], ["default", ["a"]]]) {
  test(`filter saved precedence ${source}`, () => {
    const { project } = fixture();
    const make = (priority_index) => ({ board_filters: { matchFilters: "ALL", addedFilters: [{ type: "Priority", searchPayload: [{ priority_index }] }] } });
    project.project_view.default_view = make(1);
    project.project_view.user_project_views = [{ appliedView: source === "default" ? undefined : make(2), unsavedView: source === "unsaved" ? make(3) : undefined }];
    assert.deepEqual(sectionIds(filters.getFilteredSections(project.sections, project)), expected);
  });
}

test("filter saved URL same active slug preserves its own draft", () => {
  const { project } = savedProject({});
  assert.equal(url.pinProjectViewToUrl(project, "previous"), project);
  assert.equal(url.pinProjectViewToUrl(project, "missing"), project);
});

test("filter saved view projection rejects private foreign-owner and foreign-board views", () => {
  const { project, view } = savedProject({});
  const projectView = project.project_view;
  projectView.default_view = { ...view, visibility: "Private", userId: 7 };
  projectView.default_view_id = view.id;
  projectView.user_project_views = [{ appliedView: projectView.default_view, appliedViewId: view.id,
    unsavedView: { ...view, project_view_id: "different-board" }, unsavedViewId: "foreign" }];
  const visible = sanitizer.projectVisibleViewRelations(projectView, 6);
  assert.equal(visible.default_view, null);
  assert.equal(visible.user_project_views[0].appliedView, null);
  assert.equal(visible.user_project_views[0].unsavedView, null);
  projectView.default_view = view;
  assert.equal(sanitizer.projectVisibleViewRelations(projectView, 7, true).default_view.id, view.id);
});

test("sort board orders within columns while list header flattens across columns", () => {
  const project = restore({ board_sorting_mode: "TicketNumber", board_sorting_order: "Ascending" });
  const { _sections } = board.getCurrentProject(project);
  assert.deepEqual(_sections.map((section) => section.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(sectionIds(_sections), ["a", "b", "g", "h", "c", "d", "e", "f"]);
  assert.equal(shouldFlattenSortedRows(true, true, false, false), true);
  assert.equal(shouldFlattenSortedRows(true, false, false, false), false);
  const compare = table.getSortComparator("ticket", "asc", new Map());
  assert.deepEqual(ids(_sections.flatMap((section) => section.items).sort(compare)), ["f", "a", "d", "b", "h", "e", "c", "g"]);
});

for (const [mode, expected] of [["Manual", ["b", "a"]], ["Title", ["b", "a"]], ["TicketNumber", ["a", "b"]]]) {
  test(`sort archived ${mode} respects active view`, () => {
    const project = restore({ board_sorting_mode: mode, board_sorting_order: "Ascending" });
    const archived = project.tasks.slice(0, 2).map((task, i) => ({ ...task, status: "Archive", archivedAt: `2026-11-${17 + i}T12:00:00.000Z` }));
    assert.deepEqual(ids(getViewAppliedArchivedTasks(archived, 1, project)), expected);
  });
}

test("filter archived applies saved filters before sorting and scopes to section", () => {
  const project = restore({ board_filters: { matchFilters: "ALL", addedFilters: [{ type: "Labels", searchPayload: [{ id: "red" }] }] } });
  assert.deepEqual(ids(getViewAppliedArchivedTasks(project.tasks, 1, project)), ["a"]);
  assert.deepEqual(ids(getViewAppliedArchivedTasks(project.tasks, 99, project)), []);
});

for (const visible of [true, false]) {
  test(`filter Sections Doing ${visible ? "shown" : "hidden"}`, () => {
    const project = restore({ board_columns_view: columns.map((column) => ({ ...column, visibility: column.id === 2 ? visible : column.visibility })) });
    const { _sections } = board.getCurrentProject(project);
    assert.deepEqual(_sections.map((section) => section.id), visible ? [1, 2, 3, 4, 5, 6] : [1, 3, 4, 5, 6]);
    assert.deepEqual(sectionIds(_sections), visible ? ["g", "b", "a", "h", "c", "d", "e", "f"] : ["g", "b", "a", "d", "e", "f"]);
  });
}
