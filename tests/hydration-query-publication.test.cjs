const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const {
  QueryClient,
  QueryClientProvider,
  useQuery,
} = require("@tanstack/react-query");

const root = path.join(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  cache: false,
});
const { useHydrated } = jiti(
  path.join(root, "src/hooks/General/useHydrated.ts"),
);

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

function QueryView({ request, onRequest, onPublished }) {
  const hydrated = useHydrated();
  const query = useQuery({
    queryKey: ["hydration-publication"],
    queryFn: () => {
      onRequest();
      return request;
    },
    enabled: hydrated,
    initialData: "server-placeholder",
    initialDataUpdatedAt: 0,
  });
  React.useEffect(() => {
    if (query.data === "early-result") onPublished();
  }, [onPublished, query.data]);
  return React.createElement("div", null, query.data);
}

function tree(client, request, onRequest, onPublished) {
  return React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(QueryView, { request, onRequest, onPublished }),
  );
}

test("hydration-sensitive production queries and flags use the document gate", () => {
  const inbox = read("src/hooks/Inbox/useGetNotifications.ts");
  const boards = read("src/hooks/Homepage/useGetBoards.ts");
  const flags = read("src/hooks/useFlag.tsx");

  assert.match(
    inbox,
    /export const useGetNotifications[\s\S]*?const query = useQuery\(\{\s*queryKey,\s*enabled: hydrated,/,
  );
  assert.match(inbox, /enabled: hydrated && \(options\?\.enabled \?\? true\)/);
  assert.match(boards, /enabled: hydrated && \(options\?\.enabled \?\? true\)/);
  assert.match(flags, /const flags = useContext\(FeatureFlagsContext\)/);
  assert.match(flags, /return hydrated && flags\[key\] === true/);
});

test("a shared query waits until streamed consumers can hydrate", { timeout: 5_000 }, async () => {
  const earlyResult = Promise.resolve("early-result");
  let requests = 0;
  const onRequest = () => {
    requests += 1;
  };
  const serverClient = new QueryClient();
  const shellMarkup = renderToString(
    tree(serverClient, earlyResult, onRequest, () => {}),
  );
  const routeMarkup = renderToString(
    tree(serverClient, earlyResult, onRequest, () => {}),
  );

  assert.match(shellMarkup, /server-placeholder/);
  assert.match(routeMarkup, /server-placeholder/);
  assert.equal(requests, 0);

  const dom = new JSDOM(
    `<div id="shell">${shellMarkup}</div><div id="route">${routeMarkup}</div>`,
    { url: "https://app.hypertask.ai/inbox", pretendToBeVisual: true },
  );
  Object.defineProperty(dom.window.document, "readyState", {
    configurable: true,
    value: "loading",
  });
  const testGlobals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previousGlobals = new Map(
    Object.keys(testGlobals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(global, key),
    ]),
  );
  for (const [key, value] of Object.entries(testGlobals)) {
    Object.defineProperty(global, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const recoverableErrors = [];
  const shell = dom.window.document.getElementById("shell");
  const route = dom.window.document.getElementById("route");
  const client = new QueryClient();
  let resolvePublished;
  const published = new Promise((resolve) => {
    resolvePublished = resolve;
  });
  const onPublished = () => resolvePublished();
  const hydratedRoots = [];
  try {
    await React.act(async () => {
      hydratedRoots.push(
        hydrateRoot(
          shell,
          tree(client, earlyResult, onRequest, onPublished),
          { onRecoverableError: (error) => recoverableErrors.push(error) },
        ),
      );
    });
    assert.equal(requests, 0);
    assert.equal(route.textContent, "server-placeholder");

    await React.act(async () => {
      hydratedRoots.push(
        hydrateRoot(
          route,
          tree(client, earlyResult, onRequest, onPublished),
          { onRecoverableError: (error) => recoverableErrors.push(error) },
        ),
      );
    });
    Object.defineProperty(dom.window.document, "readyState", {
      configurable: true,
      value: "complete",
    });
    dom.window.dispatchEvent(new dom.window.Event("load"));
    await React.act(() => published);

    assert.equal(recoverableErrors.length, 0);
    assert.equal(requests, 1);
    assert.equal(shell.textContent, "early-result");
    assert.equal(route.textContent, "early-result");
  } finally {
    await React.act(async () => {
      for (const hydratedRoot of hydratedRoots) hydratedRoot.unmount();
    });
    dom.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});
