const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const { hydrateBoardSections } = jiti(path.join(root, "src/lib/firstScreen/boardPayload.ts"));
const { pinProjectToUrlView } = jiti(path.join(root, "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts"));

function fixture(surface = "Board") {
  const columns = ["Inbox", "Doing", "Hidden"].map((section_title, index) => ({
    id: index + 1, section_title, ranking: String(index), visibility: index !== 2,
  }));
  const selected = {
    id: "selected", slug: "selected", board_layout: surface,
    board_columns_view: columns,
    board_sorting_mode: "Priority", board_sorting_order: "Descending",
    board_subtask_setting: "None", board_empty_sections: "Show",
    board_filters: { matchFilters: "ALL", addedFilters: [{ type: "Labels", searchPayload: [{ id: "red" }] }] },
  };
  const previous = {
    ...selected, id: "previous", slug: "previous", board_sorting_mode: "Manual",
    board_columns_view: columns.map(column => ({ ...column, visibility: column.id === 1 })),
    board_filters: { matchFilters: "ALL", addedFilters: [] },
  };
  const tasks = [
    ["low", 1, "a", 3, "red"], ["urgent", 1, "b", 1, "red"],
    ["doing", 2, "c", 2, "red"], ["excluded", 2, "d", 1, "blue"],
    ["hidden", 3, "e", 1, "red"],
  ].map(([id, sectionId, ranking, priority_index, label]) => ({
    id, sectionId, ranking, priority: { priority_index }, status: "Normal",
    taskLabels: [{ label: { id: label } }], subTasks: [],
  }));
  return hydrateBoardSections({
    id: 15, section: columns, tasks,
    project_view: {
      allViews: [previous, selected],
      user_project_views: [{ appliedView: previous, appliedViewId: previous.id }],
    },
  });
}

for (const surface of ["Board", "Table"]) {
  test(`saved URL ${surface} restores selected columns and matching tickets from canonical data`, () => {
    const project = fixture(surface);
    const snapshot = structuredClone(project);
    assert.deepEqual(project.sections.map(section => section.id), [1]);
    const pinned = pinProjectToUrlView(project, "selected");
    assert.deepEqual(pinned.sections.map(section => section.id), [1, 2]);
    assert.deepEqual(pinned.filteredSections.map(section => section.id), [1, 2]);
    assert.deepEqual(pinned.filteredSections[1].items.map(task => task.id), ["doing"]);
    assert.deepEqual(project, snapshot);
  });
}

test("saved URL board recomputes priority order and first task instead of keeping manual order", () => {
  const project = fixture();
  assert.deepEqual(project.sections[0].items.map(task => task.id), ["low", "urgent"]);
  const pinned = pinProjectToUrlView(project, "selected");
  assert.deepEqual(pinned.filteredSections[0].items.map(task => task.id), ["urgent", "low"]);
  assert.equal(pinned.firstTask.id, "urgent");
});

test("saved URL flag off preserves legacy hidden columns and manual order", () => {
  const project = fixture();
  const pinned = pinProjectToUrlView(project, "selected", undefined, false);
  assert.deepEqual(pinned.filteredSections.map(section => section.id), [1]);
  assert.deepEqual(pinned.filteredSections[0].items.map(task => task.id), ["low", "urgent"]);
  assert.equal(pinned.firstTask.id, "low");
});

test("saved URL same, missing and absent slugs preserve the existing project and draft", () => {
  const project = fixture();
  project.project_view.user_project_views[0].unsavedView = { id: "draft" };
  for (const slug of ["previous", "missing", undefined]) {
    assert.strictEqual(pinProjectToUrlView(project, slug), project);
  }
});

test("saved URL selection preserves prebuilt sections when canonical data is not loaded", () => {
  for (const missing of ["section", "tasks"]) {
    const project = fixture();
    delete project[missing];
    const pinned = pinProjectToUrlView(project, "selected");
    assert.strictEqual(pinned.sections, project.sections);
    assert.deepEqual(pinned.filteredSections[0].items.map(task => task.id), ["low", "urgent"]);
  }
});
