const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const cardFile = "src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx";
const bulkFile = "src/lib/contexts/Kanban/BulkSelectionContext.tsx";
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") } });
const { KeyCodes } = jiti(path.join(root, "src/lib/constants/keyboard-handler.ts"));
const { getTaskShortcutAction } = jiti(path.join(root, "src/lib/keyboard/taskShortcuts.ts"));

// Execute the real handlers; stub only hooks and their external action boundaries.
function load(file, names, env) {
  const text = file === cardFile && process.env.BULK_KEYBOARD_CARD_SOURCE
    ? fs.readFileSync(process.env.BULK_KEYBOARD_CARD_SOURCE, "utf8")
    : fs.readFileSync(path.join(root, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source))) {
      declarations.set(node.name.getText(source), `const ${node.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(declarations.size, names.length, "all production handlers exist");
  const compiled = ts.transpileModule(names.map(name => declarations.get(name)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), `${compiled}\nreturn {${names.join(",")}};`)(...Object.values(env));
}

function fixture({ selected = true, rowShortcutsEnabled = true, isApple = false } = {}) {
  const dom = new JSDOM('<body><div id="task-1" tabindex="0"></div><div id="task-2" tabindex="0"></div><div id="task-3" tabindex="0"></div><button id="actions">Actions</button></body>');
  const { document, KeyboardEvent } = dom.window;
  const cards = [1, 2, 3].map(id => document.getElementById(`task-${id}`));
  const tasks = [1, 2, 3].map(id => ({ id, section: "To do", sectionId: 1 }));
  const archives = [], bulkCommands = [], singleActions = [], pending = [];
  let documentDispatches = 0;
  const selectedTasks = selected ? tasks.slice(0, 2) : [];
  const env = {
    useCallback: fn => fn, KeyCodes, document, navigator: { platform: isApple ? "MacIntel" : "Linux" },
    returnIfModalOrInputActive: () => false, selectedTasks, items: tasks,
    CommandMode: { OpenAssignModal: "assign", LabelModal: "label", MoveToColumn: "move" },
    clearSelection() {}, toggleTaskSelection() {},
    openBulkCommand: mode => { bulkCommands.push(mode); cards[2].focus(); },
    bulkArchiveUndoAll: false, isProcessing: false,
    setIsProcessing() {}, setSelectedIds() {}, setFailedIds() {},
    toast: { success() {}, error() {} }, undoToastSettings: { single: false },
    onArchiveTask: task => { archives.push(task.id); cards[2].focus(); }, onArchiveUndo() {},
  };
  Object.assign(env, load(bulkFile, ["runTaskOperation", "archiveSelected"], env));
  const archiveSelected = env.archiveSelected;
  env.archiveSelected = () => { const promise = archiveSelected(); pending.push(promise); return promise; };
  Object.assign(env, load(bulkFile, ["handleBulkKeyDown"], env));
  const handlers = cards.map((card, index) => {
    const taskRef = { current: card };
    const latestRef = { current: {
      task: tasks[index], taskRef, isActive: true, isApple,
      showCommands: { show: false },
      markAsDone: (_section, id) => archives.push(id),
      setShowAssignModal: () => singleActions.push("assign"),
      setShowCommands: ({ mode }) => singleActions.push(mode),
      toggleDeleteModal: () => singleActions.push("delete"),
      updateActiveItemAndItemInView() {},
    } };
    const cardEnv = {
      ...env, task: tasks[index], taskRef, latestRef, rowShortcutsEnabled, getTaskShortcutAction,
      lastgPress: { current: null }, lastM_APress: { current: null },
      shouldRunArchiveShortcut: event => !event.repeat,
      matchesShortcut: () => false, keyboard_shortcuts: { dueDateModal: { default: "d" } },
    };
    Object.assign(cardEnv, load(cardFile, ["handleKeyDown"], cardEnv));
    const run = event => { const promise = cardEnv.handleKeyDown(event); pending.push(promise); return promise; };
    const { onDocumentKeyDown } = load(cardFile, ["onDocumentKeyDown"], { ...cardEnv, handleKeyDown: run });
    card.addEventListener("keydown", run);
    document.addEventListener("keydown", event => {
      if (document.activeElement !== card) return;
      documentDispatches++;
      onDocumentKeyDown(event);
    });
    return run;
  });
  // Provider document dispatch can consume an event before a card's listener on
  // the same node; stopPropagation alone cannot prevent that second listener.
  const { onDocumentKeyDown: bulkDocumentHandler } = load(bulkFile, ["onDocumentKeyDown"], env);
  const send = async (keyCode, modifiers = {}, target = cards[1]) => {
    target.focus();
    const event = new KeyboardEvent("keydown", { keyCode, bubbles: true, cancelable: true, ...modifiers });
    target.dispatchEvent(event);
    await Promise.all(pending);
    return event;
  };
  return { dom, cards, document, KeyboardEvent, archives, bulkCommands, singleActions, handlers,
    bulkDocumentHandler, send, documentDispatches: () => documentDispatches };
}

for (const rowShortcutsEnabled of [false, true]) {
  for (const isApple of [false, true]) {
    const mode = `${rowShortcutsEnabled ? "row" : "legacy"}/${isApple ? "Cmd" : "Ctrl"}`;
    test(`two selected, focused card: ${mode}+E archives only the selection`, async () => {
      const f = fixture({ rowShortcutsEnabled, isApple });
      try {
        const event = await f.send(KeyCodes.E, isApple ? { metaKey: true } : { ctrlKey: true });
        assert.deepEqual(f.archives.sort(), [1, 2], "only selected tickets may archive; unselected ticket 3 must stay Normal");
        assert.equal(event.defaultPrevented, true);
        assert.equal(f.documentDispatches(), 0, "consumed bulk event must not be forwarded after focus advances");
      } finally { f.dom.window.close(); }
    });
    test(`no selection: ${mode}+E still archives the focused card`, async () => {
      const f = fixture({ selected: false, rowShortcutsEnabled, isApple });
      try {
        await f.send(KeyCodes.E, isApple ? { metaKey: true } : { ctrlKey: true });
        assert.deepEqual(f.archives, [2]);
      } finally { f.dom.window.close(); }
    });
  }
  for (const [keyCode, action] of [[65, "assign"], [77, "move"], [84, "label"]]) {
    test(`bulk ${action} consumes the event without a single-card fallback (row=${rowShortcutsEnabled})`, async () => {
      const f = fixture({ rowShortcutsEnabled });
      try {
        await f.send(keyCode);
        assert.deepEqual(f.bulkCommands, [action]);
        assert.deepEqual(f.singleActions, []);
        assert.equal(f.documentDispatches(), 0);
      } finally { f.dom.window.close(); }
    });
  }
}

test("already consumed document event cannot fall through to single-card archive", async () => {
  const f = fixture();
  try {
    f.cards[2].focus();
    const event = new f.KeyboardEvent("keydown", { keyCode: KeyCodes.E, ctrlKey: true, cancelable: true });
    f.bulkDocumentHandler(event);
    await f.handlers[2](event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(f.archives.sort(), [1, 2]);
  } finally { f.dom.window.close(); }
});

test("held bulk archive does not archive either selection or next card", async () => {
  const f = fixture();
  try {
    await f.send(KeyCodes.E, { ctrlKey: true, repeat: true });
    assert.deepEqual(f.archives, []);
    assert.equal(f.documentDispatches(), 0);
  } finally { f.dom.window.close(); }
});

test("delete remains the existing single-card action; it has no bulk handler", async () => {
  const f = fixture();
  try {
    await f.send(KeyCodes.THREE, { shiftKey: true });
    assert.deepEqual(f.singleActions, ["delete"]);
    assert.deepEqual(f.archives, []);
  } finally { f.dom.window.close(); }
});
