const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getActiveShowArchivedOverrideFromProject,
  getViewAppliedArchivedTasks,
  resolveShowArchivedForBoard,
  resolveShowArchivedRequest,
} = require("./view-show-archived-entry.cjs");

const buildProject = ({
  unsavedView = null,
  appliedView = null,
  defaultView = null,
} = {}) => ({
  id: 339,
  project_view: {
    default_view: defaultView,
    user_project_views: [{ unsavedView, appliedView }],
  },
});

const view = (settings = {}) => ({
  board_sorting_mode: "Manual",
  board_sorting_order: "Descending",
  board_sorting_stack: [],
  board_filters: { addedFilters: [], matchFilters: "ANY" },
  ...settings,
});

const SECTION_ID = 7;

const archived = (id, overrides = {}) => ({
  id,
  uniqueIndex: id,
  projectId: 339,
  sectionId: 7,
  ranking: "a",
  archivedAt: `2026-08-0${id}T00:00:00.000Z`,
  ...overrides,
});

test("no view in the chain pins show-archived, so the override stays null", () => {
  assert.equal(
    getActiveShowArchivedOverrideFromProject(buildProject({ defaultView: view() })),
    null
  );
  assert.equal(getActiveShowArchivedOverrideFromProject(undefined), null);
});

test("the unsaved view wins over the applied and default views", () => {
  const project = buildProject({
    unsavedView: view({ board_show_archived: true }),
    appliedView: view({ board_show_archived: false }),
    defaultView: view({ board_show_archived: false }),
  });

  assert.equal(getActiveShowArchivedOverrideFromProject(project), true);
});

test("a saved view pinning show-archived off beats the board default view", () => {
  const project = buildProject({
    appliedView: view({ board_show_archived: false }),
    defaultView: view({ board_show_archived: true }),
  });

  assert.equal(getActiveShowArchivedOverrideFromProject(project), false);
});

test("archived tasks are dropped when the view's filters exclude them", () => {
  const highPriority = archived(1, { priority: { priority_index: 2 } });
  const lowPriority = archived(2, { priority: { priority_index: 4 } });
  const project = buildProject({
    defaultView: view({
      board_filters: {
        matchFilters: "ANY",
        addedFilters: [
          { type: "Priority", searchPayload: [{ priority_index: 2 }] },
        ],
      },
    }),
  });

  assert.deepEqual(
    getViewAppliedArchivedTasks([highPriority, lowPriority], SECTION_ID, project).map(
      ({ id }) => id
    ),
    [1]
  );
});

test("archived tasks follow the view's sorting mode instead of archive date", () => {
  const archivedFirst = archived(1, { title: "Zebra" });
  const archivedLast = archived(2, { title: "Apple" });
  const project = buildProject({
    defaultView: view({
      board_sorting_mode: "Title",
      board_sorting_order: "Ascending",
    }),
  });

  assert.deepEqual(
    getViewAppliedArchivedTasks([archivedFirst, archivedLast], SECTION_ID, project).map(
      ({ title }) => title
    ),
    ["Apple", "Zebra"]
  );
});

test("a Manual view keeps the most-recently-archived card first", () => {
  const older = archived(1);
  const newer = archived(2);
  const project = buildProject({ defaultView: view() });

  assert.deepEqual(
    getViewAppliedArchivedTasks([older, newer], SECTION_ID, project).map(({ id }) => id),
    [2, 1]
  );
});

test("archived tasks from other columns never leak into this one", () => {
  const otherColumn = archived(3, { sectionId: 9 });
  const project = buildProject({ defaultView: view() });

  assert.deepEqual(
    getViewAppliedArchivedTasks([archived(1), otherColumn], SECTION_ID, project).map(
      ({ id }) => id
    ),
    [1]
  );
});

// A saved view pins the old value until the async write lands, so without a
// pending value the second of two quick toggles re-sends the first result and
// the board never returns to where the user started (HTPR-5540 review).
test("a pending toggle outranks the saved view override until the write lands", () => {
  const project = buildProject({ appliedView: view({ board_show_archived: false }) });

  assert.equal(resolveShowArchivedForBoard(project, null, false), false);

  const afterFirstToggle = !resolveShowArchivedForBoard(project, null, false);
  assert.equal(afterFirstToggle, true);

  const pending = { projectId: project.id, value: afterFirstToggle };
  assert.equal(resolveShowArchivedForBoard(project, pending, false), true);
  assert.equal(!resolveShowArchivedForBoard(project, pending, false), false);
});

test("a pending toggle for another board is ignored", () => {
  const project = buildProject({ appliedView: view({ board_show_archived: true }) });
  assert.equal(
    resolveShowArchivedForBoard(project, { projectId: 15, value: false }, false),
    true
  );
});

test("with no view override the browser preference still decides", () => {
  assert.equal(resolveShowArchivedForBoard(buildProject(), null, true), true);
  assert.equal(resolveShowArchivedForBoard(null, null, true), true);
});

// A filter-only save from an older bundle never mentions board_show_archived.
// Coalescing that silence to null used to wipe the pinned choice (HTPR-5540).
test("an omitted board_show_archived keeps the inherited value", () => {
  assert.equal(resolveShowArchivedRequest({ board_filters: {} }, true), true);
  assert.equal(resolveShowArchivedRequest({ board_filters: {} }, false), false);
  assert.equal(resolveShowArchivedRequest({}, null), null);
});

test("an explicit board_show_archived wins over the inherited value", () => {
  assert.equal(resolveShowArchivedRequest({ board_show_archived: false }, true), false);
  assert.equal(resolveShowArchivedRequest({ board_show_archived: true }, false), true);
  assert.equal(resolveShowArchivedRequest({ board_show_archived: null }, true), null);
});

// The route has no schema validation, so a stray non-boolean must not reach
// the Prisma boolean column.
test("a non-boolean board_show_archived is rejected, not forwarded", () => {
  assert.equal(resolveShowArchivedRequest({ board_show_archived: "true" }, true), null);
  assert.equal(resolveShowArchivedRequest({ board_show_archived: 1 }, false), null);
});
