const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const { getViewFromProject, pinProjectToUrlView } = jiti(
  path.join(
    root,
    "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts",
  ),
);
const { applyTransientTabSettings, canUseViewAsTabBase } = jiti(
  path.join(
    root,
    "src/utils/helperFunctions/Views/TransientTabView.ts",
  ),
);

function view(id, slug) {
  return {
    id,
    slug,
    board_columns_view: [],
    board_filters: { matchFilters: "ALL", addedFilters: [] },
    board_sorting_mode: "Manual",
    board_sorting_order: "Ascending",
    board_sorting_stack: [],
    board_subtask_setting: "None",
    board_empty_sections: "Show",
    board_staleness: null,
    table_sort_column: null,
    table_sort_direction: null,
  };
}

function projectFixture() {
  const defaultView = view("default-id", "all-tasks");
  const viewA = view("view-a", "view-a");
  const viewB = view("view-b", "view-b");
  const unsavedView = view("unsaved-a", "unsaved-a");

  return {
    project: {
      id: 15,
      sections: [],
      project_view: {
        id: "project-view",
        default_view_id: defaultView.id,
        default_view: defaultView,
        allViews: [defaultView, viewA, viewB],
        user_project_views: [
          {
            id: "user-project-view",
            appliedViewId: viewA.id,
            appliedView: viewA,
            unsavedViewId: unsavedView.id,
            unsavedView,
          },
        ],
      },
    },
    defaultView,
    viewA,
    viewB,
    unsavedView,
  };
}

test("a different URL view overrides the globally applied view and its unsaved overlay", () => {
  const { project, viewB } = projectFixture();

  const pinned = pinProjectToUrlView(project, viewB.slug);
  const active = getViewFromProject(pinned);

  assert.notStrictEqual(pinned, project);
  assert.equal(active.type, "Applied");
  assert.equal(active.view.id, viewB.id);
  assert.equal(
    pinned.project_view.user_project_views[0].unsavedView,
    undefined,
  );
});

test("a tab on the unsaved overlay's own base view keeps that working context", () => {
  const { project, viewA, unsavedView } = projectFixture();

  const pinned = pinProjectToUrlView(project, viewA.slug);

  assert.strictEqual(pinned, project);
  assert.equal(getViewFromProject(pinned).view.id, unsavedView.id);
});

test("the default sentinel clears another tab's applied and unsaved view", () => {
  const { project, defaultView } = projectFixture();

  const pinned = pinProjectToUrlView(project, "default");
  const active = getViewFromProject(pinned);

  assert.equal(active.type, "Default");
  assert.equal(active.view.id, defaultView.id);
  assert.equal(
    pinned.project_view.user_project_views[0].appliedView,
    undefined,
  );
  assert.equal(
    pinned.project_view.user_project_views[0].unsavedView,
    undefined,
  );
});

test("the default sentinel keeps an unsaved overlay based on the default view", () => {
  const { project, unsavedView } = projectFixture();
  const row = project.project_view.user_project_views[0];
  row.appliedView = undefined;
  row.appliedViewId = undefined;

  const pinned = pinProjectToUrlView(project, "default");

  assert.strictEqual(pinned, project);
  assert.equal(getViewFromProject(pinned).view.id, unsavedView.id);
});

test("an unknown or deleted URL slug leaves the server-resolved project unchanged", () => {
  const { project } = projectFixture();

  assert.strictEqual(pinProjectToUrlView(project, "deleted-view"), project);
});

test("a private view cannot become another user's tab base", () => {
  assert.equal(
    canUseViewAsTabBase(
      { id: "private-a", userId: 9, visibility: "Private" },
      6,
    ),
    false,
  );
  assert.equal(
    canUseViewAsTabBase(
      { id: "private-a", userId: 6, visibility: "Private" },
      6,
    ),
    true,
  );
  assert.equal(
    canUseViewAsTabBase(
      { id: "public-a", userId: 9, visibility: "Public" },
      6,
    ),
    true,
  );
});

test("different tabs receive independent unsaved overlays without changing the shared row", () => {
  const shared = {
    id: "project-view",
    allViews: [
      { id: "view-a" },
      { id: "view-b" },
      { id: "global-unsaved" },
    ],
    user_project_views: [
      {
        id: "user-project-view",
        appliedViewId: "global-view",
        unsavedViewId: "global-unsaved",
      },
    ],
  };
  const viewA = { id: "view-a", userId: 6, visibility: "Private" };
  const viewB = { id: "view-b", userId: 6, visibility: "Private" };

  const tabA = applyTransientTabSettings(
    shared,
    6,
    viewA,
    { board_filters: { tab: "A" } },
    true,
  );
  const tabB = applyTransientTabSettings(
    shared,
    6,
    viewB,
    { board_filters: { tab: "B" } },
    true,
  );

  assert.equal(shared.user_project_views[0].unsavedViewId, "global-unsaved");
  assert.equal(shared.allViews.length, 3);
  assert.deepEqual(tabA.allViews.map((item) => item.id), ["view-a", "view-b"]);
  assert.equal(tabA.user_project_views[0].unsavedViewId, "tab-unsaved:view-a");
  assert.equal(tabB.user_project_views[0].unsavedViewId, "tab-unsaved:view-b");
  assert.deepEqual(tabA.user_project_views[0].unsavedView.board_filters, { tab: "A" });
  assert.deepEqual(tabB.user_project_views[0].unsavedView.board_filters, { tab: "B" });
});
