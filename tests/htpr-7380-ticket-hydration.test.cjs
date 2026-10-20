const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const noop = () => null;
const serverNow = Date.parse("2026-01-20T23:59:59.900Z");
const taskId = 42;
const userId = 985;

function load(relative, mocks = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(process.env.HTPR_7380_SOURCE_ROOT || root, relative), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => name in mocks ? { __esModule: true, ...mocks[name] } : require(name), exports);
  return exports;
}

const hydrated = load("src/hooks/General/useHydrated.ts");
const members = load("src/hooks/MultiPages/useGetMembersForAssignees.ts", {
  "@/hooks/General/useHydrated": hydrated,
  "@/utils/api/global": { default: { getMembersOwnersForAssignees: () => new Promise(() => {}) } },
});
const drafts = load("src/hooks/Task Detail/useGetDrafts.ts", {
  "@/hooks/General/useHydrated": hydrated,
  "@/utils/api/Task Detail": { getDraftsHelper: () => new Promise(() => {}) },
});
const time = load("src/hooks/Task Detail/useTimeTracking.ts", {
  "@/hooks/General/useHydrated": hydrated,
  "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
  "@/lib/state": {},
  "@/lib/realtime/client": { connectRealtimeClient: async () => null },
  "@/lib/realtime/shared": { timeTaskChannel: () => "test-time" },
  "@/store": {},
  "@/lib/boardTimeTotals": {},
  "@/lib/timeTrackingInvalidation": {},
});
const RunningTimer = load("src/components/PageComponents/TaskDetail/TopRow/RunningTimerIndicator.tsx", {
  "@/hooks/Task Detail/useTimeTracking": time,
  "@/lib/timeDuration": load("src/lib/timeDuration.ts"),
}).default;
const TaskInfo = load("src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo.tsx", {
  "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ cachedLayout: true, serverTaskSeed: { updatedAt: serverNow } }) },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  "@/lib/api/typedClient": { getTaskCycle: noop },
  axios: { default: {} },
  "react-hot-toast": { default: {} },

  "@/lib/state": { useRecoilState: () => [{}, noop] },
  "@/components/PageComponents/TaskDetail/MainPageComponents": {
    AssigneeCard: noop,
    ClickableSpan: ({ title }) => React.createElement("span", null, title),
    LocalRightSideInfo: ({ title }) => React.createElement("label", null, title),
    TaskInfoColumnContainer: ({ children }) => React.createElement("aside", null, children),
    TaskInfoLabel: ({ children }) => React.createElement("label", null, children),
    TaskInfoRow: ({ children }) => React.createElement("section", null, children),
    TaskInfoValue: ({ children }) => React.createElement("div", null, children),
  },
  "@/hooks/General/useCopyURL": { default: () => ({ copyTicketNumber: noop }) },
  "@/hooks/General/useProjectQuery": { useProjectQuery: () => ({ goToProjectShortcut: noop }) },
  "@/hooks/MultiPages/useGetMembersForAssignees": members,
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "../AssigneesContainer": { default: noop },
  "@/components/Common/Tooltip": { default: () => null },
  "@/components/Modals/TaskPriority/PriorityLabelComponent": { default: noop },
  "@/components/Modals/CreateLabel/TaskLabelComponent": { default: noop },
  "./RelatedTaskLabel": { default: ({ relationInfo }) => React.createElement("a", { href: relationInfo.route }, relationInfo.title) },
  "lucide-react": Object.fromEntries(["ArrowRight", "CornerLeftUp", "GitMerge", "GitPullRequest", "TriangleAlert"].map(name => [name, () => null])),
  "@/components/Labels/DueDateLabel": { default: noop },
  "@/lib/constants/constants": { EstimateConstants: [] },
  "@/lib/configs/taskDetail.config": { default: {} },
  "./TaskTime": { default: () => null, useTimerNow: time.useTimerNow },
  "@/lib/staleness": load("src/lib/staleness.ts"),
  "@/store": { showCommandsAtom: {} },
  "@/models/enums": { CommandMode: {} },
  "@/lib/recurrence": { RECURRENCE_LABELS: {} },
  "@/components/Modals/CyclePicker": { default: () => null },
  "@/lib/waitingOn": load("src/lib/waitingOn.ts"),
  "@/lib/pullRequests/githubPullRequests": { derivePullRequestDisplayState: () => "merged" },
  "@/components/PageComponents/TaskDetail/pullRequestBadge": { pullRequestBadgeByState: { merged: { color: "purple", label: "Merged" } } },
  "@prisma/client": { CustomFieldType: {} },
}).default;

const task = {
  id: taskId, projectId: 15, title: "Hydration ticket", section: "Bugs",
  project: {}, waitingOnUserId: 7, waitingOnSetAt: "2026-01-20T23:58:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z", sectionChangedAt: "2026-01-01T00:00:00.000Z",
  lastCommentAt: "2026-01-01T00:00:00.000Z",
};
function Rail({ currentTask = task }) {
  return React.createElement(TaskInfo, {
    currentTask, _parsedTask: currentTask, followers: [], sectionsForProjectTQ: [], labelsFromTQ: [],
  });
}
function Draft() {
  const { data } = drafts.useGetDrafts(taskId, userId);
  return React.createElement("article", null, data?.[0]?.content ?? "Server description");
}

async function hydration(t, { Component, cache = [], advance = 0, before, after, tick, beforeNot, afterHtml }) {
  const previous = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  let reactRoot, dom, client, serverClient;
  const originalNow = Date.now;
  let clock = serverNow;
  Date.now = () => clock;
  t.after(async () => {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    client?.clear();
    serverClient?.clear();
    dom?.window.close();
    Date.now = originalNow;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  delete global.window;
  delete global.document;
  global.fetch = () => new Promise(() => {});
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let delayed = false;
  let ready = false;
  function Delayed() {
    if (delayed && !ready) throw pending;
    return React.createElement(Component);
  }
  function HydratedMarker() {
    return React.createElement("output", null, hydrated.useHydrated() ? "ready" : "server");
  }
  function Shell() {
    return React.createElement(React.Fragment, null,
      React.createElement(HydratedMarker),
      React.createElement(React.Suspense, { fallback: "Loading" }, React.createElement(Delayed)));
  }
  const options = { defaultOptions: { queries: { retry: false, staleTime: Infinity } } };
  serverClient = new QueryClient(options);
  const tree = client => React.createElement(QueryClientProvider, { client }, React.createElement(Shell));
  const html = renderToString(tree(serverClient));
  assert.match(html.replace(/<!--.*?-->/g, ""), before);
  if (beforeNot) assert.doesNotMatch(html, beforeNot);
  dom = new JSDOM(`<div id="root">${html}</div>`, { url: "https://app.hypertask.ai/detail/project-15/7380" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map();
  dom.window.setInterval = (callback, delay) => { intervals.set(callback, delay); return callback; };
  dom.window.clearInterval = callback => intervals.delete(callback);
  client = new QueryClient(options);
  for (const [key, value] of cache) client.setQueryData(key, value);
  const errors = [];
  delayed = true;
  await React.act(async () => {
    reactRoot = hydrateRoot(document.getElementById("root"), tree(client), {
      onRecoverableError: error => errors.push(error.message.split("\n")[0]),
    });
  });
  assert.equal(document.querySelector("output").textContent, "ready", "outer hydration must finish before the delayed ticket");
  assert.equal(document.getElementById("root").innerHTML.replace("<output>ready</output>", "<output>server</output>"), html);
  clock += advance;
  await React.act(async () => { ready = true; release(); });
  assert.deepEqual(errors, [], "the delayed ticket must reuse the server markup");
  assert.match(document.getElementById("root").textContent, after, "live values must appear after hydration");
  if (afterHtml) assert.match(document.getElementById("root").innerHTML, afterHtml);
  if (tick) {
    clock += tick.advance;
    await React.act(async () => { for (const callback of intervals.keys()) callback(); });
    assert.match(document.getElementById("root").textContent, tick.after, "ages must keep updating after hydration");
  }
}

test("saved waiting-on name does not replace the server markup before a delayed ticket hydrates", async t => {
  await hydration(t, { Component: Rail, cache: [
    [["waiting-on-members", 15], { owner: { id: 7, displayName: "Saved person" }, members: [] }],
  ], before: /Unknown user/, after: /Saved person/ });
});

test("saved running timer appears only after the delayed ticket hydrates, then keeps ticking", async t => {
  await hydration(t, { Component: () => React.createElement(RunningTimer, { taskId }), cache: [
    [["time", "task", taskId], { enabled: true, runningEntry: { startedAt: "2026-01-20T23:58:59.900Z", pausedAt: null } }],
  ], before: /<output>server<\/output>$/, after: /1:00/, tick: { advance: 1000, after: /1:01/ } });
});

test("saved draft does not replace the server description before a delayed ticket hydrates", async t => {
  await hydration(t, { Component: Draft, cache: [
    [["draft for [task,userId]:", taskId, userId], [{ type: "Description", content: "Saved draft" }]],
  ], before: /Server description/, after: /Saved draft/ });
});

test("waiting-on age shares server time across a minute boundary, then advances normally", async t => {
  await hydration(t, { Component: () => React.createElement(Rail, { currentTask: { ...task, createdAt: "2026-01-01T12:00:00Z", sectionChangedAt: "2026-01-01T12:00:00Z", lastCommentAt: "2026-01-01T12:00:00Z" } }), before: /· 1m/, advance: 200,
    after: /· 2m/, tick: { advance: 60_000, after: /· 3m/ } });
});

test("column and comment counts share server time across midnight and the hot threshold", async t => {
  await hydration(t, { Component: () => React.createElement(Rail, { currentTask: { ...task, waitingOnUserId: null } }), before: /19d in column/, advance: 200,
    after: /20d in column · 20d since last comment/, afterHtml: /text-red-600 dark:text-red-400/, tick: { advance: 86_400_000, after: /21d in column · 21d since last comment/ } });
});

test("a stale row that becomes visible at midnight waits until hydration finishes", async t => {
  const currentTask = { ...task, waitingOnUserId: null, createdAt: "2026-01-14T00:00:00.000Z", sectionChangedAt: "2026-01-14T00:00:00.000Z", lastCommentAt: null };
  await hydration(t, { Component: () => React.createElement(Rail, { currentTask }), before: /Status/, beforeNot: /in column/,
    advance: 200, afterHtml: /text-amber-600 dark:text-amber-500/, after: /7d in column · no comments yet/ });
});
