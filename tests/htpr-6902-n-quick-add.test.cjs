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
const nFlag = "htpr-6902-n-quick-add";
const quickFlag = "htpr-6175-quick-entry-cards";
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

function commonMocks(flags, calls) {
  return {
    "@/hooks/useFlag": { useFlag: (key) => flags[key] === true },
    "@/lib/flags/keys": { HTPR_6902_N_QUICK_ADD_FLAG: nFlag, HTPR_6175_QUICK_ENTRY_CARDS_FLAG: quickFlag },
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

for (const surface of ["board", "table"]) {
  for (const [nEnabled, quickEnabled] of [[true, true], [false, true], [true, false], [false, false]]) {
    test(`${surface}: N requires both flags (${nEnabled}/${quickEnabled}); C stays the full editor`, async () => fixture(async ({ reactRoot, press }) => {
      const flags = { [nFlag]: nEnabled, [quickFlag]: quickEnabled };
      const calls = [];
      const mocks = commonMocks(flags, calls);
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
          "./TableCreateTaskButton": { TableCreateTaskButton: () => React.createElement("button", null, "New task") },
          "../../../Common/newTask": { default: ({ invokeCreateItem }) => React.createElement("input", { "data-quick": "table", ref: (element) => { if (element) element.quickCreate = invokeCreateItem; } }) },
        });
        const useTable = load(`${tablePath}useTableKeyboard.ts`, mocks).useTableKeyboard;
        const Control = load(`${tablePath}TableCreateTaskControl.tsx`, mocks).TableCreateTaskControl;
        Harness = () => {
          const rows = [{ type: "task", sid: 10 }, { type: "task", sid: 20 }];
          const context = { _currentProject: currentProject, rows, selectedIndex, sections, toggleCreateTaskGlobally: (payload) => calls.push([payload]), showCommands: { show: false }, lastGAt: { current: null }, timerToggling: { current: false }, runTaskShortcut: () => false };
          const { quickEntryEnabled } = useTable(context);
          return React.createElement(Control, { hasCurrentProject: true, projectId: 15, rows, selectedIndex, sections, toggleCreateTaskGlobally: context.toggleCreateTaskGlobally, quickEntryEnabled, quickCreateTask: (...args) => { calls.push(args); return Promise.resolve(true); } });
        };
      }
      const render = async () => React.act(async () => reactRoot.render(React.createElement(Harness)));
      await render();
      await press("n");
      assert.equal(Boolean(document.querySelector("[data-quick]")), nEnabled && quickEnabled);
      assert.equal(calls.length, 0, "N must not fall back to the full editor");
      // Remount closes quick entry without changing the keyboard code under test.
      await React.act(async () => reactRoot.render(null));
      await render();
      await press("c");
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0].sectionId, 10);
      assert.equal(document.querySelector("[data-quick]"), null);
      calls.length = 0;
      if (!(nEnabled && quickEnabled)) return;
      for (const overrides of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) {
        await press("n", overrides);
        assert.equal(document.querySelector("[data-quick]"), null);
      }
      for (const tag of ["input", "textarea", "select", "div"]) {
        const typing = document.createElement(tag);
        if (tag === "div") typing.setAttribute("contenteditable", "true");
        typing.tabIndex = 0;
        document.body.append(typing);
        typing.focus();
        await press("n");
        assert.equal(document.querySelector("[data-quick]"), null, `${tag} must keep N`);
        typing.remove();
      }
      modalOpen = true;
      await press("n");
      assert.equal(document.querySelector("[data-quick]"), null);
      modalOpen = false;
      activeColumn = 1;
      selectedIndex = 1;
      activeItem = 201;
      await render();
      if (surface === "board") document.getElementById("task-201").focus();
      await press("n");
      const quick = document.querySelector("[data-quick]");
      assert.ok(quick);
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
      await press("n");
      const columnQuick = document.querySelector("[data-quick]");
      if (surface === "board") {
        assert.equal(columnQuick.dataset.quick, "20", "focused column wins");
        await React.act(async () => reactRoot.render(null));
        activeItem = 201;
        await render();
        await press("n");
        assert.equal(document.querySelector("[data-quick]").dataset.quick, "20", "active task supplies its column when DOM focus is absent");
        await React.act(async () => reactRoot.render(null));
        activeItem = null;
        await render();
        await press("n");
        assert.equal(document.querySelector("[data-quick]").dataset.quick, "10", "no column or task focus falls back to the first column");
      } else {
        await columnQuick.quickCreate("Fallback");
        assert.deepEqual(calls.pop(), ["Fallback", 15, 10, "Inbox"]);
      }
    }));
  }
}

test("table: flags toggle N with every context dependency stable", async () => fixture(async ({ reactRoot, press }) => {
  const flags = { [nFlag]: false, [quickFlag]: false };
  const calls = [];
  const useTable = load(`${tablePath}useTableKeyboard.ts`, {
    ...commonMocks(flags, calls),
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
  for (const [nEnabled, quickEnabled] of [[false, false], [true, false], [true, true], [false, true], [true, true], [true, false]]) {
    flags[nFlag] = nEnabled;
    flags[quickFlag] = quickEnabled;
    await React.act(async () => reactRoot.render(React.createElement(Harness)));
    const before = opened;
    await press("n");
    assert.equal(opened - before, Number(nEnabled && quickEnabled));
    assert.equal(calls.length, 0);
  }
}));

for (const [nEnabled, quickEnabled] of [[true, true], [false, true], [true, false], [false, false]]) {
  test(`mobile AI writer: N stays inline or does nothing (${nEnabled}/${quickEnabled})`, async () => fixture(async ({ dom, reactRoot }) => {
    const flags = { [nFlag]: nEnabled, [quickFlag]: quickEnabled, "htpr-6141-ai-first-task-writer": true };
    const calls = [];
    const atoms = { activeItemAtom: {}, currentProjectAtom: {} };
    const useSections = load(sectionPath, {
      ...commonMocks(flags, calls),
      "@/store": atoms,
      "@/lib/state": { useRecoilState: () => React.useState({ id: 15 }), useSetRecoilState: () => () => {} },
      "jotai": { useStore: () => ({ get: () => null }) },
      "next/navigation": { useRouter: () => ({}) },
      "../MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: () => {} }) },
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(true) },
      "@/models/CreateTaskModalModels/model": { MOBILE_AI_TASK_WRITER_FOCUS: "AI_TASK_WRITER" },
    }).default;
    let state;
    const Harness = () => {
      state = useSections({ items: [], active: false, index: 0, title: "Inbox", sectionId: 10, projectId: 15 });
      return React.createElement("div", { ref: state.sectionRef, "data-column": "10" },
        state.showAddItem && React.createElement("input", { "data-quick": "10", "data-position": state.position }));
    };
    await React.act(async () => reactRoot.render(React.createElement(Harness)));
    await React.act(async () => document.querySelector("[data-column]").dispatchEvent(new dom.window.CustomEvent("OPEN_QUICK_ENTRY")));
    assert.equal(Boolean(document.querySelector("[data-quick]")), nEnabled && quickEnabled);
    assert.equal(calls.length, 0, "N must never open the full mobile editor");
    if (nEnabled && quickEnabled) assert.equal(document.querySelector("[data-quick]").dataset.position, "bottom");
    await React.act(async () => state.createTaskAt("bottom", { sectionId: 10 }, undefined, true));
    assert.equal(calls.length, 1, "the plus-button mobile behavior stays unchanged");
    assert.equal(calls[0][1], "AI_TASK_WRITER");
  }));
}

test("bottom shortcut hint follows both flags; top hint and clicks stay unchanged", async () => fixture(async ({ reactRoot }) => {
  const flags = { [nFlag]: false, [quickFlag]: false };
  const calls = [];
  const Button = load("src/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton.tsx", {
    ...commonMocks(flags, calls),
    "@/components/Common/Tooltip": { default: ({ keyCombination }) => React.createElement("span", { "data-keys": keyCombination.join("+") }) },
  }).default;
  const payload = { sectionId: 10 };
  for (const [nEnabled, quickEnabled] of [[false, false], [true, false], [false, true], [true, true]]) {
    flags[nFlag] = nEnabled;
    flags[quickFlag] = quickEnabled;
    for (const position of ["top", "bottom"]) {
      await React.act(async () => reactRoot.render(React.createElement(Button, {
        buttonPosition: position, sectionPayload: payload, createTaskAt: (...args) => calls.push(args),
      })));
      assert.equal(document.querySelector("[data-keys]").dataset.keys, position === "bottom" && nEnabled && quickEnabled ? "N" : "C");
      await React.act(async () => document.querySelector("#root > div").click());
      assert.deepEqual(calls.pop(), [position, payload, undefined, quickEnabled ? true : undefined]);
    }
  }
}));

test("flag registration, reused hints and existing full-editor scope are explicit", () => {
  assert.match(source("src/lib/flags/keys.ts"), /HTPR_6902_N_QUICK_ADD_FLAG = "htpr-6902-n-quick-add"/);
  assert.match(source("src/lib/flags.ts"), /key: HTPR_6902_N_QUICK_ADD_FLAG/);
  assert.match(source("src/lib/flags.ts"), /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
  assert.match(source("src/components/Global/BottomSettings_QuickTips.tsx"), /nQuickAddEnabled && quickEntryCardsEnabled[\s\S]*key: \["N"\], hint: "quick add"/);
  assert.match(source("src/components/PageComponents/Kanban/KanbanSectionComponents/NewTaskButton.tsx"), /nQuickAddEnabled && quickEntryCardsEnabled \? \["N"\] : \["C"\]/);
  assert.match(source(sectionPath), /useEffect\(nQuickAddEnabled && quickEntryCardsEnabled \?/);
  assert.match(source(boardPath), /if \(returnIfModalOrInputActive\(\)\) return/);
  assert.match(source(`${tablePath}useTableKeyboard.ts`), /returnIfModalOrInputActive\(\)/);
  assert.match(source("src/components/Common/newTask.tsx"), /e.key === "Enter"/);
  assert.match(source("src/components/Common/newTask.tsx"), /e.key === "Escape"/);
  assert.doesNotMatch(source("src/components/Common/newTask.tsx"), /toggleCreateTaskGlobally/);
});
