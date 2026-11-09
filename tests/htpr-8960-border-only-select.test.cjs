const assert = require("node:assert/strict");
const test = require("node:test");
const { clsx } = require("clsx");
const { twMerge } = require("tailwind-merge");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-8960-border-only-select";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`);
const MobileViewContext = React.createContext(false);
const empty = () => null;
const redStripe = "border-[hsl(0_62.8%_30.6%)]";

const outlineKey = "htpr-7614-selected-card-border";

function loadCard(enabled, outline) {
  return loader({
    "@/hooks/useFlag": { useFlag: key => key === flagKey ? enabled : key === outlineKey && outline },
    "@/lib/flags/keys": { HTPR_7614_SELECTED_CARD_BORDER_FLAG: outlineKey },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/lib/state": { useRecoilState: () => [null, empty] },
    "@/store": {},
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveStalenessFromProject: () => false },
    "@/utils/undoActions/helperFuncs": { cn: (...args) => twMerge(clsx(args)) },
    "next/link": { default: ({ prefetch, ...props }) => React.createElement("a", props) },
    "./CardSubTasks": { default: empty },
    "./TaskTagsRow": { default: empty },
    "./TaskTopRow": { default: empty },
  })("src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx").default;
}

function harness(enabled, extra = {}, task = {}, outline = false) {
  const Card = loadCard(enabled, outline);
  const app = mount();
  const calls = { opened: 0, selected: [] };
  let defaultPrevented = null;
  const record = event => {
    defaultPrevented = event.defaultPrevented;
    event.preventDefault();
  };
  app.container.addEventListener("click", record);
  const props = {
    task: { id: 42, projectId: 15, uniqueIndex: 42, ticketNumber: "HTPR-42", title: "Example card", ...task },
    currentSetting: "Flattened", assignedUsers: [], agentAssignees: [], active: false,
    hover: false, hasDraft: false,
    openDetail: () => calls.opened++,
    onSelectionClick: (id, event) => calls.selected.push([id, Boolean(event?.shiftKey)]),
    provided: {
      innerRef: () => {},
      draggableProps: { "data-rfd-draggable-id": "task-42" },
      dragHandleProps: { "data-rfd-drag-handle-id": "handle-42" },
    },
    ...extra,
  };
  return {
    calls,
    render: state => app.render(React.createElement(Card, { ...props, ...state })),
    get container() { return app.container; },
    get link() { return app.container.querySelector("a[href='/detail/project-15/42']"); },
    get card() { return app.container.querySelector(".kanban-task-card"); },
    get defaultPrevented() { return defaultPrevented; },
    click(init = {}, target = this.link) {
      defaultPrevented = null;
      React.act(() => target.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })));
    },
    close() {
      app.container.removeEventListener("click", record);
      app.close();
    },
  };
}

test("flag ships as an improvement on for everyone", () => {
  assert.equal(flag.default.key, flagKey);
  assert.equal(flag.default.kind, "improvement");
  assert.equal(flag.default.defaultMode, "EVERYONE");
});

test("flag on: no checkbox at rest, on hover, selected or while selecting, and card content never shifts", () => {
  const h = harness(true);
  try {
    const classNames = [];
    for (const state of [{}, { hover: true }, { selected: true, selectionMode: true }, { selectionMode: true }]) {
      h.render(state);
      assert.equal(h.container.querySelector("button[aria-label$='item']"), null);
      assert.doesNotMatch(h.link.className, /pl-7/);
      classNames.push(h.link.className);
    }
    assert.equal(new Set(classNames).size, 1, "link classes identical in every state");
  } finally {
    h.close();
  }
});

test("flag off: checkbox and pl-7 shift behave as before", () => {
  const h = harness(false);
  try {
    h.render({});
    assert.ok(h.container.querySelector("button[aria-label='Select item']"));
    assert.ok(h.link.classList.contains("group-hover/kanban-selection:pl-7"));
    assert.ok(!h.link.classList.contains("pl-7"));
    h.render({ selected: true, selectionMode: true });
    assert.ok(h.container.querySelector("button[aria-label='Deselect item']"));
    assert.ok(h.link.classList.contains("pl-7"));
    h.click({ shiftKey: true });
    assert.deepEqual(h.calls.selected, []);
    assert.equal(h.calls.opened, 0);
    assert.equal(h.defaultPrevented, false, "shift click keeps the browser behaviour when off");
  } finally {
    h.close();
  }
});

for (const blocked of [false, true]) {
  test(`flag on: selected card keeps the blue border and selected background${blocked ? " and the blocked red stripe" : ""}`, () => {
    const h = harness(true, {}, blocked ? { blockingTasks: [{ id: 1 }] } : {});
    try {
      h.render({ selected: true, selectionMode: true });
      const classes = [...h.card.classList];
      assert.ok(classes.includes("ring-hypertasks-purple"));
      assert.ok(classes.includes("bg-kanban-active-cardbg"));
      assert.equal(classes.includes(redStripe), blocked);
      h.render({});
      const rest = [...h.card.classList];
      assert.ok(!rest.includes("ring-hypertasks-purple"));
      assert.equal(rest.includes(redStripe), blocked);
    } finally {
      h.close();
    }
  });
}

for (const blocked of [false, true]) {
  test(`flag on with the live outline border: selected card is outlined in hypertasks-purple${blocked ? " and keeps the blocked red stripe" : ""}`, () => {
    const h = harness(true, {}, blocked ? { blockingTasks: [{ id: 1 }] } : {}, true);
    try {
      h.render({ selected: true, selectionMode: true });
      const classes = [...h.card.classList];
      assert.ok(classes.includes("!outline-hypertasks-purple"));
      assert.ok(classes.includes("bg-kanban-active-cardbg"));
      assert.equal(classes.includes(redStripe), blocked);
      assert.ok(!classes.some(name => name.startsWith("ring-")));
    } finally {
      h.close();
    }
  });
}

test("flag on: Shift+click selects, plain click opens, Cmd and Ctrl click open a new tab", () => {
  const h = harness(true);
  try {
    h.render({});
    h.click({ shiftKey: true });
    assert.deepEqual(h.calls.selected, [[42, true]]);
    assert.equal(h.calls.opened, 0);
    assert.equal(h.defaultPrevented, true, "shift click must not open a browser window");
    h.click({});
    assert.equal(h.calls.opened, 1);
    assert.deepEqual(h.calls.selected, [[42, true]]);
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }]) {
      h.click(modifier);
      assert.equal(h.defaultPrevented, false, `${JSON.stringify(modifier)} keeps the new tab`);
    }
    assert.equal(h.calls.opened, 1);
    assert.deepEqual(h.calls.selected, [[42, true]]);
  } finally {
    h.close();
  }
});

test("flag on: while cards are selected a plain click toggles instead of opening", () => {
  const h = harness(true);
  try {
    h.render({ selectionMode: true });
    h.click({});
    assert.deepEqual(h.calls.selected, [[42, false]]);
    assert.equal(h.calls.opened, 0);
    h.click({}, h.card);
    assert.deepEqual(h.calls.selected, [[42, false], [42, false]]);
    assert.equal(h.calls.opened, 0);
    h.click({ ctrlKey: true });
    assert.equal(h.defaultPrevented, false);
    assert.equal(h.calls.selected.length, 2);
  } finally {
    h.close();
  }
});

test("archived cards without a selection handler still open on click", () => {
  const h = harness(true, { onSelectionClick: undefined });
  try {
    h.render({ selectionMode: true });
    h.click({ shiftKey: true });
    h.click({});
    assert.equal(h.calls.opened, 1);
  } finally {
    h.close();
  }
});

test("drag handles and draggable props are the same with the flag on and off", () => {
  const attributes = enabled => {
    const h = harness(enabled);
    try {
      h.render({});
      return {
        id: h.card.getAttribute("data-rfd-draggable-id"),
        handle: h.card.getAttribute("data-rfd-drag-handle-id"),
      };
    } finally {
      h.close();
    }
  };
  assert.deepEqual(attributes(true), { id: "task-42", handle: "handle-42" });
  assert.deepEqual(attributes(true), attributes(false));
});
