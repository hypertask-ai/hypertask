const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  getActiveFiltersFromProject,
  stageBoardFiltersInProjectView,
} = jiti(
  path.join(root, "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts"),
);
const { getFilteredSections } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/FilterHelperFunctions.ts"),
);

const noFilters = { addedFilters: [], matchFilters: "ANY" };
const todayFilter = {
  addedFilters: [
    {
      type: "UpdatedRange",
      searchPayload: [{ id: 1, dynamicRange: "TODAY" }],
    },
  ],
  matchFilters: "ANY",
};

const buildProject = () => {
  const now = new Date();
  const old = new Date(now);
  old.setDate(old.getDate() - 2);

  return {
    id: 15,
    section: [],
    sections: [
      {
        id: 1,
        sectionId: 1,
        section_title: "Work",
        items: [
          { id: 101, updatedAt: now.toISOString() },
          { id: 102, updatedAt: old.toISOString() },
        ],
      },
    ],
    project_view: {
      id: "project-view",
      projectId: 15,
      default_view_id: "default-view",
      default_view: {
        id: "default-view",
        title: "Default",
        board_filters: noFilters,
      },
      user_project_views: [
        {
          id: "user-project-view",
          appliedViewId: "last-view",
          appliedView: {
            id: "last-view",
            title: "last",
            board_filters: noFilters,
          },
        },
      ],
    },
  };
};

test("staging board filters updates the rendered task set before persistence", () => {
  const project = buildProject();
  const originalProjectView = project.project_view;

  const stagedProjectView = stageBoardFiltersInProjectView(
    originalProjectView,
    todayFilter,
  );
  const stagedProject = { ...project, project_view: stagedProjectView };

  assert.deepEqual(getActiveFiltersFromProject(project), noFilters);
  assert.deepEqual(getActiveFiltersFromProject(stagedProject), todayFilter);
  assert.deepEqual(
    getFilteredSections(stagedProject.sections, stagedProject)[0].items.map(
      (task) => task.id,
    ),
    [101],
  );
  assert.equal(originalProjectView.user_project_views[0].unsavedView, undefined);
});

test("staging filters preserves the rest of an existing unsaved view", () => {
  const project = buildProject();
  const row = project.project_view.user_project_views[0];
  row.unsavedViewId = "unsaved-view";
  row.unsavedView = {
    ...row.appliedView,
    id: "unsaved-view",
    board_sorting_mode: "UpdatedAt",
  };

  const staged = stageBoardFiltersInProjectView(project.project_view, todayFilter);

  assert.equal(staged.user_project_views[0].unsavedView.id, "unsaved-view");
  assert.equal(
    staged.user_project_views[0].unsavedView.board_sorting_mode,
    "UpdatedAt",
  );
  assert.deepEqual(
    staged.user_project_views[0].unsavedView.board_filters,
    todayFilter,
  );
});
