const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { load: loadRoute } = require("./task-route-loader.cjs");
const { CommandMode } = loadRoute("src/models/enums.ts", {});
const flag = "htpr-7260-kanban-select-all";
const noop = () => {};
const box = ({ children }) => React.createElement("div", null, children);

function fixture(enabled, count, usage = {}, mobile = false) {
  const ui = mount();
  let groups;
  const atoms = {
    boardLayoutAtom: { value: "board" }, calendarSettingsAtom: { value: { showWeekends: true } },
    frequentlyUsedHTCAton: { value: usage }, currentProjectAtom: { value: { id: 15 } },
    tableTitleWrapAtom: {}, showCommandsAtom: { value: {} },
  };
  const load = loader({
    "@/store": atoms,
    "@/store/currentPageActions": { currentPageActionsAtom: {} },
    "@/lib/state": { useRecoilState: atom => React.useState(atom.value), useRecoilValue: atom => atom.value, useSetRecoilState: () => noop },
    "@/hooks/useFlag": { useFlag: key => key === flag && enabled },
    "next/navigation": { useRouter: () => ({ push() {} }), usePathname: () => "/project-15" },
    "reactstrap": { ModalBody: box },
    "@/components/Common/CommonModalComponents": { ModalContainerCustom: box, ModalHintBar: () => null,
      ModalInput: () => React.createElement("input") },
    "./CommandGroup": { default: () => null },
    "@/hooks/MultiPages/HTC/useHTC": { default: all => {
      groups = all;
      return { keyword: "", onKeyChange: noop, selectedCommand: null, filterCommands: all,
        hoveredGroup: 0, handleCommandSelect: noop, setHoveredGroupIndex: noop,
        setCurrentCommandIndex: noop, setSelectedCommand: noop };
    } },
    "@/hooks/RecoilRoot/useHypertasksRecoilStates": { default: () => ({ resetShowCommands: noop }) },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {
      getActiveEmptySectionSettingFromProject: () => "Shown", getActiveStalenessFromProject: () => false,
    },
    "@/components/PageComponents/Interactive-Onboarding/Components/TutorialTip": { default: () => null },
    "@/lib/contexts/TourContext": { useTourContext: () => ({ endTour: noop }) },
    "@/hooks/MultiPages/useGetAllProjectsMinimal": { useGetAllProjectsMinimal: () => ({ data: [] }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/components/Modals/Sheets": { MobileBottomSheet: box },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "../../Settings/SettingsScopeTabs": { SettingsScopeTabs: () => null },
    "@/components/Common/Tooltip": { default: () => null },
    "./ComposeTaskWriter": { default: () => null },
  });
  const Commands = load("src/components/Modals/commands/HTC/commands.tsx").default;
  const render = (selectionCount = count) => ui.render(React.createElement(Commands, {
    isOpen: true, contextOptions: { context: "Kanban", bulkSelectionCount: selectionCount,
      kanbanSelectAllEnabled: enabled }, handleAction: noop,
  }));
  render();
  return { ...ui, render, get groups() { return groups; } };
}

const usage = {
  deleteBoard: { frequency: 10000, lastUsedAt: Date.now() },
  deleteColumn: { frequency: 9000, lastUsedAt: Date.now() },
  bulkArchive: { frequency: 8000, lastUsedAt: Date.now() },
  createTask: { frequency: 7000, lastUsedAt: Date.now() },
};
const oldNames = ["Move selected tasks to column", "Assign selected tasks", "Set tags on selected tasks", "Archive selected tasks"];
const newNames = ["Move to column", "Assign", "Set tags", "Archive", "Select all on board", "Select all in this column", "Clear selection"];

test("flag off preserves selected-task labels and frequency-ranked order, including legacy destructive suggestions", () => {
  const fx = fixture(false, 3, usage);
  try {
    assert.equal(fx.groups[0].group, "Frequently used");
    assert.deepEqual(fx.groups[0].commandLists.slice(0, 2).map(row => row.key), ["deleteBoard", "deleteColumn"]);
    const bulk = fx.groups.find(group => group.group === "Selected tasks");
    assert.deepEqual(bulk.commandLists.map(row => row.name), [oldNames[3], ...oldNames.slice(0, 3)]);
    assert.equal(bulk.commandLists.length, 4);
    assert.equal(fx.groups.some(group => group.group.includes("3 selected")), false);
  } finally { fx.close(); }
  const getBulk = loader()("src/components/Modals/commands/HTC/navigationCommands.ts").getBulkTaskCommands;
  assert.deepEqual(getBulk({ context: "Kanban", bulkSelectionCount: 3 }).commandLists.map(row => row.name), oldNames);
});

for (const mobile of [false, true]) test(`flag on pins counted selection group and fixed row order before everything (${mobile ? "phone" : "desktop"})`, () => {
  const fx = fixture(true, 3, usage, mobile);
  try {
    assert.equal(fx.groups[0].group, "3 selected tasks");
    assert.deepEqual(fx.groups[0].commandLists.map(row => row.name), newNames);
    assert.deepEqual(fx.groups[0].commandLists.map(row => row.keyboard),
      [["M"], ["A"], ["T"], ["CTRL", "E"], ["CTRL", "A"], undefined, ["ESC"]]);
    assert.ok(fx.groups[0].commandLists.every(row => row.keywords.includes("selected tasks")));
    assert.equal(fx.groups.some(group => ["Frequently used", "Get started"].includes(group.group)), false);
    fx.render(5);
    assert.equal(fx.groups[0].group, "5 selected tasks");
  } finally { fx.close(); }
});

test("selection hides Get started even without usage; no selection still shows Get started", () => {
  const fx = fixture(true, 2);
  try {
    assert.equal(fx.groups[0].group, "2 selected tasks");
    assert.equal(fx.groups.some(group => group.group === "Get started"), false);
    fx.render(0);
    assert.equal(fx.groups[0].group, "Get started");
  } finally { fx.close(); }
  const off = fixture(false, 2);
  try { assert.equal(off.groups[0].group, "Get started"); } finally { off.close(); }
});

test("flag on excludes board and column deletion from Frequently used but leaves normal commands and canonical deletion available", () => {
  const fx = fixture(true, 0, usage);
  try {
    const frequent = fx.groups.find(group => group.group === "Frequently used");
    assert.ok(frequent.commandLists.some(row => row.key === "createTask"));
    assert.ok(frequent.commandLists.every(row => ![CommandMode.DeleteBoard, CommandMode.DeleteColumn].includes(row.commandMode)));
    for (const mode of [CommandMode.DeleteBoard, CommandMode.DeleteColumn]) {
      assert.ok(fx.groups.some(group => group.group !== "Frequently used" && group.commandLists.some(row => row.commandMode === mode)));
    }
  } finally { fx.close(); }
});

test("new command modes dispatch selection actions and close the palette only when enabled", () => {
  const load = loader({
    "@/lib/agents/chatPaletteCommands": {}, "@/hooks/Kanban/mobileBoardGestures": {},
    "@/lib/constants": { default: {} }, "@/lib/constants/aiEvents": {},
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {}, "@/lib/tours/types": {},
    "./Modals/Settings/settingsNavigation": {}, "@/lib/snippets": {},
    "@/lib/timeQuickLog": {}, "@/lib/aiChatDisplayMode": {},
  });
  const { createCommandDispatcher } = load("src/components/commandDispatcher.ts");
  for (const enabled of [false, true]) {
    const calls = [];
    const { handleAction } = createCommandDispatcher({
      paletteContextOptions: { kanbanSelectAllEnabled: enabled }, boardCloseHandler: () => calls.push("close"),
      bulkSelection: { selectAll: () => calls.push("all"), selectColumn: () => calls.push("column"),
        clearSelection: () => calls.push("clear") },
    });
    for (const mode of [CommandMode.SelectAllOnBoard, CommandMode.SelectAllInColumn, CommandMode.ClearTaskSelection]) handleAction(mode);
    assert.deepEqual(calls, enabled ? ["all", "close", "column", "close", "clear", "close"] : ["close", "close", "close"]);
  }
});
