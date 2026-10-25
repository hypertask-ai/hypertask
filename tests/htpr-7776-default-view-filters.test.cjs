const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const { getFilteredSections } = load(
  "src/utils/helperFunctions/Views/FilterHelperFunctions.ts",
  {
    "@/utils/helperFunctions/helperFunctions": { deepCopy: structuredClone },
    "@/models/Views/model": { DEFAULT_SUBTASK_SETTING: "Flattened_Card" },
    "@/lib/constants/constants": {},
    "@/lib/staleness": {},
    "@/lib/constants/builtinViews": { getBuiltinView: () => undefined },
    "@/utils/sortByParam": {},
    "./TableColumnsHelperFunctions": {},
    "./SubtaskHelperFunction": {},
    "./EmptySectionsHelperFunction": {},
    "@/lib/sectionAutoAssign": {},
  },
);

const priorityFilters = (priority) => ({
  matchFilters: "ALL",
  addedFilters: [{ type: "Priority", searchPayload: [{ priority_index: priority }] }],
});
const sections = [{
  id: 1,
  items: [
    { id: 10, priority: { priority_index: 1 } },
    { id: 20, priority: { priority_index: 2 } },
    { id: 30, priority: { priority_index: 3 } },
  ],
}];
const visibleIds = (project, context) =>
  getFilteredSections(sections, project, undefined, {}, context)[0].items.map(({ id }) => id);
const projectWith = (rows = []) => ({
  project_view: {
    user_project_views: rows,
    default_view: { board_filters: priorityFilters(1) },
  },
});

test("new board members immediately see only tickets matching the default view", () => {
  assert.deepEqual(visibleIds(projectWith()), [10]);
});

test("missing personal-view relations still apply board default filters", () => {
  const project = projectWith();
  delete project.project_view.user_project_views;
  assert.deepEqual(visibleIds(project), [10]);
});

test("personal unsaved and applied filters retain precedence over the board default", () => {
  assert.deepEqual(visibleIds(projectWith([{
    unsavedView: { board_filters: priorityFilters(3) },
    appliedView: { board_filters: priorityFilters(2) },
  }])), [30]);
  assert.deepEqual(visibleIds(projectWith([{
    appliedView: { board_filters: priorityFilters(2) },
  }])), [20]);
  assert.deepEqual(visibleIds(projectWith([{}])), [10]);
  assert.deepEqual(visibleIds(projectWith([{
    unsavedView: { board_filters: { matchFilters: "ALL", addedFilters: [] } },
  }])), [10, 20, 30]);
});

test("boards without default filters remain unfiltered", () => {
  assert.deepEqual(visibleIds({}), [10, 20, 30]);
  assert.deepEqual(visibleIds({ project_view: { user_project_views: [] } }), [10, 20, 30]);
});

test("flag off restores missing-row behavior without overriding personal filters", () => {
  const context = { legacyMissingPersonalViewFilters: true };
  assert.deepEqual(visibleIds(projectWith(), context), [10, 20, 30]);
  assert.deepEqual(visibleIds(projectWith([{
    appliedView: { board_filters: priorityFilters(2) },
  }]), context), [20]);
});

test("resolved default filters do not mutate the saved board view", () => {
  const project = projectWith();
  const original = structuredClone(project);
  visibleIds(project);
  assert.deepEqual(project, original);
  assert.deepEqual(visibleIds(project), [10]);
});
