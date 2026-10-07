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

function fixture(t, { enabled = true, cachedParent = true, coldViewer = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai" + href(parent) });
  const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map(name => [name, global[name]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["root"] }, "", href(parent));
  window.scrollTo = () => {};
  const client = new QueryClient();
  const renderer = createRoot(document.getElementById("root"));
  let nextPath = href(parent), children, settleTraversal, observeMount = false;
  const mounts = [], checkpoints = [], routerCalls = [];
  window.addEventListener("popstate", () => {
    if (settleTraversal) { const resolve = settleTraversal; settleTraversal = null; setImmediate(resolve); }
  }, true);
  new Function("window", "CustomEvent", historyScript)(window, window.CustomEvent);
  let nextTraversals = 0;
  window.addEventListener("popstate", () => { nextTraversals++; }, true);
  const observed = () => ({ title: document.querySelector("h1")?.textContent, body: document.querySelector("p")?.textContent, loading: document.querySelector('[role="status"]')?.getAttribute("data-task-path") });
  const Detail = ({ initialTask }) => {
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
  const server = task => { nextPath = href(task); children = React.createElement(Detail, { initialTask: task }); render(); };
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    client.clear(); dom.window.close();
    for (const name of names) global[name] = previous[name];
  });
  const initialize = async () => {
    await React.act(async () => server(parent));
    if (cachedParent) client.setQueryData(cache.cachedTaskDetailKey(2343, parent.id), parent);
    await React.act(async () => cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: child.projectId, uniqueIndex: child.uniqueIndex, href: href(child), task: child }));
    // The background Next refresh has replaced the original server tree with the child.
    await React.act(async () => server(child));
    assert.equal(observed().title, child.title);
    observeMount = true;
  };
  const checkpoint = () => checkpoints.push(observed());
  const traverse = method => React.act(async () => {
    window.removeEventListener("cached-task-detail-popstate", checkpoint);
    window.addEventListener("cached-task-detail-popstate", checkpoint);
    await new Promise(resolve => { settleTraversal = resolve; window.history[method](); });
  });
  return { client, initialize, traverse, observed, checkpoints, mounts, routerCalls, resolveViewer,
    server: task => React.act(async () => server(task)),
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
  test(`Back after cached subtask open clears the child before ${cachedParent ? "cached parent mount" : "the parent route arrives"}`, async t => {
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
      for (const mount of f.mounts) assertDestination(mount, parent);
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
    for (const mount of f.mounts) assertDestination(mount, child);
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
  test(`flag off preserves the old ${cachedParent ? "synchronous mount" : "wrong-task fallback"} and is a negative control`, async t => {
    const f = fixture(t, { enabled: false, cachedParent });
    await f.initialize(); await f.traverse("back");
    if (cachedParent) {
      assert.equal(f.observed().title, parent.title);
      assert.ok(f.mounts.some(mount => mount.title === child.title && mount.body === child.description_.content));
      assert.throws(() => assertDestination(f.mounts[0], parent), assert.AssertionError);
    } else {
      assert.equal(f.observed().title, child.title);
      assert.equal(f.observed().body, child.description_.content);
      assert.throws(() => assertDestination(f.observed(), parent), assert.AssertionError);
    }
    assert.equal(f.observed().loading, undefined);
  });
}

test("a cold cached viewer keeps neutral loading until the destination module resolves", async t => {
  const f = fixture(t, { coldViewer: true });
  await f.initialize(); await f.traverse("back");
  assertDestination(f.checkpoints.at(-1), parent);
  assert.equal(f.observed().loading, href(parent));
  await React.act(async () => f.resolveViewer());
  assert.equal(f.observed().title, parent.title);
  for (const mount of f.mounts) assertDestination(mount, parent);
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
