const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const root = path.resolve(__dirname, "..");
const cache = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } })(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const flag = "htpr-6752-instant-ticket-open";
const navigationPath = "src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx";
const task = { id: 42, projectId: 7049, uniqueIndex: 31, status: "Normal", title: "Cached title", description_: { content: "Cached body" } };
const read = (file) => file === navigationPath && process.env.CACHED_NAVIGATION_BASELINE
  ? execFileSync("git", ["show", `origin/production:${file}`], { cwd: root, encoding: "utf8" })
  : fs.readFileSync(path.join(root, file), "utf8");
function compile(source, mocks) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", js)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}
function domFixture(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project?id=7049" });
  const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map((name) => [name, global[name]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  window.scrollTo = () => {};
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  t.after(() => { for (const name of names) global[name] = previous[name]; dom.window.close(); });
  return dom;
}
function navigationMocks(client, enabled, pathname, react = React) {
  return {
    "react-dom": require("react-dom"),
    react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => pathname(), useRouter: () => ({ replace: () => assert.fail("cached navigation must not request a server route") }) },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/state": { useRecoilValue: () => ({ id: 985 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: (key) => { if (key === "htpr-6972-subtask-link") return false; assert.equal(key, flag); return enabled(); } },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag, HTPR_6972_SUBTASK_LINK_FLAG: "htpr-6972-subtask-link" },
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: ({ initialTask }) => React.createElement("article", { id: "ticket" }, initialTask.title, initialTask.description_.content) },
    "@/lib/navigation/cachedTaskDetail": cache,
  };
}

test("navigation: back restores board rows and forward restores the cached detail even while Next's pathname is stale", async (t) => {
  domFixture(t);
  const client = new QueryClient();
  t.after(() => client.clear());
  let nextPath = "/project";
  const source = process.env.CACHED_NAVIGATION_BASELINE
    ? execFileSync("git", ["show", `origin/production:${navigationPath}`], { cwd: root, encoding: "utf8" })
    : read(navigationPath);
  const Navigation = compile(source, navigationMocks(client, () => true, () => nextPath)).default;
  const renderer = createRoot(document.getElementById("root"));
  const board = React.createElement("ul", { id: "board" }, React.createElement("li", null, "Board row"));
  await React.act(async () => renderer.render(React.createElement(Navigation, { accountId: 985 }, board)));
  assert.match(document.body.textContent, /Board row/);
  await React.act(async () => {
    assert.equal(cache.openCachedTaskDetail({ queryClient: client, accountId: 985, projectId: 7049, uniqueIndex: 31, href: "/detail/project-7049/31", task }), true);
    nextPath = "/detail/project-7049/31";
    renderer.render(React.createElement(Navigation, { accountId: 985 }, board));
  });
  assert.match(document.body.textContent, /Cached titleCached body/);
  assert.equal(document.querySelector("#board"), null);
  const traverse = async (method) => React.act(async () => {
    await new Promise((resolve) => {
      window.addEventListener("popstate", resolve, { once: true });
      window.history[method]();
    });
  });
  await traverse("back");
  assert.equal(window.location.pathname, "/project");
  assert.equal(nextPath, "/detail/project-7049/31", "exercise the stale Next snapshot that caused the live bug");
  assert.equal(document.querySelector("#ticket"), null, "back must remove the detail independently of Next's source tree");
  assert.match(document.body.textContent, /Board row/);
  await traverse("forward");
  assert.equal(window.location.pathname, "/detail/project-7049/31");
  assert.match(document.body.textContent, /Cached titleCached body/);
  await traverse("back");
  assert.match(document.body.textContent, /Board row/);
  await React.act(async () => renderer.unmount());
});

test("navigation: server hydration ignores browser-only cached history and flag off preserves the original route", (t) => {
  domFixture(t);
  const client = new QueryClient();
  t.after(() => client.clear());
  client.setQueryData(cache.cachedTaskDetailKey(985, 42), task);
  window.history.replaceState({ cachedTaskDetail: { accountId: 985, taskId: 42, projectId: 7049, uniqueIndex: 31 } }, "", "/detail/project-7049/31");
  const Navigation = compile(read(navigationPath), navigationMocks(client, () => false, () => "/detail/project-7049/31")).default;
  assert.equal(renderToString(React.createElement(Navigation, { accountId: 985 }, "Production route")), "Production route");
});

test("quiet: phone board placeholders reserve height but show no bars or pulse; flag off retains production skeletons", () => {
  const source = ts.createSourceFile("section.tsx", read("src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) => item.name.getText(source) === "TaskSkeleton"));
  assert.ok(declaration);
  let enabled = true;
  // The extracted renderer uses its enclosing runtime gate, not a copied template.
  const code = ts.transpileModule(`${declaration.getText(source)}\nexport default TaskSkeleton;`, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", "useFlag", "HTPR_6752_INSTANT_TICKET_OPEN_FLAG", code)(require, exports, () => enabled, flag);
  const quiet = renderToString(React.createElement(exports.default));
  assert.match(quiet, /min-h-\[100px\]/);
  assert.doesNotMatch(quiet, /animate-pulse|bg-gray-300/);
  enabled = false;
  const legacy = renderToString(React.createElement(exports.default));
  assert.match(legacy, /animate-pulse/);
  assert.match(legacy, /bg-gray-300/);
});

test("quiet: deferred activity/comments suspend without loading text, with a flag-off positive control", () => {
  let enabled = true;
  const comment = { id: 1, activity: { type: "Updated" } };
  const noop = () => null;
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/contexts/CommentsContext": { useCommentsContext: () => ({ comment, i: 0, isStacked: false }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/styles/tiptap.module.scss": { __esModule: true, default: {} },
    "next/dynamic": { __esModule: true, default: () => noop },
    "@/lib/state": { useRecoilValue: () => ({}), useRecoilState: () => [{ id: 985 }, noop] },
    "@/store": {},
    "@/models/enums": { CommandMode: {} },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ newCommentIds: [] }) },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({}) },
    "@/hooks/MultiPages/useDoubleTap": { useDoubleTap: () => ({}) },
    "@/lib/constants/TaskDetail": {},
    "lucide-react": { Reply: noop },
    "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag },
    "@/lib/htc/isCommentCreatedByUser": { isCommentCreatedByUser: () => false },
    "@/components/Common/AttachmentsView": { __esModule: true, default: noop },
  };
  for (const name of ["CommentBodyDesktop", "CommentCreatedBy", "CommentText", "CommentOptions/ReplyToComment", "SwipeableCommentRow"]) mocks[`./${name}`] = { __esModule: true, default: noop };
  mocks["./CommentOptions"] = { CommentOptions: noop };
  mocks["./CommentTaskActivity"] = { __esModule: true, default: () => { throw new Promise(() => {}); } };
  const Comments = compile(read("src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx"), mocks).default;
  const quiet = renderToString(React.createElement(Comments));
  assert.doesNotMatch(quiet, /loading\.\.\./);
  enabled = false;
  assert.match(renderToString(React.createElement(Comments)), /loading\.\.\./);
});

test("quiet: contact hover waits for final content only on flagged detail, retaining legacy loading and errors", () => {
  let enabled = true;
  let pathname = "/detail/project-7049/31";
  let query = { isFetching: true, isError: false };
  const noop = () => {};
  const pass = ({ children }) => children;
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/components/Common/UserAvatar": { __esModule: true, default: () => null },
    "@/hooks/MultiPages/usePersonHovercard": { usePersonHovercard: () => query },
    "@/lib/agents/pageHref": { agentPageHref: () => null },
    "next/link": { __esModule: true, default: "a" },
    "next/navigation": { usePathname: () => pathname },
    "./TooltipPortal": { __esModule: true, default: pass },
    "@/hooks/useFlag": { useFlag: (key) => { if (key === "htpr-6950-tooltip-top-layer") return false; assert.equal(key, flag); return enabled; } },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag, HTPR_6950_TOOLTIP_TOP_LAYER_FLAG: "htpr-6950-tooltip-top-layer" },
    "@floating-ui/react": { useFloating: () => ({ refs: { setFloating: noop }, context: {}, floatingStyles: {} }), useInteractions: () => ({ getFloatingProps: (props) => props }), FloatingFocusManager: pass, FloatingPortal: pass },
    "lucide-react": { Check: () => null, Copy: () => null },
  };
  for (const name of ["offset", "flip", "shift", "useHover", "useFocus", "useDismiss", "useRole", "safePolygon"]) mocks["@floating-ui/react"][name] = noop;
  const loaded = compile(read("src/components/Common/PersonHovercard.tsx"), mocks);
  const Surface = loaded.PersonHovercardSurface;
  const props = { projectId: 7049, subject: { kind: "user", id: 985 }, externallyOpen: true };
  const render = (extra = {}) => renderToString(React.createElement(Surface, { ...props, ...extra }));
  const reference = React.createElement("span", null, "Contact");
  assert.equal(loaded.default({ ...props, children: reference }).props.quiet, true);
  assert.match(render({ quiet: false }), /Loading contact/, "exported callers can explicitly retain the legacy loading mode");
  assert.equal(render(), "", "no empty hovercard or loading text while fetching");
  enabled = false;
  assert.equal(loaded.default({ ...props, children: reference }).props.quiet, false);
  assert.match(render(), /Loading contact/);
  enabled = true;
  pathname = "/project";
  assert.match(render(), /Loading contact/);
  pathname = "/detail/project-7049/31";
  query = { isFetching: false, isError: true };
  assert.match(render(), /Contact details unavailable/);
  query = { isFetching: false, isError: false, data: { kind: "user", id: 985, displayName: "QA contact" } };
  assert.match(render(), /QA contact/);
});

test("warm: press and idle share a retryable warmup; only idle skips slow connections", async (t) => {
  domFixture(t);
  const client = new QueryClient();
  t.after(() => client.clear());
  let enabled = true;
  let pathname = "/project";
  const effects = [];
  const loaded = [];
  const frames = new Map();
  const idles = new Map();
  const timers = new Map();
  let id = 0;
  let emojiLoads = 0;
  let failWarm = false;
  const listeners = [];
  const addEventListener = document.addEventListener.bind(document);
  document.addEventListener = (type, listener, options) => {
    if (type === "pointerdown") listeners.push(options);
    addEventListener(type, listener, options);
  };
  const press = () => document.getElementById("root").dispatchEvent(new Event("pointerdown", { bubbles: false }));
  window.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  window.cancelAnimationFrame = (key) => frames.delete(key);
  window.requestIdleCallback = (callback, options) => {
    assert.equal(options.timeout, 5000);
    idles.set(++id, callback);
    return id;
  };
  window.cancelIdleCallback = (key) => idles.delete(key);
  window.setTimeout = (callback, delay) => { assert.equal(delay, 2000); timers.set(++id, callback); return id; };
  window.clearTimeout = (key) => timers.delete(key);
  const flush = (queue) => { const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach((callback) => callback()); };
  const mocks = navigationMocks(client, () => enabled, () => pathname, {
    ...React, useMemo: (factory) => factory(), useRef: (initial) => ({ current: initial }), useState: (initial) => [initial(), () => {}], useEffect: (effect) => effects.push(effect), useSyncExternalStore: (subscribe, snapshot) => snapshot(),
  });
  const chunks = [
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail",
    "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionEmojiButton",
    "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/BottomRow/DescriptionReactions",
    "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentReactions",
    "@/components/PageComponents/TaskDetail/TaskMovement",
    "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/EmojiOptionsComp",
    "@/lib/constants/emojiData",
    "@/firebase",
    "firebase/messaging",
  ];
  for (const chunk of chunks) Object.defineProperty(mocks, chunk, { get: () => { loaded.push(chunk); return {}; } });
  mocks["@/components/RTE/Extensions/lazyEmojiData"] = { ensureEmojiData: () => { emojiLoads++; return failWarm ? Promise.reject(new Error("chunk load failed")) : Promise.resolve(); } };
  const Navigation = compile(read(navigationPath), mocks).default;
  const mount = (accountId = 985) => {
    effects.length = 0;
    Navigation({ accountId, children: "Board" });
    const cleanups = effects.map((effect) => effect()).filter(Boolean);
    return () => cleanups.forEach((cleanup) => cleanup());
  };
  for (pathname of ["/project", "/inbox", "/my-tasks"]) {
    loaded.length = 0;
    const cleanup = mount();
    await new Promise(setImmediate);
    assert.equal(loaded.length, 0, "commit must not import viewer code");
    press();
    press();
    await new Promise(setImmediate);
    assert.deepEqual(loaded, chunks, "press warms once even before either animation frame");
    flush(frames);
    assert.equal(idles.size, 0, "one animation frame has not allowed a paint yet");
    flush(frames);
    flush(idles);
    press();
    await new Promise(setImmediate);
    assert.deepEqual(loaded, chunks, "idle and later presses cannot repeat a successful warmup");
    cleanup();
    press();
    await new Promise(setImmediate);
    assert.deepEqual(loaded, chunks, "cleanup removes the capture listener");
  }
  assert.equal(emojiLoads, 3);
  assert.ok(listeners.every(options => options.capture === true && options.passive === true));
  loaded.length = 0;
  let cleanup = mount();
  flush(frames); flush(frames);
  await new Promise(setImmediate);
  assert.equal(loaded.length, 0, "idle still waits for paint and an idle opportunity");
  flush(idles);
  await new Promise(setImmediate);
  assert.deepEqual(loaded, chunks, "idle warms without a press");
  cleanup();
  loaded.length = 0;
  failWarm = true;
  cleanup = mount();
  press(); press();
  await new Promise(setImmediate);
  assert.deepEqual(loaded, chunks, "in-flight failures do not start duplicate warmups");
  failWarm = false;
  press();
  await new Promise(setImmediate);
  assert.deepEqual(loaded, [...chunks, ...chunks], "a failed warmup can retry on the next press");
  cleanup();
  cleanup = mount();
  cleanup();
  assert.equal(frames.size, 0, "unmount cancels the pending paint callback");
  cleanup = mount();
  flush(frames); flush(frames); cleanup();
  assert.equal(idles.size, 0, "navigation cancels the pending idle callback");
  delete window.requestIdleCallback;
  loaded.length = 0;
  cleanup = mount();
  flush(frames); flush(frames);
  await new Promise(setImmediate);
  assert.equal(loaded.length, 0, "fallback does not warm immediately");
  flush(timers);
  await new Promise(setImmediate);
  assert.deepEqual(loaded, chunks, "browsers without idle callbacks eventually warm");
  cleanup();
  cleanup = mount();
  flush(frames); flush(frames); cleanup();
  assert.equal(timers.size, 0, "navigation cancels the fallback timer");
  loaded.length = 0;
  enabled = false;
  mount();
  press();
  assert.equal(frames.size, 0, "flag off schedules nothing");
  enabled = true;
  mount(null);
  press();
  assert.equal(frames.size, 0, "unknown accounts never warm");
  pathname = "/settings";
  mount();
  press();
  assert.equal(frames.size, 0, "unrelated routes never warm");
  await new Promise(setImmediate);
  assert.equal(loaded.length, 0, "ineligible routes and accounts do not register press warming");
  pathname = "/project";
  for (const connection of [{ saveData: true }, ...["slow-2g", "2g", "3g"].map(effectiveType => ({ effectiveType }))]) {
    Object.defineProperty(window.navigator, "connection", { configurable: true, value: connection });
    loaded.length = 0;
    cleanup = mount();
    assert.equal(frames.size, 0, "data saver and slow connections skip only idle preload");
    press();
    await new Promise(setImmediate);
    assert.deepEqual(loaded, chunks, "press warms on every connection");
    cleanup();
    press();
    await new Promise(setImmediate);
    assert.deepEqual(loaded, chunks, "slow-connection cleanup also removes press warming");
  }
});

test("cold click: the source page stays visible until the lazy viewer resolves, and back still works", async (t) => {
  domFixture(t);
  const client = new QueryClient();
  t.after(() => client.clear());
  let release;
  let imports = 0;
  const pending = Object.assign(new Promise(resolve => { release = resolve; }), { __esModule: true });
  const mocks = navigationMocks(client, () => true, () => "/project");
  const detail = mocks["@/components/Modals/SwipeUnread/EmbeddedTaskDetail"];
  Object.defineProperty(mocks, "@/components/Modals/SwipeUnread/EmbeddedTaskDetail", { get: () => { imports++; return pending; } });
  const Navigation = compile(read(navigationPath), mocks).default;
  const renderer = createRoot(document.getElementById("root"));
  const board = React.createElement("ul", { id: "board" }, React.createElement("li", null, "Board row"));
  await React.act(async () => renderer.render(React.createElement(Navigation, { accountId: 985 }, board)));
  assert.equal(imports, 0, "initial render must not import the viewer");
  const originalBoard = document.querySelector("#board");
  await React.act(async () => cache.openCachedTaskDetail({ queryClient: client, accountId: 985, projectId: 7049, uniqueIndex: 31, href: "/detail/project-7049/31", task }));
  assert.equal(imports, 1, "an early click loads the viewer without idle warmup");
  assert.equal(document.querySelector("#board"), originalBoard, "loading must not remount the source page or replay its startup effects");
  assert.equal(document.body.textContent, "Board row", "no blank page, spinner or skeleton while loading");
  await React.act(async () => { release(detail); await pending; });
  assert.match(document.body.textContent, /Cached titleCached body/);
  await React.act(async () => {
    await new Promise(resolve => { window.addEventListener("popstate", resolve, { once: true }); window.history.back(); });
  });
  assert.equal(document.body.textContent, "Board row");
  await React.act(async () => renderer.unmount());
});


test("cold click: Back before the viewer import finishes does not reopen the ticket", async (t) => {
  domFixture(t);
  const client = new QueryClient();
  t.after(() => client.clear());
  let release;
  const pending = Object.assign(new Promise(resolve => { release = resolve; }), { __esModule: true });
  const mocks = navigationMocks(client, () => true, () => "/project");
  const detail = mocks["@/components/Modals/SwipeUnread/EmbeddedTaskDetail"];
  mocks["@/components/Modals/SwipeUnread/EmbeddedTaskDetail"] = pending;
  const Navigation = compile(read(navigationPath), mocks).default;
  const renderer = createRoot(document.getElementById("root"));
  const board = React.createElement("div", { id: "board" }, "Board row");
  await React.act(async () => renderer.render(React.createElement(Navigation, { accountId: 985 }, board)));
  const originalBoard = document.querySelector("#board");
  await React.act(async () => cache.openCachedTaskDetail({ queryClient: client, accountId: 985, projectId: 7049, uniqueIndex: 31, href: "/detail/project-7049/31", task }));
  await React.act(async () => {
    await new Promise(resolve => { window.addEventListener("popstate", resolve, { once: true }); window.history.back(); });
  });
  await React.act(async () => { release(detail); await pending; });
  assert.equal(window.location.pathname, "/project");
  assert.equal(document.querySelector("#board"), originalBoard);
  assert.equal(document.querySelector("#ticket"), null, "a late import cannot undo Back");
  await React.act(async () => renderer.unmount());
});

test("warm: a cold desktop reaction chunk cannot delay the title/body or change its reserved layout", () => {
  let enabled = true;
  const noop = () => null;
  const Header = compile(read("src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionTopRight.tsx"), {
    react: { __esModule: true, default: React, ...React },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/dynamic": { __esModule: true, default: () => () => { throw new Promise(() => {}); } },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ currentTask: { createdAt: "2026-10-02" } }) },
    "@/components/Common/RelativeTime": { __esModule: true, default: () => "Final timestamp" },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({}) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/components/Common/AIWriterButton": { __esModule: true, default: noop },
    "@/components/Common/TimeTooltip": { __esModule: true, default: noop },
    "@/hooks/useFlag": { useFlag: () => enabled },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag },
  }).default;
  const render = () => renderToString(React.createElement(React.Suspense, { fallback: "Outer loading" },
    React.createElement("article", null, "Cached title and body", React.createElement(Header))));
  const quiet = render();
  assert.match(quiet, /Cached title and body/);
  assert.match(quiet, /Final timestamp/);
  assert.match(quiet, /h-\[14px\] w-\[14px\]/);
  assert.doesNotMatch(quiet, /Outer loading/);
  enabled = false;
  assert.match(render(), /Outer loading/, "positive control proves this cold dependency used to suspend the whole detail");
});
