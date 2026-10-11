// HTPR-7129: after editing priority, size or tags in a ticket and pressing
// Escape, the board card must show the new values at once.
// Part 1: priority, size and tag edits patch the board cache like assignee.
// Part 2: returning to the board loads it once; it is no longer mounted twice,
// which aborted its own load and could discard the fresh response.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");
const { JSDOM } = require("jsdom");
const rq = require("@tanstack/react-query");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti").createJiti(__filename, { fsCache: false, interopDefault: true, jsx: true, alias: { "@": path.join(root, "src") } });
const flags = jiti(path.join(root, "src/lib/flags/keys.ts"));
const KEY = "htpr-7129-board-card-fresh-after-escape";

const load = (rel, mocks) => {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
};

test("flag is a bugfix, default Everyone, with release risk", () => {
  const def = jiti(path.join(root, "src/lib/flags/definitions/htpr-7129-board-card-fresh-after-escape.ts"));
  assert.equal(def.default.key, KEY);
  assert.equal(flags.HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG, KEY);
  assert.equal(def.default.kind, "bugfix");
  assert.equal(def.default.defaultMode, undefined);
  assert.ok(def.default.releaseRisk?.reason);
});

// ---------------------------------------------------------------- part 1
const inView = { taskId: 77, taskProjectId: 5, sectionId: 9 };
const pickerFixture = (rel, writeName, axiosPath, flagOn, responseData) => {
  const patches = [], refetches = [], posts = [];
  const write = async (body) => { posts.push(body); return { data: responseData }; };
  const mod = load(rel, {
    "@/hooks/useFlag": { useFlag: (key) => (key === KEY ? flagOn : true) },
    "@/lib/flags/keys": flags,
    "@/lib/api/typedClient": { [writeName]: write },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { __esModule: true, default: () => ({ updateTaskInCache: (...args) => patches.push(args) }) },
    "@/hooks/MultiPages/useGetPriorityForTask": { useGetPriorityForTask: () => ({ data: undefined }) },
    "@/hooks/MultiPages/useGetEstimateForTask": { useGetEstimateForTask: () => ({ data: undefined }) },
    "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments" } },
    "@/lib/constants/constants": {},
    "@/store": { inViewObjectAtom: "inView", currentProjectAtom: "project", calendarTaskFiltersAtom: "calendar" },
    "@tanstack/react-query": { useQueryClient: () => ({ refetchQueries: (q) => refetches.push(q.queryKey) }) },
    axios: { __esModule: true, default: { post: async (url, body) => { posts.push({ url, body }); return { data: responseData }; } } },
    "@/lib/state": { useRecoilValue: (atom) => (atom === "inView" ? inView : {}) },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveFiltersFromProject: () => ({ addedFilters: [] }) },
  });
  return { mod, patches, refetches, posts };
};

const priorityRow = { id: "p1", taskId: 77, projectId: 5, sectionId: 9, priority_index: 3, Priority_Value: "High" };
const sizeRow = { id: "e1", taskId: 77, projectId: 5, sectionId: 9, estimate_index: 4, estimate_value: "L" };

for (const flagOn of [true, false]) {
  test(`priority pick ${flagOn ? "patches the board card with the saved row" : "keeps today's board refetch"} (flag ${flagOn ? "on" : "off"})`, async () => {
    const f = pickerFixture("src/hooks/MultiPages/Tasks/usePriorityModal.ts", "setTaskPriority", "/api/priority/setPriority", flagOn, priorityRow);
    let closed;
    const { EnterOnClickHandler } = f.mod.usePriorityModal("Task", (v) => { closed = v; });
    await EnterOnClickHandler({ priority_index: 3, Priority_Value: "High" });
    assert.equal(closed, true);
    if (flagOn) {
      assert.deepEqual(f.patches, [[{ priority: priorityRow }, 77, 5, 9]]);
      assert.ok(!f.refetches.some((k) => k[0] === "projectsAll"), "no board refetch that could overwrite a later size or tag patch");
    } else {
      assert.deepEqual(f.patches, []);
      assert.ok(f.refetches.some((k) => k[0] === "projectsAll"));
    }
  });

  test(`size pick ${flagOn ? "patches" : "does not patch"} the board card (flag ${flagOn ? "on" : "off"})`, async () => {
    const f = pickerFixture("src/hooks/MultiPages/Tasks/useEstimateModal.ts", "setTaskEstimate", "/api/estimate/setEstimate", flagOn, sizeRow);
    const { EnterOnClickHandler } = f.mod.useEstimateModal("Task", () => {});
    await EnterOnClickHandler({ estimate_index: 4, estimate_value: "L" });
    assert.deepEqual(f.patches, flagOn ? [[{ estimate: sizeRow }, 77, 5, 9]] : []);
  });
}

test("clearing priority or size removes it from the board card", async () => {
  const cleared = { message: "Successfully deleted" };
  const p = pickerFixture("src/hooks/MultiPages/Tasks/usePriorityModal.ts", "setTaskPriority", "", true, cleared);
  await p.mod.usePriorityModal("Task", () => {}).EnterOnClickHandler({ priority_index: 0, Priority_Value: "No Priority" });
  assert.deepEqual(p.patches, [[{ priority: undefined }, 77, 5, 9]]);
  const e = pickerFixture("src/hooks/MultiPages/Tasks/useEstimateModal.ts", "setTaskEstimate", "", true, cleared);
  await e.mod.useEstimateModal("Task", () => {}).EnterOnClickHandler({ estimate_index: 0, estimate_value: "No size" });
  assert.deepEqual(e.patches, [[{ estimate: undefined }, 77, 5, 9]]);
});

for (const flagOn of [true, false]) {
  test(`tag pick patches the board card in the open task's column (flag ${flagOn ? "on" : "off"})`, () => {
    const patches = [];
    const mod = load("src/app/detail/[...slug]/useTaskDetailNavigationActions.tsx", {
      "@/hooks/useFlag": { useFlag: (key) => (key === KEY ? flagOn : false) },
      "@/lib/flags/keys": flags,
      "@/lib/taskDetailReads": { refreshTaskDetailReadAfterWrite: () => {} },
      "@/lib/api/typedClient": {},
      "react-hot-toast": { __esModule: true, default: () => {} },
      "@/components/undoToast": {},
      "@/lib/configs/taskDetail.config": { __esModule: true, default: { queryKeys: { taskLabels: "labels" } } },
      "@/lib/constants/TaskDetail": {},
      "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments" } },
    });
    // The page seed says column 9; the task was moved to column 12 in the ticket.
    const currentTask = { id: 77, projectId: 5, sectionId: 12 };
    const ctx = {
      currentTask, _parsedTask: { id: 77, projectId: 5, sectionId: 9 }, currentProject: { id: 5 },
      showCreateLabelModal: true, setShowCreateLabelModal: () => {}, updateActiveItemAndItemInView: () => {},
      queryClient: { prefetchQuery: () => {}, refetchQueries: () => {} },
      updateTaskInCache: (...args) => patches.push(args.slice(0, 4)),
    };
    const { toggleLabelModal } = mod.useTaskDetailNavigationActions(() => ctx);
    const labels = [{ id: 1, taskId: 77, labelId: "l", label: { value: "QA" } }];
    toggleLabelModal(labels, true, false);
    assert.deepEqual(patches, [[{ taskLabels: labels }, 77, 5, flagOn ? 12 : 9]]);
  });
}

for (const keep of [true, false]) {
  test(`board return ${keep ? "keeps" : "replaces"} the patched in-memory board over the older saved snapshot (flag ${keep ? "on" : "off"})`, () => {
    const { buildAuthorizedLocalPublication } = jiti(path.join(root, "src/hooks/Homepage/useSyncedBoardReadModel.ts"));
    const staleTask = { id: 77, title: "T", sectionId: 9, projectId: 5 };
    const patchedTask = { ...staleTask, priority: priorityRow, estimate: sizeRow, taskLabels: [{ id: 1, labelId: "l", label: { value: "QA" } }] };
    const current = { accountId: 985, dataOrigin: "network", index: 0, updatedProjects: [{ id: 5, title: "B", section: [], tasks: [patchedTask], sections: [] }], notificationsCount: { all: 0, unseen: 0 } };
    const payload = { project: { id: 5, title: "B", section: [] }, tasks: [staleTask], allViews: [] };
    const publication = buildAuthorizedLocalPublication({ accountId: 985, projectId: 5, authorizedProjectIds: [5], current, payload, ...(keep ? { keepHydratedCache: true } : {}) });
    const task = publication.projectsData.updatedProjects[0].tasks.find((t) => t.id === 77);
    assert.equal(task.priority?.Priority_Value, keep ? "High" : undefined);
    assert.equal(task.estimate?.estimate_value, keep ? "L" : undefined);
    assert.equal(task.taskLabels?.length ?? 0, keep ? 1 : 0);
  });
}

test("the saved-snapshot hook reads the flag through a ref, so a late flag load never restarts route entry", () => {
  const source = fs.readFileSync(path.join(root, "src/hooks/Homepage/useSyncedBoardReadModel.ts"), "utf8");
  assert.match(source, /keepHydratedCacheRef\.current = useFlag\(HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG\);/);
  assert.match(source, /keepHydratedCache: keepHydratedCacheRef\.current,/);
  assert.match(source, /\[prepareLocalRead, queryClient\],/);
});

// ---------------------------------------------------------------- part 2
test("a board load aborted by a remount is reloaded once, never on top of a newer load", async () => {
  const { recoverAbortedProjectsAll, PROJECTS_ALL_QUERY_KEY } = jiti(path.join(root, "src/hooks/Homepage/useGetBoards.ts"));
  const client = new rq.QueryClient({ defaultOptions: { queries: { retry: false } } });
  let loads = 0;
  const queryFn = () => { loads++; return new Promise((resolve) => setTimeout(() => resolve({ load: loads }), 5)); };
  client.setQueryData(PROJECTS_ALL_QUERY_KEY, { load: 0 });
  const observer = new rq.QueryObserver(client, { queryKey: PROJECTS_ALL_QUERY_KEY, queryFn, staleTime: 60_000 });
  const unsubscribe = observer.subscribe(() => {});
  // Fresh data: mounting does not load. The reverted result after an abort looks just like this.
  assert.equal(loads, 0);
  let run;
  recoverAbortedProjectsAll(client, (fn) => { run = fn; });
  run();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(loads, 1, "the aborted load is replaced by one reload");
  assert.equal(client.getQueryData(PROJECTS_ALL_QUERY_KEY).load, 1);
  void observer.refetch();
  recoverAbortedProjectsAll(client, (fn) => { run = fn; });
  run();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(loads, 2, "a load already running is left alone");
  unsubscribe(); client.clear();
});

test("only the flagged board query arms the abort recovery", () => {
  const source = fs.readFileSync(path.join(root, "src/hooks/Homepage/useGetBoards.ts"), "utf8");
  assert.match(source, /const boardCardFresh = useFlag\(HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG\);/);
  assert.match(source, /if \(boardCardFresh\) signal\.addEventListener\("abort", \(\) => recoverAbortedProjectsAll\(queryClient\), \{ once: true \}\);/);
  assert.equal(source.match(/recoverAbortedProjectsAll\(queryClient\)/g).length, 1);
});

const href = (task) => `/detail/project-${task.projectId}/${task.uniqueIndex}`;
const child = { id: 44, projectId: 6859, uniqueIndex: 45, title: "Child title", description_: { content: "Child body" } };

async function boardReturn(t, flagOn) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project" });
  const names = ["window", "document", "Event", "MutationObserver", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map((n) => [n, global[n]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true });
  window.scrollTo = () => {};
  Object.defineProperty(window.navigator, "connection", { value: { saveData: true } });
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.closest("[hidden]") ? [] : [{}]; };
  const historyScript = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8").match(/id="ht-cached-task-history"\s+dangerouslySetInnerHTML=\{\{\s+__html: "([^"]+)"/)?.[1];
  assert.ok(historyScript);
  let settleTraversal = null;
  window.addEventListener("popstate", () => { if (settleTraversal) { const done = settleTraversal; settleTraversal = null; setImmediate(done); } }, true);
  new Function("window", "CustomEvent", historyScript)(window, window.CustomEvent);
  const cache = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
  const client = new rq.QueryClient({ defaultOptions: { queries: { retry: false } } });
  let loads = 0, aborts = 0, boardMounts = 0;
  const Board = () => {
    // Mirrors useGetBoards: an abortable board load that refetches on mount.
    const { data } = rq.useQuery({
      queryKey: ["projectsAll"], staleTime: 0, refetchOnMount: true,
      queryFn: ({ signal }) => {
        const n = ++loads;
        signal.addEventListener("abort", () => { aborts++; });
        return new Promise((resolve) => setTimeout(() => resolve({ load: n }), 30));
      },
    });
    React.useEffect(() => { boardMounts++; }, []);
    return React.createElement("section", { id: "kanban-page-container" }, `load ${data?.load ?? "none"}`);
  };
  const Detail = ({ initialTask }) => React.createElement("article", { "data-task-detail-path": href(initialTask) },
    React.createElement("h1", { id: "title-input" }, initialTask.title));
  const Navigation = load("src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx", {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"), "react-dom": { flushSync },
    "next/navigation": { usePathname: () => window.location.pathname, useRouter: () => ({ replace: () => {}, refresh: () => {} }) },
    "@tanstack/react-query": rq,
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) }, "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: (key) => (key === KEY ? flagOn : true) },
    "@/lib/flags/keys": flags, "@/lib/navigation/cachedTaskDetail": cache,
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: Detail },
  }).default;
  const renderer = createRoot(document.getElementById("root"));
  let children = React.createElement(Board);
  const render = () => renderer.render(React.createElement(rq.QueryClientProvider, { client }, React.createElement(Navigation, { accountId: 2343 }, children)));
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    client.clear(); dom.window.close();
    for (const n of names) global[n] = previous[n];
  });
  const wait = (ms) => React.act(() => new Promise((r) => setTimeout(r, ms)));
  window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["board"] }, "", "/project");
  await React.act(async () => render());
  await wait(80);
  assert.equal(loads, 1);
  // Open the ticket from the board, then the background refresh leaves the ticket route in the board slot.
  await React.act(async () => cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: child.projectId, uniqueIndex: child.uniqueIndex, href: href(child), task: child }));
  await React.act(async () => { children = React.createElement(Detail, { initialTask: child }); render(); });
  assert.equal(document.getElementById("kanban-page-container"), null, "the board is unmounted while the ticket is open");
  const before = { loads, aborts, boardMounts };
  // Escape goes Back to the board; the board route then arrives.
  await React.act(() => new Promise((resolve) => { settleTraversal = resolve; window.history.back(); }));
  assert.equal(window.location.pathname, "/project");
  await React.act(async () => { children = React.createElement(Board); render(); });
  await wait(120);
  const board = document.getElementById("kanban-page-container");
  assert.ok(board && !board.closest("[hidden]"), "the board is visible");
  return { loads: loads - before.loads, aborts: aborts - before.aborts, mounts: boardMounts - before.boardMounts, text: board.textContent };
}

test("returning to the board loads it once and keeps the fresh response (flag on)", async (t) => {
  const r = await boardReturn(t, true);
  assert.deepEqual({ loads: r.loads, aborts: r.aborts, mounts: r.mounts }, { loads: 1, aborts: 0, mounts: 1 });
  assert.equal(r.text, "load 2");
});

test("control: with the flag off the reveal remounts the board and aborts its first load", async (t) => {
  const r = await boardReturn(t, false);
  assert.equal(r.mounts, 2);
  assert.equal(r.aborts, 1);
  assert.equal(r.loads, 2);
});
