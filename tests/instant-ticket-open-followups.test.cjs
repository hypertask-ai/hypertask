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

test("warm: board commit loads cold chunks before an idle opportunity; pointerdown deduplicates and flag off does nothing", async (t) => {
  domFixture(t);
  const client = new QueryClient();
  t.after(() => client.clear());
  let enabled = true;
  const effects = [];
  const loaded = [];
  let emojiLoads = 0;
  window.requestIdleCallback = () => assert.fail("the first open must not wait for idle");
  const mocks = navigationMocks(client, () => enabled, () => "/project", {
    ...React, useRef: (initial) => ({ current: initial }), useEffect: (effect) => effects.push(effect), useSyncExternalStore: (subscribe, snapshot) => snapshot(),
  });
  const chunks = [
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
  mocks["@/components/RTE/Extensions/lazyEmojiData"] = { ensureEmojiData: () => { emojiLoads++; return Promise.resolve(); } };
  const Navigation = compile(read(navigationPath), mocks).default;
  Navigation({ accountId: 985, children: "Board" });
  assert.equal(loaded.length, 0, "imports do not block board render");
  const cleanups = effects.map((effect) => effect()).filter(Boolean);
  await new Promise(setImmediate);
  assert.deepEqual(loaded, chunks, "commit alone warms before any pointer or idle event");
  assert.equal(emojiLoads, 1);
  document.dispatchEvent(new Event("pointerdown"));
  await new Promise(setImmediate);
  assert.equal(loaded.length, chunks.length);
  cleanups.forEach((cleanup) => cleanup());
  effects.length = 0;
  loaded.length = 0;
  enabled = false;
  Navigation({ accountId: 985, children: "Board" });
  assert.ok(effects.every((effect) => effect() === undefined), "flag off schedules nothing");
  enabled = true;
  effects.length = 0;
  Navigation({ accountId: null, children: "Board" });
  assert.ok(effects.every((effect) => effect() === undefined), "unknown accounts never warm");
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

test("first mount: cached comments still defer editor controls until after primary frames and idle; interaction, fallback, cleanup and flag off remain usable", async (t) => {
  domFixture(t);
  const hookPath = "src/hooks/Task Detail/useTaskDetailGlobalStates.ts";
  const source = process.env.FIRST_MOUNT_BASELINE
    ? execFileSync("git", ["show", `origin/production:${hookPath}`], { cwd: root, encoding: "utf8" })
    : read(hookPath);
  const ast = ts.createSourceFile("hook.ts", source, ts.ScriptTarget.Latest, true);
  const hook = ast.statements.find((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) => item.name.getText(ast) === "useTaskDetailGlobalStates"));
  const statements = hook.declarationList.declarations[0].initializer.body.statements;
  const names = ["instantTicketOpen", "initialCommentsPayload", "[secondaryPanelsReady, setSecondaryPanelsReady]"];
  const declarations = names.map((name) => statements.find((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) => item.name.getText(ast) === name)));
  const effect = statements.find((statement) => ts.isExpressionStatement(statement) && statement.getText(ast).startsWith("useEffect(") && statement.getText(ast).includes("if (secondaryPanelsReady) return"));
  assert.ok(declarations.every(Boolean) && effect, "exercise the actual state/effect boundary, not a copied scheduler");
  const code = `import { useState, useMemo, useEffect } from "react";
    import { useFlag } from "@/hooks/useFlag";
    import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG } from "@/lib/flags/keys";
    export default function Readiness({ comments }) {
      const _comments = JSON.stringify(comments);
      ${[...declarations, effect].map((statement) => statement.getText(ast)).join("\n")}
      return <span data-ready={String(secondaryPanelsReady)} />;
    }`;
  let enabled = true;
  const Readiness = compile(code, {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag); return enabled; } },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag },
  }).default;
  let id = 0;
  const frames = new Map();
  const idle = new Map();
  const timers = new Map();
  const globals = { requestAnimationFrame: global.requestAnimationFrame, cancelAnimationFrame: global.cancelAnimationFrame };
  global.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  global.cancelAnimationFrame = (handle) => frames.delete(handle);
  t.after(() => Object.assign(global, globals));
  window.requestIdleCallback = (callback, options) => { assert.equal(options.timeout, 1000); idle.set(++id, callback); return id; };
  window.cancelIdleCallback = (handle) => idle.delete(handle);
  window.setTimeout = (callback, delay) => { assert.equal(delay, 0); timers.set(++id, callback); return id; };
  window.clearTimeout = (handle) => timers.delete(handle);
  const tick = async (queue) => React.act(async () => {
    const callbacks = [...queue.values()];
    queue.clear();
    callbacks.forEach((callback) => callback());
  });
  let renderer;
  const mount = async (comments = { comments: [], stacked: {} }) => {
    renderer = createRoot(document.getElementById("root"));
    await React.act(async () => renderer.render(React.createElement(Readiness, { comments })));
  };
  const ready = () => document.querySelector("span").dataset.ready === "true";
  const unmount = () => React.act(async () => renderer.unmount());
  for (const comments of [{ comments: [], stacked: {} }, { pending: true }]) {
    await mount(comments);
    assert.equal(ready(), false, "cached comments cannot bypass first-mount CPU deferral");
    await tick(frames);
    await tick(frames);
    assert.equal(ready(), false, "neither primary frame may mount editor controls");
    assert.equal(idle.size, 1);
    await tick(idle);
    assert.equal(ready(), true);
    await unmount();
  }
  for (const event of ["pointerdown", "keydown"]) {
    await mount();
    await tick(frames);
    await tick(frames);
    await React.act(async () => document.dispatchEvent(new Event(event)));
    assert.equal(ready(), true, `${event} must not wait for an idle opportunity`);
    assert.equal(idle.size, 0, "interaction cancels the pending idle work");
    await unmount();
  }
  await mount();
  await unmount();
  assert.equal(frames.size, 0, "navigation away cancels frame work");
  await mount();
  await tick(frames);
  await tick(frames);
  await unmount();
  assert.equal(idle.size, 0, "navigation away cancels idle work");
  delete window.requestIdleCallback;
  await mount();
  await tick(frames);
  await tick(frames);
  assert.equal(ready(), false);
  assert.equal(timers.size, 1);
  await tick(timers);
  assert.equal(ready(), true, "browsers without requestIdleCallback still mount controls");
  await unmount();
  await mount();
  await tick(frames);
  await tick(frames);
  await unmount();
  assert.equal(timers.size, 0, "navigation away cancels fallback work");
  enabled = false;
  await mount();
  assert.equal(ready(), true, "flag off retains immediate controls");
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  await unmount();
});
