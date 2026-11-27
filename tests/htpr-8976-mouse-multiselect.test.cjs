const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-8976-mouse-multiselect";
const borderOnlyKey = "htpr-8960-border-only-select";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`);
const empty = () => null;

function cardHarness(enabled) {
  const Card = loader({
    "@/hooks/useFlag": { useFlag: key => key === borderOnlyKey || (key === flagKey && enabled) },
    "@/lib/flags/keys": { HTPR_7614_SELECTED_CARD_BORDER_FLAG: "htpr-7614-selected-card-border" },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/state": { useRecoilState: () => [null, empty] },
    "@/store": {},
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveStalenessFromProject: () => false },
    "@/utils/undoActions/helperFuncs": { cn: (...args) => args.flat().filter(Boolean).join(" ") },
    "next/link": { default: ({ prefetch, ...props }) => React.createElement("a", props) },
    "./CardSubTasks": { default: empty },
    "./TaskTagsRow": { default: empty },
    "./TaskTopRow": { default: empty },
  })("src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx").default;
  const app = mount();
  const calls = { opened: 0, selected: [] };
  let defaultPrevented = null;
  app.container.addEventListener("click", event => {
    defaultPrevented = event.defaultPrevented;
    event.preventDefault();
  });
  app.render(React.createElement(Card, {
    task: { id: 42, projectId: 15, uniqueIndex: 42, ticketNumber: "HTPR-42", title: "Example card" },
    currentSetting: "Flattened", assignedUsers: [], agentAssignees: [], active: false, hover: false, hasDraft: false,
    openDetail: () => calls.opened++,
    onSelectionClick: (id, event) => calls.selected.push([id, Boolean(event?.shiftKey)]),
  }));
  return {
    calls,
    get defaultPrevented() { return defaultPrevented; },
    click(init = {}) {
      defaultPrevented = null;
      const link = app.container.querySelector("a[href='/detail/project-15/42']");
      React.act(() => link.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })));
    },
    close: () => app.close(),
  };
}

function boardHarness(enabled) {
  let selection;
  const items = [
    { id: 1, sectionId: 10 }, { id: 2, sectionId: 10 },
    { id: 3, sectionId: 20 }, { id: 4, sectionId: 20 },
    { id: 5, sectionId: 30 },
  ];
  const ui = mount();
  const { KanbanBulkSelectionProvider: Provider, useKanbanBulkSelection } = loader({
    "@/hooks/useFlag": { useFlag: key => key === flagKey && enabled },
    "@/lib/state": { useSetRecoilState: () => () => {}, useRecoilValue: () => null },
    "@/store": {},
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
  })("src/lib/contexts/Kanban/BulkSelectionContext.tsx");
  const noop = async () => {};
  function Probe() {
    selection = useKanbanBulkSelection();
    return React.createElement("div", { id: "sectionsContainer" },
      React.createElement("div", { className: "kanban-task-card" }, "card"),
      React.createElement("div", { id: "column-gap" }, "empty space"));
  }
  ui.render(React.createElement(Provider, { items, onArchiveTask: noop, onArchiveUndo: noop,
    onMoveTask: noop, onAssignTask: noop, onLabelTask: noop }, React.createElement(Probe)));
  return {
    get ids() { return selection.selectedIdsArray; },
    toggle: (id, range = false) => React.act(() => selection.toggleTaskSelection(id, undefined, range)),
    click(selector) {
      React.act(() => document.querySelector(selector).dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    },
    escape() {
      const event = new window.KeyboardEvent("keydown", { keyCode: 27, bubbles: true, cancelable: true });
      let handled = false;
      React.act(() => { handled = selection.handleBulkKeyDown(event); });
      return handled;
    },
    close: () => ui.close(),
  };
}

test("the flag is an improvement that ships to everyone", () => {
  assert.equal(flag.default.key, flagKey);
  assert.equal(flag.default.kind, "improvement");
  assert.equal(flag.default.defaultMode, "EVERYONE");
});

test("flag on: Ctrl+click and Cmd+click select the card instead of opening a new tab", () => {
  const h = cardHarness(true);
  try {
    h.click({ ctrlKey: true });
    assert.equal(h.defaultPrevented, true);
    h.click({ metaKey: true });
    assert.equal(h.defaultPrevented, true);
    assert.deepEqual(h.calls.selected, [[42, false], [42, false]]);
    assert.equal(h.calls.opened, 0);
    h.click({ ctrlKey: true, shiftKey: true });
    assert.deepEqual(h.calls.selected.at(-1), [42, true]);
  } finally { h.close(); }
});

test("flag on: plain click still opens the card", () => {
  const h = cardHarness(true);
  try {
    h.click({});
    assert.equal(h.calls.opened, 1);
    assert.deepEqual(h.calls.selected, []);
  } finally { h.close(); }
});

test("flag on: middle click keeps the native link", () => {
  const h = cardHarness(true);
  try {
    h.click({ button: 1 });
    assert.equal(h.defaultPrevented, false);
    assert.deepEqual(h.calls.selected, []);
    assert.equal(h.calls.opened, 0);
  } finally { h.close(); }
});

test("flag off: Ctrl+click and Cmd+click keep opening a new tab", () => {
  const h = cardHarness(false);
  try {
    h.click({ ctrlKey: true });
    assert.equal(h.defaultPrevented, false);
    h.click({ metaKey: true });
    assert.equal(h.defaultPrevented, false);
    assert.deepEqual(h.calls.selected, []);
  } finally { h.close(); }
});

test("flag on: Shift+click selects every card from the anchor across columns in board order", () => {
  const b = boardHarness(true);
  try {
    b.toggle(2);
    b.toggle(4, true);
    assert.deepEqual(b.ids, [2, 3, 4]);
    b.toggle(5, true);
    assert.deepEqual(b.ids, [2, 3, 4, 5]);
  } finally { b.close(); }
});

test("flag on: Ctrl+click toggles one card and the last toggled card anchors the next range", () => {
  const b = boardHarness(true);
  try {
    b.toggle(1);
    b.toggle(5);
    assert.deepEqual(b.ids, [1, 5]);
    b.toggle(1);
    assert.deepEqual(b.ids, [5]);
    b.toggle(3, true);
    assert.deepEqual(b.ids, [5, 1, 2, 3]);
  } finally { b.close(); }
});

test("Shift+click with no anchor selects one card", () => {
  const b = boardHarness(true);
  try {
    b.toggle(3, true);
    assert.deepEqual(b.ids, [3]);
  } finally { b.close(); }
});

test("flag off: Shift+click across columns selects one card only", () => {
  const b = boardHarness(false);
  try {
    b.toggle(2);
    b.toggle(4, true);
    assert.deepEqual(b.ids, [2, 4]);
  } finally { b.close(); }
});

test("Esc clears the selection", () => {
  const b = boardHarness(true);
  try {
    b.toggle(1);
    b.toggle(3);
    assert.equal(b.escape(), true);
    assert.deepEqual(b.ids, []);
  } finally { b.close(); }
});

test("flag on: a click on empty board space clears the selection, a card click does not", () => {
  const b = boardHarness(true);
  try {
    b.toggle(1);
    b.toggle(3);
    b.click(".kanban-task-card");
    assert.deepEqual(b.ids, [1, 3]);
    b.click("#column-gap");
    assert.deepEqual(b.ids, []);
  } finally { b.close(); }
});

test("flag off: a click on empty board space keeps the selection", () => {
  const b = boardHarness(false);
  try {
    b.toggle(1);
    b.click("#column-gap");
    assert.deepEqual(b.ids, [1]);
  } finally { b.close(); }
});

function barHarness({ enabled = true, mobile = false } = {}) {
  const ui = mount();
  let count = 0;
  const load = loader({
    "@/hooks/useFlag": { useFlag: key => key === flagKey && enabled },
    "@/lib/contexts/Kanban/BulkSelectionContext": { useKanbanBulkSelection: () => ({
      selectedCount: count, failedIds: new Set(), isProcessing: false,
      archiveSelected: async () => {}, openBulkCommand: () => {}, clearSelection: () => {},
    }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
  });
  const Bar = load("src/components/PageComponents/Kanban/KanbanHomepageComponents/KanbanBulkActionBar.tsx").default;
  const select = (next) => {
    count = next;
    ui.render(React.createElement(Bar));
  };
  return {
    select,
    text: () => ui.container.textContent,
    close: () => ui.close(),
  };
}

const hintPattern = /Ctrl\+click or Shift\+click for more/;

test("flag on: the selection bar shows the mouse hint once", () => {
  const b = barHarness();
  try {
    b.select(1);
    assert.match(b.text(), hintPattern);
    b.select(0);
    b.select(1);
    assert.doesNotMatch(b.text(), hintPattern);
  } finally { b.close(); }
});

test("flag off: the selection bar shows no mouse hint", () => {
  const b = barHarness({ enabled: false });
  try {
    b.select(1);
    assert.doesNotMatch(b.text(), hintPattern);
  } finally { b.close(); }
});

test("flag on and phone layout: the selection bar shows no mouse hint", () => {
  const b = barHarness({ mobile: true });
  try {
    b.select(1);
    assert.doesNotMatch(b.text(), hintPattern);
  } finally { b.close(); }
});
