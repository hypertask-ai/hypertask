const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const boardPath = "src/hooks/Homepage/useHandleKeyDownOperations.ts";
const sectionPath = "src/hooks/Homepage/useSections.ts";
const tablePath = "src/components/PageComponents/Kanban/TableView/";
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function load(file, mocks = {}) {
  const compiled = ts.transpileModule(source(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => name in mocks ? { __esModule: true, ...mocks[name] } : require(name),
    loaded, loaded.exports,
  );
  return loaded.exports;
}

async function fixture(run) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const names = ["window", "document", "navigator", "HTMLElement", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) Object.defineProperty(global, name, {
    configurable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const { createRoot } = require("react-dom/client");
  const reactRoot = createRoot(document.getElementById("root"));
  const press = async (key, overrides = {}) => React.act(async () => {
    document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key, keyCode: key.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true, ...overrides,
    }));
  });
  try { await run({ dom, reactRoot, press }); }
  finally {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

function commonMocks(calls) {
  return {
    "@/hooks/useFlag": { useFlag: (key) => {
      if (key === "htpr-6175-quick-entry-cards") throw new Error("Removed flag must not be read");
      return false;
    } },
    "@/lib/flags/keys": { HTPR_7047_SHARP_PLUS_SIGNS_FLAG: "htpr-7047-sharp-plus-signs" },
    "@/utils/helperFunctions/helperFunctions": {
      throttle: (handler) => handler,
      returnIfModalOrInputActive: () => Boolean(document.querySelector(".modal") || document.activeElement.matches("input,textarea,[contenteditable='true']")),
      isAIChatElementFocused: () => false,
    },
    "@/lib/keyboard/taskShortcuts": load("src/lib/keyboard/taskShortcuts.ts", {
      "@/lib/constants/keyboard-handler": { KeyCodes: {} },
      "@/lib/utils/keyboardShortcuts": {},
    }),
    "@/lib/constants/shortcuts": { isFavoriteBoardShortcut: () => false },
    "@/lib/constants/keyboard-handler": { KeyCodes: { C: 67 } },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "../MultiPages/useAddDeleteTaskInBoards": { default: () => ({ createItem: async () => true }) },
    "@/hooks/MultiPages/useAddDeleteTaskInBoards": { default: () => ({ createItem: async () => true }) },
    "../RecoilRoot/useHypertasksRecoilStates": { default: () => ({ toggleCreateTaskGlobally: (...args) => calls.push(args) }) },
    "@/lib/constants": { default: {} },
    "react-hot-toast": { default: () => {} },
  };
}

const sections = [
  { sectionId: 10, section_title: "Inbox", items: [{ id: 101, ranking: "a" }] },
  { sectionId: 20, section_title: "Doing", items: [{ id: 201, ranking: "b" }] },
];

for (const [surface, key, shiftKey, shortcut] of [
  ["board", "n", false, "N"], ["board", "C", true, "Shift+C"], ["board", "c", true, "Shift+c"],
  ["table", "n", false, "N"], ["table", "C", true, "Shift+C"], ["table", "c", true, "Shift+c"],
]) {
  test(`${surface}: ${shortcut} opens quick entry; plain and Caps Lock C stay unchanged`, async () => fixture(async ({ reactRoot, press }) => {
    const pressQuick = (overrides = {}) => press(key, { shiftKey, ...overrides });
    const calls = [];
    const mocks = commonMocks(calls);
    let activeItem = null;
    let selectedIndex = 0;
    let activeColumn = 0;
    let modalOpen = false;
    const currentProject = { id: 15 };
    const helperGuard = mocks["@/utils/helperFunctions/helperFunctions"].returnIfModalOrInputActive;
    mocks["@/utils/helperFunctions/helperFunctions"].returnIfModalOrInputActive = () => modalOpen || helperGuard();
    let Harness;
    if (surface === "board") {
      const atoms = { activeItemAtom: {}, activeSectionAtom: {}, currentProjectAtom: {}, showCommandsAtom: {}, showBoardManagerAtom: {} };
      Object.assign(mocks, {
        "@/store": atoms,
        "@/lib/state": {
          useRecoilState: (atom) => React.useState(atom === atoms.currentProjectAtom ? currentProject : atom === atoms.showCommandsAtom ? { show: false } : false),
          useRecoilValue: (atom) => atom === atoms.currentProjectAtom ? currentProject : {},
          useSetRecoilState: () => () => {},
        },
        "jotai": { useStore: () => ({ get: (atom) => atom === atoms.activeItemAtom ? activeItem : null }) },
        "next/navigation": { useRouter: () => ({ refresh: () => {} }) },
        "../MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: () => {} }) },
        "@/models/CreateTaskModalModels/model": {},
        "../General/useUndo": { useUndoContext: () => ({ undoData: [] }) },
        "../MultiPages/useUpdateTaskInBoards": { default: () => ({ updateActiveItemAndItemInView: () => {} }) },
        "@tanstack/react-query": { useQueryClient: () => ({}) },
        "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext": { useKanbanModalStatesContext: () => ({}) },
        "@/utils/api/global": {},
        "../../utils/helperFunctions/Views/FilterHelperFunctions": {},
        "../RecoilRoot/useHypertasksRecoilStates": { default: () => ({ resetShowCommands: () => {}, toggleCreateTaskGlobally: (...args) => calls.push(args) }) },
        "@/utils/helperFunctions/Views/SubtaskHelperFunction": {},
        "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveSortingModeFromProject: () => "Manual" },
        "@/utils/helperFunctions/Views/EmptySectionsHelperFunction": {},
        "../useUniversalMovement": { useUniversalMovement: () => ({ refocus: () => {} }) },
        "@/models/enums": { CommandMode: {} },
        "@/hooks/Task Detail/useTimeTracking": {},
        "@/lib/constants/builtinViews": {},
        "./useShowArchivedOnBoard": { useToggleShowArchivedOnBoard: () => () => {} },
        "@/hooks/Homepage/Views/useKanbanViews": { default: () => ({}) },
        "@/utils/generateRank": {},
      });
      const useBoard = load(boardPath, mocks).default;
      const useSections = load(sectionPath, mocks).default;
      const Column = ({ section, index }) => {
        const state = useSections({ items: section.items, active: index === activeColumn, index, title: section.section_title, sectionId: section.sectionId, projectId: 15 });
        return React.createElement("div", { ref: state.sectionRef, className: "section-container", tabIndex: 0, "data-column": section.sectionId },
          React.createElement("div", { id: `task-${section.items[0].id}`, tabIndex: 0 }, "Task"),
          state.showAddItem && React.createElement("input", { "data-quick": section.sectionId, ref: state.bottomInputRef, "data-position": state.position }),
        );
      };
      Harness = () => {
        useBoard({ initialSections: sections, filteredSections: sections });
        return React.createElement("div", { id: "sectionsContainer" }, sections.map((section, index) => React.createElement(Column, { key: section.sectionId, section, index })));
      };
    } else {
      Object.assign(mocks, {
        "./tableCreateTask": load(`${tablePath}tableCreateTask.ts`),
        "@/lib/keyboard/archiveShortcutGuard": {},
        "./tableViewShared": { isTaskRow: (row) => row?.type === "task" },
        "./TableCreateTaskButton": { TableCreateTaskButton: ({ labels }) => React.createElement("button", { title: labels.title }, "New task") },
        "../../../Common/newTask": { default: ({ invokeCreateItem }) => React.createElement("input", { "data-quick": "table", ref: (element) => { if (element) element.quickCreate = invokeCreateItem; } }) },
      });
      const useTable = load(`${tablePath}useTableKeyboard.ts`, mocks).useTableKeyboard;
      const Control = load(`${tablePath}TableCreateTaskControl.tsx`, mocks).TableCreateTaskControl;
      Harness = () => {
        const rows = [{ type: "task", sid: 10 }, { type: "task", sid: 20 }];
        const context = { _currentProject: currentProject, rows, selectedIndex, sections, toggleCreateTaskGlobally: (payload) => calls.push([payload]), showCommands: { show: false }, lastGAt: { current: null }, timerToggling: { current: false }, runTaskShortcut: () => false };
        useTable(context);
        return React.createElement(Control, { hasCurrentProject: true, projectId: 15, rows, selectedIndex, sections, toggleCreateTaskGlobally: context.toggleCreateTaskGlobally, quickCreateTask: (...args) => { calls.push(args); return Promise.resolve(true); } });
      };
    }
    const render = async () => React.act(async () => reactRoot.render(React.createElement(Harness)));
    await render();
    if (surface === "table") assert.equal(document.querySelector("button").title,
      "Create task in the selected column (N / Shift+C)");
    await pressQuick();
    assert.equal(Boolean(document.querySelector("[data-quick]")), true);
    assert.equal(calls.length, 0, "quick add never opens the full editor");
    calls.length = 0;
    // Remount closes quick entry without changing the keyboard code under test.
    await React.act(async () => reactRoot.render(null));
    await render();
    await press("c");
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].sectionId, 10);
    assert.equal(document.querySelector("[data-quick]"), null);
    calls.length = 0;
    await React.act(async () => reactRoot.render(null));
    await render();
    await press("C", { shiftKey: false });
    assert.equal(calls.length, surface === "board" ? 1 : 0, "Caps Lock C keeps each surface's existing behavior");
    assert.equal(document.querySelector("[data-quick]"), null);
    calls.length = 0;
    await React.act(async () => reactRoot.render(null));
    await render();
    // Isolate the new listener from existing Ctrl/Alt+C column shortcuts.
    activeColumn = -1;
    await render();
    for (const overrides of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, ...(!shiftKey ? [{ shiftKey: true }] : []), { repeat: true }, { isComposing: true }]) {
      await pressQuick(overrides);
      assert.equal(document.querySelector("[data-quick]"), null);
    }
    calls.length = 0;
    for (const tag of ["input", "textarea", "select", "div"]) {
      const typing = document.createElement(tag);
      if (tag === "div") typing.setAttribute("contenteditable", "true");
      typing.tabIndex = 0;
      document.body.append(typing);
      typing.focus();
      await pressQuick();
      assert.equal(document.querySelector("[data-quick]"), null, `${tag} must keep ${shortcut}`);
      assert.equal(calls.length, 0, `${tag} must not open the full editor`);
      typing.remove();
    }
    modalOpen = true;
    await pressQuick();
    assert.equal(document.querySelector("[data-quick]"), null);
    modalOpen = false;
    activeColumn = 1;
    selectedIndex = 1;
    activeItem = 201;
    await render();
    if (surface === "board") document.getElementById("task-201").focus();
    await pressQuick();
    const quick = document.querySelector("[data-quick]");
    assert.ok(quick);
    assert.equal(calls.length, 0, "focused quick add must not also open the full editor");
    if (surface === "board") {
      assert.equal(quick.dataset.quick, "20");
      assert.equal(quick.dataset.position, "bottom");
    } else {
      await quick.quickCreate("Typed title");
      assert.deepEqual(calls.pop(), ["Typed title", 15, 20, "Doing"]);
    }
    await React.act(async () => reactRoot.render(null));
    activeItem = null;
    selectedIndex = -1;
    await render();
    if (surface === "board") document.querySelector('[data-column="20"]').focus();
    await pressQuick();
    const columnQuick = document.querySelector("[data-quick]");
    if (surface === "board") {
      assert.equal(columnQuick.dataset.quick, "20", "focused column wins");
      await React.act(async () => reactRoot.render(null));
      activeItem = 201;
      await render();
      await pressQuick();
      assert.equal(document.querySelector("[data-quick]").dataset.quick, "20", "active task supplies its column when DOM focus is absent");
      await React.act(async () => reactRoot.render(null));
      activeItem = null;
      await render();
      await pressQuick();
      assert.equal(document.querySelector("[data-quick]").dataset.quick, "10", "no column or task focus falls back to the first column");
    } else {
      await columnQuick.quickCreate("Fallback");
      assert.deepEqual(calls.pop(), ["Fallback", 15, 10, "Inbox"]);
    }
  }));
}

test("table: N and Shift+C keep working across rerenders with every context dependency stable", async () => fixture(async ({ reactRoot, press }) => {
  const calls = [];
  const useTable = load(`${tablePath}useTableKeyboard.ts`, {
    ...commonMocks(calls),
    "./tableCreateTask": load(`${tablePath}tableCreateTask.ts`),
    "@/lib/keyboard/archiveShortcutGuard": {},
    "./tableViewShared": { isTaskRow: (row) => row?.type === "task" },
  }).useTableKeyboard;
  const context = {
    _currentProject: { id: 15 }, rows: [{ type: "task", sid: 10 }], selectedIndex: 0,
    sections, toggleCreateTaskGlobally: (payload) => calls.push(payload),
    showCommands: { show: false }, lastGAt: { current: null },
    timerToggling: { current: false }, runTaskShortcut: () => false,
  };
  const Harness = () => { useTable(context); return null; };
  let opened = 0;
  document.addEventListener("OPEN_TABLE_QUICK_ENTRY", () => opened++);
  for (let renderCount = 0; renderCount < 5; renderCount++) {
    await React.act(async () => reactRoot.render(React.createElement(Harness)));
    const before = opened;
    await press("n");
    assert.equal(opened - before, 1);
    assert.equal(calls.length, 0);
    for (const key of ["C", "c"]) {
      const beforeShift = opened;
      await press(key, { shiftKey: true });
      assert.equal(opened - beforeShift, 1);
      assert.equal(calls.length, 0);
    }
  }
}));

test("mobile classic form: N stays inline", async () => fixture(async ({ dom, reactRoot }) => {
  const calls = [];
  const atoms = { activeItemAtom: {}, currentProjectAtom: {} };
  const useSections = load(sectionPath, {
    ...commonMocks(calls),
    "@/store": atoms,
    "@/lib/state": { useRecoilState: () => React.useState({ id: 15 }), useSetRecoilState: () => () => {} },
    "jotai": { useStore: () => ({ get: () => null }) },
    "next/navigation": { useRouter: () => ({}) },
    "../MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: () => {} }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(true) },
  }).default;
  let state;
  const Harness = () => {
    state = useSections({ items: [], active: false, index: 0, title: "Inbox", sectionId: 10, projectId: 15 });
    return React.createElement("div", { ref: state.sectionRef, "data-column": "10" },
      state.showAddItem && React.createElement("input", { "data-quick": "10", "data-position": state.position }));
  };
  await React.act(async () => reactRoot.render(React.createElement(Harness)));
  await React.act(async () => document.querySelector("[data-column]").dispatchEvent(new dom.window.CustomEvent("OPEN_QUICK_ENTRY")));
  assert.equal(Boolean(document.querySelector("[data-quick]")), true);
  assert.equal(calls.length, 0, "N must never open the full mobile editor");
  assert.equal(document.querySelector("[data-quick]").dataset.position, "bottom");
  await React.act(async () => state.createTaskAt("bottom", { sectionId: 10 }, undefined, true));
  assert.equal(calls.length, 0, "the plus button keeps the classic inline entry");
  assert.equal(Boolean(document.querySelector("[data-quick]")), true);
  assert.equal(document.querySelector("[data-quick]").dataset.position, "bottom");
}));

test("bottom shortcut hint shows N / Shift+C; top hint and clicks stay unchanged", async () => fixture(async ({ reactRoot }) => {
  const calls = [];
  const Button = load("src/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton.tsx", {
    ...commonMocks(calls),
    "@/components/Common/Tooltip": { default: ({ keyCombination }) => React.createElement("span", { "data-keys": keyCombination.join("+") }) },
  }).default;
  const payload = { sectionId: 10 };
  for (const position of ["top", "bottom"]) {
    await React.act(async () => reactRoot.render(React.createElement(Button, {
      buttonPosition: position, sectionPayload: payload, createTaskAt: (...args) => calls.push(args),
    })));
    assert.equal(document.querySelector("[data-keys]").dataset.keys, position === "bottom" ? "N / Shift+C" : "C");
    await React.act(async () => document.querySelector("#root > div").click());
    assert.deepEqual(calls.pop(), [position, payload, undefined, true]);
  }
}));

test("retired definition is absent, reused hints and existing full-editor scope are explicit", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", path.basename(__filename, ".test.cjs") + ".ts")), false);
  assert.match((source("src/lib/flags.ts") + require("./helpers/flag-files.cjs").source()), /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
  assert.match(source("src/components/Global/BottomSettings_QuickTips.tsx"), /boardTips=\{boardTips\.map[\s\S]*key: \["N \/ Shift\+C"\]/);
  assert.match(source("src/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton.tsx"), /keyCombination=\{\["N \/ Shift\+C"\]\}/);
  assert.match(source(sectionPath), /useEffect\(\(\) => \{[\s\S]*?addEventListener\("OPEN_QUICK_ENTRY"/);
  assert.match(source(boardPath), /if \(returnIfModalOrInputActive\(\)\) return/);
  assert.match(source(`${tablePath}useTableKeyboard.ts`), /returnIfModalOrInputActive\(\)/);
  assert.match(source("src/components/Common/newTask.tsx"), /e.key === "Enter"/);
  assert.match(source("src/components/Common/newTask.tsx"), /e.key === "Escape"/);
  assert.doesNotMatch(source("src/components/Common/newTask.tsx"), /toggleCreateTaskGlobally/);
});


test("global quick-add hints always include N / Shift+C", () => {
  const file = "src/components/Global/BottomSettings_QuickTips.tsx";
  const text = source(file);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  let prop;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "boardTips") initializer = node.initializer.getText(ast);
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "boardTips") prop = node.initializer.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer && prop);
  const hints = new Function("KanbanTipsConstants", `const boardTips = ${initializer}; return ${prop};`);
  const original = { key: ["C"], hint: "add task" };
  assert.deepEqual(hints([original]), [original, { key: ["N / Shift+C"], hint: "quick add" }]);
});
