const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loader, React } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-8255-kanban-cleanup";
const flag = loader()(`src/lib/flags/definitions/${flagKey}.ts`);
const cn = loader({
  "@/lib/constants/APIRouteConstants": {},
  "@/lib/realtime/client": {},
  "../api/global": {},
})("src/utils/undoActions/helperFuncs.ts").cn;
const MobileViewContext = React.createContext(false);

const views = [
  { id: "plain", title: "Plain", visibility: "Shared" },
  { id: "smart", title: "Smart", visibility: "Shared" },
];

function render(enabled, appShellRail) {
  const ViewTabsBar = loader({
    "@/lib/state": { useRecoilValue: () => [] },
    "@/store": { activeBuiltinViewsAtom: {} },
    "@/hooks/Homepage/Views/useKanbanViews": { default: () => ({ switchViewHandler: () => {} }) },
    "@/hooks/Homepage/Views/useRenderedViews": {
      default: () => ({ renderedViews: views, orderedViews: views, viewTaskCounts: new Map() }),
    },
    "@/hooks/Homepage/Views/useViewOrderActions": { default: () => ({ saveMyViewOrder: () => {} }) },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/utils/undoActions/helperFuncs": { cn },
    "@/components/Common/Tooltip": { default: () => null },
    "@/components/Modals/ViewModals/ManageViewsModals": { default: () => null },
    "@/components/Modals/ViewModals/ViewsForBoardModal": { default: () => null },
    "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext": {
      useKanbanModalStatesContext: () => ({
        showManageViewsModal: false, toggleManageViewsModal: () => {},
        showViewsModal: false, toggleViewsModal: () => {},
      }),
    },
    "@/lib/constants/builtinViews": {
      getActiveBoardViewId: () => "plain",
      isBuiltinView: () => false,
    },
    "@/hooks/MultiPages/useGetAllProjectLabels": { useGetAllProjectLabels: () => ({ data: [] }) },
    "@/lib/smartSplits": { getSmartSplitLabel: (view) => (view.id === "smart" ? { id: "l" } : null) },
    "@/lib/contexts/boardStartupContext": { useBoardStartup: () => ({ secondaryStartupEnabled: true }) },
    "@/hooks/useFlag": { useFlag: key => key === flagKey && enabled },
    "@/lib/flags/definitions/htpr-8255-kanban-cleanup": flag,
    "@prisma/client": { ViewVisibility: { Private: "Private", Shared: "Shared" } },
  })("src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx").default;
  const html = renderToStaticMarkup(React.createElement(ViewTabsBar, {
    project: { id: 15, project_view: { default_view_id: "plain" } }, forceShow: true, appShellRail,
  }));
  const dom = new JSDOM(html);
  try {
    return [...dom.window.document.querySelectorAll('[aria-label="Smart split"]')]
      .map(icon => icon.getAttribute("class") || "");
  } finally {
    dom.window.close();
  }
}

for (const appShellRail of [true, false]) {
  const where = appShellRail ? "rail tabs" : "classic tabs";
  test(`${where}: smart split icon is purple with the cleanup off`, () => {
    const icons = render(false, appShellRail);
    assert.equal(icons.length, 1);
    assert.ok(icons[0].split(/\s+/).includes("text-hypertasks-ai-purple"));
  });

  test(`${where}: no smart split sparkle with the cleanup on`, () => {
    assert.deepEqual(render(true, appShellRail), []);
  });
}
