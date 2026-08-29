const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSortComparator,
  comparatorForSortingMode,
  sanitizeSortingStack,
  getActiveSortingStackFromProject,
} = require("./stacked-sort-entry.cjs");

const projectWithViews = ({ applied, defaultView }) => ({
  project_view: {
    user_project_views: [{ appliedView: applied }],
    default_view: defaultView,
  },
});

const task = (id, priorityIndex, dueDate, estimateIndex, ranking = "same") => ({
  id,
  ranking,
  priority: { priority_index: priorityIndex },
  dueDate,
  estimate: { estimate_index: estimateIndex },
});

test("level 2 DueDate Ascending breaks a Priority tie", () => {
  const later = task("later", 1, "2026-08-20T00:00:00.000Z", 1);
  const earlier = task("earlier", 1, "2026-08-10T00:00:00.000Z", 1);
  const comparator = buildSortComparator([
    { mode: "Priority", order: "Descending" },
    { mode: "DueDate", order: "Ascending" },
  ]);

  assert.ok(comparator);
  assert.deepEqual([later, earlier].sort(comparator).map(({ id }) => id), [
    "earlier",
    "later",
  ]);
});

test("level 2 direction changes only the tied pair", () => {
  const highestPriority = task("highest", 0, "2026-08-30T00:00:00.000Z", 1);
  const later = task("later", 1, "2026-08-20T00:00:00.000Z", 1);
  const earlier = task("earlier", 1, "2026-08-10T00:00:00.000Z", 1);
  const ascending = buildSortComparator([
    { mode: "Priority", order: "Descending" },
    { mode: "DueDate", order: "Ascending" },
  ]);
  const descending = buildSortComparator([
    { mode: "Priority", order: "Descending" },
    { mode: "DueDate", order: "Descending" },
  ]);

  assert.ok(ascending);
  assert.ok(descending);
  assert.deepEqual(
    [later, highestPriority, earlier].sort(ascending).map(({ id }) => id),
    ["highest", "earlier", "later"]
  );
  assert.deepEqual(
    [later, highestPriority, earlier].sort(descending).map(({ id }) => id),
    ["highest", "later", "earlier"]
  );
});

test("level 3 Size breaks equal Priority and DueDate values", () => {
  const larger = task("larger", 1, "2026-08-10T00:00:00.000Z", 3);
  const smaller = task("smaller", 1, "2026-08-10T00:00:00.000Z", 1);
  const comparator = buildSortComparator([
    { mode: "Priority", order: "Descending" },
    { mode: "DueDate", order: "Ascending" },
    { mode: "Size", order: "Ascending" },
  ]);

  assert.ok(comparator);
  assert.deepEqual([larger, smaller].sort(comparator).map(({ id }) => id), [
    "smaller",
    "larger",
  ]);
});

// Why this matters: ranking is unique per task, and the Priority/Size comparators fall back to it
// on a tie. If that fallback stays on for a non-final level, the level never reports a tie and the
// tie-breakers below it are dead code. Distinct rankings here, unlike the shared "same" default.
test("a Priority tie still falls through to level 2 when rankings differ", () => {
  const later = task("later", 1, "2026-08-20T00:00:00.000Z", 1, "aaa");
  const earlier = task("earlier", 1, "2026-08-10T00:00:00.000Z", 1, "zzz");
  const comparator = buildSortComparator([
    { mode: "Priority", order: "Descending" },
    { mode: "DueDate", order: "Ascending" },
  ]);

  // Ranking order would put "later" (aaa) first; the DueDate level must win instead.
  assert.deepEqual([later, earlier].sort(comparator).map(({ id }) => id), [
    "earlier",
    "later",
  ]);
});

// The flip side: a single-level Priority sort must keep tie-breaking by ranking exactly as before,
// so boards that never touch the new feature sort identically.
test("single-level Priority still tie-breaks by ranking", () => {
  const first = task("first", 1, null, 1, "aaa");
  const second = task("second", 1, null, 1, "zzz");
  const comparator = buildSortComparator([
    { mode: "Priority", order: "Descending" },
  ]);

  assert.equal(comparator(first, second) < 0, true);
  assert.deepEqual([second, first].sort(comparator).map(({ id }) => id), [
    "first",
    "second",
  ]);
});

test("empty and Manual-only levels have no comparator", () => {
  assert.equal(buildSortComparator([]), null);
  assert.equal(
    buildSortComparator([{ mode: "Manual", order: "Descending" }]),
    null
  );
  assert.equal(comparatorForSortingMode("Manual", "Ascending"), null);
});

// board_sorting_stack is nullable, and null is the normal state for every view that existed before
// this feature. Resolving the stack by value-cascading (unsaved ?? applied ?? default) would make a
// legacy view inherit the DEFAULT view's tie-breakers, which the user never asked for on that view.
test("an active view with no stack does not inherit the default view's stack", () => {
  const project = projectWithViews({
    applied: { board_sorting_mode: "Size", board_sorting_order: "Descending", board_sorting_stack: null },
    defaultView: {
      board_sorting_mode: "Priority",
      board_sorting_order: "Descending",
      board_sorting_stack: [{ mode: "DueDate", order: "Ascending" }],
    },
  });

  assert.deepEqual(getActiveSortingStackFromProject(project), []);
});

test("the active view's own stack is used when it has one", () => {
  const project = projectWithViews({
    applied: {
      board_sorting_mode: "Priority",
      board_sorting_order: "Descending",
      board_sorting_stack: [{ mode: "DueDate", order: "Ascending" }],
    },
    defaultView: { board_sorting_mode: "Manual", board_sorting_order: "Descending", board_sorting_stack: null },
  });

  assert.deepEqual(getActiveSortingStackFromProject(project), [
    { mode: "DueDate", order: "Ascending" },
  ]);
});

// A stack left behind a Manual primary must stay inert rather than resurfacing as a real sort.
test("a stack stored under a Manual primary is ignored", () => {
  const project = projectWithViews({
    applied: {
      board_sorting_mode: "Manual",
      board_sorting_order: "Descending",
      board_sorting_stack: [{ mode: "DueDate", order: "Ascending" }],
    },
    defaultView: undefined,
  });

  assert.deepEqual(getActiveSortingStackFromProject(project), []);
});

test("sanitizeSortingStack drops invalid and duplicate levels and truncates to two", () => {
  const sanitized = sanitizeSortingStack(
    [
      null,
      "junk",
      { mode: "Unknown", order: "Ascending" },
      { mode: "DueDate", order: "Unknown" },
      { mode: "Manual", order: "Ascending" },
      { mode: "Priority", order: "Ascending" },
      { mode: "DueDate", order: "Descending" },
      { mode: "DueDate", order: "Ascending" },
      { mode: "Size", order: "Ascending" },
      { mode: "CreatedAt", order: "Ascending" },
    ],
    "Priority"
  );

  assert.deepEqual(sanitized, [
    { mode: "DueDate", order: "Descending" },
    { mode: "Size", order: "Ascending" },
  ]);
});
