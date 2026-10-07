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
    "@/hooks/useFlag": { useFlag },
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
    "@/hooks/useFlag": { useFlag },
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
    "@/hooks/useFlag": { useFlag },
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

function queuedFlow(t, { enabled = true, ...options } = {}) {
  const flow = makeFlow(t, { enabled, ...options });
  const listeners = new Map();
  const frames = new Map();
  let frameId = 0;
  for (const target of [window, document]) {
    target.addEventListener = (type, handler, capture) => listeners.set(`${type}:${!!capture}`, handler);
    target.removeEventListener = (type, handler, capture) => listeners.delete(`${type}:${!!capture}`);
  }
  const cleanup = sourceCallback("src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx", {
    inboxEFirstPress: enabled, window, document,
    returnIfModalOrInputActive: () => ["INPUT", "TEXTAREA"].includes(flow.activeElement.tagName) ||
      !!flow.activeElement.closest(".ProseMirror") || !!flow.activeElement.closest(".chatwindow"),
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  })();
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
  function frame() {
    const queued = [...frames.values()]; frames.clear();
    for (const callback of queued) callback();
  }
  return { ...flow, mountKeyboard, press, frame };
}

for (const mobile of [false, true]) {
  test(`queued early ${mobile ? "phone" : "desktop"} E cannot reach the stale Inbox listener or archive before detail is ready`, t => {
    const flow = queuedFlow(t, { mobile });
    const event = flow.press();
    assert.equal(event.stopped, true, "capture must stop the still-mounted Inbox bubble handler");
    assert.equal(event.prevented, true);
    flow.frame();
    assert.deepEqual(flow.archived, []);
    assert.deepEqual(flow.navigations, []);
    flow.mountKeyboard();
    flow.frame();
    assert.deepEqual(flow.archived, [], "mount alone does not mean notification membership has loaded");
    flow.context.currentTask = { ...task, _count: { notifications: 1 }, notifications: [notification] };
    flow.mountKeyboard();
    flow.frame();
    assert.deepEqual(flow.archived, [{ item: notification, mode: "Notification" }]);
    assert.deepEqual(flow.navigations, [["Replace", "/detail/project-15/7003?inboxFlow=true"]]);
    flow.frame();
    assert.equal(flow.archived.length, 1);
  });
}


test("the queued last-ticket E archives and returns to Inbox", t => {
  const flow = queuedFlow(t, { playlist: [task] });
  flow.press();
  flow.context.currentTask = { ...task, _count: { notifications: 1 }, notifications: [notification] };
  flow.mountKeyboard(); flow.frame();
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
    flow.frame();
    assert.deepEqual(flow.archived, []);
    assert.deepEqual(flow.navigations, []);
  });
}

test("repeated early E queues only one archive-and-advance action", t => {
  const flow = queuedFlow(t);
  flow.press(); flow.press();
  flow.context.currentTask = { ...task, _count: { notifications: 1 }, notifications: [notification] };
  flow.mountKeyboard(); flow.frame();
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
