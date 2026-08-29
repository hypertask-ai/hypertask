const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
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

test("renaming a column does not refetch and unmount the active board", () => {
  const source = read("src/components/Modals/commands/manageColumn.tsx");
  const renameUpdateStart = source.indexOf(
    'if (saveMode === "RENAME" && currentProject)',
  );
  const renameUpdate = source.slice(
    renameUpdateStart,
    source.indexOf("} catch (error)", renameUpdateStart),
  );

  assert.ok(renameUpdateStart >= 0, "rename cache update is present");
  assert.match(renameUpdate, /setCurrentProject\(updateProject\(currentProject\)\)/);
  assert.match(renameUpdate, /setQueryData<IProjectsAll>\(\["projectsAll"\]/);
  assert.doesNotMatch(
    renameUpdate,
    /invalidateQueries\(\{ queryKey: \["projectsAll"\] \}\)/,
  );
});
