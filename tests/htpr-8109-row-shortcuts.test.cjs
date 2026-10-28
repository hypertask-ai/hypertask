const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });
const { getTaskShortcutAction } = jiti(path.join(root, "src/lib/keyboard/taskShortcuts.ts"));
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const shared = ts.createSourceFile("shared.tsx", fs.readFileSync(path.join(root, "src/components/PageComponents/Kanban/TableView/tableViewShared.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const sharedDeclarations = [];
function collect(node) {
  if (ts.isVariableDeclaration(node) && ["TASK_SHORTCUT_COMMAND_MODES", "isTaskRow"].includes(node.name.getText(shared))) sharedDeclarations.push(`const ${node.getText(shared)};`);
  ts.forEachChild(node, collect);
}
collect(shared);
assert.equal(sharedDeclarations.length, 2);
const sharedCode = ts.transpileModule(sharedDeclarations.join("\n"), {}).outputText;
const { TASK_SHORTCUT_COMMAND_MODES, isTaskRow } = new Function("CommandMode", `${sharedCode}\nreturn { TASK_SHORTCUT_COMMAND_MODES, isTaskRow };`)(CommandMode);
const file = "src/components/PageComponents/Kanban/TableView/useTableActions.ts";
const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
let declaration;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "runTaskShortcut") declaration = node;
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(declaration);
const compiled = ts.transpileModule(`const ${declaration.getText(source)};`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const calls = [];
  const env = {
    useCallback: (fn) => fn,
    myTasksSnoozeEnabled: false,
    isApple: false,
    isTaskRow,
    getTaskShortcutAction,
    TASK_SHORTCUT_COMMAND_MODES,
    updateActiveItemAndItemInView: (task) => calls.push(["active", task.id]),
    setShowCommands: ({ mode }) => calls.push(["command", mode]),
    setAssignTask: (task) => calls.push(["assign", task.id]),
    archiveTaskFromTable: (task) => calls.push(["archive", task.id]),
    archiveNotificationFromTable: (task) => calls.push(["notifications", task.id]),
    starTaskFromTable: (task) => calls.push(["star", task.id]),
    openTask: (task, index) => calls.push(["open", task.id, index]),
    shouldRunArchiveShortcut: () => true,
  };
  const run = new Function(...Object.keys(env), `${compiled}\nreturn runTaskShortcut;`)(...Object.values(env));
  return { calls, run };
}
const row = { type: "task", task: { id: 42, projectId: 7049 } };
const event = (keyCode, modifiers = {}) => ({
  keyCode, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  preventDefault() {}, ...modifiers,
});

for (const [keyCode, modifiers, expected] of [
  [51, { shiftKey: true }, ["command", CommandMode.DeleteTask]],
  [83, { ctrlKey: true }, ["command", CommandMode.ShareTaskPublic]],
  [80, {}, ["command", CommandMode.PriorityModal]],
  [83, {}, ["command", CommandMode.EstimateModal]],
  [68, {}, ["command", CommandMode.SetDueDate]],
  [84, {}, ["command", CommandMode.LabelModal]],
  [77, {}, ["command", CommandMode.MoveToColumn]],
  [77, { shiftKey: true }, ["command", CommandMode.MoveTaskToBoard]],
  [113, {}, ["command", CommandMode.RenameTask]],
  [65, {}, ["assign", 42]],
  [69, { ctrlKey: true }, ["archive", 42]],
  [69, {}, ["notifications", 42]],
  [83, { altKey: true }, ["star", 42]],
  [13, {}, ["open", 42, 3]],
]) {
  test(`table dispatches ${expected[0]} ${expected[1]} without flag state`, () => {
    const f = fixture();
    assert.equal(f.run(event(keyCode, modifiers), row, 3), true);
    assert.deepEqual(f.calls, [["active", 42], expected]);
  });
}

test("held, modified, missing-row and section-row keys perform no task action", () => {
  const f = fixture();
  assert.equal(f.run(event(69, { ctrlKey: true, repeat: true }), row, 0), false);
  assert.equal(f.run(event(80, { altKey: true }), row, 0), false);
  assert.equal(f.run(event(80), undefined, 0), false);
  assert.equal(f.run(event(80), { type: "section" }, 0), false);
  assert.deepEqual(f.calls, []);
});

test("X selects the row without dispatching another action", () => {
  const f = fixture();
  assert.equal(f.run(event(88), row, 0), true);
  assert.deepEqual(f.calls, [["active", 42]]);
});
