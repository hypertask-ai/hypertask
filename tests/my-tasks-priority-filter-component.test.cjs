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

stubSourceModule("src/hooks/useFlag.tsx", {
  useFlag: (key) => flagValues[key] ?? false,
});
stubSourceModule("src/lib/state.tsx", {
  useRecoilValue: () => false,
});
stubSourceModule("src/store/index.ts", {
  appShellRailAtom: {},
  showCommandsAtom: { show: false },
});
stubModule(require.resolve("next/navigation"), {
  useRouter: () => ({ back: () => { backCalls += 1; } }),
});
stubSourceModule("src/components/PageComponents/Kanban/TableView/TableView.tsx", {
  default: (props) => {
    tableViewProps.push(props);
    return null;
  },
});
stubSourceModule("src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx", {
  default: () => null,
});
stubSourceModule("src/components/Buttons/BackButton.tsx", {
  default: () => null,
});
stubSourceModule("src/components/Common/TaskRowComponents/TaskListRow.tsx", {
  SplitTitle: () => null,
});
stubSourceModule("src/styles/search.module.scss", {
  links_modal: "",
});
stubSourceModule("src/utils/undoActions/helperFuncs.ts", {
  cn: (...args) => args.filter(Boolean).join(" "),
});

// jiti compiles JSX with the classic transform, so components without an
// explicit React import need one in scope.
global.React = React;

const MyTasks = jiti(path.join(root, "src/app/my-tasks/MyTasks.tsx")).default;
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
