const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tableView = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/PageComponents/Kanban/TableView/TableView.tsx",
  ),
  "utf8",
);

const taskCells = tableView.slice(
  tableView.indexOf("const renderTaskRow"),
  tableView.indexOf("let cursor = -1"),
);
const tableHeader = tableView.slice(
  tableView.indexOf('className={`${TABLE_GRID_CLASS} table-view-header'),
  tableView.indexOf("{rows.length === 0"),
);
const ticketCell = taskCells.slice(
  taskCells.indexOf('case "ticket"'),
  taskCells.indexOf('case "title"'),
);
const titleCell = taskCells.slice(
  taskCells.indexOf('case "title"'),
  taskCells.indexOf('case "status"'),
);
const horizontalHeaderCell = tableHeader.slice(
  tableHeader.indexOf("style={"),
  tableHeader.indexOf("{dragOverColumn?.column"),
);

const assertDesktopOnlySticky = (source) => {
  assert.match(source, /md:sticky/);
  assert.doesNotMatch(source.replaceAll("md:sticky", ""), /(?:^|[\s"`])sticky(?=[\s"`])/);
};

test("mobile table rows scroll every column while desktop keeps ticket and title frozen", () => {
  assert.doesNotMatch(taskCells, /style=\{\{ position: "sticky"/);
  assertDesktopOnlySticky(ticketCell);
  assertDesktopOnlySticky(titleCell);
  assert.match(taskCells, /selected\s*\? "md:bg-active-elementBg"/);
  assert.match(taskCells, /\? "md:bg-hover-active"\s*:\s*"md:bg-containerBackground"/);
  assert.match(tableView, /overflow-x-auto overflow-y-auto table-hscroll/);
  assert.match(tableView, /style=\{\{ minWidth: tableMinWidth \}\}/);
});

test("the table header stays vertically sticky on mobile without frozen columns", () => {
  assert.match(tableHeader, /table-view-header[^`]+sticky top-0/);
  assert.doesNotMatch(horizontalHeaderCell, /position: "sticky"/);
  assertDesktopOnlySticky(horizontalHeaderCell);
  assert.match(horizontalHeaderCell, /md:z-20 md:bg-taskDetailPage/);
});
