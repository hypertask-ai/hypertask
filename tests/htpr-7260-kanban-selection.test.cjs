const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { loader, mount, React, root } = require("./helpers/htpr-7260-ui.cjs");
const flag = "htpr-7260-kanban-select-all";
const helper = ts.createSourceFile("helpers.ts", fs.readFileSync(path.join(root,
  "src/utils/helperFunctions/helperFunctions.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const guardSource = helper.statements.find(node => ts.isFunctionDeclaration(node) &&
  node.name?.text === "returnIfModalOrInputActive").getText(helper);
const guard = new Function("exports", ts.transpileModule(guardSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText + ";return exports.returnIfModalOrInputActive;")({});

function fixture(enabled) {
  let selection;
  let focusedTaskId = null;
  let items = [{ id: 1, sectionId: 10 }, { id: 2, sectionId: 10 }, { id: 3, sectionId: 20 }];
  const ui = mount();
  const load = loader({
    "@/hooks/useFlag": { useFlag: key => key === flag && enabled },
    "@/lib/state": { useSetRecoilState: () => () => {}, useRecoilValue: () => focusedTaskId },
    "@/store": {},
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: guard },
  });
  const { KanbanBulkSelectionProvider: Provider, useKanbanBulkSelection } =
    load("src/lib/contexts/Kanban/BulkSelectionContext.tsx");
  const noop = async () => {};
  function Probe() {
    selection = useKanbanBulkSelection();
    return null;
  }
  function render() {
    ui.render(React.createElement(Provider, { items, onArchiveTask: noop, onArchiveUndo: noop,
      onMoveTask: noop, onAssignTask: noop, onLabelTask: noop }, React.createElement(Probe)));
  }
  render();
  const input = document.createElement("input");
  document.body.append(input);
  return { ...ui, input, render, get selection() { return selection; },
    focusTask(id) { focusedTaskId = id; render(); },
    setItems(next) { items = next; render(); },
    key(keyCode, modifiers = {}) {
      const event = new window.KeyboardEvent("keydown", { keyCode, bubbles: true, cancelable: true, ...modifiers });
      React.act(() => document.activeElement.dispatchEvent(event));
      return event;
    },
  };
}

test("selectAll uses only visible cards, selectColumn replaces selection with one section, Escape clears", () => {
  const fx = fixture(true);
  try {
    React.act(() => fx.selection.selectAll());
    assert.deepEqual(fx.selection.selectedIdsArray, [1, 2, 3]);
    React.act(() => fx.selection.selectColumn());
    assert.deepEqual(fx.selection.selectedIdsArray, [3]);
    React.act(() => fx.selection.selectColumn(10));
    assert.deepEqual(fx.selection.selectedIdsArray, [1, 2]);
    React.act(() => fx.selection.selectColumn(20));
    assert.deepEqual(fx.selection.selectedIdsArray, [3]);
    fx.setItems([{ id: 2, sectionId: 10 }]);
    React.act(() => fx.selection.selectAll());
    assert.deepEqual(fx.selection.selectedIdsArray, [2]);
    assert.equal(fx.key(27).defaultPrevented, true);
    assert.deepEqual(fx.selection.selectedIdsArray, []);
  } finally { fx.close(); }
});

test("column command uses the most recent selected or focused card, including a range selection", () => {
  const fx = fixture(true);
  try {
    React.act(() => fx.selection.toggleTaskSelection(3, 20));
    React.act(() => fx.selection.selectColumn());
    assert.deepEqual(fx.selection.selectedIdsArray, [3]);
    fx.focusTask(1);
    React.act(() => fx.selection.selectColumn());
    assert.deepEqual(fx.selection.selectedIdsArray, [1, 2]);
    React.act(() => fx.selection.toggleTaskSelection(3, 20, true));
    React.act(() => fx.selection.selectColumn());
    assert.deepEqual(fx.selection.selectedIdsArray, [3]);
  } finally { fx.close(); }
});

test("Ctrl+A and Cmd+A prevent browser selection and select across sections without an existing selection", () => {
  const fx = fixture(true);
  try {
    assert.equal(fx.key(65, { ctrlKey: true }).defaultPrevented, true);
    assert.deepEqual(fx.selection.selectedIdsArray, [1, 2, 3]);
    React.act(() => fx.selection.clearSelection());
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    assert.equal(fx.key(65, { metaKey: true }).defaultPrevented, true);
    assert.deepEqual(fx.selection.selectedIdsArray, [1, 2, 3]);
  } finally { fx.close(); }
});

test("Ctrl+A leaves input selection and modal focus alone", () => {
  const fx = fixture(true);
  try {
    fx.input.focus();
    assert.equal(fx.key(65, { ctrlKey: true }).defaultPrevented, false);
    assert.equal(fx.selection.selectedCount, 0);
    document.activeElement.blur();
    const modal = document.createElement("div");
    modal.className = "modal show";
    document.body.append(modal);
    assert.equal(fx.key(65, { ctrlKey: true }).defaultPrevented, false);
    assert.equal(fx.selection.selectedCount, 0);
    modal.remove();
    assert.equal(fx.key(65, { ctrlKey: true }).defaultPrevented, true);
    assert.equal(fx.selection.selectedCount, 3);
  } finally { fx.close(); }
});

test("flag off still allows browser Ctrl+A without changing selection or adding selection methods' behavior", () => {
  const fx = fixture(false);
  try {
    React.act(() => fx.selection.toggleTaskSelection(1, 10));
    assert.equal(fx.key(65, { ctrlKey: true }).defaultPrevented, false);
    assert.deepEqual(fx.selection.selectedIdsArray, [1]);
    React.act(() => { fx.selection.selectAll(); fx.selection.selectColumn(20); });
    assert.deepEqual(fx.selection.selectedIdsArray, [1]);
  } finally { fx.close(); }
});

for (const enabled of [false, true]) test(`Ctrl+A ${enabled ? "does not reach competing board shortcuts" : "still reaches existing shortcuts with flag off"}`, () => {
  const fx = fixture(enabled);
  let competingCalls = 0;
  const competingShortcut = event => {
    if (event.keyCode === 65 && event.ctrlKey) competingCalls++;
  };
  document.addEventListener("keydown", competingShortcut);
  try {
    fx.key(65, { ctrlKey: true });
    assert.equal(competingCalls, enabled ? 0 : 1);
    assert.equal(fx.selection.selectedCount, enabled ? 3 : 0);
  } finally {
    document.removeEventListener("keydown", competingShortcut);
    fx.close();
  }
});
