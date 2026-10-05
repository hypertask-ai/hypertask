const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flag = "htpr-6938-my-tasks-icon-controls";
const flagName = "HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG";
const controlsFile = "src/app/my-tasks/MyTasksViewControls.tsx";
const tabsFile = "src/app/my-tasks/MyTasksViewTabs.tsx";
const shellFile = "src/components/PageComponents/Kanban/HeaderComponents/ShellViewControls.tsx";
const splitFile = "src/components/Common/TaskRowComponents/TaskListRow.tsx";
const tasksFile = "src/app/my-tasks/MyTasks.tsx";
let enabled = false;
const noop = () => {};
const box = ({ children }) => React.createElement("div", null, children);
const overrides = {
  "react": React,
  "@/hooks/useFlag": { useFlag: (key) => key === flag ? enabled : !["htpr-6567-command-scope-picker", "htpr-6950-tooltip-top-layer"].includes(key) },
  "@/hooks/MultiPages/useClickOutside": { default: noop },
  "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-11 min-w-11" },
  "@/lib/constants/constants": { PriorityConstants: [], EstimateConstants: [] },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext": { useKanbanModalStatesContext: noop },
  "@/lib/state": { useRecoilState: () => [false, noop], useSetRecoilState: () => noop },
  "@/store": {},
  "@/hooks/Task Detail/useTimeTracking": { useBoardRunningTimers: () => ({ timers: new Set() }) },
  "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
  "@/utils/helperFunctions/helperFunctions": { convertToPlain: (value) => value },
  "@/utils/generateTime": { default: noop, formatDueDateDifference: noop },
  "@/components/Common/CommonModalComponents": { ModalRowElementContainer: box },
  "@/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban": { SaveView: () => null },
  "@/components/PageComponents/Kanban/HeaderComponents/SearchFilter": { default: () => null },
  "@/components/Modals/ViewModals/SaveViewModal": { default: () => null },
  "@/components/Modals/AssignToUser/AssignToUser": { default: () => null },
  "./MyTasksInvolvementPicker": { default: () => null },
  "./MyTasksSortPicker": { default: () => null },
  "./MyTasksGroupPicker": { default: () => null },
  "./TaskRowContainer": { default: box },
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const js = ts.transpileModule(read(file), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  new Function("require", "exports", "React", js)((specifier) => {
    if (overrides[specifier]) return { __esModule: true, ...overrides[specifier] };
    if (specifier.endsWith(".scss")) return {};
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` :
        path.relative(root, path.resolve(path.dirname(path.join(root, file)), specifier));
      const target = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]
        .find((candidate) => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
      assert.ok(target, specifier);
      return load(target);
    }
    return require(specifier);
  }, exports, React);
  return exports;
}
const Controls = load(controlsFile).default;
const Tabs = load(tabsFile).default;
const { ViewControlButton } = load(shellFile);
const { SplitTitle } = load(splitFile);
const { DEFAULT_MY_TASKS_VIEW_CONFIG } = load("src/models/MyTasksView.ts");
const { DEFAULT_MY_TASKS_TABLE_COLUMNS } = load("src/utils/helperFunctions/Views/TableColumnsHelperFunctions.ts");
const { readMyTasksViewMemory, rememberMyTasksView } = load("src/lib/myTasksViewMemory.ts");
let dom, reactRoot;
const render = (component, props) => act(() => reactRoot.render(React.createElement(component, props)));
test.beforeEach(() => {
  enabled = false;
  dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/my-tasks" });
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  reactRoot = createRoot(document.getElementById("root"));
});
test.afterEach(() => { act(() => reactRoot.unmount()); dom.window.close(); });
const labels = ["My Tasks involvement", "Configure table columns", "My Tasks scope", "Filter My Tasks", "Sort My Tasks", "Group My Tasks"];
const boards = [{ id: 1, title: "Product", labels: [], sections: [] }, { id: 2, title: "Infra", labels: [], sections: [] }];
const controlProps = (config) => ({ variant: "icons", boards, config, onChange: noop, scopesEnabled: true,
  tableColumnsEnabled: true, timeGroupEnabled: true, onOpenTableColumns: noop, onOpenKanbanFilters: noop });
const trigger = (label) => document.querySelector(`button[aria-label="${label}"]`);

test("flag registration, Owner + QA, and added gates on every changed UI entry", () => {
  assert.match(read("src/lib/flags/keys.ts"), new RegExp(`${flagName} = "${flag}"`));
  assert.match(read("src/lib/flags.ts"), new RegExp(`key: ${flagName},`));
  assert.match(read("src/lib/flags.ts"), /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
  assert.ok(read("tests/feature-flags.test.cjs").includes(flag));
  for (const file of [controlsFile, tabsFile, shellFile, splitFile, tasksFile]) {
    assert.match(read(file), new RegExp(`useFlag\\(${flagName}\\)`), file);
  }
});

test("all six controls reuse icon-only kanban triggers with tooltips and phone targets", () => {
  enabled = true;
  render(Controls, controlProps(structuredClone(DEFAULT_MY_TASKS_VIEW_CONFIG)));
  for (const [index, label] of labels.entries()) {
    const button = trigger(label);
    assert.ok(button, label);
    assert.match(button.className, /group relative flex size-8/);
    assert.match(button.className, /min-h-11 min-w-11 @md:min-h-0 @md:min-w-0/);
    assert.ok(button.querySelector('svg[width="18"][stroke-width="1.75"]'));
    const tooltip = button.querySelector("div.sm\\:scale-0");
    assert.ok(tooltip, label);
    assert.equal(tooltip.textContent.trim(), ["Involvement", "Columns", "Scope", "Filters", "Sort", "Group: Due date"][index]);
    assert.equal([...button.children].filter((child) => child.tagName === "SPAN").length, 0, "no visible text label");
    assert.doesNotMatch(button.className, /text-view-control-active/);
  }
});

test("all six non-default controls are active and retain compact count badges", () => {
  enabled = true;
  const config = structuredClone(DEFAULT_MY_TASKS_VIEW_CONFIG);
  config.scopes = ["assigned", "created", "mentioned", "watching"];
  config.boardIds = [1];
  config.filters.priorityIds = [1];
  config.sort = { field: "title", direction: "desc" };
  config.groupBy = "board";
  config.tableVisibleColumns = DEFAULT_MY_TASKS_TABLE_COLUMNS.slice(0, -1);
  render(Controls, controlProps(config));
  for (const label of labels) assert.match(trigger(label).className, /text-view-control-active hover:text-view-control-active-hover/);
  for (const [label, count] of [[labels[0], "4"], [labels[2], "1"], [labels[3], "1"]]) {
    const badge = trigger(label).querySelector("span.absolute");
    assert.equal(badge.textContent, count);
    assert.match(badge.className, /-right-0\.5 -top-0\.5 text-micro/);
  }
  assert.match(trigger(labels[5]).textContent, /Group: Board/);
  config.boardIds = [2, 1];
  render(Controls, controlProps(config));
  assert.doesNotMatch(trigger(labels[2]).className, /text-view-control-active/);
});

test("6938 off preserves existing labelled controls and shared active styling", () => {
  render(Controls, controlProps(structuredClone(DEFAULT_MY_TASKS_VIEW_CONFIG)));
  for (const label of labels.filter((label) => label !== "Sort My Tasks")) {
    assert.ok(trigger(label).querySelector("span.hidden"));
    assert.doesNotMatch(trigger(label).className, /size-8/);
  }
  render(ViewControlButton, { label: "Sort board", tooltipLeft: -72, onClick: noop, active: true });
  assert.match(trigger("Sort board").className, /text-shadcn-primary/);
  enabled = true;
  render(ViewControlButton, { label: "Sort board", tooltipLeft: -72, onClick: noop, active: true });
  assert.match(trigger("Sort board").className, /text-view-control-active/);
});

test("active semantic token reuses the theme link color defined in all six palettes", () => {
  const config = load("tailwind.config.ts").default;
  assert.deepEqual(config.theme.extend.colors["view-control-active"], {
    DEFAULT: "var(--color-rich-text-link)",
    hover: "var(--color-white-black)",
  });
  assert.match(read(shellFile), /iconControlsEnabled \? "text-view-control-active hover:text-view-control-active-hover"/);
  for (const theme of ["light", "dark", "amoled", "graphite", "porcelain", "dia"]) {
    assert.match(read(`src/styles/tailwindThemes/${theme}.css`), /--color-rich-text-link:\s*#[0-9a-f]{6}/i, theme);
  }
});

test("saved-view and board-split overdue badges expose N overdue and portal hover tooltips only when enabled", () => {
  const views = [{ id: 7, name: "Mine", isDefault: false }];
  const props = { views, activeViewId: null, dirty: false, busy: false, onSelect: noop, overdueAll: 3, overdueByViewId: { 7: 2 } };
  render(Tabs, props);
  assert.equal(document.querySelector('[data-htpr-6459-my-tasks-overdue-badges]').getAttribute("aria-label"), null);
  enabled = true;
  render(Tabs, props);
  for (const count of [3, 2]) {
    const badge = document.querySelector(`span[aria-label="${count} overdue"]`);
    assert.ok(badge);
    act(() => badge.dispatchEvent(new dom.window.MouseEvent("mouseenter")));
    assert.ok([...document.body.querySelectorAll("div.fixed")].some((tooltip) => tooltip.textContent.trim() === `${count} overdue`));
    act(() => badge.dispatchEvent(new dom.window.MouseEvent("mouseleave")));
  }
  render(SplitTitle, { tab: { idx: 1, project: "Product", length: 10, hasUnseen: false, overdueCount: 4 }, isSelected: true, onClick: noop });
  const badge = document.querySelector('span[aria-label="4 overdue"]');
  assert.ok(badge);
  act(() => badge.dispatchEvent(new dom.window.MouseEvent("mouseenter")));
  assert.ok([...document.body.querySelectorAll("div.fixed")].some((tooltip) => tooltip.textContent.trim() === "4 overdue"));
  enabled = false;
  render(SplitTitle, { tab: { idx: 0, project: "All", length: 1, hasUnseen: false, overdueCount: 4 }, isSelected: true, onClick: noop });
  assert.equal(document.querySelector('span[aria-label="4 overdue"]'), null);
  assert.equal(document.querySelector("div.fixed"), null);
});

test("production tab picks persist the selected view only behind 6938 and retain board scope checks", () => {
  const source = ts.createSourceFile(tasksFile, read(tasksFile), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "selectView") expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression);
  const js = ts.transpileModule(`const select = ${expression}; select(selected);`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const run = (on, selected, boardParam = "2") => {
    const writes = [], urls = [], selectedIds = [];
    const context = { selected, boardParam, iconControlsEnabled: on, pickedView: { current: false }, currentUser: { id: 985 },
      views: [{ id: 5, isDefault: true, config: { boardIds: null } }, { id: 7, config: { boardIds: [1] } }],
      rememberMyTasksView: (...args) => writes.push(args), parseMyTasksViewConfig: (value) => value,
      DEFAULT_MY_TASKS_VIEW_CONFIG, setActiveViewId: (id) => selectedIds.push(id), updateViewConfig: noop,
      setFilterOpen: noop, replaceParams: (changes) => urls.push(changes) };
    new Function(...Object.keys(context), js)(...Object.values(context));
    return { writes, urls, selectedIds };
  };
  assert.deepEqual(run(true, 7), { writes: [[985, { viewId: 7, defaultViewId: 5 }]], urls: [{ viewId: 7, boardId: null }], selectedIds: [7] });
  assert.deepEqual(run(true, null).writes, [[985, { viewId: null, defaultViewId: 5 }]]);
  assert.deepEqual(run(false, 7).writes, []);
  assert.deepEqual(run(true, 7, "1").urls, [{ viewId: 7 }]);
});

test("memory isolates users, merges board picks, remembers All, and tolerates invalid or blocked storage", () => {
  rememberMyTasksView(985, { viewId: 7, defaultViewId: 5 });
  rememberMyTasksView(985, { boardId: 2 });
  assert.deepEqual(readMyTasksViewMemory(985), { viewId: 7, defaultViewId: 5, boardId: 2 });
  assert.deepEqual(readMyTasksViewMemory(2343), {});
  rememberMyTasksView(985, { viewId: null, defaultViewId: 5, boardId: null });
  assert.deepEqual(readMyTasksViewMemory(985), { viewId: null, defaultViewId: 5, boardId: null });
  for (const value of ["{", "null", "[]", '{"viewId":-1,"defaultViewId":5,"boardId":"2"}']) {
    window.localStorage.setItem("htpr-6938-my-tasks:985", value);
    assert.deepEqual(readMyTasksViewMemory(985), {});
  }
  Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage blocked"); } });
  assert.deepEqual(readMyTasksViewMemory(985), {});
  assert.doesNotThrow(() => rememberMyTasksView(985, { viewId: 7, defaultViewId: 5 }));
});

// Execute the production restore effect, including its guard against the older
// URL synchronization effect overwriting a restored choice in the same render.
function restoreEffect() {
  const source = ts.createSourceFile(tasksFile, read(tasksFile), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" &&
        node.arguments[0]?.getText(source).includes("readMyTasksViewMemory(currentUser.id)")) effect = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect);
  const js = ts.transpileModule(`const effect = ${effect}; effect();`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return (context) => new Function(...Object.keys(context), js)(...Object.values(context));
}

test("production restore honors explicit URLs, defaults, removed views, flag loading, and stable board IDs", () => {
  const restore = restoreEffect();
  const run = (memory, overrides = {}) => {
    const calls = [];
    const context = { iconControlsEnabled: true, viewsFeatureEnabled: true, memoryRestored: { current: false },
      currentUser: { id: 985 }, readMyTasksViewMemory: () => memory,
      views: [{ id: 5, isDefault: true }, { id: 7, isDefault: false }],
      entryParams: { current: { view: null, board: null } }, pickedView: { current: false }, pickedBoard: { current: false },
      activeViewId: 5, viewParam: null, observedViewParam: { current: undefined },
      setActiveViewId: noop, updateViewConfig: noop, parseMyTasksViewConfig: (value) => value,
      DEFAULT_MY_TASKS_VIEW_CONFIG, replaceBoardParam: (boardId) => calls.push({ boardId }),
      replaceParams: (changes) => calls.push(changes), ...overrides };
    restore(context);
    return { calls, context };
  };
  const memory = { viewId: 7, defaultViewId: 5, boardId: 2 };
  const restored = run(memory);
  assert.deepEqual(restored.calls, [{ viewId: 7, boardId: 2 }]);
  assert.equal(restored.context.observedViewParam.current, null);
  restore(restored.context);
  assert.equal(restored.calls.length, 1, "restore runs once");
  assert.deepEqual(run({ viewId: null, defaultViewId: 5 }).calls, [{ viewId: null }]);
  assert.deepEqual(run({ viewId: 7, defaultViewId: 5 }, { entryParams: { current: { view: "all", board: null } } }).calls, []);
  assert.deepEqual(run(memory, { entryParams: { current: { view: "5", board: "1" } } }).calls, []);
  assert.deepEqual(run({ viewId: 7, defaultViewId: null }).calls, [], "new default beats an older pick");
  assert.deepEqual(run({ viewId: 999, defaultViewId: 5 }).calls, [], "deleted saved view falls back to default");
  assert.deepEqual(run(memory, { iconControlsEnabled: false }).calls, []);
  assert.deepEqual(run(memory, { viewsFeatureEnabled: false }).calls, [{ boardId: 2 }], "board memory also works without saved views");
  assert.deepEqual(run({ viewId: 7, defaultViewId: 5 }, { viewsFeatureEnabled: false }).calls, []);
  assert.deepEqual(run({ viewId: 7, defaultViewId: 5 }, { pickedView: { current: true } }).calls, []);
  assert.deepEqual(run(memory, { pickedBoard: { current: true } }).calls, [{ viewId: 7 }], "new board pick is not overwritten after flags load");
  const source = read(tasksFile);
  assert.match(source, /const selectView[\s\S]*if \(iconControlsEnabled\) rememberMyTasksView\(currentUser.id/);
  assert.match(source, /const updateSplit[\s\S]*rememberMyTasksView\(currentUser.id, \{ boardId: sources\[nextIndex - 1\]\?\.projectId/);
  assert.match(source, /patchView\(viewId, \{ isDefault: true \}\);\s+if \(iconControlsEnabled\) rememberMyTasksView/);
  assert.match(source, /getMyTasksSplitIndex\(boardSplitSources, boardParam\)/);
});
