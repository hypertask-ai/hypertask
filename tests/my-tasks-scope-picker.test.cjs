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
const flag = "htpr-6567-command-scope-picker";
let enabled = false;
let pathname = "/my-tasks";
let memberQueryEnabled;
let changeBoardSearch;
const noop = () => {};
const box = ({ children }) => React.createElement("div", null, children);
const members = { members: [], owner: null };
stub("src/hooks/useFlag.tsx", { useFlag: (key) => key === flag ? enabled : true });
stub("src/lib/state.tsx", {
  useRecoilValue: (atom) => atom?.default ?? null,
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
  ModalRowElementContainer: ({ children, onClick, id }) => React.createElement("button", { onClick, id }, children),
});
stub("src/hooks/MultiPages/useGetMembersForAssignees.ts", { useGetAllMembersForAssign: (_key, _id, _data, options) => {
  memberQueryEnabled = options?.enabled;
  return { data: members };
} });
stub("src/hooks/Task Detail/useAssignTaskUser.ts", { useAssignTaskUser: () => noop });
stub("src/components/Common/UserAvatar.tsx", { default: () => React.createElement("img", { alt: "person" }) });
stub("next/navigation", { usePathname: () => pathname });
stub("src/hooks/RecoilRoot/useHypertasksRecoilStates.ts", { default: () => ({ resetShowCommands: noop }) });
stub("src/lib/contexts/TourContext.tsx", { useTourContext: () => ({ endTour: noop }) });
stub("src/hooks/MultiPages/useGetAllProjectsMinimal.ts", { useGetAllProjectsMinimal: () => ({ data: [{ id: 1, title: "Alpha" }] }) });
stub("src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx", { default: () => null });
stub("src/components/Modals/Sheets/index.ts", { MobileBottomSheet: box });
stub("src/components/Modals/commands/HTC/AllCommands.ts", {
  getAllCommands: () => [], getMobileCommandGroups: (groups) => groups, getBoardMenuCommands: (groups) => groups,
});
stub("src/hooks/MultiPages/HTC/useHTC.tsx", { default: (groups) => ({
  keyword: "", filterCommands: groups, hoveredGroup: 0, selectedCommand: null,
  onKeyChange: noop, handleCommandSelect: noop, setHoveredGroupIndex: noop, setCurrentCommandIndex: noop, setSelectedCommand: noop,
}) });
stub("src/components/Modals/commands/HTC/CommandGroup.tsx", { default: ({ filterCommands, onClickHandler }) =>
  filterCommands.map((group) => React.createElement("section", { key: group.group, "data-group": group.group },
    group.commandLists.map((command) => React.createElement("button", { key: command.key, "data-mode": command.commandMode, onClick: () => onClickHandler(command) }, command.name)))) });
stub("src/components/Modals/FilterModals/SelectFilters/FilterHTC.tsx", { default: ({ extraFilters }) => React.createElement("div", { "data-filters": true }, extraFilters) });
const jiti = require("jiti")(__filename, { interopDefault: true, jsx: { runtime: "automatic" }, alias: { "@": path.join(root, "src") } });
global.React = React;
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
  enabled = false;
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

test("flag off retains the original boards, Columns, Show done and snoozed Scope panel", () => {
  render({ filters: true, commands: true });
  openScope();
  assert.ok(document.querySelector('input[type="checkbox"]'));
  assert.match(document.body.textContent, /Columns[\s\S]*Completed tasks[\s\S]*Show done[\s\S]*Show snoozed/);
  assert.equal(document.querySelector('[placeholder="Type board name"]'), null);
  assert.equal(document.querySelector('[data-filters]').textContent, "");
  assert.equal(document.querySelector('[data-group="Boards"]').textContent.includes("Scope"), false);
});

test("flag on opens the actual Assign picker in board mode with the approved heading and no avatars", () => {
  enabled = true; render(); openScope();
  assert.equal(document.querySelector("h2").textContent, "Scope");
  assert.equal(document.querySelector("h3").textContent, "Boards");
  assert.ok(document.querySelector('[placeholder="Type board name"]'));
  assert.deepEqual([...document.querySelectorAll('[id^="scope-board-"]')].map((row) => row.textContent), ["All boards", "Alpha", "Beta"]);
  assert.equal(document.querySelectorAll("img").length, 0);
  assert.equal(memberQueryEnabled, false, "scope must not fetch assignees from a previously opened board");
});

test("picker lists every scope board without the command menu's 50-board cap and handles a live flag-off", () => {
  enabled = true;
  const boardList = Array.from({ length: 60 }, (_, id) => ({ id, title: `Board ${id}`, sections: [], labels: [] }));
  render({ boardList, filters: true }); openScope();
  assert.equal(document.querySelectorAll('[id^="scope-board-"]').length, boardList.length + 1);
  enabled = false; render({ boardList, filters: true });
  assert.equal(document.querySelector('[placeholder="Type board name"]'), null);
  assert.equal(document.querySelector('[data-filters]').textContent, "");
  assert.match(document.body.textContent, /Columns[\s\S]*Show done/);
});

test("board toggles use existing view state and pruning, stay open, and All boards resets to null", () => {
  enabled = true; config.filters.sectionIds = [11, 22]; config.filters.labelIds = ["a", "b"];
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
  enabled = true; render(); openScope();
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
  enabled = true; render({ commands: true });
  const scopeCommand = document.querySelector('[data-group="Boards"] button');
  assert.equal(scopeCommand.textContent, "Scope");
  assert.equal(Number(scopeCommand.dataset.mode), jiti(path.join(root, "src/models/enums.ts")).CommandMode.GoToBoard, "reuse the board command's mobile icon");
  click(scopeCommand); assert.ok(document.querySelector('[placeholder="Type board name"]'));
  pathname = "/inbox"; render({ commands: true });
  assert.equal(document.querySelector('[data-group="Boards"]')?.textContent.includes("Scope"), false);
});

test("flag-on Filters has Columns, Completed tasks and snoozed controls tied to current view state", () => {
  enabled = true; render({ filters: true });
  const filters = document.querySelector('[data-filters]');
  assert.match(filters.textContent, /Columns[\s\S]*Completed tasks[\s\S]*Show done[\s\S]*Show snoozed/);
  const inputs = filters.querySelectorAll('input[type="checkbox"]');
  click(inputs[0]); assert.deepEqual(config.filters.sectionIds, [11]);
  click(inputs[2]); assert.equal(config.filters.showDone, true);
  click(inputs[3]); assert.equal(config.filters.showSnoozed, true);
  assert.equal(document.querySelector('[aria-label="Filter My Tasks"]').textContent, "Filters3");
  const filterHost = fs.readFileSync(path.join(root, "src/components/Modals/FilterModals/SelectFilters/FilterHTC.tsx"), "utf8");
  const filterList = fs.readFileSync(path.join(root, "src/components/Modals/FilterModals/SelectFilters/ShowFilterOptionsModal.tsx"), "utf8");
  assert.match(filterHost, /<ShowFilterOptions\s+extraFilters=\{extraFilters\}/);
  assert.match(filterList, /\{extraFilters\}\s*<\/ModalListContainer>/);
});
