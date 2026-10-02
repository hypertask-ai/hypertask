const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { Provider, createStore } = require("jotai");
const { createJiti } = require("jiti");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  jsx: true,
  moduleCache: false,
});
// Share the native ESM Jotai context with the Provider used by these tests.
require("tsx/cjs");
const state = require(path.join(root, "src/lib/state.tsx"));

async function withBrowser(html, saved, run) {
  const dom = new JSDOM(`<div id="root">${html}</div>`, { url: "https://app.hypertask.ai/inbox" });
  dom.window.localStorage.setItem("recoil-persist", JSON.stringify(saved));
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { value, configurable: true, writable: true });
  }
  try {
    await run(document.getElementById("root"));
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

const defaults = { currentUser: null, appShellRail: true, appShellRailExpanded: false, selectedSettingsTeamId: null };
const saved = { currentUser: { id: 2343, displayName: "Free customer" }, appShellRail: false, appShellRailExpanded: true, selectedSettingsTeamId: "saved-team" };
function atomsFor(values) {
  const { persistAtom } = state.recoilPersist();
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, state.atom({ key, default: value, effects_UNSTABLE: [persistAtom] })]));
}
function StateView({ atoms, snapshots }) {
  const user = state.useRecoilValue(atoms.currentUser);
  const [rail] = state.useRecoilState(atoms.appShellRail);
  const expanded = state.useRecoilValue(atoms.appShellRailExpanded);
  const [team] = state.useRecoilState(atoms.selectedSettingsTeamId);
  const value = { currentUser: user, appShellRail: rail, appShellRailExpanded: expanded, selectedSettingsTeamId: team };
  snapshots.push(value);
  return React.createElement("div", null, JSON.stringify(value));
}

test("persisted user, rail and team atoms use server defaults on their first client render", async () => {
  const serverAtoms = atomsFor(defaults);
  const html = renderToString(React.createElement(Provider, null, React.createElement(StateView, { atoms: serverAtoms, snapshots: [] })));
  await withBrowser(html, saved, async (container) => {
    // Atom definitions are evaluated separately in the browser bundle, after storage exists.
    const clientAtoms = atomsFor(defaults);
    const snapshots = [];
    const errors = [];
    let hydratedRoot;
    try {
      await React.act(async () => {
        hydratedRoot = hydrateRoot(container, React.createElement(Provider, null, React.createElement(StateView, { atoms: clientAtoms, snapshots })), {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      assert.deepEqual(errors, [], "persisted values must not replace the server's settings/rail markup during hydration");
      assert.deepEqual(snapshots[0], defaults);
      assert.deepEqual(snapshots.at(-1), saved, "saved choices are published after hydration, not discarded");
      assert.deepEqual(JSON.parse(container.textContent), saved);
      assert.deepEqual(JSON.parse(window.localStorage.getItem("recoil-persist")), saved, "SSR defaults must not overwrite persisted preferences");
    } finally {
      if (hydratedRoot) await React.act(async () => hydratedRoot.unmount());
    }
  });
});

test("a late streamed atom consumer hydrates defaults even after the shared store changes", async () => {
  const atoms = atomsFor({ profile: null });
  const profileLabel = state.selectorFamily({
    key: "profileLabel",
    get: () => ({ get }) => get(atoms.profile) ?? "Loading settings",
  })(0);
  const snapshots = [];
  const labels = [];
  function Profile() {
    const [profile, setProfile] = state.useRecoilState(atoms.profile);
    const label = state.useRecoilValue(profileLabel);
    snapshots.push(profile);
    labels.push(label);
    return React.createElement("button", { onClick: () => setProfile((old) => `${old}!`) }, label);
  }
  const html = renderToString(React.createElement(Provider, null, React.createElement(Profile)));
  await withBrowser(html, {}, async (container) => {
    const store = createStore();
    store.set(atoms.profile, "Loaded customer");
    snapshots.length = 0;
    labels.length = 0;
    const errors = [];
    let hydratedRoot;
    try {
      await React.act(async () => {
        hydratedRoot = hydrateRoot(container, React.createElement(Provider, { store }, React.createElement(Profile)), {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      assert.deepEqual(errors, []);
      assert.equal(snapshots[0], null);
      assert.equal(labels[0], "Loading settings", "selectors also read the server defaults during hydration");
      assert.equal(container.textContent, "Loaded customer");
      await React.act(async () => container.querySelector("button").click());
      assert.equal(container.textContent, "Loaded customer!", "functional setters still read live state");
    } finally {
      if (hydratedRoot) await React.act(async () => hydratedRoot.unmount());
    }
  });
});

const queryCases = [
  ["teams", "src/hooks/MultiPages/useGetAllTeamsMinimal.ts", "useGetAllTeamsMinimal", [2343], ["getAllTeamsMinimal", 2343, 2], []],
  ["projects", "src/hooks/MultiPages/useGetAllProjectsMinimal.ts", "useGetAllProjectsMinimal", [["projectsAllMinimal"]], ["projectsAllMinimal"], []],
  ["announcements", "src/hooks/MultiPages/Sidebar/useGetAnnouncements.ts", "useGetAnnouncements", [2343], ["In-App Announcements", 2343], []],
  ["preferences", "src/hooks/General/useGetUserPreferences.tsx", "useGetUserPreferences", [], ["user-preferences"], null],
];

for (const [name, filename, exported, args, key, placeholder] of queryCases) {
  test(`${name} observers hide an already-populated cache until their own hydration completes`, async () => {
    const stubs = new Map([
      ["src/utils/api/Homepage/index.ts", { getAllTeamsForLSidebar: async () => [] }],
      ["src/utils/api/global.ts", { __esModule: true, default: { getAllProjectsMinimal: async () => [] } }],
      ["src/lib/appShellBootstrap/client.ts", { consumeEarlyAppShellBootstrapSlice: async () => null }],
    ]);
    const previous = [];
    for (const [relative, exports] of stubs) {
      const file = path.join(root, relative);
      previous.push([file, require.cache[file]]);
      require.cache[file] = { id: file, filename: file, loaded: true, exports };
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    let hydratedRoot;
    try {
      const loaded = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
      const hookModule = loaded(path.join(root, filename));
      const hook = hookModule[exported];
      const initial = placeholder ?? hookModule.DEFAULT_USER_PREFERENCES;
      const value = name === "preferences" ? { ...initial, muteAnnouncements: true } : [{ id: "cached", title: "Cached team", projects: [] }];
      const snapshots = [];
      function QueryView() {
        const query = hook(...args);
        snapshots.push(query.data);
        return React.createElement("div", null, JSON.stringify(query.data));
      }
      const tree = (queryClient) => React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(QueryView));
      const serverClient = new QueryClient();
      const html = renderToString(tree(serverClient));
      assert.deepEqual(snapshots.at(-1), initial);
      client.setQueryData(key, value);
      await withBrowser(html, {}, async (container) => {
        snapshots.length = 0;
        const errors = [];
        await React.act(async () => {
          hydratedRoot = hydrateRoot(container, tree(client), { onRecoverableError: (error) => errors.push(error) });
        });
        assert.deepEqual(errors, [], `${name} cache must not change streamed server markup`);
        assert.deepEqual(snapshots[0], initial);
        assert.deepEqual(snapshots.at(-1), value);
        await React.act(async () => hydratedRoot.unmount());
        hydratedRoot = null;
      });
      serverClient.clear();
    } finally {
      client.clear();
      for (const [file, cached] of previous) {
        if (cached) require.cache[file] = cached;
        else delete require.cache[file];
      }
    }
  });
}

async function hydrateStreamedConsumer(wrap, useValue, serverValue, clientValue, configureBrowser) {
  let ready = true;
  let resume;
  const waiting = new Promise((resolve) => { resume = resolve; });
  const snapshots = [];
  function Consumer() {
    if (!ready) throw waiting;
    const value = useValue();
    snapshots.push(value);
    return React.createElement("p", null, String(value));
  }
  const tree = () => wrap(React.createElement(React.Suspense, { fallback: "Loading" }, React.createElement(Consumer)));
  const previousReact = Object.getOwnPropertyDescriptor(global, "React");
  Object.defineProperty(global, "React", { value: React, configurable: true, writable: true });
  try {
    const html = renderToString(tree());
    assert.deepEqual(snapshots, [serverValue]);
    await withBrowser(html, {}, async (container) => {
      configureBrowser();
      snapshots.length = 0;
      ready = false;
      const errors = [];
      let hydratedRoot;
      try {
        await React.act(async () => {
          hydratedRoot = hydrateRoot(container, tree(), { onRecoverableError: (error) => errors.push(error) });
        });
        assert.equal(container.textContent, String(serverValue));
        ready = true;
        await React.act(async () => resume());
        assert.deepEqual(errors, []);
        assert.equal(snapshots[0], serverValue, "a provider update must not change a late consumer's first hydration render");
        assert.equal(snapshots.at(-1), clientValue);
        assert.equal(container.textContent, String(clientValue));
      } finally {
        if (hydratedRoot) await React.act(async () => hydratedRoot.unmount());
      }
    });
  } finally {
    if (previousReact) Object.defineProperty(global, "React", previousReact);
    else delete global.React;
  }
}

test("a late flag consumer hydrates the server branch after its provider publishes flags", async () => {
  const realtimeFile = path.join(root, "src/lib/realtime/client.ts");
  const previousRealtime = require.cache[realtimeFile];
  require.cache[realtimeFile] = {
    id: realtimeFile, filename: realtimeFile, loaded: true,
    exports: { connectRealtimeClient: async () => null, releaseRealtimeClientIfIdle: () => {} },
  };
  const serverClient = new QueryClient();
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  let activeClient = serverClient;
  try {
    const { FeatureFlagProvider, useFlag, featureFlagsQueryKey } = jiti(path.join(root, "src/hooks/useFlag.tsx"));
    client.setQueryData(featureFlagsQueryKey(2343), { "hydration-test": true });
    await hydrateStreamedConsumer(
      (children) => React.createElement(QueryClientProvider, { client: activeClient },
        React.createElement(FeatureFlagProvider, { userId: 2343 }, children)),
      () => useFlag("hydration-test"), false, true,
      () => { activeClient = client; },
    );
  } finally {
    serverClient.clear();
    client.clear();
    if (previousRealtime) require.cache[realtimeFile] = previousRealtime;
    else delete require.cache[realtimeFile];
  }
});

for (const initialIsMobile of [false, true]) {
  test(`a late route preserves its ${initialIsMobile ? "mobile" : "desktop"} server layout until hydration`, async () => {
    const { default: MobileViewProvider, useMobileView } = jiti(path.join(root, "src/lib/contexts/mobileContext.tsx"));
    await hydrateStreamedConsumer(
      (children) => React.createElement(MobileViewProvider, { initialIsMobile }, children),
      useMobileView, initialIsMobile, !initialIsMobile,
      () => { window.innerWidth = initialIsMobile ? 1440 : 390; },
    );
  });
}
