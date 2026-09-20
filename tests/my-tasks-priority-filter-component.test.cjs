// HTPR-6312: the priority filter on My Tasks must be gated by one flag for
// BOTH the control and the behavior (a flag flipping off mid-session must
// stop filtering, not just hide the button), counts must stay truthful, and
// Escape must close the dropdown instead of navigating back.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: { runtime: "automatic", importSource: "react" },
  alias: { "@": path.join(root, "src") },
});

const stubModule = (filename, exports) => {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};
const stubSourceModule = (relativePath, exports) =>
  stubModule(path.join(root, relativePath), exports);

const flagValues = { "htpr-6312-my-tasks-priority-filter": true };
const tableViewProps = [];
let backCalls = 0;
let quickAddRenders = 0;
const viewControlProps = [];
const viewTabsProps = [];
const filterModalProps = [];

stubSourceModule("src/hooks/useFlag.tsx", {
  useFlag: (key) => flagValues[key] ?? false,
});
stubSourceModule("src/hooks/Task Detail/useTimeTracking.ts", {
  useRunningTimers: () => ({ data: [] }),
});
stubSourceModule("src/lib/state.tsx", {
  useRecoilValue: () => false,
  useRecoilState: () => [0, () => {}],
});
stubSourceModule("src/store/index.ts", {
  appShellRailAtom: {},
  showCommandsAtom: { show: false },
  myTasksTableColumnsPickerRequestAtom: {},
});
stubModule(require.resolve("next/navigation"), {
  useRouter: () => ({
    back: () => { backCalls += 1; },
    replace: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
});
const ModalPart = ({ children }) => React.createElement("div", null, children);
stubModule(require.resolve("reactstrap"), { ModalBody: ModalPart });
stubSourceModule("src/components/PageComponents/Kanban/TableView/TableView.tsx", {
  default: (props) => {
    tableViewProps.push(props);
    return null;
  },
});
// HTPR-6456: MyTasks imports TableColumnsPicker; its modal SCSS blows up under jiti.
stubSourceModule("src/components/PageComponents/Kanban/TableView/TableColumnsPicker.tsx", {
  default: () => null,
});
stubSourceModule("src/hooks/Homepage/Views/useKanbanViews.ts", {
  default: () => ({ setBoardSortingViewAndReturn: async () => {} }),
});
stubSourceModule("src/components/Common/CommonModalComponents/index.tsx", {
  ModalContainerCustom: ({ children, id }) => React.createElement("div", { id }, children),
  ModalHeaderComp: ({ children, header }) => React.createElement("div", null, header, children),
  ModalInput: ({ autofocus: _autofocus, ...props }) => React.createElement("input", props),
  ModalListContainer: ({ children, ...props }) => React.createElement("ul", props, children),
  ModalRowElementContainer: ({ children, isSelected: _isSelected, ...props }) => React.createElement("li", props, children),
});
stubSourceModule("src/app/my-tasks/MyTasksViewControls.tsx", {
  default: (props) => {
    viewControlProps.push(props);
    return React.createElement("div", { "data-testid": "my-tasks-view-controls" });
  },
});
stubSourceModule("src/app/my-tasks/MyTasksViewTabs.tsx", {
  default: (props) => {
    viewTabsProps.push(props);
    return React.createElement("div", { "data-testid": "my-tasks-view-tabs" });
  },
});
stubSourceModule("src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx", {
  default: () => null,
});
stubSourceModule("src/components/Buttons/BackButton.tsx", {
  default: () => null,
});
stubSourceModule("src/app/my-tasks/MyTasksKanbanFilterModal.tsx", {
  default: (props) => {
    filterModalProps.push(props);
    return React.createElement("div", { "data-testid": "my-tasks-filter-modal" });
  },
});
// HTPR-6458: realtime client is not available under jsdom/jiti component tests.
stubSourceModule("src/hooks/realtime/useMyTasksRealtime.ts", {
  useMyTasksRealtime: () => {},
  createMyTasksRealtimeEventHandler: () => () => {},
});
stubSourceModule("src/lib/myTasks/reconcileMyTasks.ts", {
  buildMyTasksListUrl: () => "/api/my-tasks",
  createMyTasksReconcileRunner: () => ({
    request: () => {},
    flush: async () => null,
    cancel: () => {},
  }),
  parseMyTasksListPayload: () => null,
});
stubSourceModule("src/app/my-tasks/MyTasksQuickAdd.tsx", {
  default: () => {
    quickAddRenders += 1;
    return React.createElement("div", { "data-testid": "my-tasks-quick-add" });
  },
});
stubSourceModule("src/components/Common/TaskRowComponents/TaskListRow.tsx", {
  SplitTitle: () => React.createElement("div", { "data-testid": "my-tasks-split-tab" }),
});
stubSourceModule("src/styles/search.module.scss", {
  links_modal: "",
});
stubSourceModule("src/styles/linksModal.module.scss", {
  links_modal: "",
});
stubSourceModule("src/utils/undoActions/helperFuncs.ts", {
  cn: (...args) => args.filter(Boolean).join(" "),
});

// jiti compiles JSX with the classic transform, so components without an
// explicit React import need one in scope.
global.React = React;

const MyTasksModule = jiti(path.join(root, "src/app/my-tasks/MyTasks.tsx"));
const MyTasks = MyTasksModule.default;
const BoardPriorityMode = jiti(
  path.join(root, "src/components/Modals/Kanban/BoardPriorityMode.tsx"),
).default;
const { fromBoardSort, MY_TASKS_BOARD_SORT_MODES, toBoardSort } = MyTasksModule;
const { DEFAULT_MY_TASKS_VIEW_CONFIG } = jiti(path.join(root, "src/models/MyTasksView.ts"));
const { PriorityConstants } = jiti(path.join(root, "src/lib/constants/constants.ts"));

const sections = [
  {
    id: 100,
    section_title: "Board A",
    items: [
      { id: 1, priority: { priority_index: 1 } }, // Urgent
      { id: 2, priority: { priority_index: 3 } }, // Medium
    ],
  },
  {
    id: 200,
    section_title: "Board B",
    items: [
      { id: 3, priority: { priority_index: 2 } }, // High
      { id: 4 }, // no priority
    ],
  },
];

const lastViewItems = () =>
  tableViewProps[tableViewProps.length - 1].filteredSections.flatMap(
    (section) => section.items.map((item) => item.id),
  );

const renderMyTasks = (dom) => {
  const rootEl = dom.window.document.getElementById("root");
  const reactRoot = createRoot(rootEl);
  act(() => {
    reactRoot.render(React.createElement(MyTasks, { sections, tabs: ["All", "Board A", "Board B"], currentUser: { id: 6 } }));
  });
  return reactRoot;
};

const click = (element, dom) =>
  act(() => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });

test("board sorting remains selectable through the board sort modal adapter", () => {
  assert.ok(MY_TASKS_BOARD_SORT_MODES.includes("Board"));
  assert.ok(!MY_TASKS_BOARD_SORT_MODES.includes("Manual"));
  assert.deepEqual(toBoardSort({ field: "board", direction: "asc" }), {
    mode: "Board",
    order: "Ascending",
  });
  assert.deepEqual(fromBoardSort({ mode: "Board", order: "Descending" }), {
    field: "board",
    direction: "desc",
  });
});

test("single-level sort modal offers replacement modes", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/my-tasks" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const reactRoot = createRoot(dom.window.document.getElementById("root"));

  act(() => {
    reactRoot.render(React.createElement(BoardPriorityMode, {
      closeHandler: () => {},
      sort: { mode: "UpdatedAt", order: "Descending" },
      onSortChange: async () => {},
      maxLevels: 1,
      availableModes: MY_TASKS_BOARD_SORT_MODES,
      modeLabel: (mode) => mode,
    }));
  });

  assert.ok(
    dom.window.document.querySelectorAll('#users-list [id^="priority_mode:"]').length > 0,
    "the single-level sort modal must offer replacement modes",
  );

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("flag off: no filter control and no filtering", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6312-my-tasks-priority-filter"] = false;
  const reactRoot = renderMyTasks(dom);

  assert.ok(!dom.window.document.getElementById('my-tasks-priority-filter'), "filter button must be hidden with the flag off");
  assert.deepEqual(lastViewItems(), [1, 2, 3, 4]);

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("flag on: picking priorities filters, updates counts, and toggles off", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6312-my-tasks-priority-filter"] = true;
  const reactRoot = renderMyTasks(dom);

  const filterButton = dom.window.document.getElementById('my-tasks-priority-filter');
  assert.ok(filterButton, "filter button must render with the flag on");
  click(filterButton, dom);

  const menu = dom.window.document.querySelector("[role='menu']");
  assert.ok(menu, "priority menu must open");
  assert.equal(menu.querySelectorAll("[role='menuitemcheckbox']").length, PriorityConstants.length);

  // Pick Urgent (priority_index 1).
  const rows = [...menu.querySelectorAll("[role='menuitemcheckbox']")];
  click(rows.find((row) => row.textContent.includes("Urgent")), dom);
  assert.deepEqual(lastViewItems(), [1], "only the Urgent task stays visible");
  const headerCount = dom.window.document.querySelector(".text-content.font-normal");
  assert.equal(headerCount.textContent, "1", "header count must reflect the filter");
  assert.equal(filterButton.getAttribute("aria-expanded"), "true", "menu stays open while picking");

  // Toggle the same row off: everything is back.
  click(menu.querySelector("[aria-checked='true']"), dom);
  assert.deepEqual(lastViewItems(), [1, 2, 3, 4]);

  // "No Priority" keeps unprioritized tasks, like a board filter.
  click(rows.find((row) => row.textContent.includes("No Priority")), dom);
  assert.deepEqual(lastViewItems(), [4]);

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("flag turning off mid-session stops filtering and hides the control", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6312-my-tasks-priority-filter"] = true;
  const reactRoot = renderMyTasks(dom);

  click(dom.window.document.getElementById('my-tasks-priority-filter'), dom);
  const menu = dom.window.document.querySelector("[role='menu']");
  const rows = [...menu.querySelectorAll("[role='menuitemcheckbox']")];
  click(rows.find((row) => row.textContent.includes("Urgent")), dom);
  assert.deepEqual(lastViewItems(), [1], "filter active before the flag flips");

  // The flag flips off while the selection still exists (flag refresh).
  flagValues["htpr-6312-my-tasks-priority-filter"] = false;
  act(() => {
    reactRoot.render(React.createElement(MyTasks, { sections, tabs: ["All", "Board A", "Board B"], currentUser: { id: 6 } }));
  });
  assert.ok(!dom.window.document.getElementById('my-tasks-priority-filter'), "control hidden after flag off");
  assert.deepEqual(lastViewItems(), [1, 2, 3, 4], "filtering stops when the flag goes off");

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("board toolbar flag removes duplicate My Tasks rows and quick add", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/my-tasks" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6422-my-tasks-views"] = true;
  flagValues["htpr-6447-my-tasks-filter-parity"] = true;
  flagValues["htpr-6460-my-tasks-quick-add"] = true;
  flagValues["htpr-6572-my-tasks-board-toolbar"] = true;
  quickAddRenders = 0;
  viewControlProps.length = 0;
  viewTabsProps.length = 0;

  const rootEl = dom.window.document.getElementById("root");
  const reactRoot = createRoot(rootEl);
  act(() => {
    reactRoot.render(React.createElement(MyTasks, {
      sections,
      tabs: ["All", "Board A", "Board B"],
      currentUser: { id: 6 },
      viewsEnabled: true,
      initialViews: [],
    }));
  });

  assert.equal(quickAddRenders, 0, "the board toolbar removes the quick-add row");
  assert.equal(dom.window.document.querySelectorAll('[data-testid="my-tasks-split-tab"]').length, 0, "the duplicate board tab row is removed");
  assert.equal(viewControlProps.at(-1)?.boardToolbar, true);
  assert.equal(viewTabsProps.at(-1)?.boardToolbar, true);

  act(() => { reactRoot.unmount(); });
  delete flagValues["htpr-6422-my-tasks-views"];
  delete flagValues["htpr-6447-my-tasks-filter-parity"];
  delete flagValues["htpr-6460-my-tasks-quick-add"];
  delete flagValues["htpr-6572-my-tasks-board-toolbar"];
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("board toolbar stays off until saved views and filter parity are both available", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/my-tasks" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6422-my-tasks-views"] = true;
  flagValues["htpr-6460-my-tasks-quick-add"] = true;
  flagValues["htpr-6572-my-tasks-board-toolbar"] = true;
  quickAddRenders = 0;
  viewControlProps.length = 0;

  const rootEl = dom.window.document.getElementById("root");
  const reactRoot = createRoot(rootEl);
  act(() => {
    reactRoot.render(React.createElement(MyTasks, {
      sections,
      tabs: ["All", "Board A", "Board B"],
      currentUser: { id: 6 },
      viewsEnabled: true,
      initialViews: [],
    }));
  });

  assert.equal(quickAddRenders, 1, "the existing quick-add row remains available");
  assert.ok(viewControlProps.every((props) => !props.boardToolbar));
  assert.ok(dom.window.document.querySelector('[data-testid="my-tasks-split-tab"]'));

  act(() => { reactRoot.unmount(); });
  delete flagValues["htpr-6422-my-tasks-views"];
  delete flagValues["htpr-6460-my-tasks-quick-add"];
  delete flagValues["htpr-6572-my-tasks-board-toolbar"];
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("flag-off Clear All preserves scope settings", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/my-tasks?view=1" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6422-my-tasks-views"] = true;
  flagValues["htpr-6447-my-tasks-filter-parity"] = true;
  viewControlProps.length = 0;
  filterModalProps.length = 0;

  const config = {
    ...DEFAULT_MY_TASKS_VIEW_CONFIG,
    boardIds: [10],
    filters: {
      ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
      sectionIds: [100],
      showDone: true,
      showSnoozed: true,
    },
  };
  const rootEl = dom.window.document.getElementById("root");
  const reactRoot = createRoot(rootEl);
  act(() => {
    reactRoot.render(React.createElement(MyTasks, {
      sections,
      tabs: ["All", "Board A", "Board B"],
      currentUser: { id: 6 },
      viewsEnabled: true,
      initialViewId: 1,
      initialViews: [{ id: 1, name: "Scoped", position: 0, isDefault: false, config }],
    }));
  });

  act(() => viewControlProps.at(-1).onOpenKanbanFilters());
  assert.ok(filterModalProps.length > 0, "filter modal opens on the existing toolbar");
  act(() => filterModalProps.at(-1).onClearAll());

  const cleared = viewControlProps.at(-1).config;
  assert.deepEqual(cleared.boardIds, [10]);
  assert.deepEqual(cleared.filters.sectionIds, [100]);
  assert.equal(cleared.filters.showDone, true);
  assert.equal(cleared.filters.showSnoozed, true);

  act(() => { reactRoot.unmount(); });
  delete flagValues["htpr-6422-my-tasks-views"];
  delete flagValues["htpr-6447-my-tasks-filter-parity"];
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("time group flag groups by due time without saved views", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const dated = [
    {
      id: 100,
      section_title: "MyBoard",
      projectId: 10,
      items: [
        { id: 1, projectId: 10, dueDate: new Date(2020, 0, 1) },
        { id: 2, projectId: 10, dueDate: new Date() },
      ],
    },
  ];
  const rootEl = dom.window.document.getElementById("root");
  const reactRoot = createRoot(rootEl);
  act(() => {
    reactRoot.render(React.createElement(MyTasks, {
      sections: dated,
      tabs: ["All", "MyBoard"],
      currentUser: { id: 6 },
      timeGroupEnabled: true,
    }));
  });
  const titles = tableViewProps[tableViewProps.length - 1].filteredSections.map(
    (section) => section.section_title,
  );
  assert.deepEqual(titles, ["Overdue", "Today"]);
  assert.ok(!titles.includes("MyBoard"), "board titles must not be the group headers");

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("Escape closes the menu instead of navigating back", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6312-my-tasks-priority-filter"] = true;
  const reactRoot = renderMyTasks(dom);

  click(dom.window.document.getElementById('my-tasks-priority-filter'), dom);
  assert.ok(dom.window.document.querySelector("[role='menu']"), "menu open before Escape");

  act(() => {
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.ok(!dom.window.document.querySelector("[role='menu']"), "menu closed by Escape");
  assert.equal(backCalls, 0, "Escape on the menu must not navigate back");

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
