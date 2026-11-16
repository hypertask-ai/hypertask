const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const { loadModule, root } = require("./helpers/loadModule.cjs");

const boardFile = "src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx";
const tableFile = "src/components/PageComponents/Kanban/TableView/useTableActions.ts";

function initializer(file, name) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) result = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(result, `${name} exists`);
  return result;
}

function evaluate(expression, bindings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "htpr-9295-"));
  const file = path.join(dir, "handler.tsx");
  try {
    fs.writeFileSync(file, `export default ({ ${Object.keys(bindings).join(", ")} }) => (${expression});`);
    return loadModule(file).default(bindings);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const { getTaskShortcutAction } = loadModule("src/lib/keyboard/taskShortcuts.ts");
const event = () => ({ keyCode: 69, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, defaultPrevented: false, cancelBubble: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; } });

function board(task) {
  const calls = [];
  const handler = evaluate(initializer(boardFile, "eHandler"), {
    task, sectionId: 7, lastgClick: { current: null },
    toast: message => calls.push(["toast", message]),
    archiveNotification: (section, id) => calls.push(["archive", section, id]),
  });
  const element = { contains: () => true };
  const keydown = evaluate(initializer(boardFile, "handleKeyDown"), {
    useCallback: fn => fn, task, handleBulkKeyDown: () => false,
    latestRef: { current: { task, isActive: true, isApple: false, taskRef: { current: element }, showCommands: {}, eHandler: handler } },
    document: { activeElement: element, body: {} },
    getTaskShortcutAction, returnIfModalOrInputActive: () => false,
    KeyCodes: loadModule("src/lib/constants/keyboard-handler.ts").KeyCodes,
    lastgPress: { current: null }, lastgClick: { current: null }, lastM_APress: { current: null },
  });
  return { calls, press: (e = event()) => keydown(e) };
}

function table(task) {
  const calls = [];
  const toast = message => calls.push(["toast", message]);
  toast.error = message => calls.push(["error", message]);
  const actions = loadModule(tableFile, {
    react: { useCallback: fn => fn, useEffect: () => {} },
    "@/hooks/useFlag": { useFlag: () => false },
    "react-hot-toast": { default: toast },
    "@/utils/api/global": { default: { archiveTaskNotification: async (...args) => calls.push(["archive", ...args]) } },
    "@/hooks/Task Detail/useTimeTracking": { toggleTaskTimer() {} },
    "./tableViewShared": { isTaskRow: row => row.type === "task", TASK_SHORTCUT_COMMAND_MODES: {} },
  }).useTableActions({
    rows: [], currentUser: { id: 9 }, _currentProject: { id: 15 },
    updateTaskInCache: (...args) => calls.push(["cache", ...args]),
    updateActiveItemAndItemInView() {}, isApple: false,
    didRestore: { current: true }, selectedIndex: 0,
  });
  return { calls, press: () => actions.runTaskShortcut(event(), { type: "task", task }, 0) };
}

for (const [name, fixture] of [["board", board], ["table", table]]) {
  for (const seen of [false, true]) test(`${name}: E archives ${seen ? "seen after opening" : "unseen"} inbox item without a flag`, async () => {
    const task = { id: 42, projectId: 15, sectionId: 7, _count: { notifications: 1 }, notifications: [{ id: 3, taskId: 42, seen }] };
    const fx = fixture(task);
    fx.press();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(fx.calls.some(call => call[0] === "archive"));
    assert.ok(!fx.calls.some(call => call[1] === "This task is not in inbox"));
    if (name === "table") {
      const update = fx.calls.find(call => call[0] === "cache")[1];
      assert.equal(update._count.notifications, 0);
      assert.deepEqual(update.notifications, []);
    }
  });
  for (const count of [0, undefined]) test(`${name}: E refuses count ${count} without a flag`, async () => {
    const fx = fixture({ id: 42, projectId: 15, sectionId: 7, _count: count === undefined ? undefined : { notifications: count } });
    fx.press();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fx.calls, [["toast", "This task is not in inbox"]]);
  });
}

for (const count of [0, 1]) test(`board E consumes the event before focus moves to another task with ${count} notifications`, async () => {
  const first = board({ id: 42, _count: { notifications: 1 } });
  const next = board({ id: 43, _count: { notifications: count } });
  const key = event();
  await first.press(key);
  await next.press(key);
  assert.equal(key.defaultPrevented, true);
  assert.equal(key.cancelBubble, true);
  assert.deepEqual(first.calls, [["archive", 7, 42]]);
  assert.deepEqual(next.calls, []);
});
