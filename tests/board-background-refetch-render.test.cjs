const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const board = {
  id: 1,
  title: "Visible board",
  sections: [{ id: 2, section_title: "To do", items: [] }],
  project_view: { allViews: [] },
};
const networkData = {
  accountId: 8,
  dataOrigin: "network",
  networkRequestScopeKey: "8:1",
  networkRequestGeneration: 1,
  networkRequestId: "request-1",
  updatedProjects: [board],
};
let queryResult = { data: networkData, isFetching: false, isError: false };
const queryClient = { getQueryData: () => undefined };
const searchParams = new URLSearchParams("id=1&view=default");
const favorites = [];
const noop = () => {};
const noopComponent = () => null;
const atoms = new Proxy({}, { get: (_, key) => key });
const moduleMocks = {
  "nookies": { __esModule: true, default: { set: noop } },
  "next/navigation": {
    useRouter: () => ({ replace: noop }),
    useSearchParams: () => searchParams,
    usePathname: () => "/project",
  },
  "@tanstack/react-query": { useQueryClient: () => queryClient },
  "@/store": atoms,
  "@/lib/state": {
    useRecoilState: (atom) => [atom === "boardLayoutAtom" ? "board" : false, noop],
    useRecoilValue: () => false,
    useSetRecoilState: () => noop,
  },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(true) },
  "@/lib/contexts/boardStartupContext": {
    useBoardStartup: () => ({ releaseSecondaryStartup: noop, markBoardUsable: noop, secondaryStartupEnabled: false }),
  },
  "@/hooks/Homepage/useGetBoards": {
    PROJECTS_ALL_QUERY_KEY: ["getAll"],
    normalizeRequestedProjectId: (s) => Number(s),
    ActiveBoardPayloadUnavailableError: class extends Error {},
    useGetAllBoards: (_user, _slug, callbacks) => {
      const called = React.useRef(false);
      React.useEffect(() => {
        if (!called.current) {
          called.current = true;
          void callbacks.onActiveBoardAuthorized(1, {
            accountId: 8, projectId: 1, generation: 1, requestId: "request-1", isCurrent: () => true,
          });
        }
      }, []);
      return { ...queryResult, refetch: noop };
    },
  },
  "@/hooks/Homepage/useSyncedBoardReadModel": {
    usePreparedBoardReadModel: () => ({ authorizeAndPublishLocalBoard: noop, cancelPreparedLocalPublication: noop }),
    useSyncedBoardReadModel: noop,
  },
  "@/hooks/Inbox/useGetNotifications": { useGetNotificationCount: () => ({ data: undefined }) },
  "@/hooks/MultiPages/useGetAllFavorites": { useGetAllFavorites: () => ({ data: favorites }) },
  "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: noop },
  "@/hooks/General/useProjectQuery": { useProjectQuery: () => ({ goToProjectShortcut: noop }) },
  "@/hooks/General/useDeferredSubscriptionCheck": { useDeferredSubscriptionCheck: noop },
  "@/hooks/Homepage/Views/useViewCyclingShortcuts": { __esModule: true, default: noop },
  "@/hooks/MultiPages/Route/useTrialModal": { __esModule: true, default: () => ({ showTrial: false, setShowTrial: noop }) },
  "@/hooks/Task Detail/useTimeTracking": { useBoardRunningTimers: () => ({ timers: new Map(), timerDataReady: true }) },
  "@/lib/demo/guest": { isGuestUser: () => false },
  "@/lib/boardSync/pilot": { getBoardSyncPilotEnabled: () => false, persistBoardSyncPilotPreference: noop },
  "@/lib/analytics/boardReadinessPhases": {
    createBoardReadinessRouteEntryId: () => 1,
    prepareBoardReadinessTrace: noop,
    getBoardReadinessTraceScope: () => ({ accountId: 8, projectId: 1, routeEntryId: 1 }),
    markBoardNetworkQueryPublished: noop,
    flushBoardReadinessTrace: noop,
    markBoardReadinessPhase: noop,
  },
  "@/utils/api/helperFunctions": { addLastActivityAt: noop },
  "@/hooks/MultiPages/useGetAllAccessibleBoardList": { MOBILE_BOARD_SWITCHER_QUERY_KEY: ["boards"] },
  "@/lib/boardBootstrap/earlyBoardBootstrap": { discardEarlyBoardBootstrap: noop },
  "@/lib/lastBoardTeam": { setLastBoardTeam: noop },
  "@/lib/localReadModels/clear": { clearRevokedBoardMarker: noop },
  "@/lib/analytics/boardSwitchLatency": { resolveBoardSwitchIntent: noop },
  "@/lib/boardStartup/secondaryRequests": {
    shouldReleaseSecondaryStartupOnBoardRequest: () => false,
    shouldReleaseSecondaryStartupForTerminalBoard: () => false,
  },
  "@/lib/navigation/nextHistoryState": { getNextRouterAwareHistoryState: () => ({}) },
  "@/utils/helperFunctions/helperFunctions": { debounce: (fn) => fn, deepCopy: (value) => structuredClone(value) },
  "@/utils/helperFunctions/Views/ViewsHelperFunctions": {
    pinProjectToUrlView: (project) => project,
    getActiveBoardLayoutPreferenceFromProject: () => "board",
    resolveBoardLayoutFromSurface: () => "board",
    getActiveSortingModeFromProject: () => "manual",
    getViewFromProject: () => ({ type: "Default" }),
  },
  "@/utils/helperFunctions/Views/FilterHelperFunctions": { getFilteredSections: (sections) => sections },
  "@/utils/helperFunctions/Views/SubtaskHelperFunction": { getAppliedSubtaskSections: (sections) => sections },
  "@/utils/helperFunctions/Views/EmptySectionsHelperFunction": { getFilteredEmptySections: (sections) => sections },
  "@/lib/constants/builtinViews": {
    getActiveBoardViewId: () => "default", isBuiltinViewId: () => false,
    buildBuiltinViewContext: () => ({}), getBuiltinView: () => null,
  },
  "@/lib/boardDocumentTitle": { buildBoardDocumentTitle: (project) => project.title },
  "@/utils/api/Homepage": { isBoardPayloadHydrated: () => true },
  "@/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage": {
    __esModule: true,
    default: ({ _currentProject }) => React.createElement("div", { "data-testid": "board" }, _currentProject.title),
  },
  "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext": {
    KanbanModalsProvider: ({ children }) => children,
  },
  "@/components/PageComponents/Kanban/HeaderComponents/CycleBoardMeta": { __esModule: true, default: noopComponent },
  "./NoBoardsEmptyState": { __esModule: true, default: noopComponent },
};

// Compile the actual route component while replacing IO hooks and the heavy board children.
const source = fs.readFileSync(path.join(__dirname, "../src/app/[...boardURL]/LandingPage.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const landingModule = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (specifier) => moduleMocks[specifier] ?? require(specifier),
  landingModule,
  landingModule.exports,
);
const LandingPage = landingModule.exports.default;

test("a background refetch with temporarily missing data keeps the rendered board", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/project?id=1&view=default" });
  const previous = { window: global.window, document: global.document, navigator: global.navigator, ResizeObserver: global.ResizeObserver, sessionStorage: global.sessionStorage, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  global.sessionStorage = dom.window.sessionStorage;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.requestAnimationFrame = () => 1;
  dom.window.cancelAnimationFrame = noop;
  const root = createRoot(document.getElementById("root"));
  const render = () => root.render(React.createElement(LandingPage, { user: { id: 8 }, authenticated: true, slugs: "1" }));
  try {
    queryResult = { data: networkData, isFetching: false, isError: false };
    await React.act(async () => render());
    assert.equal(document.querySelector("[data-testid=board]")?.textContent, "Visible board");
    const boardNode = document.querySelector("[data-testid=board]");
    queryResult = { data: undefined, isFetching: true, isError: false };
    await React.act(async () => render());
    assert.equal(document.querySelector("[data-testid=board]"), boardNode);
  } finally {
    await React.act(async () => root.unmount());
    global.window = previous.window;
    global.document = previous.document;
    Object.defineProperty(global, "navigator", { configurable: true, value: previous.navigator });
    global.ResizeObserver = previous.ResizeObserver;
    global.sessionStorage = previous.sessionStorage;
    global.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});
