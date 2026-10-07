const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const cache = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const flags = jiti(path.join(root, "src/lib/flags/keys.ts"));
const source = fs.readFileSync(path.join(root, "src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx"), "utf8");
const historyScript = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8").match(/id="ht-cached-task-history"\s+dangerouslySetInnerHTML=\{\{\s+__html: "([^"]+)"/)?.[1];
assert.ok(historyScript);
const parent = { id: 42, projectId: 6859, uniqueIndex: 43, title: "Parent title", description_: { content: "Parent body" } };
const child = { ...parent, id: 44, uniqueIndex: 45, title: "Child title", description_: { content: "Child body" } };
const href = task => `/detail/project-${task.projectId}/${task.uniqueIndex}`;

function fixture(t, { enabled = true, cachedParent = true, coldViewer = false, stableChildren = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai" + href(parent) });
  const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map(name => [name, global[name]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["root"] }, "", href(parent));
  window.scrollTo = () => {};
  const client = new QueryClient();
  const renderer = createRoot(document.getElementById("root"));
  let nextPath = href(parent), children, nativeTask = parent, seedNative = false, settleTraversal, observeMount = false;
  const routeSubscribers = new Set();
  const mounts = [], checkpoints = [], routerCalls = [];
  window.addEventListener("popstate", () => {
    if (settleTraversal) { const resolve = settleTraversal; settleTraversal = null; setImmediate(resolve); }
  }, true);
  new Function("window", "CustomEvent", historyScript)(window, window.CustomEvent);
  let nextTraversals = 0;
  window.addEventListener("popstate", () => { nextTraversals++; }, true);
  const visible = selector => [...document.querySelectorAll(selector)].find(el => !el.closest("[hidden]"));
  const observed = () => ({ title: visible("h1")?.textContent, body: visible("p")?.textContent, loading: visible('[role="status"]')?.getAttribute("data-task-path") });
  const Detail = ({ initialTask, native = false }) => {
    React.useEffect(() => {
      if (native && seedNative) client.setQueryData(cache.cachedTaskDetailKey(2343, initialTask.id), initialTask);
    }, [initialTask, native]);
    if (observeMount) mounts.push({ destination: href(initialTask), ...observed() });
    return React.createElement("article", null,
      React.createElement("h1", null, initialTask.title),
      React.createElement("p", null, initialTask.description_.content),
      React.createElement("textarea"));
  };
  let resolveViewer;
  const viewer = new Promise(resolve => { resolveViewer = () => resolve({ __esModule: true, default: Detail }); });
  viewer.__esModule = true;
  const mocks = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"), "react-dom": { flushSync },
    "next/navigation": { usePathname: () => nextPath, useRouter: () => ({ replace: url => routerCalls.push(url), refresh: () => routerCalls.push("refresh") }) },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) }, "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: key => key === flags.HTPR_6991_BACK_FIRST_OPEN_FLAG ? enabled : true },
    "@/lib/flags/keys": flags, "@/lib/navigation/cachedTaskDetail": cache,
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": coldViewer ? viewer : { __esModule: true, default: Detail },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  const Navigation = exports.default;
  const render = () => renderer.render(React.createElement(Navigation, { accountId: 2343 }, children));
  const NativeRoute = () => React.createElement(Detail, { initialTask: React.useSyncExternalStore(notify => { routeSubscribers.add(notify); return () => routeSubscribers.delete(notify); }, () => nativeTask), native: true });
  const routeChildren = React.createElement(NativeRoute);
  const server = task => {
    nextPath = href(task); nativeTask = task;
    children = stableChildren ? routeChildren : React.createElement(Detail, { initialTask: task, native: true });
    for (const notify of routeSubscribers) notify();
    render();
  };
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    client.clear(); dom.window.close();
    for (const name of names) global[name] = previous[name];
  });
  const initialize = async ({ refreshChild = true } = {}) => {
    await React.act(async () => server(parent));
    if (cachedParent) client.setQueryData(cache.cachedTaskDetailKey(2343, parent.id), parent);
    await React.act(async () => cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: child.projectId, uniqueIndex: child.uniqueIndex, href: href(child), task: child }));
    // The background Next refresh has replaced the original server tree with the child.
    if (refreshChild) await React.act(async () => server(child));
    if (!coldViewer) assert.equal(observed().title, child.title);
    observeMount = true;
  };
  const checkpoint = () => checkpoints.push(observed());
  const traverse = method => React.act(async () => {
    window.removeEventListener("cached-task-detail-popstate", checkpoint);
    window.addEventListener("cached-task-detail-popstate", checkpoint);
    await new Promise(resolve => { settleTraversal = resolve; window.history[method](); });
  });
  return { client, initialize, traverse, observed, checkpoints, mounts, routerCalls, resolveViewer,
    server: task => React.act(async () => { seedNative = true; server(task); }),
    nextPath: task => React.act(async () => { nextPath = href(task); render(); }),
    nextTraversals: () => nextTraversals };
}

function assertDestination(observed, task) {
  if (observed.loading === href(task)) {
    assert.equal(observed.title, undefined);
    assert.equal(observed.body, undefined);
  } else {
    assert.equal(observed.title, task.title);
    assert.equal(observed.body, task.description_.content);
  }
}

for (const cachedParent of [true, false]) {
  test(`Back after cached subtask open ${cachedParent ? "commits the parent without Loading" : "hides the child until the parent route arrives"}`, async t => {
    const f = fixture(t, { cachedParent });
    await f.initialize(); await f.traverse("back");
    assert.equal(window.location.pathname, href(parent));
    assertDestination(f.checkpoints.at(-1), parent);
    assertDestination(f.observed(), parent);
    if (cachedParent) {
      assert.equal(f.observed().title, parent.title);
      assert.equal(f.nextTraversals(), 0);
      assert.deepEqual(f.routerCalls, []);
      assert.ok(f.mounts.length > 0);
      assert.ok(f.mounts.every(mount => mount.destination === href(parent)));
      assert.equal(f.checkpoints.at(-1).loading, undefined);
    } else {
      assert.equal(f.observed().loading, href(parent));
      // A URL update alone is not proof that the old route content was replaced.
      await f.nextPath(parent); assertDestination(f.observed(), parent);
      assert.equal(f.observed().loading, href(parent));
      await f.server(parent); assert.equal(f.observed().title, parent.title);
    }
    f.mounts.length = 0;
    await f.traverse("forward");
    assertDestination(f.checkpoints.at(-1), child);
    assert.equal(f.observed().title, child.title);
    assert.equal(f.checkpoints.at(-1).loading, undefined);
  });
}

test("Forward with an evicted child keeps neutral loading until the child route arrives", async t => {
  const f = fixture(t, { cachedParent: false });
  await f.initialize(); await f.traverse("back"); await f.server(parent);
  f.client.removeQueries({ queryKey: cache.cachedTaskDetailKey(2343, child.id), exact: true });
  await f.traverse("forward");
  assertDestination(f.checkpoints.at(-1), child);
  assert.equal(f.observed().loading, href(child));
  await f.server(child); assert.equal(f.observed().title, child.title);
});

for (const cachedParent of [true, false]) {
  test(`flag off preserves ${cachedParent ? "the synchronous cache hit" : "the wrong-task cache-miss fallback as a negative control"}`, async t => {
    const f = fixture(t, { enabled: false, cachedParent });
    await f.initialize(); await f.traverse("back");
    if (cachedParent) {
      assert.equal(f.observed().title, parent.title);
      assert.equal(f.checkpoints.at(-1).title, parent.title);
    } else {
      assert.equal(f.observed().title, child.title);
      assert.equal(f.observed().body, child.description_.content);
      assert.throws(() => assertDestination(f.observed(), parent), assert.AssertionError);
    }
    assert.equal(f.observed().loading, undefined);
  });
}

test("a pending cached viewer shows neither the child nor Loading on cold Back", async t => {
  const f = fixture(t, { coldViewer: true });
  await f.initialize({ refreshChild: false }); await f.traverse("back");
  assert.equal(f.checkpoints.at(-1).title, undefined);
  assert.equal(f.observed().loading, undefined);
  assert.equal(f.observed().title, undefined);
  await React.act(async () => f.resolveViewer());
  assert.equal(f.observed().title, parent.title);
  assert.equal(f.observed().loading, undefined);
});

test("a late viewer import cannot clear cache-miss protection before the native parent renders", async t => {
  const f = fixture(t, { cachedParent: false, coldViewer: true });
  await f.initialize(); await f.traverse("back");
  assert.equal(f.observed().loading, href(parent));
  await React.act(async () => f.resolveViewer());
  assert.equal(f.observed().loading, href(parent));
  await f.nextPath(parent);
  assert.equal(f.observed().loading, href(parent));
  await f.server(parent);
  assert.equal(f.observed().title, parent.title);
  assert.equal(f.observed().loading, undefined);
});

test("cached Forward bypasses an outstanding cache-miss Back destination", async t => {
  const f = fixture(t, { cachedParent: false });
  await f.initialize(); await f.traverse("back");
  assert.equal(f.observed().loading, href(parent));
  await f.traverse("forward");
  assert.equal(f.observed().title, child.title);
  assert.equal(f.observed().loading, undefined);
  await f.server(parent);
  assert.equal(f.observed().title, child.title);
  assert.equal(f.observed().loading, undefined);
});

test("cache-miss Back allows the hidden native route to render and seed the parent with stable children", async t => {
  const f = fixture(t, { cachedParent: false, stableChildren: true });
  await f.initialize(); await f.traverse("back");
  assert.equal(f.observed().loading, href(parent));
  assert.equal(f.observed().title, undefined);
  await f.nextPath(parent);
  assert.equal(f.observed().loading, href(parent));
  await f.server(parent);
  assert.equal(f.observed().title, parent.title);
  assert.equal(f.observed().loading, undefined);
  assert.equal(window.location.pathname, href(parent));
});

test("same-task modal popstate keeps the task and unsent composer mounted", async t => {
  const f = fixture(t);
  await f.initialize();
  const composer = document.querySelector("textarea"); composer.value = "Unsent draft";
  await React.act(async () => window.dispatchEvent(new window.PopStateEvent("popstate", { state: window.history.state })));
  assert.equal(document.querySelector("textarea"), composer);
  assert.equal(composer.value, "Unsent draft");
  assert.equal(f.observed().loading, undefined);
});

test("native detail seeds cache readiness with the Back flag independently of subtask links", () => {
  const nativeSource = fs.readFileSync(path.join(root, "src/app/detail/[...slug]/useTaskDetailState.tsx"), "utf8");
  const body = nativeSource.slice(nativeSource.indexOf("  const subtaskLink =")).match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/)?.[1];
  assert.ok(body);
  const seed = new Function("subtaskLink", "backFirstOpen", "embedded", "authenticatedUserId", "currentUser", "_parsedTask", "queryClient", "cachedTaskDetailKey", body);
  for (const subtaskLink of [false, true]) for (const backFirstOpen of [false, true]) {
    const client = new QueryClient();
    seed(subtaskLink, backFirstOpen, false, 2343, { id: 2343 }, parent, client, cache.cachedTaskDetailKey);
    assert.equal(client.getQueryData(cache.cachedTaskDetailKey(2343, parent.id)), subtaskLink || backFirstOpen ? parent : undefined);
    client.clear();
  }
  const client = new QueryClient();
  seed(false, true, true, 2343, { id: 2343 }, parent, client, cache.cachedTaskDetailKey);
  seed(false, true, false, 2344, { id: 2343 }, parent, client, cache.cachedTaskDetailKey);
  assert.equal(client.getQueryData(cache.cachedTaskDetailKey(2343, parent.id)), undefined);
  client.clear();
});
