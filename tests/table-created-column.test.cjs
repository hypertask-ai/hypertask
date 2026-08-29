const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/table-created-column.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { formatDateWithYearIfPast } = jiti(path.join(root, "src/utils/generateTime.ts"));
const {
  TABLE_COLUMN_KEYS,
  normalizeTableVisibleColumns,
} = jiti(path.join(root, "src/utils/helperFunctions/Views/TableColumnsHelperFunctions.ts"));
const { sanitizeTableSort } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts")
);

const thisYear = new Date().getFullYear();

// The whole point of the column is telling an old ticket from a recent one, so
// a date that silently drops its year is worse than no column at all.
test("a date outside the current year keeps its year", () => {
  const formatted = formatDateWithYearIfPast(new Date(2025, 8, 12));
  assert.match(formatted, /2025/);
});

test("a date inside the current year drops the year", () => {
  const formatted = formatDateWithYearIfPast(new Date(thisYear, 0, 15));
  assert.doesNotMatch(formatted, new RegExp(String(thisYear)));
  assert.notEqual(formatted, "");
});

test("missing and unparseable values render as empty, never as Invalid Date", () => {
  assert.equal(formatDateWithYearIfPast(null), "");
  assert.equal(formatDateWithYearIfPast(undefined), "");
  assert.equal(formatDateWithYearIfPast("not a date"), "");
});

test("created is a selectable table column and survives normalisation", () => {
  assert.ok(TABLE_COLUMN_KEYS.includes("created"));
  assert.ok(normalizeTableVisibleColumns(["ticket", "title", "created"]).includes("created"));
});

test("created is retained when a saved table sort is sanitized", () => {
  assert.deepEqual(sanitizeTableSort("created", "desc"), {
    column: "created",
    direction: "desc",
  });
});

test("an unsaved null table sort clears the applied view's old sort", () => {
  const { getActiveTableSortFromProject } = jiti(
    path.join(root, "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts")
  );
  const project = {
    project_view: {
      default_view: {
        table_sort_column: "updated",
        table_sort_direction: "desc",
      },
      user_project_views: [
        {
          appliedView: {
            table_sort_column: "priority",
            table_sort_direction: "desc",
          },
          unsavedView: {
            table_sort_column: null,
            table_sort_direction: null,
          },
        },
      ],
    },
  };

  assert.equal(getActiveTableSortFromProject(project), null);
});

// The bug this guards: the sort-key allowlist used to be a hand-maintained copy
// of TABLE_COLUMN_KEYS, so "created" was added to one and not the other and every
// Created sort was sanitized away. They are one list now; this fails if they part.
test("every table column key is accepted as a sort key", () => {
  const { getActiveTableSortFromProject } = jiti(
    path.join(root, "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts")
  );
  for (const key of TABLE_COLUMN_KEYS) {
    const project = {
      project_view: {
        user_project_views: [
          { unsavedView: { table_sort_column: key, table_sort_direction: "asc" } },
        ],
      },
    };
    assert.deepEqual(
      getActiveTableSortFromProject(project),
      { column: key, direction: "asc" },
      `${key} was rejected as a sort column`
    );
  }
});
