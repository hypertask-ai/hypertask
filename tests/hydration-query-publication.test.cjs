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
    queryKey: hydrated
      ? ["hydration-publication"]
      : ["hydration-publication", "placeholder"],
    queryFn: () => {
      onRequest();
      return request;
    },
    enabled: hydrated,
    initialData: "server-placeholder",
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
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

test("hydration-sensitive production queries and flags use the component gate", () => {
  const inbox = read("src/hooks/Inbox/useGetNotifications.ts");
  const boards = read("src/hooks/Homepage/useGetBoards.ts");
  const flags = read("src/hooks/useFlag.tsx");

  assert.match(
    inbox,
    /export const useGetNotifications[\s\S]*?const query = useQuery\(\{\s*queryKey: hydrated\s*\? queryKey\s*: \[\.\.\.queryKey, "hydration-placeholder"\],\s*enabled: hydrated,/,
  );
  assert.match(inbox, /enabled: hydrated && \(options\?\.enabled \?\? true\)/);
  assert.match(
    inbox,
    /queryKey: hydrated\s*\? queryOptions\.queryKey\s*: \[\.\.\.queryOptions\.queryKey, "hydration-placeholder"\]/,
  );
  assert.match(boards, /enabled: hydrated && \(options\?\.enabled \?\? true\)/);
  assert.match(
    boards,
    /queryKey: hydrated\s*\? PROJECTS_ALL_QUERY_KEY\s*: \[\.\.\.PROJECTS_ALL_QUERY_KEY, "hydration-placeholder", user\.id\]/,
  );
  assert.match(flags, /const flags = useContext\(FeatureFlagsContext\)/);
  assert.match(flags, /return hydrated && flags\[key\] === true/);
});

test("shared early results stay hidden until each consumer hydrates", { timeout: 5_000 }, async () => {
  const earlyResult = Promise.resolve("early-result");
  let requests = 0;
  const onRequest = () => {
    requests += 1;
  };
  const serverMarkup = renderToString(
    tree(new QueryClient(), earlyResult, onRequest, () => {}),
  );

  assert.match(serverMarkup, /server-placeholder/);
  assert.equal(requests, 0);
  await earlyResult;

  const dom = new JSDOM(
    `<div id="first">${serverMarkup}</div><div id="late">${serverMarkup}</div>`,
    { url: "https://app.hypertask.ai/inbox" },
  );
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
  const firstContainer = dom.window.document.getElementById("first");
  const lateContainer = dom.window.document.getElementById("late");
  const queryClient = new QueryClient();
  let resolveFirstPublished;
  const firstPublished = new Promise((resolve) => {
    resolveFirstPublished = resolve;
  });
  let resolveLatePublished;
  const latePublished = new Promise((resolve) => {
    resolveLatePublished = resolve;
  });
  const waitForPublication = (publication, consumer) => {
    let timeout;
    return Promise.race([
      publication,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${consumer} did not publish`)),
          1_000,
        );
      }),
    ]).finally(() => clearTimeout(timeout));
  };
  let firstRoot;
  let lateRoot;
  try {
    await React.act(async () => {
      firstRoot = hydrateRoot(
        firstContainer,
        tree(queryClient, earlyResult, onRequest, resolveFirstPublished),
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      );
    });
    await React.act(() => waitForPublication(firstPublished, "first consumer"));

    assert.equal(firstContainer.textContent, "early-result");
    assert.equal(lateContainer.textContent, "server-placeholder");

    await React.act(async () => {
      lateRoot = hydrateRoot(
        lateContainer,
        tree(queryClient, earlyResult, onRequest, resolveLatePublished),
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      );
    });
    await React.act(() => waitForPublication(latePublished, "late consumer"));

    assert.equal(recoverableErrors.length, 0);
    assert.equal(requests, 1);
    assert.equal(lateContainer.textContent, "early-result");
  } finally {
    await React.act(async () => {
      firstRoot?.unmount();
      lateRoot?.unmount();
    });
    dom.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});
