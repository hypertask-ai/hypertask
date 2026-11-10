const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const selectAllFlag = "htpr-7260-kanban-select-all";
const columnFlag = "htpr-8929-column-select-all";

const returnIfModalOrInputActive = () => {
  const tagName = (document.activeElement?.tagName ?? "").toLowerCase();
  return (
    ["input", "textarea", "textbox", "prosemirror"].includes(tagName) ||
    document.getElementsByClassName("modal show").length > 0
  );
};

function fixture(columnEnabled) {
  let selection;
  let focusedTaskId = null;
  let items = [{ id: 1, sectionId: 10 }, { id: 2, sectionId: 10 }, { id: 3, sectionId: 20 }];
  const ui = mount();
  const load = loader({
    "@/hooks/useFlag": {
      useFlag: key => (key === selectAllFlag) || (key === columnFlag && columnEnabled),
    },
    "@/lib/state": { useSetRecoilState: () => () => {}, useRecoilValue: () => focusedTaskId },
    "@/store": {},
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive },
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
  return { ...ui, input, load, render, get selection() { return selection; },
    focusTask(id) { focusedTaskId = id; render(); },
    setItems(next) { items = next; render(); },
    key(keyCode, modifiers = {}) {
      const event = new window.KeyboardEvent("keydown", { keyCode, bubbles: true, cancelable: true, ...modifiers });
      React.act(() => (document.activeElement ?? document.body).dispatchEvent(event));
      return event;
    },
    hover(sectionId) {
      const column = document.createElement("div");
      column.className = "section-container";
      column.id = `droppable-section-container-${sectionId}`;
      const card = document.createElement("div");
      column.append(card);
      document.body.append(column);
      React.act(() => card.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true })));
      return column;
    },
  };
}

const columnIds = fx => [...fx.selection.selectedIdsArray].sort((left, right) => left - right);

test("Shift+A selects every card in the focused column and leaves other columns alone", () => {
  const fx = fixture(true);
  try {
    fx.focusTask(1);
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, true);
    assert.deepEqual(columnIds(fx), [1, 2]);
    React.act(() => fx.selection.clearSelection());
    fx.focusTask(3);
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, true);
    assert.deepEqual(columnIds(fx), [3]);
  } finally { fx.close(); }
});

test("Shift+A uses the column under the pointer when no card is focused", () => {
  const fx = fixture(true);
  try {
    fx.hover(20);
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, true);
    assert.deepEqual(columnIds(fx), [3]);
    React.act(() => fx.selection.clearSelection());
    fx.hover(10);
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, true);
    assert.deepEqual(columnIds(fx), [1, 2]);
  } finally { fx.close(); }
});

test("Shift+A follows the column under the pointer after a card was selected by hand", () => {
  const fx = fixture(true);
  try {
    React.act(() => fx.selection.toggleTaskSelection(3, 20));
    assert.deepEqual(columnIds(fx), [3]);
    fx.hover(10);
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, true);
    assert.deepEqual(columnIds(fx), [1, 2]);
  } finally { fx.close(); }
});

test("Shift+A with no focused card and no pointer over a column selects nothing", () => {
  const fx = fixture(true);
  try {
    fx.key(65, { shiftKey: true });
    assert.equal(fx.selection.selectedCount, 0);
    assert.deepEqual(fx.selection.selectedIdsArray, []);
  } finally { fx.close(); }
});

test("Shift+A leaves text fields and modals alone", () => {
  const fx = fixture(true);
  try {
    fx.focusTask(1);
    fx.input.focus();
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, false);
    assert.equal(fx.selection.selectedCount, 0);
    document.activeElement.blur();
    const modal = document.createElement("div");
    modal.className = "modal show";
    document.body.append(modal);
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, false);
    assert.equal(fx.selection.selectedCount, 0);
    modal.remove();
  } finally { fx.close(); }
});

test("Ctrl+A still selects the whole board when Shift+A is available", () => {
  const fx = fixture(true);
  try {
    fx.focusTask(1);
    assert.equal(fx.key(65, { ctrlKey: true }).defaultPrevented, true);
    assert.deepEqual(columnIds(fx), [1, 2, 3]);
  } finally { fx.close(); }
});

test("with the column shortcut flag off Shift+A does not intercept the key or change selection", () => {
  const fx = fixture(false);
  try {
    fx.focusTask(1);
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, false);
    assert.equal(fx.selection.selectedCount, 0);
    fx.hover(20);
    assert.equal(fx.key(65, { shiftKey: true }).defaultPrevented, false);
    assert.equal(fx.selection.selectedCount, 0);
  } finally { fx.close(); }
});

test("the Select all in this column command shows Shift+A only when the ticket flag is on", () => {
  const load = loader({});
  const { getBulkTaskCommands } = load("src/components/Modals/commands/HTC/navigationCommands.ts");
  const row = (options) => getBulkTaskCommands({
    context: "Kanban",
    bulkSelectionCount: 2,
    kanbanSelectAllEnabled: true,
    ...options,
  }).commandLists.find((command) => command.key === "bulkSelectAllInColumn");
  assert.deepEqual(row({ columnSelectAllHintEnabled: true }).keyboard, ["SHIFT", "A"]);
  assert.equal(row({}).keyboard, undefined);
});
