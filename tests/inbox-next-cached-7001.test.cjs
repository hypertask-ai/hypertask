const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const query = require("@tanstack/react-query");
const { QueryClient } = query;

const root = path.resolve(__dirname, "..");
const jiti = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const cache = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const flags = jiti(path.join(root, "src/lib/flags/keys.ts"));
const first = { id: 42, projectId: 6859, uniqueIndex: 43, status: "Normal", title: "First title", description_: { content: "First body" } };
const next = { ...first, id: 44, uniqueIndex: 45, title: "Next title", description_: { content: "Next body" } };
const href = task => `/detail/project-${task.projectId}/${task.uniqueIndex}`;
const inboxKey = id => ["inbox", "data", id];

function compile(file, mocks) {
  const source = process.env.INBOX_NAVIGATION_BASELINE && file.endsWith("useHypertasksNavigate.ts")
    ? execFileSync("git", ["show", `origin/production:${file}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    if (name === "@/lib/taskDetailReads") return jiti(path.join(root, "src/lib/taskDetailReads.ts"));
    if (name === "@/hooks/useFlag") return { ...mocks[name], useFlagReady: () => true, useFlag: key => key === flags.HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG ? false : mocks[name].useFlag(key) };
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports.default;
}

function fixture(t, { enabled = true, instant = true, authenticatedId = 2343, inboxAccountId = 2343, cached = true, upload = false, realDetail = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/inbox" });
  const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map(name => [name, global[name]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  window.scrollTo = () => {};
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  const client = new QueryClient();
  const renderer = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    client.clear();
    dom.window.close();
    for (const name of names) global[name] = previous[name];
  });
  client.setQueryData(inboxKey(2343), { accountId: inboxAccountId, notifications: cached ? [{ task: next }] : [] });
  client.setQueryData(["uploads"], upload);
  let pathname = "/inbox";
  const calls = [];
  const router = { replace: route => calls.push(["replace", route]), push: route => calls.push(["push", route]) };
  let Detail = ({ initialTask, taskId }) => React.createElement("article", { "data-task-id": taskId },
    initialTask.title, initialTask.description_.content, React.createElement("textarea", { "data-task-id": taskId }));
  const mocks = {
    react: React,
    "react-dom": require("react-dom"),
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => pathname, useRouter: () => router },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: key => {
      if (key === flags.HTPR_7001_INBOX_NEXT_CACHED_FLAG) return enabled;
      if (key === flags.HTPR_6752_INSTANT_TICKET_OPEN_FLAG) return instant;
      if (key === flags.HTPR_7000_INBOX_NEXT_OPEN_FLAG) return true;
      assert.ok([flags.HTPR_6972_SUBTASK_LINK_FLAG, flags.HTPR_6991_BACK_FIRST_OPEN_FLAG, flags.HTPR_7002_INBOX_E_FIRST_PRESS_FLAG, flags.HTPR_7003_BOARD_BACK_FLAG, flags.HTPR_7008_PHONE_FIRST_PAINT_FLAG].includes(key), key);
      return false;
    } },
    "@/lib/flags/keys": flags,
    "@/lib/navigation/cachedTaskDetail": cache,
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: Detail },
    "@/hooks/Inbox/useGetNotifications": { inboxDataQueryKey: inboxKey },
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: authenticatedId }) },
    "@/lib/constants": {},
    "@/lib/constants/constants": { REACT_QUERY_KEYS: { uploadStates: ["uploads"] } },
    "react-hot-toast": { __esModule: true, default: message => calls.push(["toast", message]) },
    "@/lib/analytics/taskDetailReadiness": { taskDetailEntryPathForRoute: () => null, markTaskDetailNavigationStart: () => {} },
  };
  const pending = new Map();
  if (realDetail) {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = (url, { signal }) => new Promise((resolve, reject) => {
      pending.set(Number(new URL(url, window.location.origin).searchParams.get("uniqueIndex")), resolve);
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
    const Context = React.createContext(null);
    const useTaskContext = () => React.useContext(Context);
    const TasksProvider = ({ parsedTask, children }) => {
      const [currentTask, setCurrentTask] = React.useState(() => JSON.parse(parsedTask));
      return React.createElement(Context.Provider, { value: { currentTask, setCurrentTask, setDescription: () => {}, hasDraft: false, hasDraftInit: false } }, children);
    };
    const TaskComp = () => {
      const { currentTask } = useTaskContext();
      return React.createElement("article", { "data-task-id": currentTask.id }, currentTask.title, React.createElement("textarea", { "data-task-id": currentTask.id }));
    };
    Detail = compile("src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx", {
      ...mocks,
      "@tanstack/react-query": query,
      "@/hooks/useFlag": { useFlag: () => false },
      "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { commentsStacked: false, scrollSetting: "Bottom" } }) },
      "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
      "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider, useTaskContext },
      "@/lib/realtime/taskDetailRefresh": jiti(path.join(root, "src/lib/realtime/taskDetailRefresh.ts")),
      "@/app/unauthorized/page": { __esModule: true, default: () => "Denied" },
      "@/app/detail/[...slug]/TaskDetailComp": { __esModule: true, default: TaskComp },
      "@/utils/api/Task Detail": { fetchCommentsHelper: () => assert.fail("cached opening must not await comments") },
      "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments" } },
    });
    mocks["@/components/Modals/SwipeUnread/EmbeddedTaskDetail"].default = Detail;
  }
  const Navigation = compile("src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx", mocks);
  const useNavigate = compile("src/hooks/MultiPages/Route/useHypertasksNavigate.ts", mocks);
  let navigate;
  function App() {
    navigate = useNavigate().navigate;
    return React.createElement(Navigation, { accountId: 2343 }, "Inbox rows");
  }
  const render = () => renderer.render(React.createElement(query.QueryClientProvider, { client }, React.createElement(App)));
  return {
    client, calls, pending,
    async refresh(task) {
      await React.act(async () => {
        pending.get(task.uniqueIndex)({ ok: true, status: 200, json: async () => task });
        await new Promise(resolve => client.getQueryCache().subscribe(event => {
          if (event.query.queryKey[2] === task.id && event.query.state.fetchStatus === "idle") resolve();
        }));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    },
    async start() {
      await React.act(async () => render());
      await React.act(async () => {
        cache.openCachedTaskDetail({ queryClient: client, accountId: 2343, projectId: first.projectId, uniqueIndex: first.uniqueIndex, href: href(first) + "?inboxFlow=true", task: first });
        pathname = href(first);
        render();
      });
      // Even the instant flag OFF control starts on an already-open detail.
      if (!instant) window.history.replaceState({}, "", href(first) + "?inboxFlow=true");
    },
    move: route => React.act(async () => navigate("Replace", route)),
  };
}

for (const suffix of ["?inboxFlow=true", ""]) {
  test(`Inbox replacement ${suffix ? "with keyboard flow" : "without arrow flow"} opens saved target before any server response and K returns to the right editor`, async t => {
    const f = fixture(t);
    await f.start();
    const composer = document.querySelector("textarea");
    composer.value = "First unsent draft";
    await f.move(href(next) + suffix);
    assert.deepEqual(f.calls, [], "cached opening must not wait for a server route");
    assert.equal(window.location.pathname, href(next));
    assert.equal(new URLSearchParams(window.location.search).get("inboxFlow"), "true");
    assert.equal(document.querySelector("article").dataset.taskId, String(next.id));
    assert.equal(document.querySelector("article").textContent, next.title + next.description_.content);
    const nextComposer = document.querySelector("textarea");
    assert.notEqual(nextComposer, composer, "editor ownership changes with the visible task");
    assert.equal(nextComposer.dataset.taskId, String(next.id));
    nextComposer.value = "Typing for next";
    assert.equal(composer.value, "First unsent draft");
    assert.equal(window.history.length, 2, "playlist moves replace, not push");
    await f.move(href(first));
    assert.equal(document.querySelector("article").dataset.taskId, String(first.id));
    assert.notEqual(document.querySelector("textarea"), nextComposer);
    assert.equal(new URLSearchParams(window.location.search).get("inboxFlow"), "true");
  });
}

test("bugfix OFF keeps the exact server Replace route and old view until server commit", async t => {
  const f = fixture(t, { enabled: false });
  await f.start();
  await f.move(href(next));
  assert.deepEqual(f.calls, [["replace", href(next)]]);
  assert.equal(window.location.pathname, href(first));
  assert.equal(document.querySelector("article").dataset.taskId, String(first.id));
});

for (const options of [{ instant: false }, { authenticatedId: 999 }, { inboxAccountId: 999 }, { cached: false }]) {
  test(`unsafe or unavailable cache falls back to server without publishing another task: ${JSON.stringify(options)}`, async t => {
    const f = fixture(t, options);
    await f.start();
    await f.move(href(next) + "?inboxFlow=true");
    assert.deepEqual(f.calls, [["replace", href(next) + "?inboxFlow=true"]]);
    assert.equal(window.location.pathname, href(first));
    assert.equal(f.client.getQueryData(cache.cachedTaskDetailKey(2343, next.id)), undefined);
  });
}

test("upload guard still blocks cached playlist navigation", async t => {
  const f = fixture(t, { upload: true });
  await f.start();
  await f.move(href(next) + "?inboxFlow=true");
  assert.deepEqual(f.calls, [["toast", "Upload in progress!"]]);
  assert.equal(document.querySelector("article").dataset.taskId, String(first.id));
});

test("unrelated replacements stay on the server and Inbox target keeps query and hash", async t => {
  const f = fixture(t);
  await f.start();
  await f.move("/project?id=6859");
  assert.deepEqual(f.calls, [["replace", "/project?id=6859"]]);
  await f.move(href(next) + "?inboxFlow=true&view=7#comment-9");
  assert.equal(window.location.search, "?inboxFlow=true&view=7");
  assert.equal(window.location.hash, "#comment-9");
  assert.equal(document.querySelector("article").dataset.taskId, String(next.id));
});

test("Inbox reuses the real board detail's background refresh and a cancelled previous request cannot replace the visible ticket", async t => {
  const f = fixture(t, { realDetail: true });
  await f.start();
  assert.equal(document.querySelector("article").textContent, first.title);
  const latePrevious = f.pending.get(first.uniqueIndex);
  await f.move(href(next) + "?inboxFlow=true");
  assert.equal(document.querySelector("article").textContent, next.title, "saved target paints with the server request pending");
  assert.ok(f.pending.has(next.uniqueIndex), "the real existing detail refreshes the newly visible ticket");
  await f.refresh({ ...next, title: "Fresh next title" });
  assert.equal(document.querySelector("article").textContent, "Fresh next title");
  await React.act(async () => latePrevious({ ok: true, status: 200, json: async () => ({ ...first, title: "Late previous title" }) }));
  assert.equal(document.querySelector("article").textContent, "Fresh next title");
  assert.equal(document.querySelector("textarea").dataset.taskId, String(next.id));
});
