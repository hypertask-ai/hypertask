const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
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
const inbox = jiti(path.join(root, "src/lib/taskDetailInboxFlow.ts"));
const navigationFile = "src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx";
const descriptionFile = "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionSubTasks/DescriptionSubTasks.tsx";
const parentFile = "src/components/PageComponents/TaskDetail/TopRow/SubtaskLink.tsx";
const historyBootScript = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8").match(/id="ht-cached-task-history"\s+dangerouslySetInnerHTML=\{\{\s+__html: "([^"]+)"/)?.[1];
assert.ok(historyBootScript, "the root must register cached history before Next hydration");
const parent = { id: 42, projectId: 6859, uniqueIndex: 43, title: "Parent title", description_: { content: "Parent body" }, subTasks: [] };
const child = { ...parent, id: 44, uniqueIndex: 45, title: "Child title", description_: { content: "Child body" }, parentTask: parent };
child.parentTask = { ...parent, subTasks: [{ ...child, parentTask: null }] };
const parentWithChild = { ...parent, subTasks: [child] };
const href = task => `/detail/project-${task.projectId}/${task.uniqueIndex}`;

function load(file, mocks, ref = process.env.SUBTASK_LINK_BASELINE) {
  const source = ref ? execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8" }) : fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", "queueMicrotask", compiled)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports, mocks.queueMicrotask ?? queueMicrotask);
  return exports.default;
}

function fixture(t, { enabled = true, direct = false, ref } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai" + (direct ? href(parent) : "/project") });
  const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map(name => [name, global[name]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["root"] }, "", window.location.href);
  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method].bind(window.history);
    // Next restores its internal marker after handling native history writes.
    window.history[method] = (state, title, url) => original({ ...state, __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["root"] }, title, url);
  }
  window.scrollTo = () => {};
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  const client = new QueryClient();
  let settleTraversal;
  let nextTraversals = 0;
  let restoreNextRoute = () => {};
  let nativeCheckpoints = false;
  window.addEventListener("popstate", () => {
    if (settleTraversal) { const resolve = settleTraversal; settleTraversal = null; setImmediate(resolve); }
  }, true);
  new Function("window", "CustomEvent", historyBootScript)(window, window.CustomEvent);
  // Native Window popstate runs in registration order, unlike jsdom's synthetic capture ordering.
  window.addEventListener("popstate", () => { nextTraversals++; restoreNextRoute(); }, true);
  const renderer = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    client.clear(); dom.window.close();
    for (const name of names) global[name] = previous[name];
  });
  let nextPath = direct ? href(parent) : "/project";
  let currentTask = parentWithChild;
  let serverTask = parentWithChild;
  let instant = true, account = 2343, authenticated = 2343;
  const playlists = [];
  const router = { replace: () => assert.fail("cached task history must not fetch a Next route"), refresh: () => assert.fail("cached task history must not refresh") };
  let syncCommits = 0;
  const mocks = {
    "react-dom": { flushSync: callback => { syncCommits++; return flushSync(callback); } },
    queueMicrotask: callback => nativeCheckpoints ? callback() : queueMicrotask(callback),
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => nextPath, useRouter: () => router, useSearchParams: () => new URLSearchParams("inboxFlow=true") },
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/state": { useRecoilValue: () => ({ id: account }), useRecoilState: () => [[], value => playlists.push(value)] },
    "@/store": { currentUserAtom: {}, tasksPlayListAtom: {} },
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: authenticated }) },
    "@/hooks/useFlag": { useFlag: key => key === flags.HTPR_6972_SUBTASK_LINK_FLAG ? enabled : instant },
    "@/lib/flags/keys": flags, "@/lib/navigation/cachedTaskDetail": cache, "@/lib/taskDetailInboxFlow": inbox,
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ currentTask, editMode: "", cachedLayout: true }) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "./TaskPagesContext": { useTaskPages: () => ({ loading: false, hasPages: true }) },
    "../../../TopRow/CreateSummaryButton": { __esModule: true, default: () => null },
    "@/components/Common/Tooltip": { __esModule: true, default: () => null },
    "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: {} } },
    "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.join(" ") },
    "lucide-react": { Check: () => null, Plus: () => null, Unlink: () => null },
    "@/hooks/Task Detail/useUpdateSubtask": { __esModule: true, default: () => ({}) },
  };
  const Description = load(descriptionFile, mocks);
  const ParentLink = load(parentFile, mocks);
  const Detail = ({ initialTask }) => {
    currentTask = initialTask;
    return React.createElement("article", null,
      React.createElement("h1", null, initialTask.title),
      React.createElement("p", null, initialTask.description_.content),
      React.createElement("textarea", { "data-testid": "composer" }),
      React.createElement(Description),
      React.createElement(ParentLink, { parentTask: initialTask.parentTask, projectId: initialTask.projectId }));
  };
  const ServerDetail = () => React.createElement(Detail, { initialTask: serverTask });
  mocks["@/components/Modals/SwipeUnread/EmbeddedTaskDetail"] = { __esModule: true, default: Detail };
  const Navigation = load(navigationFile, mocks, ref);
  let children = direct ? React.createElement(ServerDetail) : "Board";
  let navigationKey = 0;
  const render = () => renderer.render(React.createElement(React.StrictMode, null, React.createElement(Navigation, { accountId: 2343, key: navigationKey }, React.isValidElement(children) ? React.cloneElement(children) : children)));
  const open = task => cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: task.projectId, uniqueIndex: task.uniqueIndex, href: href(task), task });
  const assertContent = task => {
    assert.equal(window.location.pathname, href(task));
    assert.equal(document.querySelector("h1")?.textContent, task.title);
    assert.equal(document.querySelector("p")?.textContent, task.description_.content);
  };
  const click = async task => React.act(async () => {
    const link = document.querySelector(`a[href="${href(task)}?inboxFlow=true"]`);
    assert.ok(link, `Missing ${href(task)} in ${document.querySelector("article")?.textContent}`);
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, "cached clicks must suppress Next navigation");
  });
  const traverse = method => React.act(async () => {
    await new Promise(resolve => {
      settleTraversal = resolve;
      window.history[method]();
    });
  });
  return { client, render, open, assertContent, click, traverse, playlists,
    next(task) { nextPath = href(task); render(); },
    server(task) { serverTask = task; children = React.createElement(ServerDetail); nextPath = href(task); render(); },
    remount() { navigationKey++; render(); },
    nativeNext() {
      // Native dispatch flushes microtasks before invoking the next listener.
      nativeCheckpoints = true;
      restoreNextRoute = () => flushSync(() => {
        window.history.replaceState({}, "", window.location.href);
        nextPath = window.location.pathname;
        render();
      });
    },
    instant(value) { instant = value; }, account(value) { account = value; }, authenticated(value) { authenticated = value; },
    nextTraversals: () => nextTraversals, syncCommits: () => syncCommits };
}

for (const direct of [false, true]) {
  test(`cached subtask and parent links show title/body immediately with Back/Forward from ${direct ? "direct Next parent" : "board card"}`, async t => {
    const f = fixture(t, { direct });
    await React.act(async () => f.render());
    if (direct) f.client.setQueryData(cache.cachedTaskDetailKey(2343, parent.id), parentWithChild);
    else await React.act(async () => f.open(parentWithChild));
    f.assertContent(parent);
    const composer = document.querySelector("textarea");
    await React.act(async () => { window.dispatchEvent(new Event("cached-task-detail-navigation")); f.render(); });
    assert.equal(document.querySelector("textarea"), composer, "same-address notification never replaces the mounted page");
    await React.act(async () => window.dispatchEvent(new window.PopStateEvent("popstate", { state: window.history.state })));
    assert.equal(document.querySelector("textarea"), composer, "same-task modal history retains the composer");
    assert.equal(f.nextTraversals(), 1, "same-task modal popstate still reaches its listeners");
    const nextTraversalsBefore = f.nextTraversals();
    await React.act(async () => {
      const { cachedTaskDetail, ...state } = window.history.state;
      window.history.replaceState(state, "", window.location.href);
    });
    await f.click(child); f.assertContent(child);
    assert.deepEqual(f.playlists.at(-1), [{ projectId: 6859, uniqueIndex: 43 }, { projectId: 6859, uniqueIndex: 45 }]);
    assert.equal(window.location.search, "?inboxFlow=true");
    await f.traverse("back"); f.assertContent(parent);
    assert.equal(window.history.state.cachedTaskDetail?.taskId, parent.id, "unmarked Back must publish a durable parent marker before stale Next renders");
    await React.act(async () => f.next(child)); f.assertContent(parent);
    await React.act(async () => f.next(parent)); f.assertContent(parent);
    await f.traverse("forward"); f.assertContent(child);
    assert.equal(f.nextTraversals(), nextTraversalsBefore, "cached Back/Forward must run before Next's native listener");
    assert.equal(f.syncCommits(), 2, "cached Back/Forward must commit before the native listener returns");
    await React.act(async () => f.next(parent)); f.assertContent(child);
    await React.act(async () => f.next(child)); f.assertContent(child);
    await f.click(parent); f.assertContent(parent);
    assert.equal(window.location.search, "?inboxFlow=true");
    // Next may remove custom state during a same-address refresh.
    await React.act(async () => window.history.replaceState({}, "", window.location.href));
  });
}

test("cached traversal survives an unmarked matching Next page without a remembered location", async t => {
  const f = fixture(t, { direct: true });
  await React.act(async () => f.render());
  f.client.setQueryData(cache.cachedTaskDetailKey(2343, parent.id), parentWithChild);
  await f.click(child);
  await React.act(async () => {
    window.history.replaceState({}, "", window.location.href);
    f.server(child);
    f.remount();
  });
  f.assertContent(child);
  const composer = document.querySelector("textarea");
  await React.act(async () => { window.dispatchEvent(new Event("cached-task-detail-navigation")); f.render(); });
  assert.equal(document.querySelector("textarea"), composer, "matching Next content stays mounted");
  await f.traverse("back");
  assert.equal(window.history.state.cachedTaskDetail?.taskId, parent.id, "cached Back must survive losing the remembered location");
  f.assertContent(parent);
  await f.traverse("forward"); f.assertContent(child);
  assert.equal(f.nextTraversals(), 0);
});

test("native Next popstate cannot remove cached recovery or hide a same-path marker change", async t => {
  const f = fixture(t, { direct: true });
  await React.act(async () => f.render());
  f.client.setQueryData(cache.cachedTaskDetailKey(2343, parent.id), parentWithChild);
  await f.click(child);
  await React.act(async () => f.server(child));
  f.nativeNext();
  await f.traverse("back");
  assert.equal(window.history.state.cachedTaskDetail?.taskId, parent.id, "native Next must not remove cached recovery before its listener runs");
  f.assertContent(parent);
  await f.traverse("forward"); f.assertContent(child);
});

test("an unmarked matching Next page retains its composer after seeding and same-task modal popstate", async t => {
  const f = fixture(t, { direct: true });
  await React.act(async () => f.render());
  const composer = document.querySelector("textarea"); composer.value = "Unsent draft";
  await React.act(async () => { f.client.setQueryData(cache.cachedTaskDetailKey(2343, parent.id), parentWithChild); f.render(); });
  await React.act(async () => window.dispatchEvent(new window.PopStateEvent("popstate", { state: {} })));
  assert.equal(document.querySelector("textarea"), composer);
  assert.equal(composer.isConnected, true);
  assert.equal(composer.value, "Unsent draft");
});

test("same-task modal history after a normal Next navigation does not replace the composer with cached content", async t => {
  const f = fixture(t, { direct: true });
  await React.act(async () => f.render());
  f.client.setQueryData(cache.cachedTaskDetailKey(2343, child.id), child);
  await React.act(async () => {
    window.history.pushState({}, "", href(child));
    f.server(child);
  });
  const composer = document.querySelector("textarea");
  await React.act(async () => window.dispatchEvent(new window.PopStateEvent("popstate", { state: window.history.state })));
  assert.equal(document.querySelector("textarea"), composer);
  assert.equal(window.history.state.cachedTaskDetail, undefined);
});

for (const ref of [undefined, "3a35c08e7~1"]) {
  test(`flag-off cached navigation preserves pre-1131 behavior (${ref ?? "candidate"})`, async t => {
    const f = fixture(t, { enabled: false, ref });
    await React.act(async () => f.render());
    await React.act(async () => f.open(parentWithChild));
    const link = document.querySelector("a");
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    await React.act(async () => link.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false);
    await React.act(async () => f.server(child));
    assert.equal(document.querySelector("h1").textContent, parent.title, "old cached overlay remains until native navigation publishes a new address");
    await React.act(async () => window.history.pushState({}, "", href(child)));
    assert.equal(document.querySelector("h1").textContent, parent.title);
    await React.act(async () => window.dispatchEvent(new Event("cached-task-detail-navigation")));
    f.assertContent(child);
  });
}

test("links preserve modified clicks and fallback for missing descriptions, disabled flags and mismatched accounts", async t => {
  const f = fixture(t, { direct: true });
  await React.act(async () => f.render());
  const dispatch = async (target, options) => {
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, ...options });
    await React.act(async () => target.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false, JSON.stringify(options));
    assert.equal(window.location.pathname, href(parent));
  };
  const link = () => document.querySelector("a");
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) await dispatch(link(), options);
  f.instant(false); await React.act(async () => f.render()); await dispatch(link());
  f.instant(true); f.authenticated(985); await React.act(async () => f.render()); await dispatch(link());
  f.authenticated(2343); f.account(985); await React.act(async () => f.render()); await dispatch(link());
  f.account(2343);
  const compactChild = { id: child.id, projectId: child.projectId, uniqueIndex: child.uniqueIndex, title: child.title };
  await React.act(async () => f.server({ ...parent, subTasks: [compactChild] }));
  await dispatch(link());
  // Parent link uses the same fallback rules when the parent relation is compact.
  await React.act(async () => f.server({ ...child, parentTask: { ...compactChild, id: parent.id, uniqueIndex: parent.uniqueIndex, title: parent.title } }));
  await dispatch(document.querySelector(`a[href="${href(parent)}?inboxFlow=true"]`));
  await React.act(async () => f.server({ ...parent, subTasks: [compactChild] }));
  f.client.setQueryData(["boardTasks", 2343, parent.projectId], { tasks: [child] });
  await f.click(child); f.assertContent(child);
});
