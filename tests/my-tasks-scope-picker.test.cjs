const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const stub = (relative, exports) => {
  const filename = relative.startsWith("src/") ? path.join(root, relative) : require.resolve(relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
let pathname = "/my-tasks";
let memberQueryEnabled;
let changeBoardSearch;
const noop = () => {};
const box = ({ children }) => React.createElement("div", null, children);
const members = { members: [], owner: null };
stub("src/hooks/useFlag.tsx", { useFlag: (key) => key !== "htpr-6938-my-tasks-icon-controls" });
stub("src/lib/state.tsx", {
  useRecoilValue: (atom) => atom?.default ?? null,
  useSetRecoilState: () => noop,
  useRecoilState: (atom) => React.useState(atom?.default ?? {}),
});
stub("src/store/index.ts", {
  boardLayoutAtom: { default: "table" }, calendarSettingsAtom: { default: {} },
  frequentlyUsedHTCAton: { default: {} }, currentProjectAtom: { default: null },
});
stub("src/store/currentPageActions.ts", { currentPageActionsAtom: { default: null } });
stub("src/lib/configs/general.config.ts", { MOBILE_TARGET: "min-h-11 min-w-11", generalConfig: {} });
stub("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts", { getActiveEmptySectionSettingFromProject: () => "Shown", getActiveStalenessFromProject: () => false });
stub("src/utils/helperFunctions/Views/FilterHelperFunctions.ts", { defaultFilterSettings: { matchFilters: "ANY", addedFilters: [] } });
stub("src/styles/linksModal.module.scss", {});
stub("reactstrap", { ModalBody: box });
stub("src/components/Common/CommonModalComponents/index.tsx", {
  ModalContainerCustom: box, ModalListContainer: box, ModalHintBar: () => null,
  ModalHeaderComp: ({ header }) => React.createElement("h2", null, header),
  ModalInput: ({ value, placeholder, onChange }) => {
    if (placeholder === "Type board name") changeBoardSearch = onChange;
    return React.createElement("input", { value, placeholder, onChange });
  },
  ModalRowElementContainer: ({ children, onClick, id, role, onKeyDown, "aria-checked": checked }) => React.createElement("button", { onClick, id, role, onKeyDown, "aria-checked": checked }, children),
});
stub("src/hooks/MultiPages/useGetMembersForAssignees.ts", { useGetAllMembersForAssign: (_key, _id, _data, options) => {
  memberQueryEnabled = options?.enabled;
  return { data: members };
} });
stub("src/hooks/Task Detail/useAssignTaskUser.ts", { useAssignTaskUser: () => noop });
stub("src/components/Common/UserAvatar.tsx", { default: () => React.createElement("img", { alt: "person" }) });
stub("next/navigation", { useRouter: () => ({ push() {} }), usePathname: () => pathname });
stub("src/hooks/RecoilRoot/useHypertasksRecoilStates.ts", { default: () => ({ resetShowCommands: noop }) });
stub("src/lib/contexts/TourContext.tsx", { useTourContext: () => ({ endTour: noop }) });
stub("src/hooks/MultiPages/useGetAllProjectsMinimal.ts", { useGetAllProjectsMinimal: () => ({ data: [{ id: 1, title: "Alpha" }] }) });
stub("src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx", { default: () => null });
stub("src/components/Modals/Sheets/index.ts", { MobileBottomSheet: box });
stub("src/components/Modals/commands/HTC/ComposeTaskWriter.tsx", { default: () => null });
stub("src/components/Modals/commands/HTC/AllCommands.ts", {
  getAllCommands: () => [], getMobileCommandGroups: (groups) => groups, getBoardMenuCommands: (groups) => groups,
});
stub("src/hooks/MultiPages/HTC/useHTC.tsx", { default: (groups) => {
  return {
    keyword: "", filterCommands: groups, hoveredGroup: 0, selectedCommand: null,
    onKeyChange: noop, handleCommandSelect: noop, setHoveredGroupIndex: noop, setCurrentCommandIndex: noop, setSelectedCommand: noop,
  };
} });
stub("src/components/Modals/commands/HTC/CommandGroup.tsx", { default: ({ filterCommands, onClickHandler }) =>
  filterCommands.map((group) => React.createElement("section", { key: group.group, "data-group": group.group },
    group.commandLists.map((command) => React.createElement("button", { key: command.key, "data-mode": command.commandMode, onClick: () => onClickHandler(command) }, command.name)))) });
stub("src/components/Modals/FilterModals/SelectFilters/FilterHTC.tsx", { default: ({ extraFilters }) => React.createElement("div", { "data-filters": true }, extraFilters) });
const jiti = require("jiti")(__filename, { interopDefault: true, jsx: { runtime: "automatic" }, alias: { "@": path.join(root, "src") } });
global.React = React;
stub("src/hooks/MultiPages/Filters/useFilterView.ts", { useFilterView: () => ({
  keyword: "", onKeyChange: noop, selectedIndex: 0, setSelectedIndex: noop,
  filteredCommands: [], activeFilters: { matchFilters: "ANY", addedFilters: [] },
}) });
const Assign = jiti(path.join(root, "src/components/Modals/AssignToUser/AssignToUser.tsx")).default;
const FilterOptions = jiti(path.join(root, "src/components/Modals/FilterModals/SelectFilters/ShowFilterOptionsModal.tsx")).default;
const Controls = jiti(path.join(root, "src/app/my-tasks/MyTasksViewControls.tsx")).default;
const Filters = jiti(path.join(root, "src/app/my-tasks/MyTasksKanbanFilterModal.tsx")).default;
const Commands = jiti(path.join(root, "src/components/Modals/commands/HTC/commands.tsx")).default;
const { DEFAULT_MY_TASKS_VIEW_CONFIG } = jiti(path.join(root, "src/models/MyTasksView.ts"));
const boards = [
  { id: 1, title: "Alpha", sections: [{ id: 11, title: "Todo" }], labels: [{ id: "a", name: "A" }] },
  { id: 2, title: "Beta", sections: [{ id: 22, title: "Done" }], labels: [{ id: "b", name: "B" }] },
];
let dom, reactRoot, config;
const click = (element) => act(() => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
const button = (label) => [...document.querySelectorAll("button")].find((el) => el.textContent === label);
function Harness({ filters = false, commands = false, boardList = boards }) {
  const [value, setValue] = React.useState(config);
  config = value;
  return React.createElement(React.Fragment, null,
    React.createElement(Controls, { boards: boardList, config: value, onChange: setValue, snoozeEnabled: true }),
    filters && React.createElement(Filters, { boards, config: value, onViewChange: setValue, settings: value.filterSettings, onChange: noop,
      onClearAll: noop, notStarred: false, onClearNotStarred: noop, members: [], labels: [], onClose: noop, snoozeEnabled: true }),
    commands && React.createElement(Commands, { isOpen: true }));
}
test.beforeEach(() => {
  pathname = "/my-tasks";
  config = structuredClone(DEFAULT_MY_TASKS_VIEW_CONFIG);
  dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/my-tasks" });
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = noop;
  reactRoot = createRoot(document.getElementById("root"));
});
test.afterEach(() => { act(() => reactRoot.unmount()); dom.window.close(); });
const render = (props) => act(() => reactRoot.render(React.createElement(Harness, props)));
const openScope = () => click(document.querySelector('[aria-label="My Tasks scope"]'));

test("scope opens the actual Assign picker in board mode with the approved heading and no avatars", () => {
  render(); openScope();
  assert.equal(document.querySelector("h2").textContent, "Scope");
  assert.equal(document.querySelector("h3").textContent, "Boards");
  assert.ok(document.querySelector('[placeholder="Type board name"]'));
  assert.deepEqual([...document.querySelectorAll('[id^="scope-board-"]')].map((row) => row.textContent), ["All boards", "Alpha", "Beta"]);
  assert.equal(document.querySelectorAll("img").length, 0);
  assert.equal(memberQueryEnabled, false, "scope must not fetch assignees from a previously opened board");
});

test("picker lists every scope board without the command menu's 50-board cap", () => {
  const boardList = Array.from({ length: 60 }, (_, id) => ({ id, title: `Board ${id}`, sections: [], labels: [] }));
  render({ boardList }); openScope();
  assert.equal(document.querySelectorAll('[id^="scope-board-"]').length, boardList.length + 1);
});

test("board toggles use existing view state and pruning, stay open, and All boards resets to null", () => {
  config.filters.sectionIds = [11, 22]; config.filters.labelIds = ["a", "b"];
  render(); openScope(); click(button("Alpha"));
  assert.deepEqual(config.boardIds, [2]);
  assert.deepEqual(config.filters.sectionIds, [22]);
  assert.deepEqual(config.filters.labelIds, ["b"]);
  assert.equal(button("Alpha").querySelector("svg"), null);
  assert.ok(button("Beta").querySelector("svg"));
  click(button("Beta")); assert.deepEqual(config.boardIds, []);
  click(button("All boards")); assert.equal(config.boardIds, null);
  assert.ok(button("Alpha").querySelector("svg"));
  assert.ok(document.querySelector('[placeholder="Type board name"]'));
});

test("search narrows board rows, Enter toggles immediately, and Escape closes without propagating", () => {
  render(); openScope();
  act(() => changeBoardSearch({ target: { value: "beta" } }));
  assert.equal(button("Alpha"), undefined);
  act(() => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  assert.deepEqual(config.boardIds, [1]);
  let escaped = false;
  document.addEventListener("keydown", () => { escaped = true; }, { once: true });
  act(() => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(document.querySelector('[placeholder="Type board name"]'), null);
  assert.equal(escaped, false);
});

test("Scope command is in Boards only on My Tasks and opens the same picker", () => {
  render({ commands: true });
  const scopeCommand = document.querySelector('[data-group="Boards"] button');
  assert.equal(scopeCommand.textContent, "Scope");
  assert.equal(Number(scopeCommand.dataset.mode), jiti(path.join(root, "src/models/enums.ts")).CommandMode.GoToBoard, "reuse the board command's mobile icon");
  click(scopeCommand); assert.ok(document.querySelector('[placeholder="Type board name"]'));
  pathname = "/inbox"; render({ commands: true });
  assert.equal(document.querySelector('[data-group="Boards"]')?.textContent.includes("Scope"), false);
});

test("Filters has Columns, Completed tasks and snoozed controls tied to current view state", () => {
  render({ filters: true });
  const filters = document.querySelector('[data-filters]');
  assert.match(filters.textContent, /Columns[\s\S]*Completed tasks[\s\S]*Show done[\s\S]*Show snoozed/);
  const rows = filters.querySelectorAll('[role="checkbox"]');
  assert.equal(rows.length, 4);
  click(rows[0]); assert.deepEqual(config.filters.sectionIds, [11]);
  click(rows[2]); assert.equal(config.filters.showDone, true);
  click(rows[3]); assert.equal(config.filters.showSnoozed, true);
  assert.equal(document.querySelector('[aria-label="Filter My Tasks"]').textContent, "Filters3");
});

test("shared Assign picker keeps assignee mode when no boardPicker is supplied", () => {
  act(() => reactRoot.render(React.createElement(Assign, { assignees: [], onClose: noop })));
  assert.ok(document.querySelector('[placeholder="Type user name"]'));
  assert.equal(document.querySelector('[id^="scope-board-"]'), null);
  assert.equal(memberQueryEnabled, true);
});

for (const control of ["native", "role"]) {
  test(`shared filter list leaves ${control} checkbox keys to the control`, () => {
    let toggles = 0;
    const checkbox = control === "native" ? React.createElement("input", { type: "checkbox" }) :
      React.createElement("button", { role: "checkbox", "aria-checked": false }, React.createElement("span", null, "Toggle"));
    act(() => reactRoot.render(React.createElement(FilterOptions, {
      view: "MyTasks", handleAction: noop, toggleFilterMatchOptions: () => { toggles += 1; },
      extraFilters: React.createElement("label", null, "Extra scope control", checkbox),
    })));
    assert.match(document.body.textContent, /Extra scope control/);
    const arrow = (target) => act(() => target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", keyCode: 39, bubbles: true })));
    arrow(document.querySelector(control === "native" ? 'input[type="checkbox"]' : '[role="checkbox"] span'));
    assert.equal(toggles, 0);
    arrow(document.body);
    assert.equal(toggles, 1, "non-checkbox keys retain filter match handling");
  });
}

test("retired command scope flag is absent from the registry and production modes", () => {
  const key = "htpr-6567-command-scope-picker";
  const definitions = require("./helpers/flag-files.cjs").definitions();
  assert.equal(definitions.some(({ key }) => key === "htpr-6930-my-tasks-kanban-reuse"), false, "retired key is absent from registry");
  assert.equal(definitions.some((definition) => definition.key === key), false);
  assert.equal(fs.existsSync(path.join(root, `src/lib/flags/definitions/${key}.ts`)), false);
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(Object.hasOwn(snapshot.modes, key), false);
});
