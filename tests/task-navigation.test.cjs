const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient } = require("@tanstack/react-query");
const { createJiti } = require("jiti");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const cache = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const task = { id: 42, projectId: 7425, uniqueIndex: 1, title: "Alpha planning", status: "Normal", description_: { content: "<p>Planning</p>" } };
const boardHref = "/project?id=7425";
const taskHref = "/detail/project-7425/1";

function loadSource(relativePath, mocks) {
  const source = process.env.TASK_NAVIGATION_BASELINE
    ? execFileSync("git", ["show", `HEAD:${relativePath}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports.default;
}

function fixture(t, { flagEnabled = false, mobile = false, cached = false, openDetail } = {}) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: `https://app.hypertask.ai${boardHref}` });
  const originals = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, location: dom.window.location, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(global, name));
    Object.defineProperty(global, name, { configurable: true, writable: true, value });
  }
  dom.window.scrollTo = () => {};
  const calls = [];
  const router = {
    push: (href) => { calls.push(["router.push", href]); dom.window.history.pushState({ __NA: true }, "", href); },
    replace: () => assert.fail("opening a card must not replace the board history entry"),
  };
  const queryClient = new QueryClient();
  const navigate = loadSource("src/hooks/MultiPages/Route/useHypertasksNavigate.ts", {
    "next/navigation": { useRouter: () => router, usePathname: () => "/project" },
    "@/lib/constants": {},
    "@/lib/constants/constants": { REACT_QUERY_KEYS: {} },
    "react-hot-toast": () => {},
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: 2343 }) },
    "@/hooks/useFlag": { useFlag: () => flagEnabled },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "htpr-6752-instant-ticket-open" },
    "@/lib/navigation/cachedTaskDetail": cache,
    "@/lib/analytics/taskDetailReadiness": { taskDetailEntryPathForRoute: () => "board", markTaskDetailNavigationStart: () => {} },
  })();

  // Exercise Next's real App Router Link, stubbing route dispatch and disabled prefetch.
  const linkPath = require.resolve("next/dist/client/app-dir/link");
  const linkRequire = createRequire(linkPath);
  const linkModule = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(linkPath, "utf8"))((name) => {
    if (name === "../components/app-router-instance") return {
      dispatchNavigateAction: (href) => { calls.push(["Link", href]); dom.window.history.pushState({ __NA: true }, "", href); },
    };
    if (name === "../components/links") return {
      IDLE_LINK_STATUS: { pending: false },
      mountLinkInstance: () => ({}),
      unmountLinkForCurrentNavigation: () => {},
      unmountPrefetchableInstance: () => {},
      onNavigationIntent: () => assert.fail("card prefetch is disabled"),
    };
    return linkRequire(name);
  }, linkModule, linkModule.exports);
  const Card = loadSource("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": linkModule.exports,
    "@/hooks/useFlag": { useFlag: () => flagEnabled },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "htpr-6752-instant-ticket-open" },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  });
  const container = dom.window.document.getElementById("root");
  const errors = [];
  dom.window.addEventListener("error", (event) => errors.push(event.error));
  const reactRoot = createRoot(container, { onUncaughtError: (error) => errors.push(error) });
  t.after(async () => {
    await React.act(() => reactRoot.unmount());
    queryClient.clear();
    dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  });
  const render = async (selectionControl) => React.act(() => reactRoot.render(
    React.createElement(AppRouterContext.Provider, { value: router },
      React.createElement(Card, {
        active: false,
        taskHref,
        openDetail: openDetail ?? (() => navigate.navigateToTask(task.projectId, task.uniqueIndex, "push", undefined, cached ? task : undefined)),
        selectionControl,
      }, React.createElement("span", { id: "title" }, task.title)),
    ),
  ));
  const click = async (selector = "#title", modifiers = {}) => {
    const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...modifiers });
    if (modifiers.button === 1) Object.defineProperty(event, "which", { value: 2 });
    let defaultPrevented;
    // Observe the real bubbling handlers, then suppress jsdom's unsupported native tab navigation.
    container.addEventListener("click", (event) => {
      defaultPrevented = event.defaultPrevented;
      event.preventDefault();
    }, { once: true });
    await React.act(() => dom.window.document.querySelector(selector).dispatchEvent(event));
    assert.deepEqual(errors, [], "click handlers must not hide runtime errors");
    return { defaultPrevented };
  };
  return { dom, calls, queryClient, render, click };
}

for (const mobile of [false, true]) {
  for (const [flagEnabled, cached] of [[false, false], [true, false], [true, true]]) {
    test(`one card click adds one history entry (${mobile ? "phone" : "desktop"}, instant=${flagEnabled}, cached=${cached})`, async (t) => {
      const f = fixture(t, { mobile, flagEnabled, cached });
      await f.render();
      const documentBefore = f.dom.window.document;
      const event = await f.click();
      assert.equal(event.defaultPrevented, true, "the Link must not independently navigate");
      assert.deepEqual(f.calls, cached ? [] : [["router.push", taskHref]], "only the task navigator owns opening");
      assert.equal(f.dom.window.location.pathname, taskHref);
      assert.equal(f.dom.window.history.length, 2, "one click must not insert duplicate task entries");
      assert.equal(f.dom.window.document, documentBefore, "no full document replacement is requested");
      if (cached) assert.equal(f.queryClient.getQueryData(cache.cachedTaskDetailKey(2343, task.id)).title, task.title);
      await new Promise((resolve) => {
        f.dom.window.addEventListener("popstate", resolve, { once: true });
        f.dom.window.history.back();
      });
      assert.equal(f.dom.window.location.pathname + f.dom.window.location.search, boardHref, "one Back returns to the board");
    });
  }
}

for (const flagEnabled of [false, true]) {
  test(`modifier clicks keep the native link without opening the current tab (instant=${flagEnabled})`, async (t) => {
    const f = fixture(t, { flagEnabled });
    await f.render();
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const event = await f.click("#title", modifiers);
      assert.equal(event.defaultPrevented, false, "cmd/ctrl and other modified clicks retain the browser action");
      assert.deepEqual(f.calls, [], "modified clicks must not bubble into the parent's task opener");
    }
    assert.equal(f.dom.window.document.querySelector("a").getAttribute("href"), taskHref);
    assert.equal(f.dom.window.history.length, 1);
  });

  test(`the card leaves modal/side-panel and stopped child actions to their owner (instant=${flagEnabled})`, async (t) => {
    let opens = 0;
    const f = fixture(t, { flagEnabled, openDetail: () => opens++ });
    await f.render(React.createElement("button", { id: "selection", onClick: (event) => event.stopPropagation() }, "Select"));
    await f.click("#selection");
    assert.equal(opens, 0);
    await f.click();
    assert.equal(opens, 1, "a non-routing task opener is invoked exactly once");
    assert.deepEqual(f.calls, [], "the Link must not upgrade the caller's modal/panel action to a page navigation");
    assert.equal(f.dom.window.history.length, 1);
  });
}
