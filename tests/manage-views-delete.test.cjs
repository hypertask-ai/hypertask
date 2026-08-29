const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
require("tsx/cjs");

const {
  isProjectViewResponseForBoard,
  replaceProjectViewForCurrentBoard,
} = require(
  path.join(
    root,
    "src/utils/helperFunctions/Views/ProjectViewState.ts",
  ),
);

test("deleting a saved view immediately replaces the current board view data", () => {
  const deletedView = { id: "view-deleted", title: "Delete me" };
  const keptView = { id: "view-kept", title: "Keep me" };
  const currentProject = {
    id: 15,
    name: "Hypertask",
    project_view: {
      id: "project-view-15",
      allViews: [deletedView, keptView],
      user_project_views: [{ appliedView: deletedView }],
    },
  };
  const updatedProjectView = {
    id: "project-view-15",
    allViews: [keptView],
    user_project_views: [{ appliedView: undefined }],
  };

  const nextProject = replaceProjectViewForCurrentBoard(
    currentProject,
    15,
    updatedProjectView,
  );

  assert.notEqual(nextProject, currentProject);
  assert.equal(nextProject.project_view, updatedProjectView);
  assert.deepEqual(nextProject.project_view.allViews, [keptView]);
  assert.deepEqual(currentProject.project_view.allViews, [deletedView, keptView]);
});

test("a delayed deletion response cannot replace a different current board", () => {
  const currentProject = {
    id: 16,
    project_view: { id: "project-view-16", allViews: [] },
  };

  assert.equal(
    replaceProjectViewForCurrentBoard(
      currentProject,
      15,
      { id: "project-view-15", allViews: [] },
    ),
    currentProject,
  );
});

test("only a complete project view for the deleted board can replace local state", () => {
  const completeResponse = {
    id: "project-view-15",
    projectId: 15,
    allViews: [],
    user_project_views: [],
  };

  assert.equal(isProjectViewResponseForBoard(completeResponse, 15), true);
  assert.equal(isProjectViewResponseForBoard(undefined, 15), false);
  assert.equal(
    isProjectViewResponseForBoard({ id: "project-view-15", projectId: 15 }, 15),
    false,
  );
  assert.equal(isProjectViewResponseForBoard(completeResponse, 16), false);

  const hookSource = fs.readFileSync(
    path.join(root, "src/hooks/Homepage/Views/useKanbanViews.ts"),
    "utf8",
  );
  assert.match(
    hookSource,
    /isProjectViewResponseForBoard\(updatedProjectView, projectId\)/,
  );
  assert.doesNotMatch(hookSource, /response\.data as IProjectView/);
});

test("Manage Views applies the deletion response before relying on a refetch", () => {
  const source = fs.readFileSync(
    path.join(
      root,
      "src/components/Modals/ViewModals/ManageViewsModals.tsx",
    ),
    "utf8",
  );

  assert.match(
    source,
    /const updatedProjectView = await deleteView\(view\.id, currentProject\.id\)/,
  );
  assert.match(
    source,
    /setCurrentProject\(\(project\) =>\s*replaceProjectViewForCurrentBoard\(/,
  );
});
