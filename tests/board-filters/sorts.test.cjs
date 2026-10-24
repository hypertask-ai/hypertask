const test = require("node:test");
const assert = require("node:assert/strict");
const { NOW, fields, columns, fixture, ids } = require("./fixture.cjs");
const { boardCases, tableCases, customCases } = require("./sort-cases.cjs");
const { board, table, views, restore, load } = require("./runtime.cjs");
const customMap = new Map(fields.map((field) => [`customField:${field.id}`, field]));
const sectionOrder = new Map(columns.map((column, i) => [column.id, i]));

for (const [mode, asc, desc] of boardCases) {
  for (const [direction, order, expected] of [["asc", "Ascending", asc], ["desc", "Descending", desc]]) {
    test(`sort ${mode} ${direction}`, () => {
      const settings = { board_sorting_mode: mode, board_sorting_order: order };
      const { tasks, project } = fixture();
      project.project_view.user_project_views[0].appliedView = settings;
      assert.deepEqual(ids(board.returnSortedItems([...tasks], project)), expected.split(" "));
      for (const surface of ["board", "table"]) {
        const reloaded = restore(settings, surface);
        assert.equal(views.getActiveSortingModeFromProject(reloaded), mode);
        assert.equal(views.getActiveSortingOrderFromProject(reloaded), order);
        assert.deepEqual(ids(board.returnSortedItems([...tasks], reloaded)), expected.split(" "));
      }
    });
  }
}

for (const [label, asc, desc] of [...tableCases, ...customCases]) {
  const field = fields.find((field) => field.type === label);
  const column = field ? `customField:${field.id}` : label;
  for (const [direction, expected] of [["asc", asc], ["desc", desc]]) {
    test(`sort list ${label} ${direction}`, () => {
      const { tasks, timeTotals } = fixture();
      const compare = table.getSortComparator(column, direction, customMap, sectionOrder, true, timeTotals, NOW, NOW);
      assert.deepEqual(ids([...tasks].sort(compare)), expected.split(" "));
      const reloaded = restore({ table_sort_column: column, table_sort_direction: direction }, "table");
      const [saved] = table.resolveSortState(reloaded);
      assert.deepEqual(saved, { column, direction });
      const restoredCompare = table.getSortComparator(saved.column, saved.direction, customMap, sectionOrder, true, timeTotals, NOW, NOW);
      assert.deepEqual(ids([...reloaded.tasks].sort(restoredCompare)), expected.split(" "));
    });
  }
}

test("sort matrix exactly covers board modes, list columns and custom types", () => {
  const { SortingMode, CustomFieldType } = require("@prisma/client");
  const { TABLE_COLUMN_KEYS } = load("utils/helperFunctions/Views/TableColumnsHelperFunctions.ts");
  assert.deepEqual(boardCases.map(([mode]) => mode).sort(), Object.values(SortingMode).sort());
  assert.deepEqual(tableCases.map(([column]) => column).sort(), [...TABLE_COLUMN_KEYS].sort());
  assert.deepEqual(customCases.map(([type]) => type).sort(), Object.values(CustomFieldType).sort());
});

test("sort Priority asc then Title desc defers ranking until final level", () => {
  const project = restore({ board_sorting_mode: "Priority", board_sorting_order: "Ascending",
    board_sorting_stack: [{ mode: "Title", order: "Descending" }, { mode: "TicketNumber", order: "Ascending" }] });
  assert.deepEqual(ids(board.returnSortedItems([...project.tasks], project)), ["d", "c", "h", "b", "a", "f", "g", "e"]);
});

test("sort Priority desc then DueDate asc then Title desc", () => {
  const project = restore({ board_sorting_mode: "Priority", board_sorting_order: "Descending",
    board_sorting_stack: [{ mode: "DueDate", order: "Ascending" }, { mode: "Title", order: "Descending" }] });
  assert.deepEqual(ids(board.returnSortedItems([...project.tasks], project)), ["f", "a", "b", "h", "c", "d", "e", "g"]);
});

test("sort Manual ignores stale secondary levels in saved JSON", () => {
  const project = restore({ board_sorting_mode: "Manual", board_sorting_order: "Descending",
    board_sorting_stack: [{ mode: "Title", order: "Ascending" }] });
  assert.deepEqual(views.getActiveSortingStackFromProject(project), []);
  assert.deepEqual(ids(board.returnSortedItems([...project.tasks], project)), ["h", "g", "f", "e", "d", "c", "b", "a"]);
});

test("sort stack removes invalid duplicate and primary levels and caps at three", () => {
  assert.deepEqual(views.sanitizeSortingStack([
    { mode: "Priority", order: "Ascending" }, { mode: "Manual", order: "Ascending" },
    { mode: "Unknown", order: "Ascending" }, { mode: "Title", order: "invalid" },
    { mode: "Title", order: "Descending" }, { mode: "Title", order: "Ascending" },
    { mode: "DueDate", order: "Ascending" }, { mode: "Size", order: "Ascending" },
  ], "Priority"), [{ mode: "Title", order: "Descending" }, { mode: "DueDate", order: "Ascending" }]);
});

for (const column of ["board", "labels", "customField:invalid", "unknown"]) {
  test(`sort list unsupported ${column} rejected on save`, () => {
    assert.deepEqual(views.sanitizeTableSort(column, "asc"), { column: null, direction: "asc" });
  });
}

test("sort list time disabled does not restore an invisible sort", () => {
  const project = restore({ table_sort_column: "time", table_sort_direction: "desc" }, "table");
  project.showTimeTotals = false;
  assert.deepEqual(table.resolveSortState(project), []);
});

for (const direction of ["asc", "desc"]) {
  test(`sort list removed custom field ${direction} retains blank-last text fallback`, () => {
    const { tasks } = fixture();
    const comparator = table.getSortComparator(`customField:${fields[0].id}`, direction, new Map());
    assert.deepEqual(ids([...tasks].sort(comparator)), (direction === "asc" ? "b a h c d e f g" : "e d c a h b f g").split(" "));
  });
}

test("sort Priority desc DueDate asc Title desc resolves a true third-level tie", () => {
  const project = restore({ board_sorting_mode: "Priority", board_sorting_order: "Descending",
    board_sorting_stack: [{ mode: "DueDate", order: "Ascending" }, { mode: "Title", order: "Descending" }] });
  project.tasks[0].priority = { priority_index: 2 };
  project.tasks[2].priority = { priority_index: 2 };
  project.tasks[1].dueDate = project.tasks[0].dueDate;
  assert.deepEqual(ids(board.returnSortedItems([...project.tasks], project)), ["f", "a", "b", "c", "h", "d", "e", "g"]);
});

test("sort list Priority desc Title asc Ticket desc defers ranking through three levels", () => {
  const { tasks } = fixture();
  tasks[7].title = tasks[1].title;
  const levels = [["priority", "desc"], ["title", "asc"], ["ticket", "desc"]];
  const comparators = levels.map(([column, direction], i) => table.getSortComparator(column, direction, customMap, sectionOrder, i === levels.length - 1));
  const compare = (a, b) => comparators.map((comparator) => comparator(a, b)).find((result) => result !== 0) ?? 0;
  assert.deepEqual(ids([...tasks].sort(compare)), ["f", "a", "h", "b", "c", "d", "e", "g"]);
});
