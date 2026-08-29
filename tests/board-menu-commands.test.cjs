const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/board-menu-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getAllCommands, getBoardMenuCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")
);

const boardMenuKeys = (appShellRailOn, activeSurface) =>
  getBoardMenuCommands(
    getAllCommands({ context: "Kanban", appShellRailOn }),
    activeSurface
  )[0].commandLists.map((command) => command.key);

test("board menu commands use the curated order", () => {
  assert.deepEqual(boardMenuKeys(true), [
    "boardSettings",
    "sortBoard",
    "ShowFilterHtc",
    "manageColumns",
    "renameColumn",
    "hideColumn",
    "appShellBoard",
    "appShellTable",
    "manageViews",
    "toggleEmptyColumns",
  ]);
});

test("board menu commands skip unavailable entries", () => {
  assert.deepEqual(boardMenuKeys(false), [
    "boardSettings",
    "sortBoard",
    "ShowFilterHtc",
    "manageColumns",
    "renameColumn",
    "hideColumn",
    "manageViews",
    "toggleEmptyColumns",
  ]);
});

// HTPR-3805: on the Table view, table-scoped actions (configure columns,
// sort, filter) lead the menu; board-only column/section actions drop below.
test("table surface leads with table actions, board actions below", () => {
  assert.deepEqual(boardMenuKeys(true, "table"), [
    "configureTableColumns",
    "sortBoard",
    "ShowFilterHtc",
    "boardSettings",
    "manageColumns",
    "renameColumn",
    "hideColumn",
    "appShellBoard",
    "appShellTable",
    "manageViews",
    "toggleEmptyColumns",
  ]);
});
