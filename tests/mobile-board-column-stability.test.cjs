const assert = require("node:assert/strict");
const { readFileSync } = require("./refactored-module-source.cjs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("adding a column updates the board cache without refetching it", () => {
  const source = read("src/components/commands.tsx");
  const createStart = source.indexOf("const createColumn = async");
  const createColumn = source.slice(
    createStart,
    source.indexOf("const updateBoard = async", createStart),
  );

  assert.ok(createStart >= 0, "add-column handler is present");
  assert.match(createColumn, /updateProjectView\(/);
  assert.doesNotMatch(createColumn, /(?:refetch|invalidate)Queries/);
});

test("tapping a column title opens Manage columns without publishing board data", () => {
  const source = read(
    "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
  );
  const titleStart = source.indexOf("const TitleAndTasks =");
  const titleAndTasks = source.slice(
    titleStart,
    source.indexOf("const DragoverOverlay =", titleStart),
  );

  assert.ok(titleStart >= 0, "column title component is present");
  assert.match(
    titleAndTasks,
    /setShowCommands\(\{ show: true, mode: CommandMode\.ManageColumn \}\)/,
  );
  assert.doesNotMatch(titleAndTasks, /(?:refetch|invalidate|setQueryData)/);
});
