const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/utils/controllers/section/moveToColumnSections.ts"),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = { exports: {} };
new Function("exports", "module", javascript)(loaded.exports, loaded);
const { resolveMoveToColumnSections } = loaded.exports;

const boardColumns = [
  { id: 1, section_title: "Todo", visibility: true },
  { id: 2, section_title: "Doing", visibility: true },
  { id: 3, section_title: "Done", visibility: true },
];

const titles = (columns) => columns.map((column) => column.section_title);

test("a saved view with no stored columns still lists the board's columns", () => {
  // The production incident: the applied view "Tracking" was created with a
  // null board_columns_view, so every column of that board disappeared from
  // the move dialog. A view that stores no columns overrides nothing.
  const columns = resolveMoveToColumnSections({
    defaultColumns: boardColumns,
    activeColumns: null,
    activeViewType: "Applied",
    boardSections: [],
  });

  assert.deepEqual(titles(columns), ["Todo", "Doing", "Done"]);
  assert.ok(columns.every((column) => column.visibility === true));
});

test("the active view decides which of the board's columns read as hidden", () => {
  // This is the reason the reconciliation exists at all: a column the active
  // view does not carry is offered as a move target, marked hidden.
  const columns = resolveMoveToColumnSections({
    defaultColumns: boardColumns,
    activeColumns: [
      { id: 1, visibility: true },
      { id: 2, visibility: false },
    ],
    activeViewType: "Applied",
    boardSections: [],
  });

  assert.deepEqual(
    columns.map((column) => [column.id, column.visibility]),
    [
      [1, true],
      [2, false],
      [3, false],
    ],
  );
});

test("the board default view is used as-is, with no reconciliation", () => {
  const columns = resolveMoveToColumnSections({
    defaultColumns: boardColumns,
    activeColumns: boardColumns,
    activeViewType: "Default",
    boardSections: [],
  });

  assert.deepEqual(columns, boardColumns);
});

test("a board whose default view stores no columns falls back to its sections", () => {
  // A board with no project_view or no default view row at all: the Section
  // table is the only remaining truth about which columns exist.
  for (const defaultColumns of [null, undefined, [], { corrupted: true }]) {
    const columns = resolveMoveToColumnSections({
      defaultColumns,
      activeColumns: null,
      activeViewType: undefined,
      boardSections: [
        { id: 7, section_title: "Backlog", visibility: false },
        { id: 8, section_title: "Shipped", visibility: true },
      ],
    });

    assert.deepEqual(titles(columns), ["Backlog", "Shipped"]);
    // Visibility is unknowable without a view, and a column the dialog cannot
    // offer is worse than one wrongly drawn without the hidden-eye marker.
    assert.ok(columns.every((column) => column.visibility === true));
  }
});

test("no shape of stored view JSON throws", () => {
  for (const activeColumns of [null, undefined, {}, 0, "[]"]) {
    assert.doesNotThrow(() =>
      resolveMoveToColumnSections({
        defaultColumns: boardColumns,
        activeColumns,
        activeViewType: "Unsaved",
        boardSections: [],
      }),
    );
  }
});
