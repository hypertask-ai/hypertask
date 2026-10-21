const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { load: loadRoute } = require("./task-route-loader.cjs");
const { CommandMode } = loadRoute("src/models/enums.ts", {});

for (const enabled of [false, true]) test(`Kanban bulk bar ${enabled ? "reuses working quick actions and clickable Esc" : "is unchanged with flag off"}`, () => {
  const ui = mount();
  const calls = [];
  let processing = false;
  let count = 2;
  const load = loader({
    "@/hooks/useFlag": { useFlag: () => enabled },
    "@/lib/contexts/Kanban/BulkSelectionContext": { useKanbanBulkSelection: () => ({
      selectedCount: count, failedIds: new Set(), isProcessing: processing,
      archiveSelected: async () => calls.push("archive"),
      openBulkCommand: mode => calls.push(mode ?? "actions"), clearSelection: () => calls.push("clear"),
    }) },
    "@/lib/contexts/MyTasks/BulkSelectionContext": { useMyTasksBulkSelection: () => { throw new Error("My Tasks context must not be used by Kanban"); } },
  });
  const Bar = load("src/components/PageComponents/Kanban/KanbanHomepageComponents/KanbanBulkActionBar.tsx").default;
  const render = () => ui.render(React.createElement(Bar));
  try {
    render();
    const buttons = [...ui.container.querySelectorAll("button")];
    assert.deepEqual(buttons.map(button => button.getAttribute("aria-label") || button.textContent), enabled ?
      ["Archive selected", "Assign selected", "Label selected", "Move selected", "Open actions", "Esc"] : ["Open actions"]);
    for (const button of buttons) React.act(() => button.click());
    assert.deepEqual(calls, enabled ? ["archive", CommandMode.OpenAssignModal, CommandMode.LabelModal,
      CommandMode.MoveToColumn, "actions", "clear"] : ["actions"]);
    if (!enabled) assert.ok(ui.container.textContent.includes("Esc to clear"));
    else assert.equal(ui.container.querySelectorAll("svg").length, 4);
    processing = true;
    render();
    assert.equal(ui.container.querySelector('button[aria-label="Archive selected"]')?.disabled, enabled ? true : undefined);
    assert.equal([...ui.container.querySelectorAll("button")].find(button => button.textContent === "Open actions").disabled, true);
    count = 0;
    render();
    assert.equal(ui.container.innerHTML, "");
  } finally { ui.close(); }
});

for (const enabled of [false, true]) for (const mobile of [false, true]) {
  test(`bulk bar footer clearance: flag ${enabled}, phone ${mobile}`, () => {
    const ui = mount();
    const load = loader({
      "@/hooks/useFlag": { useFlag: () => enabled },
      "@/lib/contexts/MyTasks/BulkSelectionContext": { useMyTasksBulkSelection: () => { throw new Error("My Tasks context must not be used by Kanban"); } },
      "@/lib/contexts/Kanban/BulkSelectionContext": { useKanbanBulkSelection: () => ({
        selectedCount: 2, failedIds: new Set(), isProcessing: false,
        archiveSelected: async () => {}, openBulkCommand: () => {}, clearSelection: () => {},
      }) },
    });
    const Bar = load("src/components/PageComponents/Kanban/KanbanHomepageComponents/KanbanBulkActionBar.tsx").default;
    const { MobileViewContext } = load("src/lib/contexts/mobileContext.tsx");
    try {
      for (const visible of [true, false]) {
        if (visible) document.documentElement.style.setProperty("--quick-tips-clearance", "46px");
        else document.documentElement.style.removeProperty("--quick-tips-clearance");
        ui.render(React.createElement(MobileViewContext.Provider, { value: mobile }, React.createElement(Bar)));
        const bar = ui.container.querySelector('[role="status"]');
        if (!enabled) {
          assert.equal(bar.getAttribute("style"), null);
          assert.equal(bar.className, "fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-[5px] bg-modalBackground px-3 py-2 text-content text-white-black customshadow-4");
        } else if (mobile) {
          assert.equal(bar.style.bottom, "calc(var(--mobile-dock-h, 0px) + 16px + env(safe-area-inset-bottom))");
          assert.match(bar.className, /inset-x-2 z-\[210\]/);
        } else {
          assert.equal(bar.style.bottom, "var(--quick-tips-clearance, 20px)");
          assert.match(bar.className, /bottom-5/);
          const bottom = document.documentElement.style.getPropertyValue("--quick-tips-clearance") || bar.style.bottom.match(/, (\d+px)/)[1];
          assert.equal(bottom, visible ? "46px" : "20px");
        }
      }
    } finally { ui.close(); }
  });
}

test("shortcut footer publishes measured clearance, tracks resize and scrollbar offsets, and clears on dismissal", () => {
  const fs = require("node:fs");
  const ts = require("typescript");
  const { root } = require("./helpers/htpr-7260-ui.cjs");
  const source = fs.readFileSync(`${root}/src/components/Global/BottomSettings_QuickTips.tsx`, "utf8");
  const ast = ts.createSourceFile("footer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tips = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(ast) === "TipsComp").getText(ast);
  const compiled = ts.transpileModule(tips, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const ui = mount();
  let height = 38;
  let scroll = false;
  let updateHeight;
  let disconnected = 0;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalObserver = global.ResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = () => ({ height });
  global.ResizeObserver = class {
    constructor(callback) { updateHeight = callback; }
    observe() {}
    disconnect() { disconnected++; }
  };
  const Footer = new Function("React", "useRef", "useEffect", "useDeviceContext", "usePathname",
    "useHypertasksRecoilStates", "useAiChatMainContentLayout", "useRecoilState", "isXScrollOnKanbanAtom", "KBDElement", "X",
    `${compiled}; return TipsComp;`)(React, React.useRef, React.useEffect, () => false, () => "/project-15",
    () => ({ toggleShowCommands() {} }), () => ({ mainContentWidth: "100%" }), () => [scroll, () => {}], {},
    ({ content }) => React.createElement("kbd", null, content), props => React.createElement("button", { ...props, "aria-label": "Dismiss tips" }));
  let visible = true;
  const render = (rail = false) => ui.render(visible ? React.createElement(Footer, {
    tips: [{ key: ["CTRL", "K"], hint: "command center" }], appShellRailOn: rail,
    toggleQuickTips: () => { visible = false; render(); },
  }) : null);
  const clearance = () => document.documentElement.style.getPropertyValue("--quick-tips-clearance");
  try {
    render();
    assert.equal(document.documentElement.style.getPropertyValue("--quick-tips-h"), "38px");
    assert.equal(clearance(), "calc(38px + calc(0px + var(--notif-banner-h, 0px)) + 8px)");
    height = 42;
    React.act(() => updateHeight());
    assert.equal(clearance(), "calc(42px + calc(0px + var(--notif-banner-h, 0px)) + 8px)");
    scroll = true;
    render();
    assert.equal(clearance(), "calc(42px + calc(12px + var(--notif-banner-h, 0px)) + 8px)");
    render(true);
    assert.equal(clearance(), "calc(42px + calc(0px + var(--notif-banner-h, 0px)) + 8px)");
    height = 0;
    React.act(() => updateHeight());
    assert.equal(clearance(), "20px");
    height = 38;
    React.act(() => updateHeight());
    React.act(() => ui.container.querySelector('[aria-label="Dismiss tips"]').click());
    assert.equal(clearance(), "");
    assert.equal(document.documentElement.style.getPropertyValue("--quick-tips-h"), "");
    assert.equal(disconnected, 3);
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    if (originalObserver) global.ResizeObserver = originalObserver;
    else delete global.ResizeObserver;
    ui.close();
  }
});
