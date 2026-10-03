const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const navigation = jiti(path.join(root, "src/lib/taskDetailArchiveNavigation.ts"));
const mutation = jiti(path.join(root, "src/lib/inboxSync/mutation.ts"));
const tutorial = jiti(path.join(root, "src/lib/tutorial/learnTutorialState.ts"));
const { inboxConfig } = jiti(path.join(root, "src/lib/configs/inbox.config.ts"));

function loadSource(relativePath, mocks) {
  const javascript = ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
  ).outputText;
  const exports = {};
  new Function("require", "exports", javascript)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return { __esModule: true, ...mocks[name] };
  }, exports);
  return exports;
}

const task = {
  id: 42,
  projectId: 15,
  uniqueIndex: 6894,
  sectionId: 100,
  status: "Normal",
  title: "First inbox task",
  description_: { content: "<p>Cached body</p>" },
};
const notification = {
  id: "701",
  taskId: task.id,
  projectId: task.projectId,
  userId: 6,
  type: "Comment",
  status: "Normal",
  archivedAt: null,
  task,
};
const hydratedTask = {
  ...task,
  _count: { notifications: 1 },
  notifications: [notification],
};

function makeFlow(t, initialTask, currentTask, playlist = [task]) {
  const client = new QueryClient();
  const key = ["inbox", 6];
  const currentUser = { id: 6 };
  const atoms = { currentUserAtom: {}, tasksPlayListAtom: {}, globalNotificationFocusAtom: {} };
  const context = {
    parsedTask: JSON.stringify(initialTask),
    currentTask,
    currentItemInTasksPlaylist: task,
    setCurrentTask: (update) => { context.currentTask = update(context.currentTask); },
    onGoback: () => navigations.push(["Back"]),
  };
  const requests = [];
  const pending = [];
  const broadcasts = [];
  const toasts = [];
  const navigations = [];
  const reconciliations = [];
  const rows = [
    { ...notification, id: 701 },
    { ...notification, id: 702, type: "Reacted" },
    { ...notification, id: 703, userId: 7 },
  ];
  const buildInboxQueryCache = (notifications, splitsNoImportant = [], showImportantSplit = false) => ({
    notifications,
    splitsNoImportant,
    showImportantSplit,
    structuredData: { data: [notifications], tabs: [{ project: "All", idx: 0 }] },
  });
  client.setQueryData(key, buildInboxQueryCache(rows.filter((row) => row.userId === 6)));
  const state = {
    useRecoilState: (atom) => [
      atom === atoms.currentUserAtom ? currentUser
        : atom === atoms.tasksPlayListAtom ? playlist : { currIdx: 0, currSplit: 0 },
      () => {},
    ],
    useRecoilValue: () => currentUser,
    useSetRecoilState: () => () => {},
  };
  const query = { useQueryClient: () => client };
  const searchParams = new URLSearchParams("inboxFlow=true");
  const nextNavigation = {
    usePathname: () => "/detail/project-15/6894",
    useSearchParams: () => searchParams,
    useRouter: () => ({ refresh: () => assert.fail("detail removal must not race navigation with refresh") }),
  };
  const optimistic = loadSource("src/lib/inboxSync/optimistic.ts", {
    "@/lib/boardSync/pilot": {},
    "@/utils/helperFunctions/helperFunctions": { buildInboxQueryCache },
    "./revision": { isInboxReadModelRevision: () => false },
    "./mutation": mutation,
  });
  const route = loadSource("src/pages/api/notifications/markAsDone.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
    "@/lib/realtime/server": {
      socketIdFromHeader: () => null,
      broadcastInboxChange: async (...args) => broadcasts.push(args),
    },
    "@/lib/prisma": { default: { notification: {
      findUnique: async ({ where }) => rows.find((row) => Number(row.id) === where.id),
      updateMany: async ({ where, data }) => {
        const matches = rows.filter((row) => row.taskId === where.taskId && row.userId === where.userId
          && row.status !== where.status.not && Number(row.id) !== where.id?.not);
        matches.forEach((row) => Object.assign(row, data));
        return { count: matches.length };
      },
      update: async ({ where, data }) => {
        const row = rows.find((row) => Number(row.id) === where.id);
        Object.assign(row, data);
        return row;
      },
    } } },
  }).default;
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const originalDocument = global.document;
  global.window = { dispatchEvent: () => {} };
  global.document = { querySelector: () => null, getElementById: () => null };
  global.fetch = async (url, options) => {
    requests.push(url);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
    await route({ method: options.method, headers: {}, query: Object.fromEntries(new URL(url, "https://app.hypertask.ai").searchParams) }, res);
    return { ok: res.statusCode === 200 };
  };
  client.invalidateQueries = async (options) => {
    reconciliations.push(options);
    client.setQueryData(key, buildInboxQueryCache(rows.filter((row) => row.userId === 6 && row.status === "Normal")));
  };
  t.after(() => {
    global.fetch = originalFetch;
    global.window = originalWindow;
    global.document = originalDocument;
    client.clear();
  });
  const focus = loadSource("src/hooks/Inbox/useGlobalFocusHandler.tsx", {
    "@/store": atoms,
    "@/lib/state": state,
    "@tanstack/react-query": query,
    "@/utils/helperFunctions/helperFunctions": {},
    "../General/useUndo": { useUndoContext: () => ({ performActionAndStoreUndoData: () => {} }) },
    "next/navigation": nextNavigation,
    axios: {},
    "@prisma/client": {},
    "@/utils/axiosClient": {},
    "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) },
    "@/lib/configs/inbox.config": { inboxConfig },
    "./useGetNotifications": { inboxDataQueryKey: () => key },
    "@/lib/tutorial/learnTutorialState": tutorial,
    "@/lib/inboxSync/optimistic": optimistic,
    "@/lib/inboxSync/mutation": mutation,
  }).default();
  const useArchive = loadSource("src/hooks/Task Detail/useArchiveAndNavigate.ts", {
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => context },
    react: { useContext: () => false, useCallback: (callback) => callback },
    "../MultiPages/useUpdateTaskInBoards": { default: () => ({}) },
    "../Inbox/useGlobalFocusHandler": { default: () => ({
      ...focus,
      archiveNotificationGetter: (...args) => {
        const promise = focus.archiveNotificationGetter(...args);
        pending.push(promise);
        return promise;
      },
    }) },
    "@/lib/state": state,
    "@/store": atoms,
    "react-hot-toast": { default: (message) => toasts.push(message) },
    "@tanstack/react-query": query,
    "../General/useUndo": { useUndoContext: () => ({}) },
    "@/lib/contexts/mobileContext": {},
    "../MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: (...args) => navigations.push(args) }) },
    "next/navigation": nextNavigation,
    "@/lib/taskDetailArchiveNavigation": navigation,
    "@/components/undoToast": { undoToastSettings: { single: false } },
  }).default;
  return { client, key, context, requests, pending, broadcasts, toasts, navigations, reconciliations, rows, useArchive };
}

test("removing the top inbox notification uses hydrated membership, not the incomplete cached task", async (t) => {
  // inboxTaskSelect only carries a comment count; cached open keeps this parse frozen.
  const flow = makeFlow(t, { ...task, _count: { comments: 3 } }, hydratedTask);
  const outcome = flow.useArchive().navigateToNextTask(true, true);
  assert.deepEqual(flow.toasts, [], "a visible remove action must not claim the task is absent from inbox");
  assert.equal(outcome, "navigated");
  assert.equal(flow.requests.length, 1);
  const url = new URL(flow.requests[0], "https://app.hypertask.ai");
  assert.equal(url.searchParams.get("id"), notification.id);
  assert.equal(url.searchParams.get("taskId"), String(task.id));
  assert.deepEqual(flow.client.getQueryData(flow.key).notifications, [], "returning to inbox must not repaint the removed item or its siblings");
  await Promise.all(flow.pending);
  assert.deepEqual(flow.rows.map((row) => row.status), ["Archive", "Archive", "Normal"]);
  assert.deepEqual(flow.client.getQueryData(flow.key).notifications, []);
  assert.equal(flow.context.currentTask._count.notifications, 0);
  assert.deepEqual(flow.navigations, [["Back"]]);
  assert.deepEqual(flow.reconciliations, [{ queryKey: flow.key, exact: true }]);
  assert.equal(flow.broadcasts[0][0], 6);
});

test("a refreshed notification id replaces the cached id when removing from a directly opened task", async (t) => {
  const staleTask = { ...hydratedTask, notifications: [{ ...notification, id: "999" }] };
  const flow = makeFlow(t, staleTask, hydratedTask, null);
  assert.equal(flow.useArchive().navigateToNextTask(true, true), "navigated");
  await Promise.all(flow.pending);
  assert.equal(new URL(flow.requests[0], "https://app.hypertask.ai").searchParams.get("id"), notification.id);
  assert.deepEqual(flow.client.getQueryData(flow.key).notifications, []);
  assert.deepEqual(flow.toasts, []);
});

test("a second removal cannot toggle the frozen notification back into inbox", async (t) => {
  const flow = makeFlow(t, hydratedTask, hydratedTask);
  flow.useArchive().navigateToNextTask(true, false);
  await Promise.all(flow.pending);
  assert.equal(flow.context.currentTask._count.notifications, 0);
  flow.useArchive().navigateToNextTask(true, false);
  await Promise.all(flow.pending);
  assert.equal(flow.requests.length, 1, "zeroed live membership must stop the API's archive/unarchive toggle");
  assert.deepEqual(flow.client.getQueryData(flow.key).notifications, []);
});
