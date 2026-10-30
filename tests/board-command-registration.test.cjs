const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { boardCommands } = jiti(path.join(root, "src/components/Modals/commands/HTC/domains/boardCommands.ts"));
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const options = {
  projects: [{ id: 1, title: "Current" }, { id: 2, title: "Next" }],
  currentProject: { id: 1 },
  onMyTasks: false,
  myTasksViewsEnabled: false,
  myTasksFilterParityEnabled: false,
  myTasksScopesEnabled: false,
  columnArchiveEnabled: false,
};

test("command modes are defined", () => {
  assert.notEqual(CommandMode.GoToBoard, undefined);
  assert.notEqual(CommandMode.ArchiveColumn, undefined);
});

test("board navigation excludes the current board and preserves its command", () => {
  assert.deepEqual(boardCommands(options), [{
    key: "gotoBoard-2", name: "Go to board: Next", payload: "2",
    commandMode: CommandMode.GoToBoard, keywords: "Next board project go open switch",
  }]);
});

test("board navigation limits results after excluding the current board", () => {
  const projects = Array.from({ length: 53 }, (_, id) => ({ id, title: `Board ${id}` }));
  const commands = boardCommands({ ...options, projects, currentProject: projects[0] });
  assert.equal(commands.length, 50);
  assert.equal(commands[0].key, "gotoBoard-1");
  assert.equal(commands[49].key, "gotoBoard-50");
});

test("my tasks and archive registrations keep their order and gates", () => {
  const active = { ...options, onMyTasks: true, myTasksViewsEnabled: true,
    myTasksFilterParityEnabled: true, myTasksScopesEnabled: true,
    columnArchiveEnabled: true, context: "Kanban" };
  assert.deepEqual(boardCommands(active).map(c => c.key), ["myTasksScope", "gotoBoard-2", "archiveColumn", "myTasksInvolvement", "myTasksSort", "myTasksGroup"]);
  assert.deepEqual(boardCommands({ ...active, myTasksFilterParityEnabled: false, myTasksScopesEnabled: false, context: "Others" }).map(c => c.key), ["gotoBoard-2", "myTasksSort", "myTasksGroup"]);
  assert.equal(boardCommands({ ...active, currentProject: null }).some(c => c.key === "archiveColumn"), false);
});

test("archive is available in task context only when enabled", () => {
  const active = { ...options, columnArchiveEnabled: true, context: "Task" };
  assert.equal(boardCommands(active).at(-1).key, "archiveColumn");
  assert.equal(boardCommands({ ...active, columnArchiveEnabled: false }).some(c => c.key === "archiveColumn"), false);
});

test("missing project lists do not create navigation commands", () => {
  assert.deepEqual(boardCommands({ ...options, projects: null }), []);
});
