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
const realtimeSubscriptions = [];
let reconcileRequests = 0;
let backCalls = 0;

stubSourceModule("src/hooks/useFlag.tsx", {
  useFlag: (key) => flagValues[key] ?? false,
});
stubSourceModule("src/hooks/Task Detail/useTimeTracking.ts", {
  useRunningTimers: () => ({ data: [] }),
});
stubSourceModule("src/lib/state.tsx", {
  useRecoilValue: () => false,
  useRecoilState: () => [0, () => {}],
  useSetRecoilState: () => () => {},
});
stubSourceModule("src/hooks/General/useUndo.tsx", {
  useUndoContext: () => ({ performActionAndStoreUndoData: async () => {} }),
});
stubSourceModule("src/hooks/Task Detail/useAssignTaskUser.ts", {
  useAssignTaskUser: () => async () => {},
});
stubSourceModule("src/hooks/MultiPages/useMoveTaskToSection.ts", {
  default: () => ({ mutateAsync: async () => {} }),
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
  useSearchParams: () => new URLSearchParams(global.window?.location.search),
});
stubSourceModule("src/components/PageComponents/Kanban/TableView/TableView.tsx", {
  default: (props) => {
    tableViewProps.push(props);
    return null;
  },
});
stubSourceModule("src/components/PageComponents/Kanban/TableView/TableColumnsPicker.tsx", {
  default: () => null,
});
stubSourceModule("src/app/my-tasks/MyTasksViewControls.tsx", {
  default: () => null,
});
stubSourceModule("src/app/my-tasks/MyTasksViewTabs.tsx", {
  default: () => null,
});
stubSourceModule("src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx", {
  default: () => null,
});
stubSourceModule("src/components/Buttons/BackButton.tsx", {
  default: () => null,
});
stubSourceModule("src/app/my-tasks/MyTasksKanbanFilterModal.tsx", {
  default: () => null,
});
stubSourceModule("src/hooks/realtime/useMyTasksRealtime.ts", {
  useMyTasksRealtime: (...args) => realtimeSubscriptions.push(args),
  createMyTasksRealtimeEventHandler: () => () => {},
});
stubSourceModule("src/lib/myTasks/reconcileMyTasks.ts", {
  buildMyTasksListUrl: () => "/api/my-tasks",
  createMyTasksReconcileRunner: () => ({
    request: () => { reconcileRequests += 1; },
    flush: async () => null,
    cancel: () => {},
  }),
  parseMyTasksListPayload: () => null,
});
stubSourceModule("src/components/Common/TaskRowComponents/TaskListRow.tsx", {
  SplitTitle: () => null,
});
stubSourceModule("src/styles/search.module.scss", {
  links_modal: "",
  phone_layout: "phone_layout",
});
stubSourceModule("src/utils/undoActions/helperFuncs.ts", {
  cn: (...args) => args.filter(Boolean).join(" "),
});

global.React = React;

const MyTasks = jiti(path.join(root, "src/app/my-tasks/MyTasks.tsx")).default;

const sections = [
  {
    id: 100,
    section_title: "Board A",
    items: [
      { id: 1, priority: { priority_index: 1 } },
      { id: 2, priority: { priority_index: 3 } },
    ],
  },
  {
    id: 200,
    section_title: "Board B",
    items: [
      { id: 3, priority: { priority_index: 2 } },
      { id: 4 },
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

test("views on: legacy priority button stays hidden", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6312-my-tasks-priority-filter"] = true;
  const reactRoot = renderMyTasks(dom);

  assert.ok(!dom.window.document.getElementById('my-tasks-priority-filter'), "legacy priority button stays hidden");
  assert.deepEqual(lastViewItems(), [1, 2, 3, 4]);

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

test("flag turning off mid-session keeps the legacy control hidden", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6312-my-tasks-priority-filter"] = true;
  const reactRoot = renderMyTasks(dom);

  assert.ok(!dom.window.document.getElementById('my-tasks-priority-filter'));
  assert.deepEqual(lastViewItems(), [1, 2, 3, 4]);

  flagValues["htpr-6312-my-tasks-priority-filter"] = false;
  act(() => {
    reactRoot.render(React.createElement(MyTasks, { sections, tabs: ["All", "Board A", "Board B"], currentUser: { id: 6 } }));
  });
  assert.ok(!dom.window.document.getElementById('my-tasks-priority-filter'), "control hidden after flag off");
  assert.deepEqual(lastViewItems(), [1, 2, 3, 4], "list stays unfiltered");

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

for (const savedBoardGroup of [false, true]) {
  test(`My Tasks preserves ${savedBoardGroup ? "saved board" : "default time"} grouping`, () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: `https://app.hypertask.ai/my-tasks${savedBoardGroup ? "?view=1" : ""}` });
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    for (const key of Object.keys(flagValues)) flagValues[key] = false;
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
        initialViewId: savedBoardGroup ? 1 : null,
        initialViews: savedBoardGroup ? [{ id: 1, name: "By board", config: { groupBy: "board" } }] : [],
      }));
    });
    const titles = tableViewProps[tableViewProps.length - 1].filteredSections.map(
      (section) => section.section_title,
    );
    assert.deepEqual(titles, savedBoardGroup ? ["MyBoard"] : ["Overdue", "Today"]);

    act(() => { reactRoot.unmount(); });
    delete global.window;
    delete global.document;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

}

test("Escape with no priority menu navigates back", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  flagValues["htpr-6312-my-tasks-priority-filter"] = true;
  const reactRoot = renderMyTasks(dom);

  assert.ok(!dom.window.document.getElementById('my-tasks-priority-filter'));
  assert.ok(!dom.window.document.querySelector("[role='menu']"));

  act(() => {
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.equal(backCalls, 1, "Escape with no menu navigates back");

  act(() => { reactRoot.unmount(); });
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

for (const groupBy of ["board", "time"]) {
  test(`${groupBy} grouping counts every Tab before a render`, () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/my-tasks?view=1&board=10" });
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    flagValues["htpr-6312-my-tasks-priority-filter"] = false;
    const boardSections = [10, 20, 30, 40].map((projectId) => ({
      id: projectId, projectId, section_title: `Board ${projectId}`,
      items: [{ id: projectId, projectId }],
    }));
    const reactRoot = createRoot(document.getElementById("root"));
    const press = (shiftKey = false) => document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }),
    );
    try {
      act(() => reactRoot.render(React.createElement(MyTasks, {
        sections: boardSections, tabs: ["All", ...boardSections.map((section) => section.section_title)],
        currentUser: { id: 6 },
        initialViewId: 1,
        initialViews: [{ id: 1, name: "Navigation", config: { groupBy } }],
        boards: boardSections.map(({ projectId, section_title }) => ({
          id: projectId, title: section_title, labels: [], sections: [],
        })),
      })));
      assert.deepEqual(lastViewItems(), [10]);
      const panel = document.querySelector('[data-testid="my-tasks-panel"]');
      assert.equal(panel.classList.contains("w-full"), true);
      assert.equal(panel.classList.contains("global-view-width"), false);
      for (const [shiftKey, expectedBoards, expectedItems] of [
        [false, [20, 30, 40], [40]],
        [true, [30, 20, 10], [10]],
        [false, [20, 30, 40, null, 10, 20], [20]],
        [true, [10, null, 40, 30, 20, 10], [10]],
      ]) {
        act(() => {
          for (const boardId of expectedBoards) {
            press(shiftKey);
            assert.equal(new URL(window.location.href).searchParams.get("board"), boardId === null ? null : String(boardId));
          }
        });
        assert.deepEqual(lastViewItems(), expectedItems);
      }
    } finally {
      act(() => reactRoot.unmount());
      dom.window.close();
      delete global.window;
      delete global.document;
      delete global.IS_REACT_ACT_ENVIRONMENT;
    }
  });
}

test("live updates stay active without a feature flag", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/my-tasks" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const before = reconcileRequests;
  const reactRoot = renderMyTasks(dom);
  try {
    assert.equal(realtimeSubscriptions.at(-1)[2], true);
    assert.equal(reconcileRequests, before + 2, "scope refresh and the always-on snooze refresh each request once");
    assert.ok(dom.window.document.body.textContent.includes("Live list updates on"));
    assert.deepEqual(lastViewItems(), [1, 2, 3, 4]);
  } finally {
    act(() => { reactRoot.unmount(); });
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

for (const enabled of [false, true]) {
  test(`phone layout styles follow their flag (${enabled}) without changing tasks`, () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/my-tasks" });
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    flagValues["htpr-8144-phone-my-tasks"] = enabled;
    const reactRoot = renderMyTasks(dom);
    try {
      assert.equal(dom.window.document.querySelector('[data-testid="my-tasks-panel"]').classList.contains("phone_layout"), enabled);
      assert.deepEqual(lastViewItems(), [1, 2, 3, 4]);
    } finally {
      act(() => { reactRoot.unmount(); });
      dom.window.close();
      flagValues["htpr-8144-phone-my-tasks"] = false;
      delete global.window;
      delete global.document;
      delete global.IS_REACT_ACT_ENVIRONMENT;
    }
  });
}
