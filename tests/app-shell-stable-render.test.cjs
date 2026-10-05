const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { Provider, createStore } = require("jotai");
const { QueryClient, QueryClientProvider, notifyManager } = require("@tanstack/react-query");
const ts = require("typescript");
const { createRefactoredModuleRequire } = require("./refactored-module-require.cjs");

const directory = path.join(__dirname, "..");
const noop = () => {};
const state = createRefactoredModuleRequire(directory, {
  "@/hooks/General/useHydrated": { useHydrated: () => true },
})("./src/lib/state.tsx");
const user = { id: 8, displayName: "QA", avatar: "qa.png", notificationPreference: "direct", UserSetting: { trialStatus: "Free" } };
const copy = (value) => JSON.parse(JSON.stringify(value));
notifyManager.setScheduler(queueMicrotask);

async function browser(run) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/project?id=1" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { configurable: true, writable: true, value });
  const root = createRoot(document.getElementById("root"));
  try { await run(root); }
  finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

// HTPR-6853: exercise the actual caller options, not just the hook passthrough.
function startupOptions(hook) {
  const source = fs.readFileSync(path.join(directory, "src/components/ProviderGlobal/GloablProviders.tsx"), "utf8");
  const tree = ts.createSourceFile("provider.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let options;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === hook) {
      const argument = node.arguments.at(-1).getText(tree);
      options = new Function("secondaryStartupEnabled", `return (${argument});`)(true);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(options);
  return options;
}

for (const [name, file, exported, key] of [
  ["projects", "useGetAllProjectsMinimal", "useGetAllProjectsMinimal", ["projectsAllMinimal"]],
  ["hyper AI", "useGetHyperAI", "useGetHyperAI", ["hyper-ai"]],
]) {
  test(`${name} startup observer stays silent while fetching, retries and other consumers still update`, async () => browser(async (root) => {
    let requests = 0;
    let fail = false;
    const response = async () => {
      requests += 1;
      if (fail) throw new Error("fixture retry");
      return [{ id: requests }];
    };
    const load = createRefactoredModuleRequire(directory, {
      "@/hooks/General/useHydrated": { useHydrated: () => true },
      "@/utils/api/global": { __esModule: true, default: { getAllProjectsMinimal: response } },
      "@/lib/constants/APIRouteConstants": { getHyperRoute: "/hyper" },
      "@/lib/appShellBootstrap/client": { consumeEarlyAppShellBootstrapSlice: async () => null },
      axios: { __esModule: true, default: { get: async () => ({ data: await response() }) } },
    });
    const hook = load(`./src/hooks/MultiPages/${file}.ts`)[exported];
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0, staleTime: Infinity, notifyOnChangeProps: "all" } } });
    let shellRenders = 0;
    let visibleRenders = 0;
    let visible;
    function Shell() {
      shellRenders += 1;
      if (name === "projects") hook(key, undefined, startupOptions(exported));
      else hook(undefined, startupOptions(exported));
      return null;
    }
    function Visible() {
      visibleRenders += 1;
      visible = name === "projects" ? hook(key) : hook();
      return React.createElement("span", null, `${visible.isError}:${JSON.stringify(visible.data)}`);
    }
    try {
      await React.act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Shell), React.createElement(Visible))));
      await React.act(async () => client.refetchQueries({ queryKey: key }));
      assert.equal(client.getQueryCache().find({ queryKey: key }).observers[1].options.notifyOnChangeProps, "all", "other consumers retain query-client notification defaults");
      const shellBefore = shellRenders;
      const visibleBefore = visibleRenders;
      await React.act(async () => client.refetchQueries({ queryKey: key }));
      assert.equal(shellRenders, shellBefore, "unused observer must not notify on fetch/data changes");
      assert.ok(visibleRenders > visibleBefore);
      assert.deepEqual(visible.data, [{ id: requests }]);
      assert.deepEqual(client.getQueryData(key), visible.data);
      fail = true;
      const beforeRetry = requests;
      await React.act(async () => client.refetchQueries({ queryKey: key }));
      assert.equal(requests, beforeRetry + 2, "silencing notifications must preserve retries");
      assert.equal(visible.isError, true);
      assert.equal(shellRenders, shellBefore, "unused observer must not notify on errors");
    } finally { client.clear(); }
  }));
}

function authModule(atoms, getUser, cookieWrites) {
  return createRefactoredModuleRequire(directory, {
    "@/lib/state": state,
    "@/store": atoms,
    "./useCurrentUserCheckFromCookies": { __esModule: true, default: () => user },
    nookies: { __esModule: true, default: { get: () => ({}), set: (...args) => cookieWrites.push(args) } },
    "next/navigation": { useRouter: () => ({ refresh: noop }), useSearchParams: () => new URLSearchParams() },
    "@/utils/api/Homepage": { getCurrentUserById: async () => ({ status: 200, data: getUser() }) },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/lib/constants/APIRouteConstants": {},
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/configs/auth.config": { __esModule: true, default: { cookies: { user: "nookies_user", maxAge: 100, options: { path: "/" } } } },
    "@/lib/auth/betterAuthClient": {},
    "@/lib/auth/accounts": {},
    "@/lib/contexts/mobileBlockingContext": { useMobileBlocking: () => ({ showMobileOverlay: noop }) },
    "@/utils/edgeHelpers": {},
    "@/lib/auth/safeReturnTo": {},
    "@/lib/auth/userProfileQuery": { getUserProfileQueryOptions: (id) => ({ queryKey: ["fetchUser", id], enabled: false }) },
    "@/lib/auth/slimUserCookie": { slimUserForCookie: (value) => value },
    "@/lib/appShellBootstrap/client": { consumeEarlyAppShellBootstrapSlice: async () => null },
  })("./src/hooks/General/useAuth.tsx");
}

test("AuthProvider ignores unused query result notifications but preserves cache updates", async () => browser(async (root) => {
  const atoms = { currentUserAtom: state.atom({ key: "auth-query", default: user }) };
  const { AuthProvider, useAuth } = authModule(atoms, () => user, []);
  const client = new QueryClient();
  let renders = 0;
  function Consumer() { useAuth(); renders += 1; return null; }
  try {
    await React.act(async () => root.render(React.createElement(Provider, null, React.createElement(QueryClientProvider, { client }, React.createElement(AuthProvider, { authenticatedUserId: 8 }, React.createElement(Consumer))))));
    const before = renders;
    await React.act(async () => client.setQueryData(["fetchUser", 8], { id: 8, displayName: "Fresh" }));
    assert.equal(renders, before, "unused data must not republish Auth context");
    assert.equal(client.getQueryData(["fetchUser", 8]).displayName, "Fresh");
  } finally { client.clear(); }
}));

test("AuthProvider reuses equal profiles, but changed names/avatars and accounts still publish", async () => browser(async (root) => {
  const atoms = { currentUserAtom: state.atom({ key: "auth-profile", default: user }) };
  const store = createStore();
  let incoming = copy(user);
  const cookieWrites = [];
  const { AuthProvider } = authModule(atoms, () => incoming, cookieWrites);
  const client = new QueryClient();
  let renders = 0;
  function Consumer() { const profile = state.useRecoilValue(atoms.currentUserAtom); renders += 1; return React.createElement("span", null, `${profile.id}:${profile.displayName}:${profile.avatar}`); }
  try {
    await React.act(async () => root.render(React.createElement(Provider, { store }, React.createElement(QueryClientProvider, { client }, React.createElement(AuthProvider, { authenticatedUserId: 8 }, React.createElement(Consumer))))));
    const before = renders;
    const fetchProfile = () => client.fetchQuery({ queryKey: ["refresh-fixture"], queryFn: client.getQueryCache().find({ queryKey: ["fetchUser", 8] }).options.queryFn });
    await React.act(async () => fetchProfile());
    assert.equal(renders, before, "deep-equal profile must preserve subscriber renders");
    assert.equal(store.get(atoms.currentUserAtom), user);
    assert.equal(cookieWrites.length, 1, "cookie refresh is preserved");
    for (const changed of [{ ...user, displayName: "Updated", avatar: "new.png" }, { ...user, id: 9 }]) {
      incoming = changed;
      const previous = renders;
      await React.act(async () => fetchProfile());
      assert.ok(renders > previous);
      assert.deepEqual(store.get(atoms.currentUserAtom), incoming);
      assert.match(document.querySelector("span").textContent, new RegExp(`^${incoming.id}:${incoming.displayName}:${incoming.avatar}$`));
    }
  } finally { client.clear(); }
}));

test("cookie mirror retains equal profiles but updates changed profiles and rejects another account", async () => browser(async (root) => {
  const atoms = { currentUserAtom: state.atom({ key: "cookie-profile", default: user }) };
  const store = createStore();
  const load = createRefactoredModuleRequire(directory, {
    "@/lib/state": state, "@/store": atoms,
    nookies: { parseCookies: () => ({ nookies_user: "fixture" }) },
    "@/utils/edgeHelpers": { isValidUser: () => ({ isValid: true, user: copy(user) }) },
  });
  const useCurrentUser = load("./src/hooks/General/useCurrentUserCheckFromCookies.tsx").default;
  const snapshots = [];
  const ProfileContext = React.createContext(null);
  function Consumer() { const profile = React.useContext(ProfileContext); snapshots.push(profile); return React.createElement("span", null, profile?.displayName); }
  const child = React.createElement(Consumer);
  function Mirror() { const profile = useCurrentUser(8); return React.createElement(ProfileContext.Provider, { value: profile }, child); }
  await React.act(async () => root.render(React.createElement(Provider, { store }, React.createElement(Mirror))));
  const previous = snapshots.at(-1);
  const before = snapshots.length;
  await React.act(async () => store.set(atoms.currentUserAtom, copy(user)));
  assert.equal(snapshots.at(-1), previous, "equal atom publications must not replace local mirror");
  assert.equal(snapshots.length, before, "equal mirror state must not re-render consumers");
  await React.act(async () => store.set(atoms.currentUserAtom, { ...user, displayName: "Changed", avatar: "changed.png" }));
  assert.equal(snapshots.at(-1).displayName, "Changed");
  assert.equal(document.querySelector("span").textContent, "Changed");
  await React.act(async () => store.set(atoms.currentUserAtom, { ...user, id: 9, displayName: "Wrong account" }));
  assert.equal(snapshots.at(-1).displayName, "Changed");
}));

test("path focus resets reuse equal state and still reset real changes outside excluded routes", async () => browser(async (root) => {
  const atoms = Object.fromEntries(["globalNotificationFocusAtom", "showTrialModalAtom", "InboxTaskIndexAtom", "SearchTaskIndexAtom", "ArchivedTaskIndexAtom"].map((key) => [key, state.atom({ key, default: key === "globalNotificationFocusAtom" ? { currIdx: 0, currSplit: 0 } : 0 })]));
  const store = createStore();
  let pathname = "/project";
  const load = createRefactoredModuleRequire(directory, {
    "@/lib/state": state, "@/store": atoms,
    "next/navigation": { usePathname: () => pathname },
    "@/components/ProviderGlobal/useGlobalUIState": { useGlobalUIState: () => ({ closeAIChatInterface: noop }) },
  });
  const useGlobalPathCheck = load("./src/hooks/General/useGlobalPathCheck.ts").default;
  let renders = 0;
  function Publisher({ profile }) { useGlobalPathCheck(profile); return null; }
  function Consumer() { const focus = state.useRecoilValue(atoms.globalNotificationFocusAtom); renders += 1; return React.createElement("span", null, `${focus.currIdx}:${focus.currSplit}`); }
  const child = React.createElement(Consumer);
  const render = (profile) => root.render(React.createElement(Provider, { store }, React.createElement(Publisher, { profile }), child));
  await React.act(async () => render(user));
  const before = renders;
  const original = store.get(atoms.globalNotificationFocusAtom);
  await React.act(async () => render(copy(user)));
  assert.equal(renders, before, "equal focus must not re-render consumers on a profile refresh");
  assert.equal(store.get(atoms.globalNotificationFocusAtom), original);
  await React.act(async () => store.set(atoms.globalNotificationFocusAtom, { currIdx: 2, currSplit: 1 }));
  pathname = "/inbox";
  await React.act(async () => render(copy(user)));
  assert.equal(document.querySelector("span").textContent, "2:1", "inbox keeps focus");
  pathname = "/project";
  const changed = renders;
  await React.act(async () => render(copy(user)));
  assert.ok(renders > changed);
  assert.equal(document.querySelector("span").textContent, "0:0");
}));

test("modal context is stable across parent renders while toggles and board switches remain live", async () => browser(async (root) => {
  const atoms = { currentProjectAtom: state.atom({ key: "modal-project", default: { id: 1 } }), boardSearchAtom: state.atom({ key: "modal-search", default: { open: false, projectId: null, keyword: "" } }) };
  const store = createStore();
  const mocks = { "@/lib/state": state, "@/store": atoms, "@/app/[...boardURL]/serverActions": { getAllSubTasks: async (id) => [id] } };
  const hook = createRefactoredModuleRequire(directory, mocks)("./src/hooks/Homepage/useKanbanModalStates.ts");
  const { KanbanModalsProvider, useKanbanModalStatesContext } = createRefactoredModuleRequire(directory, { "@/hooks/Homepage/useKanbanModalStates": hook })("./src/lib/contexts/Kanban/KanbanContainer/KanbanModalContext.tsx");
  let renders = 0;
  let modal;
  function Consumer() { renders += 1; modal = useKanbanModalStatesContext(); return null; }
  const child = React.createElement(Consumer);
  const render = () => root.render(React.createElement(Provider, { store }, React.createElement(KanbanModalsProvider, null, child)));
  await React.act(async () => render());
  const before = renders;
  const previous = modal;
  await React.act(async () => render());
  assert.equal(renders, before);
  assert.equal(modal, previous);
  await React.act(async () => modal.toggleViewsModal());
  assert.equal(modal.showViewsModal, true);
  await React.act(async () => modal.toggleSearchTasks(true));
  assert.equal(modal.showSearchTasks, true);
  await React.act(async () => modal.toggleDeleteModal(true, { id: 4, section: "Todo" }));
  assert.equal(modal.showDeleteTaskModal, true);
  assert.deepEqual(modal.tasksToDelete, [4]);
  await React.act(async () => store.set(atoms.currentProjectAtom, { id: 2 }));
  assert.equal(modal.showViewsModal, false);
  assert.equal(modal.showDeleteTaskModal, false);
  await React.act(async () => modal.toggleSearchTasks(true));
  assert.equal(store.get(atoms.boardSearchAtom).projectId, 2, "stable callback must follow current board");
}));
