const test = require("node:test");
const assert = require("node:assert/strict");
const { clsx } = require("clsx");
const { twMerge } = require("tailwind-merge");
const { DragDropContext, Draggable, Droppable } = require("@hello-pangea/dnd");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const flag = "htpr-7263-phone-hold-select";
const selectAllFlag = "htpr-7260-kanban-select-all";
const noop = () => {};
const empty = () => null;

function fixture(t, { enabled = true, mobile = true, selectAll = true, overview = false } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const ui = mount();
  const MobileViewContext = React.createContext(mobile);
  const calls = [];
  const opened = [];
  const items = [
    { id: 1, sectionId: 10, projectId: 15, uniqueIndex: 1, title: "First" },
    { id: 2, sectionId: 20, projectId: 15, uniqueIndex: 2, title: "Second" },
  ];
  let selection;
  let currentMobile = mobile;
  let currentEnabled = enabled;
  const load = loader({
    "@/hooks/useFlag": { useFlag: key => key === flag ? currentEnabled : key === selectAllFlag && selectAll },
    "@/lib/flags/keys": { HTPR_7260_KANBAN_SELECT_ALL_FLAG: selectAllFlag },
    "@/lib/state": { useSetRecoilState: () => noop, useRecoilValue: () => null },
    "@/store": {},
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => twMerge(clsx(values)) },
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveStalenessFromProject: () => false },
    "@/components/PageComponents/MyTasks/MyTasksBulkActionBar": { BulkActionButtons: empty },
    "./CardSubTasks": { default: empty },
    "./FlattenedParentTask": { default: empty },
    "./TaskTagsRow": { default: empty },
    "./TaskTopRow": { default: empty },
    "next/link": { default: ({ prefetch, ...props }) => React.createElement("a", props) },
  });
  const { KanbanBulkSelectionProvider: Provider, useKanbanBulkSelection } =
    load("src/lib/contexts/Kanban/BulkSelectionContext.tsx");
  const { useLongPressTouchSensor } = load("src/hooks/Kanban/useLongPressTouchSensor.ts");
  const Card = load("src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx").default;
  const Bar = load("src/components/PageComponents/Kanban/KanbanHomepageComponents/KanbanBulkActionBar.tsx").default;
  const dragActions = {
    move: point => calls.push(["move", point]),
    drop: options => calls.push(["drop", options]),
    cancel: options => calls.push(["cancel", options]),
    shouldRespectForcePress: () => false,
  };
  const api = {
    findClosestDraggableId: event => event.target.closest("[data-rfd-draggable-id]")?.dataset.rfdDraggableId,
    tryGetLock(id, forceStop, { sourceEvent }) {
      if (sourceEvent.target.closest("button")) return null;
      calls.push(["lock", id]);
      return {
        abort: () => calls.push(["abort"]),
        shouldRespectForcePress: () => false,
        fluidLift: point => { calls.push(["lift", point]); return dragActions; },
      };
    },
  };
  function Sensor() {
    useLongPressTouchSensor(api);
    return null;
  }
  function Cards() {
    selection = useKanbanBulkSelection();
    return React.createElement(React.Fragment, null,
      !overview && React.createElement(Sensor),
      ...items.map((task, index) => {
        const card = provided => React.createElement(Card, {
          key: task.id, task, project: { name: "Board", sorting_mode: "Manual" },
          assignedUsers: [], agentAssignees: [], currentSetting: "None",
          selected: selection.isSelected(task.id), selectionMode: selection.selectedCount > 0,
          onSelectionClick: (id, event) => selection.toggleTaskSelection(id, task.sectionId, Boolean(event?.shiftKey)),
          openDetail: () => opened.push(task.id),
          provided,
        });
        return overview
          ? React.createElement(Draggable, { key: task.id, draggableId: `task-${task.id}`, index,
            isDragDisabled: true }, card)
          : card({
            innerRef: noop,
            draggableProps: { "data-rfd-draggable-id": `task-${task.id}` },
            dragHandleProps: { "data-test-handle": "unchanged" },
          });
      }),
      React.createElement(Bar),
    );
  }
  const render = () => {
    const board = React.createElement(Cards);
    ui.render(React.createElement(MobileViewContext.Provider, { value: currentMobile },
      React.createElement(Provider, { items, onArchiveTask: noop, onArchiveUndo: noop,
        onMoveTask: noop, onAssignTask: noop, onLabelTask: noop }, overview ? React.createElement(DragDropContext, {
        sensors: [useLongPressTouchSensor], enableDefaultSensors: false,
        onBeforeDragStart: () => calls.push(["lift"]), onDragEnd: () => calls.push(["drop"]),
      }, React.createElement(Droppable, { droppableId: "overview" }, provided =>
        React.createElement("div", { ref: provided.innerRef, ...provided.droppableProps },
          board, provided.placeholder))) : board)));
  };
  render();
  function touch(type, id = 1, {
    x = 10, y = 20, count = type === "touchend" || type === "touchcancel" ? 0 : 1,
    target = ui.container.querySelector(`#task-${id} a`),
  } = {}) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    const point = { clientX: x, clientY: y };
    Object.defineProperties(event, {
      touches: { value: Array.from({ length: count }, () => point) },
      changedTouches: { value: [point] },
    });
    React.act(() => target.dispatchEvent(event));
    return event;
  }
  return {
    ...ui, calls, opened, touch, get selection() { return selection; },
    close() {
      if (overview) {
        ui.render(null);
        React.act(() => t.mock.timers.tick(0));
      }
      ui.close();
    },
    advance: ms => React.act(() => t.mock.timers.tick(ms)),
    release(id = 1, point) {
      const event = touch("touchend", id, point);
      if (!event.defaultPrevented) React.act(() => ui.container.querySelector(`#task-${id} a`).click());
      return event;
    },
    setEnabled(value) { currentEnabled = value; render(); },
    setMobile(value) { currentMobile = value; render(); },
  };
}

test("hold-release starts shared selection and bar; taps toggle across columns and empty selection restores opening", t => {
  const fx = fixture(t);
  try {
    fx.touch("touchstart");
    fx.advance(900);
    assert.equal(fx.calls.some(([kind]) => kind === "lift"), false);
    assert.equal(fx.release().defaultPrevented, true);
    assert.deepEqual(fx.selection.selectedIdsArray, [1]);
    assert.match(fx.container.querySelector('[role="status"]').textContent, /1 selected/);
    const checkbox = fx.container.querySelector('#task-1 button[aria-label="Deselect item"]');
    assert.ok(checkbox.classList.contains("!flex"));
    assert.ok(checkbox.querySelector("svg"));
    assert.deepEqual(fx.opened, []);
    fx.touch("touchstart", 2);
    assert.equal(fx.release(2).defaultPrevented, true);
    assert.deepEqual(fx.selection.selectedIdsArray, [1, 2]);
    fx.touch("touchstart");
    fx.release();
    fx.touch("touchstart", 2);
    fx.release(2);
    assert.equal(fx.selection.selectedCount, 0);
    assert.equal(fx.container.querySelector('[role="status"]'), null);
    fx.touch("touchstart");
    assert.equal(fx.release().defaultPrevented, false);
    assert.deepEqual(fx.opened, [1]);
  } finally { fx.close(); }
});

test("hold-move starts today's drag and never selects, even after moving back to the origin", t => {
  const fx = fixture(t);
  try {
    fx.touch("touchstart");
    fx.advance(900);
    fx.touch("touchmove", 1, { x: 16 });
    fx.touch("touchmove");
    assert.equal(fx.release().defaultPrevented, true);
    assert.deepEqual(fx.calls, [
      ["lock", "task-1"], ["lift", { x: 10, y: 20 }],
      ["move", { x: 16, y: 20 }], ["move", { x: 10, y: 20 }],
      ["drop", { shouldBlockNextClick: true }],
    ]);
    assert.equal(fx.selection.selectedCount, 0);
    assert.deepEqual(fx.opened, []);
  } finally { fx.close(); }
});

test("jitter at tolerance still selects while pre-hold scrolling cancels without selection", t => {
  const fx = fixture(t);
  try {
    fx.touch("touchstart");
    fx.touch("touchmove", 1, { x: 13, y: 24 });
    fx.advance(900);
    fx.touch("touchmove", 1, { x: 15 });
    fx.release(1, { x: 15 });
    assert.deepEqual(fx.selection.selectedIdsArray, [1]);
    fx.touch("touchstart", 2);
    assert.equal(fx.touch("touchmove", 2, { x: 16 }).defaultPrevented, false);
    fx.advance(900);
    fx.touch("touchend", 2);
    assert.deepEqual(fx.selection.selectedIdsArray, [1]);
    assert.equal(fx.calls.some(([kind]) => kind === "lift"), false);
  } finally { fx.close(); }
});

for (const options of [{ enabled: false }, { mobile: false }]) {
  test(`legacy tap, jitter cancellation and drag wiring remain unchanged with ${JSON.stringify(options)}`, t => {
    const fx = fixture(t, options);
    try {
      React.act(() => fx.selection.toggleTaskSelection(2, 20));
      fx.touch("touchstart");
      assert.equal(fx.release().defaultPrevented, false);
      assert.deepEqual(fx.opened, [1]);
      fx.touch("touchstart");
      fx.touch("touchmove", 1, { x: 11 });
      fx.advance(900);
      fx.touch("touchend");
      assert.equal(fx.calls.some(([kind]) => kind === "lift"), false);
      fx.calls.length = 0;
      fx.touch("touchstart");
      fx.advance(900);
      fx.touch("touchmove", 1, { x: 11 });
      fx.release();
      assert.deepEqual(fx.calls, [
        ["lock", "task-1"], ["lift", { x: 10, y: 20 }],
        ["move", { x: 11, y: 20 }], ["drop", { shouldBlockNextClick: true }],
      ]);
      assert.deepEqual(fx.selection.selectedIdsArray, [2]);
      fx.calls.length = 0;
      fx.touch("touchstart");
      fx.advance(900);
      assert.equal(fx.release().defaultPrevented, true);
      assert.deepEqual(fx.calls, [
        ["lock", "task-1"], ["lift", { x: 10, y: 20 }],
        ["drop", { shouldBlockNextClick: true }],
      ]);
      assert.deepEqual(fx.selection.selectedIdsArray, [2]);
      assert.equal(fx.container.querySelector('#task-2 button').classList.contains("!flex"), false);
      assert.equal(fx.container.querySelector('[data-test-handle="unchanged"]') !== null, true);
    } finally { fx.close(); }
  });
}

for (const overview of [false, true]) for (const cancel of ["touchcancel", "multitouch", "Escape", "resize", "orientationchange", "visibilitychange", "flag-off", "desktop", "unmount"]) {
  for (const held of [false, true]) test(`${cancel} during ${held ? "hold" : "pending touch"} cannot select or leak a drag (overview: ${overview})`, t => {
    const fx = fixture(t, { overview });
    let closed = false;
    try {
      fx.touch("touchstart");
      if (held) fx.advance(900);
      if (cancel === "multitouch") fx.touch("touchstart", 1, { count: 2 });
      else if (cancel === "touchcancel") fx.touch("touchcancel");
      else if (cancel === "flag-off") fx.setEnabled(false);
      else if (cancel === "desktop") fx.setMobile(false);
      else if (cancel === "unmount") { fx.close(); closed = true; }
      else React.act(() => {
        const event = cancel === "Escape" ? new window.KeyboardEvent("keydown", { key: "Escape" }) : new window.Event(cancel);
        (cancel === "visibilitychange" ? document : window).dispatchEvent(event);
      });
      fx.advance(1000);
      if (!closed) fx.touch("touchend");
      assert.equal(fx.selection.selectedCount, 0);
      assert.deepEqual(fx.calls, overview ? [] : [["lock", "task-1"], ["abort"]]);
    } finally { if (!closed) fx.close(); }
  });
}

test("hold-release toggles an already selected card, with or without the select-all flag", t => {
  const fx = fixture(t, { selectAll: false });
  try {
    React.act(() => fx.selection.toggleTaskSelection(1, 10));
    fx.touch("touchstart");
    fx.advance(900);
    fx.release();
    assert.equal(fx.selection.selectedCount, 0);
    React.act(() => fx.selection.toggleTaskSelection(999));
    assert.equal(fx.selection.selectedCount, 0);
  } finally { fx.close(); }
});

test("column touch pickup keeps its 120ms drag", t => {
  const fx = fixture(t);
  try {
    const target = fx.container.querySelector(".kanban-task-card");
    target.dataset.rfdDraggableId = "column-10";
    fx.touch("touchstart");
    fx.advance(120);
    fx.release();
    assert.deepEqual(fx.calls, [["lock", "column-10"], ["lift", { x: 10, y: 20 }],
      ["drop", { shouldBlockNextClick: true }]]);
    assert.equal(fx.selection.selectedCount, 0);
  } finally { fx.close(); }
});

test("disabled overview draggables support hold selection and selected-mode tap toggles without dragging", t => {
  const fx = fixture(t, { overview: true });
  try {
    assert.ok(fx.container.querySelector('[data-rfd-draggable-id="task-1"]'));
    assert.equal(fx.container.querySelector("[data-rfd-drag-handle-draggable-id]"), null);
    fx.touch("touchstart");
    fx.advance(900);
    assert.equal(fx.release().defaultPrevented, true);
    assert.deepEqual(fx.selection.selectedIdsArray, [1]);
    assert.match(fx.container.querySelector('[role="status"]').textContent, /1 selected/);
    fx.touch("touchstart", 2);
    assert.equal(fx.release(2).defaultPrevented, true);
    assert.deepEqual(fx.selection.selectedIdsArray, [1, 2]);
    fx.touch("touchstart");
    fx.release();
    fx.touch("touchstart", 2);
    fx.release(2);
    assert.equal(fx.selection.selectedCount, 0);
    assert.deepEqual(fx.opened, []);
    fx.touch("touchstart");
    fx.advance(900);
    fx.touch("touchmove", 1, { x: 16 });
    fx.touch("touchend", 1, { x: 16 });
    assert.equal(fx.selection.selectedCount, 0);
    assert.deepEqual(fx.calls, []);
    fx.touch("touchstart");
    assert.equal(fx.release().defaultPrevented, false);
    assert.deepEqual(fx.opened, [1]);
  } finally { fx.close(); }
});

test("existing checkbox and desktop X key use the same selection as phone holds", t => {
  const fx = fixture(t);
  try {
    React.act(() => fx.selection.handleBulkKeyDown({ keyCode: 88, preventDefault: noop }, 1));
    assert.deepEqual(fx.selection.selectedIdsArray, [1]);
    fx.touch("touchstart", 2);
    fx.release(2);
    assert.deepEqual(fx.selection.selectedIdsArray, [1, 2]);
    React.act(() => fx.container.querySelector('#task-1 button[aria-label="Deselect item"]').click());
    assert.deepEqual(fx.selection.selectedIdsArray, [2]);
    React.act(() => fx.container.querySelector('[role="status"] button:last-child').click());
    assert.equal(fx.selection.selectedCount, 0);
    assert.deepEqual(fx.opened, []);
  } finally { fx.close(); }
});


test("dragging with a selection never ticks or unticks the dragged card", t => {
  const fx = fixture(t);
  try {
    React.act(() => fx.selection.toggleTaskSelection(2, 20));
    fx.touch("touchstart");
    fx.advance(900);
    fx.touch("touchmove", 1, { y: 26 });
    fx.release(1, { y: 26 });
    assert.deepEqual(fx.selection.selectedIdsArray, [2]);
    assert.deepEqual(fx.opened, []);
  } finally { fx.close(); }
});

test("release beyond tolerance without a move event cannot select or open", t => {
  const fx = fixture(t);
  try {
    fx.touch("touchstart");
    fx.advance(900);
    assert.equal(fx.release(1, { x: 16 }).defaultPrevented, true);
    assert.deepEqual(fx.calls, [["lock", "task-1"], ["abort"]]);
    assert.equal(fx.selection.selectedCount, 0);
    assert.deepEqual(fx.opened, []);
  } finally { fx.close(); }
});

for (const overview of [false, true]) test(`touching the shared checkbox is left to its existing click handler, not toggled twice (overview: ${overview})`, t => {
  const fx = fixture(t, { overview });
  try {
    React.act(() => fx.selection.toggleTaskSelection(2, 20));
    const target = fx.container.querySelector('#task-1 button[aria-label="Select item"]');
    fx.touch("touchstart", 1, { target });
    assert.equal(fx.touch("touchend", 1, { target }).defaultPrevented, false);
    assert.deepEqual(fx.calls, []);
    React.act(() => target.click());
    assert.deepEqual(fx.selection.selectedIdsArray, [2, 1]);
    assert.deepEqual(fx.opened, []);
  } finally { fx.close(); }
});
