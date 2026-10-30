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
const controlsFile = "src/app/my-tasks/MyTasksViewControls.tsx";
const tabsFile = "src/app/my-tasks/MyTasksViewTabs.tsx";
const sortFile = "src/components/Modals/Kanban/BoardPriorityMode.tsx";
const saveFile = "src/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban.tsx";
const modalFile = "src/components/Modals/ViewModals/SaveViewModal.tsx";
const commandsFile = "src/components/Modals/commands/HTC/commands.tsx";
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { boardCommands } = jiti(path.join(root, "src/components/Modals/commands/HTC/domains/boardCommands.ts"));

function parsed(file) {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function declaration(file, name) {
  const source = parsed(file);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Missing ${name}`);
  return found.getText(source);
}

test("retired kanban reuse key is absent from the registry and controls are permanent", () => {
  assert.equal(require("./helpers/flag-files.cjs").definitions().some(({ key }) => key === "htpr-6930-my-tasks-kanban-reuse"), false, "retired key is absent from registry");
  for (const file of [controlsFile, tabsFile, sortFile, saveFile, modalFile, commandsFile,
    "src/app/my-tasks/MyTasksInvolvementPicker.tsx", "src/app/my-tasks/MyTasksGroupPicker.tsx",
    "src/app/my-tasks/MyTasksSortPicker.tsx",
    "src/components/Modals/OptionPicker/index.tsx",
    "src/components/PageComponents/Kanban/TableView/TableColumnsPicker.tsx",
    "src/components/PageComponents/Kanban/HeaderComponents/ShellViewControls.tsx",
    "src/components/Modals/FilterModals/SelectFilters/ShowFilterOptionsModal.tsx"]) {
    assert.doesNotMatch(read(file), /kanbanReuseEnabled|styleGuideEnabled/, file);
  }
});

test("All boards toggles through setBoards in AssignModal and the legacy filter row", () => {
  const source = read(controlsFile);
  const toggle = /setBoards\(config\.boardIds === null \? \[\] : null\)/g;
  assert.equal([...source.matchAll(toggle)].length, 2);
  assert.match(source, /onSelect: \(id\) => id === null \? setBoards\(config\.boardIds === null/);
  assert.match(source, /sectionIds: config\.filters\.sectionIds\.filter/);
  assert.match(source, /labelIds: config\.filters\.labelIds\.filter/);
  assert.match(read("src/components/Modals/AssignToUser/AssignToUser.tsx"), /\{boardPicker \? \(/);
});

test("picker adapters reuse OptionPicker and preserve involvement fallback and group values", () => {
  const involvement = read("src/app/my-tasks/MyTasksInvolvementPicker.tsx");
  const group = read("src/app/my-tasks/MyTasksGroupPicker.tsx");
  assert.match(involvement, /<OptionPickerModal/);
  assert.match(involvement, /checked: scopes\.includes\(scope\)/);
  assert.doesNotMatch(involvement, /onClose\(\)/);
  assert.match(read(controlsFile), /scopes: next\.length > 0 \? next : \["assigned"\]/);
  assert.match(group, /id: "time", label: "Due date", hint: "Overdue, Later, No due date"/);
  assert.match(group, /onChange\(option\.id\);\s+onClose\(\);/);
  assert.match(read(controlsFile), /Group: \$\{groupBy === "time" \? "Due date" : "Board"\}/);
});

test("sort adapter uses controlled BoardPriorityMode and keeps board outside the Prisma enum", () => {
  const source = read("src/app/my-tasks/MyTasksSortPicker.tsx");
  assert.match(source, /<BoardPriorityMode[\s\S]*sort=\{level\}[\s\S]*onSortChange=/);
  assert.match(source, /maxLevels=\{1\}/);
  for (const [field, mode] of Object.entries({ dueDate: "DueDate", priority: "Priority", createdAt: "CreatedAt", updatedAt: "UpdatedAt", title: "Title" })) {
    assert.match(source, new RegExp(`${field}: "${mode}"`));
  }
  assert.match(source, /id: "board" as const, label: "Board"/);
  assert.match(source, /sort\.direction === "asc" \? "Ascending" : "Descending"/);
  assert.match(source, /next\.order === "Ascending" \? "asc" : "desc"/);
  assert.doesNotMatch(source, /as SortingMode|as TBoardSortingLevel/);
  assert.match(read(sortFile), /replaceSingleLevel = isControlled && maxLevels === 1/);
  assert.match(read(sortFile), /\.\.\.\(replaceSingleLevel \? \[\] : levels\)/);
  assert.match(read(sortFile), /replaceSingleLevel \|\| levels\.length < maxLevels/);
  assert.match(read(controlsFile), /<ViewControlButton[\s\S]*<ArrowUpDown size=\{18\} strokeWidth=\{1\.75\}/);
});

test("Commands uses board picker commands and dispatches matching local events", () => {
  const memo = declaration(commandsFile, "allCommands_");
  assert.match(memo, /getBoardCommands\(\{[\s\S]*?onMyTasks[\s\S]*?myTasksViewsEnabled[\s\S]*?myTasksScopesEnabled/);
  assert.match(memo, /group: "Boards", commandLists: boardCommands/);
  const options = { projects: [], onMyTasks: true, myTasksViewsEnabled: true, myTasksFilterParityEnabled: true, myTasksScopesEnabled: true, columnArchiveEnabled: false };
  const keys = (changes) => boardCommands({ ...options, ...changes }).map(({ key }) => key);
  assert.deepEqual(keys({}), ["myTasksScope", "myTasksInvolvement", "myTasksSort", "myTasksGroup"]);
  assert.deepEqual(keys({ onMyTasks: false }), []);
  assert.deepEqual(keys({ myTasksViewsEnabled: false, myTasksScopesEnabled: false }), ["myTasksGroup"]);
  for (const [key, event] of Object.entries({ myTasksInvolvement: "my-tasks-involvement-picker", myTasksSort: "my-tasks-sort-picker", myTasksGroup: "my-tasks-group-picker" })) {
    assert.match(read(commandsFile), new RegExp(`${key}: "${event}"`));
    assert.match(read(controlsFile), new RegExp(`addEventListener\\("${event}"`));
    assert.match(read(controlsFile), new RegExp(`removeEventListener\\("${event}"`));
  }
  assert.match(read(commandsFile), /if \(onMyTasks\) window\.dispatchEvent/);
});

test("commands cached by search disappear when the route leaves My Tasks", () => {
  const source = parsed(commandsFile);
  let expression;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "filterCommands" &&
      node.parent.parent.tagName?.getText(source) === "CommandGroups") expression = node.initializer.expression;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression);
  const js = ts.transpileModule(`const result = ${expression.getText(source)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const evaluate = new Function("onMyTasks", "filterCommands", "removeImageGeneration", `${js}; return result;`);
  const keys = ["myTasksScope", "myTasksInvolvement", "myTasksSort", "myTasksGroup", "otherCommand"];
  const groups = [{ commandLists: keys.map((key) => ({ key })) }];
  const result = (route) => evaluate(route, groups, false)[0].commandLists.map((row) => row.key);
  assert.deepEqual(result(true), keys, "My Tasks keeps every picker command");
  assert.deepEqual(result(false), ["myTasksScope", "otherCommand"]);
});

test("shared SaveView is the only save path and personal choices never use board state", () => {
  const tabs = read(tabsFile);
  assert.doesNotMatch(tabs, /Save as view|onClick=\{saveAs\}|onClick=\{onSave\}|onClick=\{onReset\}/);
  assert.match(tabs, /\{saveOpen && \(\s*<SaveViewModal/);
  assert.match(tabs, /<SaveView variant="shell" dirty=\{dirty\} busy=\{busy\} onReset=\{onReset\} onSaveClick=/);
  assert.match(tabs, /<SaveViewModal[\s\S]*personal=\{\{[\s\S]*canSaveCurrent: Boolean\(activeView\)/);
  assert.match(tabs, /onSaveCurrent: onSave, onCreate: onSaveAs, onReset/);
  const controlled = declaration(saveFile, "SaveView");
  assert.match(controlled, /"dirty" in props[\s\S]*<ShellSaveView/);
  assert.doesNotMatch(controlled, /useKanbanViews|useKanbanModalStatesContext/);
  const personal = declaration(modalFile, "SaveViewModal");
  assert.match(personal, /personal\.canSaveCurrent \? \["Save to current view"\] : \[\]/);
  assert.match(personal, /"New personal view"[\s\S]*"Reset"/);
  assert.doesNotMatch(personal, /useKanbanViews|IProject|Public|SaveForTeam|everyone/);
  for (const label of ["Rename", "Set as default", "Delete"]) assert.ok(tabs.includes(label));
});

test("Check icons use the bare house mark and Columns retains locks, drag handles and checkbox accessibility", () => {
  for (const file of [controlsFile, "src/components/Modals/OptionPicker/index.tsx", "src/components/PageComponents/Kanban/TableView/TableColumnsPicker.tsx"]) {
    assert.match(read(file), /<Check size=\{16\} strokeWidth=\{1\.75\} \/>/);
  }
  assert.match(read("src/components/Modals/OptionPicker/index.tsx"), /checked\?: boolean/);
  assert.match(read("src/components/Modals/OptionPicker/index.tsx"), /checkedIcon = <Check/);
  assert.match(read("src/components/Modals/OptionPicker/index.tsx"), /option\.checked && checkedIcon/);
  const columns = read("src/components/PageComponents/Kanban/TableView/TableColumnsPicker.tsx");
  for (const text of ['role="checkbox"', "aria-checked={isChecked}", "dragProvided.dragHandleProps", "isDragDisabled={isLocked}", "if (lockedColumns.has(column)) return"]) assert.ok(columns.includes(text));
  assert.match(columns, /\{isChecked && checkedIcon\}/);
});

let boardHookCalls = 0;
let changeName;
const noop = () => {};
const box = ({ children }) => React.createElement("div", null, children);
const overrides = {
  "react": React,
  "reactstrap": { ModalBody: box },
  "@/hooks/useFlag": { useFlag: (key) => key !== "htpr-6938-my-tasks-icon-controls" },
  "@/hooks/MultiPages/useClickOutside": { default: noop },
  "@/hooks/General/useHandleMouse": { default: ({ setSelectedIndex }) => ({ handleMouseEnter: setSelectedIndex, handleMouseLeave: noop, handleMouseMove: noop, elRef: React.useRef(null) }) },
  "@/hooks/General/useHandleKeydownBasic": { default: () => { const [selectedIndex, setSelectedIndex] = React.useState(0); return { selectedIndex, setSelectedIndex, handleKeydown: noop }; } },
  "@/hooks/General/useCurrentUserCheckFromCookies": { default: () => ({ id: 985 }) },
  "@/hooks/Homepage/Views/useKanbanViews": { default: () => { boardHookCalls += 1; return { setBoardSortingViewAndReturn: () => { throw new Error("Unexpected board write"); } }; } },
  "@/lib/state": { useRecoilState: () => [null, noop], useRecoilValue: () => null, useSetRecoilState: () => noop },
  "@/store": {},
  "@/utils/helperFunctions/Views/ViewsHelperFunctions": {
    MAX_SORT_LEVELS: 3, getActiveSortingModeFromProject: () => "Manual",
    getActiveSortingOrderFromProject: () => "Ascending", getActiveSortingStackFromProject: () => [],
  },
  "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-11 min-w-11" },
  "@/lib/constants/constants": { PriorityConstants: [], EstimateConstants: [] },
  "@/lib/filterSettingsMutations": { myTasksParityFilterCount: () => 0, migrateFlatFiltersToFilterSettings: () => ({}) },
  "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext": { useKanbanModalStatesContext: () => { throw new Error("Unexpected board modal context"); } },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/hooks/Task Detail/useTimeTracking": { useBoardRunningTimers: () => ({ timers: new Set() }) },
  "@/components/Common/Tooltip": { default: () => null },
  "@/components/PageComponents/Kanban/HeaderComponents/SearchFilter": { default: () => null },
  "@/components/Modals/AssignToUser/AssignToUser": { default: ({ boardPicker }) => React.createElement("div", null, boardPicker.options.map((option, index) => React.createElement("button", { key: index, onClick: () => boardPicker.onSelect(option.id) }, option.label))) },
  "@/components/Common/CommonModalComponents": {
    ModalContainerCustom: box, ModalListContainer: box,
    ModalHeaderComp: ({ header }) => React.createElement("h2", null, header),
    ModalInput: ({ value, onChange, placeholder }) => {
      if (placeholder === "Name your view") changeName = onChange;
      return React.createElement("input", { value, onChange, placeholder });
    },
    ModalRowElementContainer: ({ children, onClick, role, ...props }) => React.createElement("button", { onClick, role, id: props.id, "aria-checked": props["aria-checked"] }, children),
  },
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const filename = path.join(root, file);
  const exports = {};
  cache.set(file, exports);
  const js = ts.transpileModule(read(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function("require", "exports", "React", js)((specifier) => {
    if (overrides[specifier]) return { __esModule: true, ...overrides[specifier] };
    if (specifier.endsWith(".scss")) return {};
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : path.relative(root, path.resolve(path.dirname(filename), specifier));
      const target = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((candidate) => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
      assert.ok(target, `Missing import ${specifier}`);
      return load(target);
    }
    return require(specifier);
  }, exports, React);
  return exports;
}
const Controls = load(controlsFile).default;
const Tabs = load(tabsFile).default;
const Sort = load(sortFile).default;
const { SaveView } = load(saveFile);
const SaveModal = load(modalFile).default;
const { DEFAULT_MY_TASKS_VIEW_CONFIG } = load("src/models/MyTasksView.ts");
const boards = [{ id: 1, title: "Alpha", sections: [{ id: 11, title: "Todo" }], labels: [{ id: "a" }] }];
let dom, reactRoot, config;
const click = (element) => act(() => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
const button = (label) => [...document.querySelectorAll("button")].find((element) => element.textContent === label);
const render = (component, props) => act(() => reactRoot.render(React.createElement(component, props)));
function Harness() {
  const [value, setValue] = React.useState(config);
  config = value;
  return React.createElement(Controls, { boards, config: value, onChange: setValue, scopesEnabled: true });
}
test.beforeEach((context) => {
  boardHookCalls = 0;
  config = structuredClone(DEFAULT_MY_TASKS_VIEW_CONFIG);
  dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/my-tasks" });
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = noop;
  reactRoot = createRoot(document.getElementById("root"));
  context.mock.timers.enable({ apis: ["setTimeout"] });
});
test.afterEach(() => { act(() => reactRoot.unmount()); dom.window.close(); });

test("shared pickers and SaveView replace legacy native controls and standalone saving", () => {
  render(Harness);
  click(document.querySelector('[aria-label="My Tasks involvement"]'));
  assert.equal(document.querySelector("h2").textContent, "Involvement");
  assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 0);
  click(document.querySelector('[aria-label="Sort My Tasks"]'));
  assert.ok(button("Priority"));
  assert.equal(document.querySelectorAll("select").length, 0);
  const props = { views: [], activeViewId: null, dirty: false, busy: false, onSaveAs: noop, onReset: noop, onSave: noop };
  render(Tabs, props);
  assert.equal(button("Save view").tabIndex, -1);
  assert.equal(button("New personal view"), undefined);
  render(Tabs, { ...props, dirty: true });
  assert.equal(button("Save as view"), undefined);
  assert.ok(button("Save view"));
  click(button("Save view"));
  assert.ok(button("New personal view"));
});

test("All boards toggles null to empty and back, pruning filters", () => {
  config.filters.sectionIds = [11]; config.filters.labelIds = ["a"];
  render(Harness);
  click(document.querySelector('[aria-label="My Tasks scope"]'));
  click(button("All boards"));
  assert.deepEqual(config.boardIds, []);
  assert.deepEqual(config.filters.sectionIds, []);
  assert.deepEqual(config.filters.labelIds, []);
  click(button("All boards"));
  assert.equal(config.boardIds, null);
});

test("involvement picker stays open, shows Check membership and falls back to assigned", (context) => {
  render(Harness);
  act(() => window.dispatchEvent(new Event("my-tasks-involvement-picker")));
  click(button("Created by me")); act(() => context.mock.timers.tick(1));
  assert.deepEqual(config.scopes, ["assigned", "created"]);
  assert.ok(button("Created by me").querySelector('svg[width="16"][stroke-width="1.75"]'));
  click(button("Assigned to me")); act(() => context.mock.timers.tick(1));
  click(button("Created by me")); act(() => context.mock.timers.tick(1));
  assert.deepEqual(config.scopes, ["assigned"]);
  assert.ok(document.querySelector("h2"));
  assert.equal(document.querySelector('input[type="checkbox"]'), null);
});

test("HTPR-6958 keeps Group by in phone Commands and the desktop toolbar without adding a phone row", (context) => {
  render(Harness);
  assert.ok(button("Group: Due date"));
  assert.equal(document.querySelector('[aria-label="Group My Tasks"]').parentElement.className, "relative hidden @md:block");
  act(() => window.dispatchEvent(new Event("my-tasks-group-picker")));
  assert.ok(button("Due dateOverdue, Later, No due date").querySelector("svg"));
  click(button("Board")); act(() => context.mock.timers.tick(1));
  assert.equal(config.groupBy, "board");
  assert.equal(document.querySelector("h2"), null);
  assert.ok(button("Group: Board"));
});

test("controlled single-level sort replaces the field and never writes a board", async () => {
  let next, closed = false;
  const props = { sort: { mode: "DueDate", order: "Ascending" }, maxLevels: 1,
    onSortChange: (value) => { next = value; }, closeHandler: () => { closed = true; } };
  render(Sort, props);
  assert.ok(button("Priority"));
  await act(async () => click(button("Priority")));
  assert.deepEqual(next, { mode: "Priority", order: "Descending" });
  assert.equal(closed, true);
});

test("My Tasks sort picker preserves saved board sorting and maps direction without unsupported modes", async () => {
  config.sort = { field: "board", direction: "desc" };
  render(Harness);
  act(() => window.dispatchEvent(new Event("my-tasks-sort-picker")));
  assert.match(document.body.textContent, /BoardDescending/);
  assert.equal(button("Size"), undefined);
  await act(async () => click(button("Priority")));
  assert.deepEqual(config.sort, { field: "priority", direction: "desc" });
  assert.equal(document.querySelector("h2"), null);
});

test("controlled Save pills retain kanban animation, obey dirty and busy and never use board hooks", () => {
  let saves = 0, resets = 0;
  const props = { variant: "shell", dirty: false, busy: false, onSaveClick: () => { saves += 1; }, onReset: () => { resets += 1; } };
  render(SaveView, props);
  assert.equal(button("Save view").tabIndex, -1);
  assert.deepEqual([...document.querySelectorAll("button")].map((row) => row.textContent), ["Reset", "Save view"]);
  assert.match(button("Save view").className, /rounded-\[4px\] bg-shadcn-primary/);
  assert.match(button("Reset").className, /rounded-\[4px\] px-2 text-text-light-gray/);
  assert.match(button("Save view").parentElement.className, /max-w-0/);
  render(SaveView, { ...props, dirty: true });
  assert.match(button("Save view").parentElement.className, /max-w-\[144px\]/);
  click(button("Save view")); click(button("Reset"));
  assert.equal(saves, 1); assert.equal(resets, 1);
  render(SaveView, { ...props, dirty: true, busy: true });
  assert.equal(button("Save view").disabled, true);
  assert.equal(button("Reset").disabled, true);
  assert.equal(boardHookCalls, 0);
});

test("personal Save modal has only current, new personal and reset choices with no board persistence", async () => {
  let saved = 0, reset = 0, created;
  const personal = { canSaveCurrent: true, busy: false, onSaveCurrent: () => { saved += 1; }, onCreate: (name) => { created = name; }, onReset: () => { reset += 1; } };
  render(SaveModal, { toggle: noop, personal });
  assert.deepEqual([...document.querySelectorAll("button")].map((row) => row.textContent), ["Save to current view", "New personal view", "Reset"]);
  await act(async () => click(button("Save to current view")));
  assert.equal(saved, 1);
  await act(async () => click(button("Reset")));
  assert.equal(reset, 1);
  await act(async () => click(button("New personal view")));
  assert.ok(document.querySelector('[placeholder="Name your view"]'));
  act(() => changeName({ target: { value: "  Personal view  " } }));
  await act(async () => click(button("Save view")));
  assert.equal(created, "Personal view");
  assert.equal(boardHookCalls, 0);
});

test("personal Save modal on All omits current save, and busy callbacks cannot run", async () => {
  let calls = 0;
  render(SaveModal, { toggle: noop, personal: { canSaveCurrent: false, busy: true, onSaveCurrent: noop, onCreate: noop, onReset: () => { calls += 1; } } });
  assert.deepEqual([...document.querySelectorAll("button")].map((row) => row.textContent), ["New personal view", "Reset"]);
  await act(async () => click(button("Reset")));
  assert.equal(calls, 0);
  assert.equal(boardHookCalls, 0);
});
