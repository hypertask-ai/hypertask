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
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
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
  t.after(() => { for (const name of names) global[name] = previous[name]; dom.window.close(); });
  return dom;
}
function navigationMocks(client, enabled, pathname, react = React) {
  return {
    react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => pathname(), useRouter: () => ({ replace: () => assert.fail("cached navigation must not request a server route") }) },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/state": { useRecoilValue: () => ({ id: 985 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag); return enabled(); } },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag },
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
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag); return enabled; } },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag },
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

test("warm: idle and pointerdown load the measured cold chunks once, cancel scheduled work, and never warm with flag off", async (t) => {
  domFixture(t);
  const client = new QueryClient();
  t.after(() => client.clear());
  let enabled = true;
  const effects = [];
  const loaded = [];
  let emojiLoads = 0;
  let idleCallback;
  const canceled = [];
  window.requestIdleCallback = (callback) => { idleCallback = callback; return 7; };
  window.cancelIdleCallback = (id) => canceled.push(id);
  const mocks = navigationMocks(client, () => enabled, () => "/project", {
    ...React, useRef: (initial) => ({ current: initial }), useEffect: (effect) => effects.push(effect), useSyncExternalStore: (subscribe, snapshot) => snapshot(),
  });
  const chunks = [
    "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionEmojiButton",
    "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/BottomRow/DescriptionReactions",
    "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentReactions",
    "@/components/PageComponents/TaskDetail/TaskMovement",
  ];
  for (const chunk of chunks) Object.defineProperty(mocks, chunk, { get: () => { loaded.push(chunk); return {}; } });
  mocks["@/components/RTE/Extensions/lazyEmojiData"] = { ensureEmojiData: () => { emojiLoads++; return Promise.resolve(); } };
  const Navigation = compile(read(navigationPath), mocks).default;
  Navigation({ accountId: 985, children: "Board" });
  const cleanup = effects[0]();
  assert.equal(loaded.length, 0, "warm work is not synchronous with board render");
  document.dispatchEvent(new Event("pointerdown"));
  await new Promise(setImmediate);
  assert.deepEqual(loaded, chunks);
  assert.equal(emojiLoads, 1);
  idleCallback();
  await new Promise(setImmediate);
  assert.equal(loaded.length, chunks.length, "idle following pointerdown does not duplicate imports");
  cleanup();
  assert.deepEqual(canceled, [7]);
  document.dispatchEvent(new Event("pointerdown"));
  assert.equal(loaded.length, chunks.length);
  effects.length = 0;
  loaded.length = 0;
  emojiLoads = 0;
  Navigation({ accountId: 985, children: "Board" });
  const cleanupIdle = effects[0]();
  idleCallback();
  await new Promise(setImmediate);
  assert.deepEqual(loaded, chunks, "idle alone warms before any pointer interaction");
  assert.equal(emojiLoads, 1);
  cleanupIdle();
  effects.length = 0;
  enabled = false;
  Navigation({ accountId: 985, children: "Board" });
  assert.equal(effects[0](), undefined, "flag off schedules nothing");
  enabled = true;
  effects.length = 0;
  Navigation({ accountId: null, children: "Board" });
  assert.equal(effects[0](), undefined, "unknown accounts never warm");
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
