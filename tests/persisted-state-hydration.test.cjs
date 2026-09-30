const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const passThrough = ({ children }) => children;
const noop = () => {};
const emptyFields = [];

// Compile the real providers, atoms and table. Only unrelated UI and network
// boundaries are replaced; every page load gets a fresh module/state cache.
function loadApp(pathname, commits) {
  const cache = new Map();
  let publishUser;
  const mocks = {
    "next/navigation": { usePathname: () => pathname, useRouter: () => ({ refresh: noop }) },
    "react-hot-toast": { __esModule: true, default: { error: noop }, Toaster: () => null },
    "@tanstack/react-query": {
      QueryClient: class {},
      useQuery: () => ({ data: emptyFields }),
      useQueryClient: () => ({}),
    },
    "@tanstack/react-query-persist-client": { PersistQueryClientProvider: passThrough },
    "@/utils/queryIndexedDbPersister": { createQueryPersister: () => ({ dispose: noop }) },
    "@/lib/contexts/mobileContext": {
      __esModule: true, default: passThrough, MobileViewContext: React.createContext(false),
    },
    "@/lib/contexts/deviceContext": { DeviceProvider: passThrough, useDeviceContext: () => false },
    "@/lib/contexts/ThemeListener": { __esModule: true, default: () => null },
    "@/hooks/General/useUndo": { UndoProvider: passThrough },
    "@/lib/contexts/mobileBlockingContext": { MobileBlockingProvider: passThrough },
    "@/lib/contexts/TourContext": { TourProvider: passThrough },
    "@/hooks/useFlag": { FeatureFlagProvider: passThrough, useFlag: () => false },
    "@/hooks/General/useAuth": {
      AuthProvider: ({ children }) => {
        const state = load("@/lib/state");
        publishUser = state.useSetRecoilState(load("@/store").currentUserAtom);
        return children;
      },
    },
    "@/components/ProviderGlobal/GloablProviders": {
      __esModule: true,
      default: ({ children }) => {
        const state = load("@/lib/state");
        const atoms = load("@/store");
        const user = state.useRecoilValue(atoms.currentUserAtom);
        const rail = state.useRecoilValue(atoms.appShellRailAtom);
        const expanded = state.useRecoilValue(atoms.appShellRailExpandedAtom);
        const [team, setTeam] = state.useRecoilState(atoms.selectedSettingsTeamIdAtom);
        // A real startup writeback pattern: defaults must never reach this effect.
        React.useEffect(() => setTeam(team), [team, setTeam]);
        React.useLayoutEffect(() => {
          commits.push({ userId: user?.id, rail, expanded, team });
        });
        return React.createElement("main", { "data-rail": rail ? "on" : "off", "data-team": team }, children);
      },
    },
    "@/hooks/Homepage/useShowArchivedOnBoard": { useShowArchivedOnBoard: () => false },
    "@/hooks/General/useProjectQuery": { useProjectQuery: () => ({ updateActiveItemAndItemInView: noop }) },
    "@/hooks/MultiPages/Route/useHypertasksNavigate": { __esModule: true, default: () => ({ navigateToTask: noop }) },
    "@/hooks/RecoilRoot/useHypertasksRecoilStates": { __esModule: true, default: () => ({ toggleCreateTaskGlobally: noop }) },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { __esModule: true, default: () => ({ removeFromListWithStatus: noop, updateTaskInCache: noop }) },
    "@/hooks/Task Detail/useStarAndPin": { useStarAndPin: () => ({ starTask: noop }) },
    "@/lib/contexts/MyTasks/BulkSelectionContext": { useMyTasksBulkSelectionOptional: () => null },
    "@/hooks/Task Detail/useTimeTracking": {
      useBoardRunningTimers: () => ({ timeTotals: new Map() }), useTimerNow: () => 0,
    },
    "@/hooks/MultiPages/useMoveTaskToSection": { __esModule: true, default: () => ({ mutate: noop }) },
    "@/hooks/Homepage/Views/useKanbanViews": { __esModule: true, default: () => ({ setTableSortViewAndReturn: noop, changeBoardLayout: noop }) },
    "@/hooks/MultiPages/useAddDeleteTaskInBoards": { __esModule: true, default: () => ({}) },
    "@/lib/keyboard/taskProjectFallback": { useTaskProjectFallback: () => ({ project: null }) },
    "@/components/Common/TaskRowComponents/TaskListRow": { SplitTitle: () => null },
    "@/components/Common/UserAvatar": { __esModule: true, default: () => null },
    "@/components/Modals/TaskPriority/PriorityLabelComponent": { __esModule: true, default: () => null },
    "@/components/Modals/TaskEstimate/EstimateLabelComponent": { __esModule: true, default: () => null },
    "@/components/Modals/CreateLabel/TaskLabelComponent": { __esModule: true, default: () => null },
    "@/components/Labels/DueDateLabel": { __esModule: true, default: () => null },
    "@/components/PageComponents/Kanban/KanbanTaskComponents/BlockerChip": { BlockerTaskChip: () => null },
    "@/utils/api/global": { __esModule: true, default: {} },
    "@/utils/helperFunctions/helperFunctions": {
      returnSortedItems: (items) => items, returnIfModalOrInputActive: () => false,
      deepCopy: (value) => value == null ? value : structuredClone(value),
    },
    "@/utils": { taskBaseUri: noop },
  };
  function load(request, parent = root) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    if (!request.startsWith("@/") && !request.startsWith(".")) return require(request);
    const base = request.startsWith("@/")
      ? path.join(root, "src", request.slice(2))
      : path.resolve(path.dirname(parent), request);
    const filename = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    assert.ok(filename, `Missing test import: ${request}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    });
    new Function("require", "module", "exports", outputText)(
      (child) => load(child, filename), loadedModule, loadedModule.exports,
    );
    return loadedModule.exports;
  }
  const Provider = load("@/utils/Providers").default;
  const state = load("@/lib/state");
  const atoms = load("@/store");
  return { Provider, state, atoms, load, publishUser: (user) => publishUser(user) };
}

async function withBrowser(saved, run) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://app.hypertask.ai/inbox",
  });
  dom.window.localStorage.setItem("recoil-persist", JSON.stringify(saved));
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.assign(global, globals);
  try {
    await run(dom);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

function tree(app, children, accountId = 42) {
  return React.createElement(app.Provider, {
    initialIsMobile: false, initialIsApple: false, authenticatedUserId: accountId,
  }, children);
}

async function hydrate(dom, app, children, accountId = 42) {
  const errors = [];
  let reactRoot;
  await React.act(async () => {
    reactRoot = hydrateRoot(dom.window.document.getElementById("root"), tree(app, children, accountId), {
      onRecoverableError: (error) => errors.push(error),
    });
  });
  assert.deepEqual(errors, []);
  return reactRoot;
}

function serverMarkup(pathname, children, accountId = 42) {
  const previousWindow = global.window;
  delete global.window;
  try {
    return renderToString(tree(loadApp(pathname, []), children, accountId));
  } finally {
    if (previousWindow !== undefined) global.window = previousWindow;
  }
}

test("workspace hydration never renders the default rail or an empty saved user", async () => {
  const markup = serverMarkup("/inbox", React.createElement("p", null, "Inbox"));
  assert.equal(markup, "");
  for (const saved of [
    { currentUser: { id: 42 }, appShellRail: false, appShellRailExpanded: true },
    { currentUser: { id: 42 }, appShellRail: true, appShellRailExpanded: true },
  ]) {
    await withBrowser(saved, async (dom) => {
      dom.window.document.getElementById("root").innerHTML = markup;
      const commits = [];
      const app = loadApp("/inbox", commits);
      const Consumer = () => React.createElement("p", null, app.state.useRecoilValue(app.atoms.currentUserAtom).id);
      const reactRoot = await hydrate(dom, app, React.createElement(Consumer));
      try {
        assert.ok(commits.length > 0);
        assert.ok(commits.every((commit) => commit.userId === 42 && commit.rail === saved.appShellRail && commit.expanded === true));
        assert.equal(dom.window.document.querySelector("p").textContent, "42");
      } finally {
        await React.act(async () => reactRoot.unmount());
      }
    });
  }
});

test("workspace consumers wait for the matching user when storage is empty or stale", async () => {
  for (const saved of [{}, { currentUser: { id: 99 } }]) {
    await withBrowser(saved, async (dom) => {
      const commits = [];
      const app = loadApp("/project", commits);
      const userIds = [];
      const Consumer = () => {
        const user = app.state.useRecoilValue(app.atoms.currentUserAtom);
        userIds.push(user.id); // Deliberately unsafe unless the real boundary protects it.
        return React.createElement("p", null, user.id);
      };
      const reactRoot = await hydrate(dom, app, React.createElement(Consumer));
      try {
        assert.deepEqual(userIds, []);
        assert.deepEqual(commits, []);
        await React.act(async () => app.publishUser({ id: 99 }));
        assert.deepEqual(userIds, []);
        await React.act(async () => app.publishUser({ id: 42 }));
        assert.ok(userIds.length > 0);
        assert.ok(userIds.every((id) => id === 42));
        await React.act(async () => app.publishUser(null));
        assert.equal(dom.window.document.querySelector("main"), null);
      } finally {
        await React.act(async () => reactRoot.unmount());
      }
    });
  }
});

test("a non-default setting survives startup writeback and a full reload", async () => {
  await withBrowser({ currentUser: { id: 42 }, selectedSettingsTeamId: "team-b" }, async (dom) => {
    for (let reload = 0; reload < 2; reload += 1) {
      const commits = [];
      const app = loadApp("/settings", commits);
      const reactRoot = await hydrate(dom, app, React.createElement("p", null, "Settings"));
      try {
        assert.ok(commits.length > 0);
        assert.ok(commits.every((commit) => commit.team === "team-b"));
        dom.window.dispatchEvent(new dom.window.Event("pagehide"));
        assert.equal(JSON.parse(dom.window.localStorage.getItem("recoil-persist")).selectedSettingsTeamId, "team-b");
      } finally {
        await React.act(async () => reactRoot.unmount());
      }
    }
  });
});

test("a manually hidden Time column stays hidden on an already-seeded board", async () => {
  await withBrowser({
    currentUser: { id: 42 }, tableVisibleColumnsAtom: ["ticket", "title"], tableTimeColumnSeededBoardsAtom: [7],
  }, async (dom) => {
    for (let reload = 0; reload < 2; reload += 1) {
      const app = loadApp("/project", []);
      const TableView = app.load("@/components/PageComponents/Kanban/TableView/TableView").default;
      const reactRoot = await hydrate(dom, app, React.createElement(TableView, {
        _sections: [], _currentProject: { id: 7, showTimeTotals: true }, currentUser: { id: 42 }, _activeSortingMode: "default",
      }));
      try {
        const headers = [...dom.window.document.querySelectorAll("button span.truncate")]
          .map((header) => header.textContent);
        assert.ok(headers.includes("Ticket"));
        assert.ok(headers.includes("Title"));
        assert.ok(!headers.includes("Time"));
        dom.window.dispatchEvent(new dom.window.Event("pagehide"));
        const persisted = JSON.parse(dom.window.localStorage.getItem("recoil-persist"));
        assert.deepEqual(persisted.tableVisibleColumnsAtom, ["ticket", "title"]);
        assert.deepEqual(persisted.tableTimeColumnSeededBoardsAtom, [7]);
      } finally {
        await React.act(async () => reactRoot.unmount());
      }
    }
  });
});

test("public content keeps server rendering, including for a signed-in visitor", () => {
  for (const pathname of ["/share/task", "/login", "/invite/team", "/pricing", "/oauth/authorize", "/qa/login"]) {
    const markup = serverMarkup(pathname, React.createElement("p", null, "Public content"));
    assert.ok(markup.includes("<p>Public content</p>"), pathname);
  }
  assert.ok(serverMarkup("/login", React.createElement("p", null, "Login"), null).includes("<p>Login</p>"));
});
