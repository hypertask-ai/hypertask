const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const { loadModule, root } = require("./helpers/loadModule.cjs");

const boardFile = "src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx";
const homepageFile = "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx";
const tableFile = "src/components/PageComponents/Kanban/TableView/useTableActions.ts";
const flagKey = "htpr-8625-board-inbox-archive";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "htpr-8625-"));
  const file = path.join(dir, "handler.tsx");
  try {
    fs.writeFileSync(file, `export default ({ ${Object.keys(bindings).join(", ")} }) => (${expression});`);
    return loadModule(file).default(bindings);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const { getTaskShortcutAction } = loadModule("src/lib/keyboard/taskShortcuts.ts");
const event = () => ({ keyCode: 69, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, preventDefault() {} });

function board(enabled, task) {
  const calls = [];
  const handler = evaluate(initializer(boardFile, "eHandler"), {
    boardInboxArchive: enabled, task, sectionId: 7, lastgClick: { current: null },
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
  return { calls, press: () => keydown(event()) };
}

function table(enabled, task) {
  const calls = [];
  const toast = message => calls.push(["toast", message]);
  toast.error = message => calls.push(["error", message]);
  const actions = loadModule(tableFile, {
    react: { useCallback: fn => fn, useEffect: () => {} },
    "@/hooks/useFlag": { useFlag: key => key === flagKey && enabled },
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

test("flag is a reversible Everyone bugfix", () => {
  const flag = loadModule("src/lib/flags/definitions/htpr-8625-board-inbox-archive.ts").default;
  assert.equal(flag.key, flagKey);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
});

for (const [name, fixture] of [["board", board], ["table", table]]) {
  for (const seen of [false, true]) test(`${name}: E archives ${seen ? "seen after opening" : "unseen"} inbox item`, async () => {
    const task = { id: 42, projectId: 15, sectionId: 7, _count: { notifications: 1 }, notifications: [{ id: 3, taskId: 42, seen }] };
    const fx = fixture(true, task);
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
  for (const count of [0, undefined]) test(`${name}: E refuses count ${count}`, async () => {
    const fx = fixture(true, { id: 42, projectId: 15, sectionId: 7, _count: count === undefined ? undefined : { notifications: count } });
    fx.press();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fx.calls, [["toast", "This task is not in inbox"]]);
  });
  for (const count of [1, 0, undefined]) test(`${name}: flag off retains legacy behavior for ${count}`, async () => {
    const fx = fixture(false, { id: 42, projectId: 15, sectionId: 7, _count: count === undefined ? undefined : { notifications: count } });
    fx.press();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fx.calls.some(call => call[0] === "archive"), count === undefined);
    assert.equal(fx.calls.some(call => call[1] === "This task is not in inbox"), count !== undefined);
  });
}

test("board archive clears cached badge and notifications", async () => {
  const task = { id: 42, totalComments: 2, notifications: [{ id: 3, taskId: 42 }] };
  let updated;
  const archive = evaluate(initializer(homepageFile, "archiveNotification"), {
    useCallback: fn => fn, store: { get: () => null }, activeItemAtom: {},
    document: { getElementById: () => null }, toast() {}, undoInboxArchive() {},
    latestRef: { current: { displaySections: [], sections: [{ sectionId: 7, items: [task] }], _currentProject: { id: 15 },
      getProjectIdxAndAllData: async () => ({ allData: { updatedProjects: [] }, projectToUpdateIndex: 0 }),
      mutationHandler: (_index, sections) => { updated = sections; } } },
  });
  await archive(7, 42);
  assert.equal(updated[0].items[0]._count.notifications, 0);
  assert.deepEqual(updated[0].items[0].notifications, []);
});
