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

test("mobile table rows scroll every column while desktop keeps ticket and title frozen", () => {
  assert.doesNotMatch(taskCells, /style=\{\{ position: "sticky"/);
  assert.equal(
    taskCells.match(/md:sticky/g)?.length,
    2,
    "only the ticket and title cells should become sticky at the desktop breakpoint",
  );
  assert.match(taskCells, /selected\s*\? "md:bg-active-elementBg"/);
  assert.match(taskCells, /\? "md:bg-hover-active"\s*:\s*"md:bg-containerBackground"/);
});

test("the table header stays vertically sticky on mobile without frozen columns", () => {
  assert.match(tableHeader, /table-view-header[^`]+sticky top-0/);
  assert.doesNotMatch(tableHeader, /position: "sticky"/);
  assert.match(tableHeader, /md:sticky md:z-20/);
  assert.match(tableHeader, /md:bg-taskDetailPage/);
});
