const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const cache = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const revocation = jiti(path.join(root, "src/lib/boardSync/revocationTombstone.ts"));
const task = { id: 42, projectId: 6859, uniqueIndex: 43, title: "Cached ticket", status: "Normal", description_: { content: "<p>Already local</p>" } };

function navigateHook(queryClient, router, userId = 2343, authenticatedId = userId, flagEnabled = true) {
  const relativePath = "src/hooks/MultiPages/Route/useHypertasksNavigate.ts";
  const source = process.env.CACHED_DETAIL_BASELINE
    ? execFileSync("git", ["show", `origin/production:${relativePath}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, relativePath), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mocks = {
    "@/lib/constants": { default: {} },
    "@/lib/constants/constants": { REACT_QUERY_KEYS: {} },
    "next/navigation": { useRouter: () => router, usePathname: () => "/project" },
    "react-hot-toast": { default: () => {} },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/state": { useRecoilValue: () => ({ id: userId }) },
    "@/store": { currentUserAtom: {} },
  "@/hooks/useFlag": { useFlag: () => flagEnabled },
  "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "htpr-6752-instant-ticket-open" },
    "@/hooks/General/useAuth": { useAuth: () => ({ currentUser: null, authenticatedUserId: authenticatedId }) },
    "@/lib/navigation/cachedTaskDetail": cache,
    "@/lib/analytics/taskDetailReadiness": { taskDetailEntryPathForRoute: () => "board", markTaskDetailNavigationStart: () => {} },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports.default();
}

function historyFixture(t) {
  const original = global.window;
  const calls = [];
  const history = { state: { __NA: true, _N: true, tree: "original-board-tree" } };
  for (const method of ["pushState", "replaceState"]) {
    history[method] = (state, unused, href) => { calls.push({ method, state, href }); history.state = state; };
  }
  global.window = { history, scrollTo: (x, y) => { assert.equal(x, 0); assert.equal(y, 0); } };
  t.after(() => { global.window = original; });
  return { calls, history };
}

test("board click publishes cached title and body synchronously without router navigation", (t) => {
  const queryClient = new QueryClient();
  t.after(() => queryClient.clear());
  queryClient.setQueryData(["boardTasks", 2343, 6859], { tasks: [task], project: { id: 6859, title: "QA board" } });
  const { calls, history } = historyFixture(t);
  const routerCalls = [];
  const hook = navigateHook(queryClient, { push: (...args) => routerCalls.push(args) });
  hook.navigateToTask(6859, 43, "push", "?inboxFlow=true&reply=true#comment-12");
  assert.equal(routerCalls.length, 0, "cached clicks must not wait for Next's server route");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].href, "/detail/project-6859/43?inboxFlow=true&reply=true#comment-12");
  assert.equal(history.state.__NA, undefined, "Next must observe the native history update");
  assert.equal(history.state._N, undefined);
  assert.equal(history.state.tree, "original-board-tree", "Back retains the original route tree");
  const seeded = queryClient.getQueryData(cache.cachedTaskDetailKey(2343, 42));
  assert.equal(seeded.title, task.title);
  assert.equal(seeded.description_.content, task.description_.content);
  assert.equal(seeded.project.title, "QA board");
});

test("My Tasks and inbox rows can supply their already authorized local task", (t) => {
  const queryClient = new QueryClient();
  t.after(() => queryClient.clear());
  const { calls } = historyFixture(t);
  const hook = navigateHook(queryClient, { replace: () => assert.fail("must not fetch RSC") });
  hook.navigateToTask(6859, 43, "replace", "?inboxFlow=true", task);
  assert.equal(calls[0].method, "replaceState");
  assert.equal(queryClient.getQueryData(cache.cachedTaskDetailKey(2343, 42)).title, task.title);
});

test("only prior account-scoped opens are reused when the board snapshot lacks a body", (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const { calls } = historyFixture(t);
  const hook = navigateHook(client, { push: () => assert.fail("already loaded detail must not wait for RSC") });
  client.setQueryData(cache.cachedTaskDetailKey(2343, task.id), task);
  hook.navigateToTask(6859, 43, "push", undefined, { ...task, description_: undefined });
  assert.equal(calls.length, 1);
  client.removeQueries({ queryKey: ["task-"] });
  hook.navigateToTask(6859, 43);
  assert.equal(calls.length, 2, "playlist navigation can reuse a previously opened ticket");
  client.clear();
  client.setQueryData(cache.cachedTaskDetailKey(985, task.id), task);
  assert.equal(cache.findCachedTaskDetail(client, 2343, 6859, 43), undefined);
});

test("unscoped detail snapshots cannot be relabeled for a signed-in account", (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const { calls } = historyFixture(t);
  const routerCalls = [];
  client.setQueryData(["task-", task.id], task);
  client.setQueryData(cache.cachedTaskDetailKey(985, task.id), task);
  navigateHook(client, { push: (href) => routerCalls.push(href) }).navigateToTask(6859, 43);
  assert.equal(calls.length, 0);
  assert.deepEqual(routerCalls, ["/detail/project-6859/43"]);
  assert.equal(client.getQueryData(cache.cachedTaskDetailKey(2343, task.id)), undefined);
  client.setQueryData(cache.cachedTaskDetailKey(2343, task.id), task);
  assert.equal(cache.findCachedTaskDetail(client, 2343, 6859, 43).title, task.title);
});

test("flag-off clicks use production router push and replace even with a cached body", (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  const { calls } = historyFixture(t);
  const routerCalls = [];
  client.setQueryData(["boardTasks", 2343, 6859], { tasks: [task] });
  const hook = navigateHook(client, {
    push: (href) => routerCalls.push(["push", href]),
    replace: (href) => routerCalls.push(["replace", href]),
  }, 2343, 2343, false);
  hook.navigateToTask(6859, 43, "push", "?reply=true", task);
  hook.navigateToTask(6859, 43, "replace", "?inboxFlow=true#comment-12", task);
  assert.equal(calls.length, 0);
  assert.deepEqual(routerCalls, [
    ["push", "/detail/project-6859/43?reply=true"],
    ["replace", "/detail/project-6859/43?inboxFlow=true#comment-12"],
  ]);
  assert.equal(client.getQueryData(cache.cachedTaskDetailKey(2343, task.id)), undefined);
});

test("uncached or old title-only snapshots retain the authorized server route", (t) => {
  const queryClient = new QueryClient();
  t.after(() => queryClient.clear());
  const { calls } = historyFixture(t);
  const routerCalls = [];
  const hook = navigateHook(queryClient, { push: (href) => routerCalls.push(href) });
  hook.navigateToTask(6859, 99);
  hook.navigateToTask(6859, 43, "push", undefined, { ...task, description_: undefined });
  assert.equal(calls.length, 0);
  assert.deepEqual(routerCalls, ["/detail/project-6859/99", "/detail/project-6859/43"]);
});

test("a stale client identity cannot use the prior account's supplied task", (t) => {
  const queryClient = new QueryClient();
  t.after(() => queryClient.clear());
  const { calls } = historyFixture(t);
  const routerCalls = [];
  for (const authenticatedId of [985, null]) {
    navigateHook(queryClient, { push: (href) => routerCalls.push(href) }, 2343, authenticatedId)
      .navigateToTask(6859, 43, "push", undefined, task);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(routerCalls, ["/detail/project-6859/43", "/detail/project-6859/43"]);
});

test("another account's board cache, deleted tasks and revoked boards cannot seed detail", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["boardTasks", 985, 6859], { tasks: [task] });
  assert.equal(cache.findCachedTaskDetail(queryClient, 2343, 6859, 43), undefined);
  assert.equal(cache.findCachedTaskDetail(queryClient, 2343, 6859, 43, { ...task, status: "Deleted" }), undefined);
  revocation.recordBoardRevocationTombstone(2343, 6859);
  assert.equal(cache.findCachedTaskDetail(queryClient, 2343, 6859, 43, task), undefined);
  revocation.clearBoardRevocationTombstone(2343, 6859);
  queryClient.clear();
});

test("Back, Forward and session changes only show a marker matching the exact route and account", () => {
  const location = { accountId: 2343, taskId: 42, projectId: 6859, uniqueIndex: 43 };
  const state = { cachedTaskDetail: location };
  assert.deepEqual(cache.cachedTaskDetailLocation("/detail/project-6859/43", 2343, state), location);
  assert.equal(cache.cachedTaskDetailLocation("/project", 2343, state), undefined);
  assert.equal(cache.cachedTaskDetailLocation("/detail/project-6859/44", 2343, state), undefined);
  assert.equal(cache.cachedTaskDetailLocation("/detail/project-6859/43", 985, state), undefined);
  assert.equal(cache.cachedTaskDetailLocation("/detail/project-6859/43", null, state), undefined);
  assert.equal(cache.cachedTaskDetailLocation("/detail/project-6859/43", 2343, null), undefined);
});

test("known-empty descriptions open locally, but a wrong supplied task never seeds the requested ticket", () => {
  const queryClient = new QueryClient();
  assert.ok(cache.findCachedTaskDetail(queryClient, 2343, 6859, 43, { ...task, description_: null }));
  assert.equal(cache.findCachedTaskDetail(queryClient, 2343, 6859, 44, task), undefined);
  queryClient.clear();
});

test("card Links defer normal clicks to the cached navigator and preserve modified clicks", () => {
  const React = require("react");
  const relativePath = "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx";
  const source = process.env.CACHED_DETAIL_BASELINE
    ? execFileSync("git", ["show", `origin/production:${relativePath}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const mocks = {
    "react": { __esModule: true, default: React, useContext: () => false, useCallback: (callback) => callback },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": { __esModule: true, default: "a" },
    "@/hooks/useFlag": { useFlag: () => flagEnabled },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "htpr-6752-instant-ticket-open" },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/utils/undoActions/helperFuncs": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  };
  let flagEnabled = true;
  const exportsObject = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exportsObject);
  let opens = 0;
  const card = exportsObject.default({ taskHref: "/detail/project-6859/43", children: "Cached ticket", openDetail: () => opens++ });
  const link = card.props.children.find((child) => child?.type === "a");
  assert.equal(typeof link.props.onClick, "function", "card Links must suppress Next's duplicate route navigation");
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    let prevented = false;
    let stopped = false;
    link.props.onClick({ button: 0, ...modifiers, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    if (!stopped) card.props.onClick();
    assert.equal(prevented, Object.keys(modifiers).length === 0, "only normal clicks cancel Next's duplicate route fetch");
    assert.equal(stopped, Object.keys(modifiers).length !== 0, "modified clicks keep native browser behavior");
  }
  assert.equal(opens, 1);
  flagEnabled = false;
  const disabled = exportsObject.default({ taskHref: "/detail/project-6859/43", children: "Cached ticket", openDetail: () => opens++ });
  assert.equal(disabled.props.children.find((child) => child?.type === "a").props.onClick, undefined, "flag-off Links retain production click handling");
});

test("background history refreshes preserve the mounted cached detail, but route/account changes do not", (t) => {
  const queryClient = new QueryClient();
  t.after(() => queryClient.clear());
  const { history } = historyFixture(t);
  let pathname = "/detail/project-6859/43";
  let currentAccountId = 2343;
  let flagEnabled = true;
  const previousLocation = { current: undefined };
  const Detail = () => null;
  const mocks = {
    "react": { useRef: () => previousLocation, useEffect: () => {} },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => pathname, useRouter: () => ({}) },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/state": { useRecoilValue: () => ({ id: currentAccountId }) },
    "@/store": { currentUserAtom: {} },
  "@/hooks/useFlag": { useFlag: () => flagEnabled },
  "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "htpr-6752-instant-ticket-open" },
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: Detail },
    "@/lib/navigation/cachedTaskDetail": cache,
  };
  const source = fs.readFileSync(path.join(root, "src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exportsObject = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exportsObject);
  const render = (accountId = 2343) => exportsObject.default({ accountId, children: "Original route" });
  queryClient.setQueryData(cache.cachedTaskDetailKey(2343, 42), task);
  history.state.cachedTaskDetail = { accountId: 2343, taskId: 42, projectId: 6859, uniqueIndex: 43 };
  const first = render();
  assert.equal(first.type, Detail);
  flagEnabled = false;
  assert.equal(render(), "Original route", "disabled rollout never displays an existing cached marker");
  flagEnabled = true;
  assert.equal(render().type, Detail);
  delete history.state.cachedTaskDetail;
  assert.equal(render().key, first.key, "a background RSC refresh must not remount editors or lose drafts");
  assert.equal(render(985), "Original route");
  assert.equal(render(), "Original route", "an account switch clears the prior navigation marker");
  history.state.cachedTaskDetail = { accountId: 2343, taskId: 42, projectId: 6859, uniqueIndex: 43 };
  pathname = "/project";
  assert.equal(render(), "Original route");
  pathname = "/detail/project-6859/43";
  assert.equal(render().type, Detail);
  currentAccountId = 985;
  assert.equal(render(), "Original route", "a stale client account cannot show the signed account's cached task");
});

test("projectsAll must belong to the signed-in account, including locally restored snapshots", () => {
  const client = new QueryClient();
  const project = { id: 6859, tasks: [task] };
  for (const accountId of [985, undefined]) {
    client.setQueryData(["projectsAll"], { accountId, updatedProjects: [project] });
    assert.equal(cache.findCachedTaskDetail(client, 2343, 6859, 43), undefined);
  }
  client.setQueryData(["projectsAll"], { accountId: 2343, updatedProjects: [project] });
  assert.equal(cache.findCachedTaskDetail(client, 2343, 6859, 43).title, task.title);
  client.clear();
});

test("archived tickets remain available but a server-denied seed cannot be reopened from a stale card", async (t) => {
  const client = new QueryClient();
  t.after(() => client.clear());
  historyFixture(t);
  assert.ok(cache.findCachedTaskDetail(client, 2343, 6859, 43, { ...task, status: "Archived" }));
  const key = cache.cachedTaskDetailKey(2343, 42);
  client.setQueryData(key, task);
  await assert.rejects(client.fetchQuery({ queryKey: key, retry: false, queryFn: () => { throw new cache.TaskAccessDeniedError(); } }));
  assert.equal(cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: 6859, uniqueIndex: 43, href: "/detail/project-6859/43", task }), false);
});

test("navigation seeds are memory-only so reloads retain server route authorization", () => {
  const { shouldDehydratePersistedQuery } = jiti(path.join(root, "src/utils/queryPersistence.ts"));
  const client = new QueryClient();
  client.setQueryData(cache.cachedTaskDetailKey(2343, 42), task);
  assert.equal(shouldDehydratePersistedQuery(client.getQueryCache().find({ queryKey: cache.cachedTaskDetailKey(2343, 42) })), false);
  client.clear();
});
