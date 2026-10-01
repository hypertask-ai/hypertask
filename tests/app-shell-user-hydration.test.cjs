const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const user = { id: 6651001, displayName: "Local test user", UserSettingId: "local" };
const atoms = { currentUserAtom: Symbol("user"), currentProjectAtom: Symbol("project"), currentBoardBillingAtom: Symbol("billing") };
const noop = () => {};
const emptyFavorites = [];

for (const mobile of [false, true]) {
  test(`app shell hydrates its saved user on ${mobile ? "mobile" : "desktop"}`, async () => {
    const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
    const previousGlobals = globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
    const modules = new Map([
      ["src/store/index.ts", atoms],
      ["src/lib/state.tsx", {
        useRecoilState: (atom) => [atom === atoms.currentUserAtom && typeof window !== "undefined" ? user : null, noop],
        useSetRecoilState: () => noop,
      }],
      ["src/hooks/MultiPages/useGetAllFavorites.ts", { useGetAllFavorites: () => ({ data: emptyFavorites }) }],
    ]);
    const previousModules = [];
    let reactRoot;
    let dom;
    try {
      for (const name of globals) delete global[name];
      for (const [relative, exports] of modules) {
        const filename = path.join(root, relative);
        previousModules.push([filename, require.cache[filename]]);
        require.cache[filename] = { id: filename, filename, loaded: true, exports };
      }
      const navigation = path.join(root, "node_modules/next/navigation.js");
      previousModules.push([navigation, require.cache[navigation]]);
      require.cache[navigation] = {
        id: navigation, filename: navigation, loaded: true,
        exports: { usePathname: () => "/search", useSearchParams: () => new URLSearchParams() },
      };
      const useGlobalProvider = createJiti(__filename, {
        interopDefault: true,
        alias: { "@": path.join(root, "src"), "next/navigation": navigation },
      })(path.join(root, "src/components/ProviderGlobal/useGlobalProvider.ts")).default;
      const snapshots = [];
      const Shell = () => {
        const { currentUser } = useGlobalProvider();
        snapshots.push(currentUser);
        return React.createElement("div", null,
          !currentUser && React.createElement("aside", null, "Cookie consent"),
          mobile && currentUser && React.createElement("nav", null, "Mobile navigation"),
        );
      };
      const serverHtml = renderToString(React.createElement(Shell));
      assert.match(serverHtml, /Cookie consent/);
      snapshots.length = 0;
      dom = new JSDOM(`<div id="root">${serverHtml}</div>`, { url: "https://app.hypertask.ai/search" });
      Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
      Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
      const errors = [];
      const container = document.getElementById("root");
      await React.act(async () => {
        reactRoot = hydrateRoot(container, React.createElement(Shell), {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      assert.deepEqual(errors, [], "saved user must not change cookie consent or mobile chrome during hydration");
      assert.equal(snapshots[0], null, "first client render matches the server's user state");
      assert.equal(snapshots.at(-1), user, "saved profile remains available after hydration");
      assert.equal(container.querySelector("aside"), null);
      assert.equal(Boolean(container.querySelector("nav")), mobile);
    } finally {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
      dom?.window.close();
      for (const [filename, previous] of previousModules) {
        if (previous) require.cache[filename] = previous;
        else delete require.cache[filename];
      }
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(global, name, descriptor);
        else delete global[name];
      }
    }
  });
}
