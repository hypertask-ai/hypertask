const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/table-row-drag-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  canDropTableRow,
  getTableRowDragData,
  parseTableRowDragData,
} = jiti(
  path.join(
    root,
    "src/components/PageComponents/Kanban/TableView/tableRowDrag.ts"
  )
);

const realSectionIds = new Set([10, 20]);

test("table rows are draggable only when grouped by real project sections", () => {
  assert.deepEqual(getTableRowDragData(7, 10, realSectionIds, false), {
    taskId: 7,
    sourceSectionId: 10,
  });
  assert.equal(getTableRowDragData(7, 10, realSectionIds, true), null);
  assert.equal(getTableRowDragData(7, 99, realSectionIds, false), null);
  assert.equal(getTableRowDragData(7, 10, new Set(), false), null);
});

test("table row drops require a different real project section", () => {
  const draggedTask = { taskId: 7, sourceSectionId: 10 };
  assert.equal(canDropTableRow(draggedTask, 20, realSectionIds), true);
  assert.equal(canDropTableRow(draggedTask, 10, realSectionIds), false);
  assert.equal(canDropTableRow(draggedTask, 99, realSectionIds), false);
  assert.equal(canDropTableRow(draggedTask, 20, new Set()), false);
});

test("table row drag payloads reject unrelated native drags", () => {
  assert.deepEqual(
    parseTableRowDragData('{"taskId":7,"sourceSectionId":10}'),
    { taskId: 7, sourceSectionId: 10 }
  );
  assert.equal(parseTableRowDragData("status"), null);
  assert.equal(parseTableRowDragData('{"taskId":"7","sourceSectionId":10}'), null);
});
