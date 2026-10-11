const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const { load } = require("./task-route-loader.cjs");

const task = { id: 42, projectId: 15, uniqueIndex: 7002, _count: { comments: 3 } };
const nextTask = { id: 43, projectId: 15, uniqueIndex: 7003 };
const notification = { id: "701", taskId: 42, projectId: 15, userId: 2343, status: "Normal", archivedAt: null };
const inboxKey = ["inbox", "data", 2343];
const firstPressFlag = "htpr-7002-inbox-e-first-press";

function makeFlow(t, {
  enabled = true, currentTask = task, inboxFlow = "true", notifications = [notification],
  playlist = [task, nextTask], mobile = false, routerPathname = `/detail/project-${task.projectId}/${task.uniqueIndex}`,
  nativePathname = `/detail/project-${task.projectId}/${task.uniqueIndex}`,
} = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queryClient = new QueryClient();
  const buildInboxQueryCache = notifications => ({
    notifications,
    structuredData: { data: [notifications], tabs: [{ project: "All", idx: 0 }] },
  });
  queryClient.setQueryData(inboxKey, buildInboxQueryCache(notifications));
  const archived = [];
  const navigations = [];
  const toasts = [];
  const pending = [];
  const atoms = { currentUserAtom: {}, tasksPlayListAtom: {}, globalNotificationFocusAtom: {} };
  const state = {
    useRecoilState: atom => [
      atom === atoms.currentUserAtom ? { id: 2343 }
        : atom === atoms.tasksPlayListAtom ? playlist : { currIdx: 0, currSplit: 0 }, () => {},
    ],
    useRecoilValue: () => ({ id: 2343 }),
    useSetRecoilState: () => () => {},
  };
  const nextNavigation = {
    usePathname: () => routerPathname,
    useSearchParams: () => new URLSearchParams(inboxFlow ? { inboxFlow } : {}),
    useRouter: () => ({
      push: href => navigations.push(["Push", href]),
      replace: href => {
        navigations.push(["Replace", href]);
        global.window.location = new URL(href, "https://app.hypertask.ai");
      },
      refresh: () => navigations.push(["Refresh"]),
      back: () => {
        navigations.push(["Back"]);
        global.window.location = new URL("/inbox", "https://app.hypertask.ai");
      },
    }),
  };
  const originalWindow = global.window;
  const originalFetch = global.fetch;
  global.window = {
    location: new URL(nativePathname + (inboxFlow ? `?inboxFlow=${inboxFlow}` : ""), "https://app.hypertask.ai"),
    dispatchEvent: () => {},
  };
  global.fetch = async url => {
    const params = new URL(url, "https://app.hypertask.ai").searchParams;
    const item = [notification, ...notifications, ...(currentTask.notifications ?? [])].find(row => row.id === params.get("id"));
    archived.push({ item, mode: "Notification" });
    assert.equal(params.get("taskId"), String(item.taskId));
    assert.equal(params.get("userId"), "2343");
    return { ok: true };
  };
  const useFlag = key => key === firstPressFlag && enabled;
  const optimistic = load("src/lib/inboxSync/optimistic.ts", {
    "@/lib/boardSync/pilot": {},
    "@/utils/helperFunctions/helperFunctions": { buildInboxQueryCache },
    "./revision": { isInboxReadModelRevision: () => false },
  });
  const useFocus = load("src/hooks/Inbox/useGlobalFocusHandler.tsx", {
    "@/lib/api/typedClient": {},
    "@/hooks/useFlag": { useFlag, useFlagLoaded: () => true },
    "@/store": atoms,
    "@/lib/state": state,
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/utils/helperFunctions/helperFunctions": {},
    "../General/useUndo": { useUndoContext: () => ({ performActionAndStoreUndoData: () => {} }) },
    "next/navigation": nextNavigation,
    axios: {},
    "@prisma/client": {},
    "@/utils/axiosClient": {},
    "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) },
    "./useGetNotifications": { inboxDataQueryKey: () => inboxKey },
    "@/lib/inboxSync/optimistic": optimistic,
  }).default;
  const useNavigate = load("src/hooks/MultiPages/Route/useHypertasksNavigate.ts", {
    "@/lib/constants": { default: {} },
    "@/hooks/useFlag": { useFlag, useFlagLoaded: () => true },
    "next/navigation": nextNavigation,
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/state": state,
    "@/store": atoms,
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: 2343 }) },
    "react-hot-toast": { default: message => toasts.push(message) },
    "@/lib/navigation/cachedTaskDetail": {},
    "@/utils/api/Homepage": {},
    "@/lib/firstScreen/SurfaceContext": {},
  }).default;
  const context = {
    currentTask,
    currentItemInTasksPlaylist: currentTask,
    setCurrentTask: update => { context.currentTask = update(context.currentTask); },
    onGoback: () => useNavigate().navigate("Back"),
  };
  const useArchive = load("src/hooks/Task Detail/useArchiveAndNavigate.ts", {
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => context },
    react: { useContext: () => mobile, useCallback: callback => callback },
    "../MultiPages/useUpdateTaskInBoards": { default: () => ({}) },
    "../Inbox/useGlobalFocusHandler": { default: () => {
      const focus = useFocus();
      return { ...focus, archiveNotificationGetter: (...args) => {
        const promise = focus.archiveNotificationGetter(...args);
        pending.push(promise);
        return promise;
      } };
    } },
    "@/lib/state": state,
    "@/store": atoms,
    "react-hot-toast": { default: message => toasts.push(message) },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "../General/useUndo": { useUndoContext: () => ({}) },
    "@/lib/contexts/mobileContext": {},
    "../MultiPages/Route/useHypertasksNavigate": { default: useNavigate },
    "next/navigation": nextNavigation,
    "@/components/undoToast": { undoToastSettings: { single: false } },
    "@/hooks/useFlag": { useFlag, useFlagLoaded: () => true },
    "../Inbox/useGetNotifications": { inboxDataQueryKey: id => ["inbox", "data", id] },
  }).default;
  const { createTaskDetailKeyboard } = load("src/app/detail/[...slug]/taskDetailKeyboard.ts", {
    "@/lib/snippets": {},
    "./taskDetailEditingKeymap": { taskDetailEditingKeymap: () => [] },
    "react-hot-toast": { default: () => {} },
  });
  const activeElement = { tagName: "BODY", className: "", closest: () => null };
  const originalDocument = global.document;
  global.document = { activeElement, querySelector: () => null, getElementById: () => null };
  t.after(async () => {
    const persisted = await Promise.all(pending);
    global.document = originalDocument;
    global.window = originalWindow;
    global.fetch = originalFetch;
    queryClient.clear();
    assert.ok(persisted.every(Boolean), "every attempted archive must persist the exact requested notification");
  });
  function keyboard() {
    return createTaskDetailKeyboard({
      ...context,
      ...useArchive(),
      currentUser: { id: 2343 },
      lastGPress: { current: null },
      activeModals: [],
      showCommands: { show: false },
      undoData: [],
      searchParams: new URLSearchParams(inboxFlow ? { inboxFlow } : {}),
      resetShowCommands: () => {},
      setShowDropdown: () => {},
      setArchiveNudge: () => {},
    });
  }
  function pressE(handler = keyboard().handleKeyDown) {
    handler({ key: "e", keyCode: 69, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: () => {} });
  }
  return { queryClient, archived, navigations, toasts, context, activeElement, keyboard, pressE,
    archiveNotification: (...args) => useFocus().archiveNotificationGetter(...args),
    ...useNavigate(),
  };
}

test("E immediately after an Inbox cached open archives before detail membership loads and advances", t => {
  const flow = makeFlow(t);
  assert.equal(flow.context.currentTask._count.notifications, undefined);
  assert.equal(flow.context.currentTask.notifications, undefined);
  flow.pressE();
  assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
  assert.deepEqual(flow.navigations, [["Replace", "/detail/project-15/7003?inboxFlow=true"]]);
  assert.deepEqual(flow.toasts, []);
});

for (const mobile of [false, true]) {
  const surface = mobile ? "phone" : "desktop";
  test(`ready ${surface} E archives and advances after the Inbox keyboard handoff`, t => {
    const flow = makeFlow(t, { mobile });
    flow.pressE();
    assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
    assert.deepEqual(flow.queryClient.getQueryData(inboxKey).notifications, []);
    assert.deepEqual(flow.navigations, [["Replace", "/detail/project-15/7003?inboxFlow=true"]],
      "Inbox split replace and refresh must not race the next-ticket replace");
    assert.equal(window.location.pathname, "/detail/project-15/7003");
    assert.equal(window.location.search, "?inboxFlow=true");
  });

  test(`early ${surface} E on the last Inbox ticket archives and returns to Inbox`, t => {
    const flow = makeFlow(t, { mobile, playlist: [task] });
    flow.pressE();
    assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
    assert.deepEqual(flow.navigations, [["Back"]]);
    assert.equal(window.location.pathname, "/inbox");
  });

  test(`late ${surface} E keeps the hydrated archive-and-advance path`, t => {
    const flow = makeFlow(t, { mobile, currentTask: { ...task, _count: { notifications: 1 }, notifications: [notification] } });
    flow.pressE();
    assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
    assert.deepEqual(flow.navigations, [["Replace", "/detail/project-15/7003?inboxFlow=true"]]);
  });
}

test("flag off preserves cached-path split navigation and refresh after hydrated archive", t => {
  const flow = makeFlow(t, {
    enabled: false, routerPathname: "/inbox",
    currentTask: { ...task, _count: { notifications: 1 }, notifications: [notification] },
  });
  flow.pressE();
  assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
  assert.deepEqual(flow.navigations, [
    ["Replace", "/inbox?split=All"], ["Replace", "/inbox?split=All"], ["Refresh"],
    ["Replace", "/detail/project-15/7003?inboxFlow=true"],
  ]);
});

test("archiving on the actual Inbox still updates the split URL and refreshes", async t => {
  const flow = makeFlow(t, { nativePathname: "/inbox", routerPathname: "/inbox" });
  await flow.archiveNotification(notification, "Notification", null);
  assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
  assert.deepEqual(flow.navigations, [
    ["Replace", "/inbox?split=All"], ["Replace", "/inbox?split=All"], ["Refresh"],
  ]);
});

test("flag off preserves the early no-op and the hydrated archive path", t => {
  const flow = makeFlow(t, { enabled: false });
  flow.pressE();
  assert.deepEqual(flow.archived, []);
  assert.deepEqual(flow.navigations, []);
  assert.deepEqual(flow.toasts, ["This task is not in inbox"]);
  flow.context.currentTask = { ...task, _count: { notifications: 1 }, notifications: [notification] };
  flow.pressE();
  assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
  assert.equal(flow.navigations.length, 1);
});

test("early E reads current cache membership at press time, not when the handler was created", t => {
  const flow = makeFlow(t, { notifications: [] });
  const { handleKeyDown } = flow.keyboard();
  flow.queryClient.setQueryData(inboxKey, {
    ...flow.queryClient.getQueryData(inboxKey),
    notifications: [notification],
    structuredData: { data: [[notification]], tabs: [{ project: "All", idx: 0 }] },
  });
  flow.pressE(handleKeyDown);
  assert.equal(flow.archived[0].item.id, notification.id);
});

for (const [name, changes] of [
  ["another task", { taskId: 43 }],
  ["another project", { projectId: 16 }],
  ["another account", { userId: 985 }],
  ["an archived notification", { status: "Archive", archivedAt: "2026-10-07" }],
  ["a synthetic notification", { id: "waiting-on-42" }],
  ["a synthetic notification with a numeric id", { waitingOnSynthetic: true }],
  ["an invalid notification id", { id: "Infinity" }],
]) {
  test(`early E never archives ${name}`, t => {
    const flow = makeFlow(t, { notifications: [{ ...notification, ...changes }] });
    flow.pressE();
    assert.deepEqual(flow.archived, []);
    assert.deepEqual(flow.navigations, []);
  });
}

test("the early fallback does not change directly opened tickets", t => {
  const flow = makeFlow(t, { inboxFlow: null });
  flow.pressE();
  assert.deepEqual(flow.archived, []);
  assert.deepEqual(flow.navigations, []);
});

test("a second E cannot reuse removed membership, even through the original handler", t => {
  const flow = makeFlow(t);
  const { handleKeyDown } = flow.keyboard();
  flow.pressE(handleKeyDown);
  flow.pressE(handleKeyDown);
  assert.equal(flow.archived.length, 1);
  assert.equal(flow.navigations.length, 1);
});

test("a known zero membership count does not reuse a stale Inbox row", t => {
  const flow = makeFlow(t, { currentTask: { ...task, _count: { notifications: 0 } } });
  flow.pressE();
  assert.deepEqual(flow.archived, []);
  assert.deepEqual(flow.navigations, []);
});

test("the early fallback only consults the current account's Inbox cache", t => {
  const flow = makeFlow(t, { notifications: [] });
  flow.queryClient.setQueryData(["inbox", "data", 985], { notifications: [notification] });
  flow.pressE();
  assert.deepEqual(flow.archived, []);
  assert.deepEqual(flow.navigations, []);
});

test("membership already loaded in the detail uses the existing archive path with the flag on", t => {
  const flow = makeFlow(t, { notifications: [], currentTask: { ...task, _count: { notifications: 1 }, notifications: [notification] } });
  flow.pressE();
  assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
  assert.equal(flow.navigations.length, 1);
});

for (const [name, focus] of [
  ["a title input", { tagName: "INPUT" }],
  ["a textarea", { tagName: "TEXTAREA" }],
  ["a Tiptap editor", { tagName: "DIV", closest: selector => selector === ".ProseMirror" ? {} : null }],
  ["a child inside Tiptap", { tagName: "SPAN", closest: selector => selector === ".ProseMirror" ? {} : null }],
  ["chat", { closest: selector => selector === ".chatwindow" ? {} : null }],
]) {
  test(`E is not consumed while typing in ${name}`, t => {
    const flow = makeFlow(t);
    Object.assign(flow.activeElement, focus);
    flow.pressE();
    assert.deepEqual(flow.archived, []);
    assert.deepEqual(flow.navigations, []);
  });
}

function sourceCallback(file, env, name) {
  const source = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (name && ts.isVariableDeclaration(node) && node.name.getText(tree) === name) callback = node.initializer;
    if (!name && ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" &&
        node.arguments[0]?.getText(tree).includes('"htpr-7002-detail-keyboard"')) callback ??= node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(callback, `${file}: real ${name ?? "keyboard handoff effect"}`);
  const compiled = ts.transpileModule(`const callback = ${callback.getText(tree)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(env), `${compiled}\nreturn callback;`)(...Object.values(env));
}

const globalProvider = "src/components/ProviderGlobal/GloablProviders.tsx";
const cachedNavigation = "src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx";
const queueHook = "src/hooks/useInboxEFirstPressQueue.ts";
const queueSource = fs.existsSync(path.resolve(__dirname, "..", queueHook)) ? queueHook : cachedNavigation;

function queuedFlow(t, { enabled = true, noRAF = false, deferQueue = false, ...options } = {}) {
  const flow = makeFlow(t, { enabled, ...options });
  const listeners = new Map();
  const frames = new Map();
  const scheduled = new Set();
  const cancelled = [];
  let frameId = 0;
  for (const target of [window, document]) {
    target.addEventListener = (type, handler, capture) => listeners.set(`${type}:${!!capture}`, handler);
    target.removeEventListener = (type, handler, capture) => listeners.delete(`${type}:${!!capture}`);
  }
  const mountQueue = sourceCallback(queueSource, {
    inboxEFirstPress: enabled, window, document, queryClient: flow.queryClient,
    REACT_QUERY_KEYS: sourceCallback("src/lib/constants/constants.ts", {}, "REACT_QUERY_KEYS"),
    returnIfModalOrInputActive: () => ["INPUT", "TEXTAREA"].includes(flow.activeElement.tagName) ||
      !!flow.activeElement.closest(".ProseMirror") || !!flow.activeElement.closest(".chatwindow"),
    setTimeout: (callback, delay) => {
      const id = setTimeout(() => { scheduled.delete(id); callback(); }, delay);
      scheduled.add(id);
      return id;
    },
    clearTimeout: id => {
      assert.ok(scheduled.delete(id), "cleanup must only cancel a scheduled timeout");
      cancelled.push(id);
      clearTimeout(id);
    },
    requestAnimationFrame: noRAF ? undefined : callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: noRAF ? undefined : id => frames.delete(id),
  });
  const cleanup = deferQueue ? undefined : mountQueue();
  t.after(() => cleanup?.());
  let readinessCleanup;
  const originalCustomEvent = global.CustomEvent;
  global.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
  window.dispatchEvent = event => listeners.get(`${event.type}:false`)?.(event);
  t.after(() => { readinessCleanup?.(); global.CustomEvent = originalCustomEvent; });
  function mountKeyboard() {
    readinessCleanup?.();
    readinessCleanup = sourceCallback("src/app/detail/[...slug]/useTaskDetailReadiness.tsx", {
      embedded: false, inboxEFirstPress: enabled, currentTask: flow.context.currentTask, window, document, CustomEvent,
      ...flow.keyboard(),
    })();
  }
  function press() {
    const event = { key: "e", keyCode: 69, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
      prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listeners.get("keydown:true")?.(event);
    if (!event.stopped) listeners.get("keydown:false")?.(event);
    return event;
  }
  function poll() {
    const queued = [...frames.values()]; frames.clear();
    for (const callback of queued) callback();
    t.mock.timers.tick(16);
  }
  return { ...flow, mountKeyboard, mountQueue, press, poll, cleanup, scheduled, cancelled };
}

for (const enabled of [false, true]) {
  test(`phone route commit ${enabled ? "on" : "off"}: early E survives the real workspace frame remount only behind the flag`, t => {
    const React = require("react");
    const { createRoot } = require("react-dom/client");
    const { JSDOM } = require("jsdom");
    const flow = queuedFlow(t, { enabled, mobile: true, deferQueue: true });
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    const previousAct = global.IS_REACT_ACT_ENVIRONMENT;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    function act(callback) {
      const previousWindow = global.window, previousDocument = global.document;
      global.window = dom.window; global.document = dom.window.document;
      try { React.act(callback); } finally { global.window = previousWindow; global.document = previousDocument; }
    }
    let pathname = "/inbox", mounts = 0;
    const frameMocks = {
      "next/navigation": { usePathname: () => pathname },
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(true) },
      "@/hooks/useFlag": { useFlag: () => false, useFlagLoaded: () => true },
      "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
      "@/components/Common/Tooltip": { __esModule: true, default: () => null },
      "@/lib/flags/keys": {},
    };
    const frameModule = { exports: {} };
    const frameSource = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", "src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", frameSource)(specifier => frameMocks[specifier] ?? require(specifier), frameModule, frameModule.exports);
    const Frame = frameModule.exports.default;
    const tree = ts.createSourceFile(globalProvider, fs.readFileSync(path.resolve(__dirname, "..", globalProvider), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let shell;
    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "AIChatClosedLayout") shell = node.getText(tree);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.ok(shell, "exercise the actual global provider workspace subtree");
    const compiled = ts.transpileModule(`const Shell = ({children}) => ${shell};`, {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    function Navigation({ children }) {
      React.useEffect(() => { mounts++; }, []);
      React.useEffect(() => queueSource === cachedNavigation ? flow.mountQueue() : undefined, []);
      return children;
    }
    const env = {
      React, AIChatClosedLayout: Frame, CachedTaskDetailNavigation: Navigation, authenticatedUserId: 2343,
      showMobileTabBar: false, mobileBottomInsetVisible: false, mobilePullCommandVisible: false,
      openAIChatInterface: () => {}, showAiChatInterface: false, sidebarWidthPx: 0,
      shouldMountChatRuntime: false, Suspense: React.Suspense, AIChatPanels: () => null,
    };
    const Shell = new Function(...Object.keys(env), `${compiled}\nreturn Shell;`)(...Object.values(env));
    function Provider() {
      React.useEffect(() => queueSource === queueHook ? flow.mountQueue() : undefined, []);
      return React.createElement(Shell, null, React.createElement("article"));
    }
    const renderer = createRoot(dom.window.document.getElementById("root"));
    act(() => renderer.render(React.createElement(Provider)));
    t.after(() => {
      act(() => renderer.unmount());
      global.IS_REACT_ACT_ENVIRONMENT = previousAct;
      dom.window.close();
    });
    flow.press();
    pathname = window.location.pathname;
    act(() => renderer.render(React.createElement(Provider)));
    assert.equal(mounts, 2, "the phone Inbox-to-detail wrapper change really remounts navigation");
    flow.context.currentTask = { ...task, _count: { notifications: 1 }, notifications: [notification] };
    flow.mountKeyboard(); flow.poll();
    assert.deepEqual(flow.archived, enabled ? [{ item: notification, mode: "Notification" }] : []);
    assert.deepEqual(flow.navigations, enabled ? [["Replace", "/detail/project-15/7003?inboxFlow=true"]] : []);
  });
}

test("no rAF environment: idle cleanup cancels nothing", t => {
  const flow = queuedFlow(t, { noRAF: true });
  flow.cleanup();
  assert.deepEqual(flow.cancelled, []);
  assert.equal(flow.scheduled.size, 0);
});

test("no rAF environment: queued E still archives and advances", t => {
  const active = queuedFlow(t, { noRAF: true });
  active.press();
  active.mountKeyboard();
  t.mock.timers.tick(2000);
  assert.deepEqual(active.archived, [{ item: notification, mode: "Notification" }]);
  assert.deepEqual(active.navigations, [["Replace", "/detail/project-15/7003?inboxFlow=true"]]);
  assert.equal(active.scheduled.size, 0);
  active.cleanup();
});

for (const mobile of [false, true]) {
  test(`slow ${mobile ? "phone" : "desktop"} readiness hands E to the same-path mounted cache-membership handler at two seconds`, t => {
    const flow = queuedFlow(t, { mobile });
    flow.press();
    flow.mountKeyboard();
    t.mock.timers.tick(1999);
    assert.deepEqual(flow.archived, []);
    t.mock.timers.tick(1);
    assert.equal(flow.context.currentTask.notifications, undefined);
    assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
    assert.deepEqual(flow.navigations, [["Replace", "/detail/project-15/7003?inboxFlow=true"]]);
    t.mock.timers.tick(6000);
    assert.equal(flow.archived.length, 1);
    assert.equal(flow.scheduled.size, 0);
  });
}

for (const ready of [false, true]) {
  test(`navigation blocked with membership ${ready ? "ready" : "slow"} waits beyond two seconds before archiving and advancing`, t => {
    const flow = queuedFlow(t, { currentTask: ready ? { ...task, _count: { notifications: 1 }, notifications: [notification] } : task });
    const keys = sourceCallback("src/lib/constants/constants.ts", {}, "REACT_QUERY_KEYS");
    flow.queryClient.setQueryData(keys.uploadStates, true);
    flow.mountKeyboard();
    assert.equal(flow.press().stopped, true);
    t.mock.timers.tick(4000);
    assert.deepEqual(flow.archived, []);
    assert.deepEqual(flow.navigations, []);
    flow.queryClient.setQueryData(keys.uploadStates, false);
    flow.poll();
    assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
    assert.deepEqual(flow.navigations, [["Replace", "/detail/project-15/7003?inboxFlow=true"]]);
  });
}

test("blocked navigation expires at six seconds without archiving", t => {
  const flow = queuedFlow(t);
  const keys = sourceCallback("src/lib/constants/constants.ts", {}, "REACT_QUERY_KEYS");
  flow.queryClient.setQueryData(keys.uploadStates, true);
  flow.press(); flow.mountKeyboard();
  t.mock.timers.tick(2000);
  t.mock.timers.tick(4000);
  flow.queryClient.setQueryData(keys.uploadStates, false);
  flow.poll();
  assert.deepEqual(flow.archived, []);
  assert.deepEqual(flow.navigations, []);
  assert.equal(flow.scheduled.size, 0);
});

test("a slow registered last-ticket handler archives and returns to Inbox", t => {
  const flow = queuedFlow(t, { playlist: [task] });
  flow.press(); flow.mountKeyboard();
  t.mock.timers.tick(2000);
  assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
  assert.deepEqual(flow.navigations, [["Back"]]);
});

for (const path of ["/my-tasks", "/detail/project-15/7003"]) {
  test(`navigation away to ${path} cancels a slow mounted handler before hand-off`, t => {
    const flow = queuedFlow(t);
    flow.press(); flow.mountKeyboard();
    t.mock.timers.tick(1999);
    const original = window.location;
    window.location = new URL(path + "?inboxFlow=true", window.location.origin);
    window.dispatchEvent(new CustomEvent("cached-task-detail-navigation", { detail: {} }));
    window.location = original;
    t.mock.timers.tick(6000);
    assert.deepEqual(flow.archived, []);
    assert.deepEqual(flow.navigations, []);
    assert.equal(flow.scheduled.size, 0);
  });
}

test("a wrong-path detail handler cannot receive the timed-out E", t => {
  const flow = queuedFlow(t);
  flow.press();
  window.dispatchEvent(new CustomEvent("htpr-7002-detail-keyboard", {
    detail: { path: "/detail/project-16/7002", ready: true, handleKeyDown: flow.keyboard().handleKeyDown },
  }));
  t.mock.timers.tick(2000);
  flow.mountKeyboard(); flow.poll();
  assert.deepEqual(flow.archived, []);
  assert.deepEqual(flow.navigations, []);
});

for (const mobile of [false, true]) {
  test(`queued early ${mobile ? "phone" : "desktop"} E cannot reach the stale Inbox listener or archive before detail is ready`, t => {
    const flow = queuedFlow(t, { mobile });
    const event = flow.press();
    assert.equal(event.stopped, true, "capture must stop the still-mounted Inbox bubble handler");
    assert.equal(event.prevented, true);
    flow.poll();
    assert.deepEqual(flow.archived, []);
    assert.deepEqual(flow.navigations, []);
    flow.mountKeyboard();
    flow.poll();
    assert.deepEqual(flow.archived, [], "mount alone does not mean notification membership has loaded");
    flow.context.currentTask = { ...task, _count: { notifications: 1 }, notifications: [notification] };
    flow.mountKeyboard();
    flow.poll();
    assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
    assert.deepEqual(flow.navigations, [["Replace", "/detail/project-15/7003?inboxFlow=true"]]);
    flow.poll();
    assert.equal(flow.archived.length, 1);
  });
}


test("the queued last-ticket E archives and returns to Inbox", t => {
  const flow = queuedFlow(t, { playlist: [task] });
  flow.press();
  flow.context.currentTask = { ...task, _count: { notifications: 1 }, notifications: [notification] };
  flow.mountKeyboard(); flow.poll();
  assert.equal(flow.archived.length, 1);
  assert.deepEqual(flow.navigations, [["Back"]]);
});

for (const reason of ["timeout", "navigation", "unmount"]) {
  test(`a queued E cancelled by ${reason} never archives without advancing`, t => {
    const flow = queuedFlow(t);
    flow.press();
    if (reason === "timeout") t.mock.timers.tick(2000);
    else if (reason === "navigation") window.location = new URL("/my-tasks", window.location.origin);
    else window.dispatchEvent(new CustomEvent("htpr-7002-detail-keyboard", { detail: { path: window.location.pathname, ready: false } }));
    flow.poll();
    assert.deepEqual(flow.archived, []);
    assert.deepEqual(flow.navigations, []);
  });
}

test("repeated early E queues only one archive-and-advance action", t => {
  const flow = queuedFlow(t);
  flow.press(); flow.press();
  flow.context.currentTask = { ...task, _count: { notifications: 1 }, notifications: [notification] };
  flow.mountKeyboard(); flow.poll();
  assert.equal(flow.archived.length, 1);
  assert.equal(flow.navigations.length, 1);
});

test("a fully ready E stays on the existing detail keyboard path", t => {
  const flow = queuedFlow(t, { currentTask: { ...task, _count: { notifications: 1 }, notifications: [notification] } });
  flow.mountKeyboard();
  assert.equal(flow.press().stopped, false);
  assert.equal(flow.archived.length, 1);
  assert.equal(flow.navigations.length, 1);
});

test("flag off installs no handoff and preserves the early detail no-op", t => {
  const flow = queuedFlow(t, { enabled: false });
  flow.mountKeyboard();
  assert.equal(flow.press().stopped, false);
  assert.deepEqual(flow.archived, []);
  assert.deepEqual(flow.navigations, []);
});

for (const focus of [
  { tagName: "INPUT" }, { tagName: "TEXTAREA" },
  { closest: selector => selector === ".ProseMirror" ? {} : null },
  { closest: selector => selector === ".chatwindow" ? {} : null },
]) {
  test("the early queue leaves typing E untouched", t => {
    const flow = queuedFlow(t); Object.assign(flow.activeElement, focus);
    const event = flow.press();
    assert.equal(event.stopped, false); assert.equal(event.prevented, false);
    assert.deepEqual(flow.archived, []);
  });
}

for (const enabled of [false, true]) {
  test(`cached Inbox mount refresh ${enabled ? "on" : "off"}: prevents replaying the source URL only behind the bugfix flag`, async t => {
    const flow = makeFlow(t, { enabled });
    window.history = { state: { cachedTaskDetail: { taskId: task.id } } };
    const getTask = sourceCallback("src/app/detail/[...slug]/useTaskDetailModalActions.tsx", {
      inboxEFirstPress: enabled, navigate: flow.navigate, _parsedTask: task, setCurrentProject: () => {},
      taskDetailConfig: { navigation: { refresh: "Refresh" }, taskIds: { newTask: -1 } },
    }, "getTask");
    await getTask();
    assert.deepEqual(flow.navigations, enabled ? [] : [["Refresh"]]);
    window.history.state = {};
    await getTask();
    assert.deepEqual(flow.navigations.at(-1), ["Refresh"], "native detail still refreshes normally");
  });
}
