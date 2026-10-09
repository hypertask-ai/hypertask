const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRefactoredModuleRequire } = require("./refactored-module-require.cjs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const board = {
  id: 1,
  title: "Visible board",
  sections: ["To do", "In progress", "Done"].map((section_title, index) => ({
    id: index + 2,
    section_title,
    items: [{ id: index + 20, title: `Card ${index + 1}` }],
  })),
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
let instantTicketOpen = false;
let boardAuthorizations = 0;
const queryClient = { getQueryData: () => undefined };
const searchParams = new URLSearchParams("id=1&view=default");
const favorites = [];
const noop = () => {};
const noopComponent = () => null;
const atoms = new Proxy({}, { get: (_, key) => key });
const moduleMocks = {
  "@/components/Global/FirstScreenMobileChrome": { __esModule: true, default: noopComponent },
  "nookies": { __esModule: true, default: { set: noop } },
  "next/navigation": {
    useRouter: () => ({ replace: noop }),
    useSearchParams: () => searchParams,
    usePathname: () => "/project",
  },
  "@tanstack/react-query": { useQueryClient: () => queryClient },
  "@/store": atoms,
  "@/models/enums": { CommandMode: { InviteMember: "InviteMember" } },
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
          boardAuthorizations += 1;
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
  "@/hooks/General/useHydrated": { useHydrated: () => true },
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
  "@/lib/firstScreen/BoardDocumentBoundary": { __esModule: true, default: ({ children }) => children },
  "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
    "@/lib/firstScreen/boardDocument": { getBoardDocument: () => null },
    "@/hooks/useFlag": { useFlag: () => instantTicketOpen },
  "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant-ticket-open" },
  "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailLocation: () => undefined },
  "@/lib/constants/constants": { REACT_QUERY_KEYS: { uploadStates: ["Uploading_States"] } },
  "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: noopComponent },
  "lucide-react": { ChevronLeft: noopComponent },
  "@/components/Common/Tooltip": { __esModule: true, default: noopComponent },
  "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  "@/lib/contexts/Multipages/AI_Agent/chatContext": { ChatContext: React.createContext(undefined) },
  "@/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage": {
    __esModule: true,
    default: ({ _currentProject, filteredSections }) => React.createElement(
      "div", { "data-testid": "board" }, _currentProject.title,
      filteredSections.map((section) => React.createElement(
        "section", { key: section.id, "data-testid": "column" }, section.section_title,
        section.items.map((card) => React.createElement("article", { key: card.id, "data-testid": "card" }, card.title)),
      )),
    ),
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
  createRefactoredModuleRequire(path.join(__dirname, "../src/app/[...boardURL]"), moduleMocks),
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
    assert.match(document.querySelector("[data-testid=board]")?.textContent, /^Visible board/);
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

// Exercise the shell's actual route slot, not a hand-written copy of its wrappers.
const providerSource = fs.readFileSync(path.join(__dirname, "../src/components/ProviderGlobal/GloablProviders.tsx"), "utf8");
const workspaceStart = providerSource.indexOf("<BoardStartupContext.Provider");
const workspaceEnd = providerSource.indexOf("</BoardStartupContext.Provider>", workspaceStart);
assert.ok(workspaceStart >= 0 && workspaceEnd > workspaceStart);
const workspace = providerSource.slice(workspaceStart, workspaceEnd + "</BoardStartupContext.Provider>".length);
const shellModule = { exports: {} };
const shellSource = `
  const { Suspense } = require("react");
  const { BoardStartupContext, ChatRuntimeHost, ChatRuntime, AIChatPanels,
    AIChatClosedLayout, CachedTaskDetailNavigation, FullScreenChatLoading } = dependencies;
  const releaseSecondaryStartup = () => {};
  const markBoardUsable = () => {};
  const secondaryStartupEnabled = false;
  const isFullScreenChat = false;
  const shouldMountAgentChatRuntime = false;
  const showMobileTabBar = false;
  const mobileBottomInsetVisible = false;
  const mobilePullCommandVisible = false;
  const openAIChatInterface = () => {};
  const authenticatedUserId = 8;
  exports.Workspace = function Workspace({ children, instantTicketOpen, chatMounted }) {
    const shouldMountChatRuntime = chatMounted;
    const showAiChatInterface = chatMounted;
    const sidebarWidthPx = chatMounted ? 420 : 0;
    return (${workspace});
  };
`;

for (const chatMounted of [false, true]) {
  test(`initial board keeps columns and cards when flags resolve (chat ${chatMounted ? "loading" : "closed"})`, async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://app.hypertask.ai/project?id=1&view=default" });
    const globals = {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      sessionStorage: dom.window.sessionStorage,
      ResizeObserver: class { observe() {} disconnect() {} },
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
    for (const [key, value] of Object.entries(globals)) {
      Object.defineProperty(global, key, { configurable: true, writable: true, value });
    }
    dom.window.requestAnimationFrame = () => 1;
    dom.window.cancelAnimationFrame = noop;
    const load = createRefactoredModuleRequire(path.join(__dirname, ".."), moduleMocks);
    let releaseRuntime;
    const runtimeReady = new Promise((resolve) => { releaseRuntime = resolve; });
    const ChatRuntime = React.lazy(() => runtimeReady);
    const dependencies = {
      BoardStartupContext: React.createContext({}),
      ChatRuntimeHost: load("./src/components/ProviderGlobal/ChatRuntimeHost.tsx").default,
      ChatRuntime,
      AIChatPanels: noopComponent,
      AIChatClosedLayout: load("./src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx").default,
      CachedTaskDetailNavigation: load("./src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx").default,
      FullScreenChatLoading: noopComponent,
    };
    const compiledShell = ts.transpileModule(shellSource, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function("require", "exports", "dependencies", compiledShell)(require, shellModule.exports, dependencies);
    const Workspace = shellModule.exports.Workspace;
    const root = createRoot(document.getElementById("root"));
    const render = () => root.render(React.createElement(
      Workspace, { instantTicketOpen, chatMounted },
      React.createElement(LandingPage, { user: { id: 8 }, authenticated: true, slugs: "1" }),
    ));
    try {
      instantTicketOpen = false;
      boardAuthorizations = 0;
      queryResult = { data: undefined, isFetching: true, isError: false };
      await React.act(async () => render());
      assert.equal(document.querySelectorAll("[data-testid=column]").length, 0);

      queryResult = { data: networkData, isFetching: false, isError: false };
      await React.act(async () => render());
      const columns = [...document.querySelectorAll("[data-testid=column]")];
      const cards = [...document.querySelectorAll("[data-testid=card]")];
      assert.equal(columns.length, board.sections.length);
      assert.equal(cards.length, board.sections.flatMap((section) => section.items).length);
      assert.equal(boardAuthorizations, 1);
      const assertRetained = () => {
        const currentColumns = [...document.querySelectorAll("[data-testid=column]")];
        const currentCards = [...document.querySelectorAll("[data-testid=card]")];
        assert.equal(currentColumns.length, columns.length);
        assert.ok(currentColumns.every((column, index) => column === columns[index]), "flag hydration must not remount the rendered columns");
        assert.equal(currentCards.length, cards.length);
        assert.ok(currentCards.every((card, index) => card === cards[index]), "cards must not reset to placeholders");
        assert.ok(columns.every((column) => column.isConnected));
        assert.equal(boardAuthorizations, 1, "the route must not restart board authorization");
      };

      instantTicketOpen = true;
      await React.act(async () => render());
      assertRetained();
      queryResult = { data: undefined, isFetching: true, isError: false };
      await React.act(async () => render());
      assertRetained();
      await React.act(async () => {
        releaseRuntime({ default: ({ children }) => children });
        await runtimeReady;
      });
      assertRetained();
      queryResult = { data: networkData, isFetching: false, isError: false };
      instantTicketOpen = false;
      await React.act(async () => render());
      assertRetained();
    } finally {
      await React.act(async () => root.unmount());
      instantTicketOpen = false;
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
      }
      dom.window.close();
    }
  });
}
