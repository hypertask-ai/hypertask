const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const { useGetSearchCache } = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
})(path.join(root, "src/hooks/Search/useSearchCache.ts"));

const emptyCache = { history: [], results: [] };
const savedCache = { history: ["release notes", "AI search"], results: [] };

for (const scenario of [
  { name: "desktop saved history", width: 1440, saved: savedCache },
  { name: "mobile saved history", width: 390, saved: savedCache },
  { name: "restored query history", width: 1440, warm: savedCache },
  { name: "empty storage", width: 390 },
  { name: "malformed storage", width: 1440, raw: "{broken" },
  { name: "unavailable storage", width: 390, blocked: true },
  { name: "server-provided history", width: 1440, initial: savedCache },
]) {
  test(`search cache hydrates safely with ${scenario.name}`, async () => {
    const globals = ["window", "document", "navigator", "localStorage", "IS_REACT_ACT_ENVIRONMENT"];
    const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
    const serverClient = new QueryClient();
    const browserClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: scenario.warm ? Infinity : 0 } },
    });
    let dom;
    let reactRoot;
    let latestQuery;
    const snapshots = [];
    const History = () => {
      latestQuery = useGetSearchCache(scenario.initial);
      snapshots.push(latestQuery.data);
      return React.createElement("ul", { id: "search-history" },
        latestQuery.data.history.map((term) => React.createElement("li", { key: term }, term)),
      );
    };
    const tree = (client) => React.createElement(QueryClientProvider, { client }, React.createElement(History));

    try {
      for (const name of globals) delete global[name];
      const serverHtml = renderToString(tree(serverClient));
      assert.deepEqual(snapshots[0], scenario.initial ?? emptyCache);
      serverClient.clear();
      snapshots.length = 0;

      dom = new JSDOM(`<div id="root">${serverHtml}</div>`, { url: "https://app.hypertask.ai/search" });
      Object.defineProperty(dom.window, "innerWidth", { value: scenario.width });
      if (scenario.saved || scenario.raw) {
        dom.window.localStorage.setItem("searchCache", scenario.raw ?? JSON.stringify(scenario.saved));
      }
      if (scenario.blocked) {
        Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("Storage blocked"); } });
      }
      Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
      Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
      Object.defineProperty(global, "localStorage", {
        configurable: true,
        get: () => dom.window.localStorage,
      });
      if (scenario.warm) browserClient.setQueryData(["Search"], scenario.warm);
      const errors = [];
      const container = document.getElementById("root");
      await React.act(async () => {
        reactRoot = hydrateRoot(container, tree(browserClient), {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

      assert.deepEqual(errors, [], "saved browser history must not replace server markup during hydration");
      assert.deepEqual(snapshots[0], scenario.initial ?? emptyCache, "first client render must match the server");
      const expected = scenario.saved ?? scenario.warm ?? scenario.initial ?? emptyCache;
      assert.deepEqual(latestQuery.data, expected, "history is restored after hydration, including safe storage fallback");
      assert.deepEqual([...container.querySelectorAll("li")].map((li) => li.textContent), expected.history);
      assert.equal(latestQuery.isError, false);

      const updated = { history: ["new query", ...expected.history], results: [] };
      await React.act(async () => {
        browserClient.setQueryData(["Search"], updated);
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      assert.equal(container.querySelector("li").textContent, "new query", "search writes still publish to the UI");
    } finally {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
      serverClient.clear();
      browserClient.clear();
      dom?.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(global, name, descriptor);
        else delete global[name];
      }
    }
  });
}
