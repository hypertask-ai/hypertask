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
  let navigated = null;
  app.container.addEventListener("click", event => {
    navigated = !event.defaultPrevented;
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
    get navigated() { return navigated; },
    click(init = {}) {
      navigated = null;
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
      React.act(() => document.body.dispatchEvent(event));
    },
    close: () => ui.close(),
  };
}

test("flag ships as a behaviour improvement on for everyone", () => {
  assert.equal(flag.default.key, flagKey);
  assert.equal(flag.default.kind, "improvement");
  assert.equal(flag.default.defaultMode, "EVERYONE");
});

test("flag on: Ctrl+click and Cmd+click select the card instead of opening a new tab", () => {
  const h = cardHarness(true);
  try {
    h.click({ ctrlKey: true });
    assert.equal(h.navigated, false);
    h.click({ metaKey: true });
    assert.equal(h.navigated, false);
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

test("flag off: Ctrl+click and Cmd+click keep opening a new tab", () => {
  const h = cardHarness(false);
  try {
    h.click({ ctrlKey: true });
    assert.equal(h.navigated, true);
    h.click({ metaKey: true });
    assert.equal(h.navigated, true);
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

test("Shift+click with no anchor toggles one card", () => {
  const b = boardHarness(true);
  try {
    b.toggle(3, true);
    assert.deepEqual(b.ids, [3]);
  } finally { b.close(); }
});

test("flag off: Shift+click across columns toggles one card only", () => {
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
    b.escape();
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
