const assert = require("node:assert/strict");
const test = require("node:test");
const { QueryClient } = require("@tanstack/react-query");
const { load } = require("./task-route-loader.cjs");

const task = { id: 42, projectId: 15, uniqueIndex: 7002, _count: { comments: 3 } };
const nextTask = { id: 43, projectId: 15, uniqueIndex: 7003 };
const notification = { id: "701", taskId: 42, projectId: 15, userId: 2343, status: "Normal", archivedAt: null };
const inboxKey = ["inbox", "data", 2343];

function makeFlow(t, { enabled = true, currentTask = task, inboxFlow = "true", notifications = [notification] } = {}) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(inboxKey, { notifications });
  const archived = [];
  const navigations = [];
  const toasts = [];
  const atoms = { currentUserAtom: {}, tasksPlayListAtom: {} };
  const context = {
    currentTask,
    currentItemInTasksPlaylist: currentTask,
    setCurrentTask: update => { context.currentTask = update(context.currentTask); },
    onGoback: () => navigations.push(["Back"]),
  };
  const useArchive = load("src/hooks/Task Detail/useArchiveAndNavigate.ts", {
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => context },
    react: { useContext: () => false, useCallback: callback => callback },
    "../MultiPages/useUpdateTaskInBoards": { default: () => ({}) },
    "../Inbox/useGlobalFocusHandler": { default: () => ({
      moveIdxDown: () => {},
      moveIdxUp: () => {},
      archiveNotificationGetter: (item, mode) => {
        archived.push({ item, mode });
        queryClient.setQueryData(inboxKey, data => ({
          ...data,
          notifications: data.notifications.filter(row => row.taskId !== item.taskId),
        }));
      },
    }) },
    "@/lib/state": { useRecoilState: atom => [
      atom === atoms.currentUserAtom ? { id: 2343 } : [task, nextTask], () => {},
    ] },
    "@/store": atoms,
    "react-hot-toast": { default: message => toasts.push(message) },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "../General/useUndo": { useUndoContext: () => ({}) },
    "@/lib/contexts/mobileContext": {},
    "../MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: (...args) => navigations.push(args) }) },
    "next/navigation": { useSearchParams: () => new URLSearchParams(inboxFlow ? { inboxFlow } : {}) },
    "@/components/undoToast": { undoToastSettings: { single: false } },
    "@/hooks/useFlag": { useFlag: () => enabled },
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
  t.after(() => { global.document = originalDocument; queryClient.clear(); });
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
  return { queryClient, archived, navigations, toasts, context, activeElement, keyboard, pressE };
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
  flow.queryClient.setQueryData(inboxKey, { notifications: [notification] });
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
