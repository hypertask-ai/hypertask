const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const root = path.resolve(__dirname, "..");
const cache = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } })(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const flag = "htpr-6752-instant-ticket-open";
function load(file, mocks) {
  const exports = {};
  const source = process.env.INSTANT_OPEN_BASELINE
    ? execFileSync("git", ["show", `1bf55e726:${file}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

test("real history Back replaces Next's stale source tree after detail RSC; Forward and flag off retain router traversal", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project?id=7049#board" });
  const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map((name) => [name, global[name]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  window.scrollTo = () => {};
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  const client = new QueryClient();
  const renderer = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    client.clear();
    for (const name of names) global[name] = previous[name];
    dom.window.close();
  });
  let nextPath = "/project";
  let enabled = true;
  let serverChildren = React.createElement("ul", { id: "board" }, React.createElement("li", null, "Board row"));
  const board = serverChildren;
  const detail = React.createElement("article", { id: "server-detail" }, "Server detail");
  const replacements = [];
  const traversals = [];
  let refreshes = 0;
  const router = {
    replace: (url) => {
      replacements.push(url);
      nextPath = new URL(url, window.location.origin).pathname;
      render();
    },
    refresh: () => {
      refreshes++;
      serverChildren = board;
      render();
    },
  };
  const Navigation = load("src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => nextPath, useRouter: () => router },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/state": { useRecoilValue: () => ({ id: 985 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag, HTPR_6972_SUBTASK_LINK_FLAG: "htpr-6972-subtask-link" },
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: () => React.createElement("article", { id: "cached-detail" }, "Cached detail") },
    "@/lib/navigation/cachedTaskDetail": cache,
    "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionEmojiButton": {},
    "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/BottomRow/DescriptionReactions": {},
    "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentReactions": {},
    "@/components/PageComponents/TaskDetail/TaskMovement": {},
    "@/components/RTE/Extensions/lazyEmojiData": { ensureEmojiData: async () => {} },
  }).default;
  function render() { renderer.render(React.createElement(Navigation, { accountId: 985 }, serverChildren)); }
  // These are Next's actual history keys. Its bubble listener otherwise restores
  // the source URL with detail children, the failure reproduced in Chromium.
  const sourceState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["board"], renderedSearch: "?id=7049" } };
  window.history.replaceState(sourceState, "", window.location.href);
  window.addEventListener("popstate", () => {
    traversals.push(window.location.pathname);
    nextPath = window.location.pathname;
    serverChildren = detail;
    render();
  });
  await React.act(async () => render());
  await React.act(async () => {
    cache.openCachedTaskDetail({ queryClient: client, accountId: 985, projectId: 7049, uniqueIndex: 31, href: "/detail/project-7049/31", task: { id: 42, projectId: 7049, uniqueIndex: 31, title: "Cached", description_: { content: "Body" } } });
    nextPath = "/detail/project-7049/31";
    render();
  });
  // Simulate the background Next RSC commit, which removes custom history state.
  await React.act(async () => {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["detail"], renderedSearch: "" } }, "", window.location.href);
    serverChildren = detail;
    render();
  });
  const traverse = (method) => React.act(async () => {
    await new Promise((resolve) => {
      window.addEventListener("cached-task-detail-navigation", resolve, { once: true });
      window.addEventListener("popstate", () => setImmediate(resolve), { once: true, capture: true });
      window.history[method]();
    });
  });
  await traverse("back");
  assert.deepEqual(replacements, ["/project?id=7049#board"]);
  assert.equal(refreshes, 1, "replacing the URL alone reuses the poisoned source route payload");
  assert.deepEqual(traversals, [], "capture must prevent Next from traversing the stale tree");
  assert.ok(document.querySelector("#board li"));
  assert.equal(document.querySelector("#server-detail"), null);
  assert.equal(document.querySelector("#cached-detail"), null);
  await traverse("forward");
  assert.deepEqual(traversals, ["/detail/project-7049/31"]);
  assert.ok(document.querySelector("#server-detail"));
  await React.act(async () => { enabled = false; render(); });
  await traverse("back");
  assert.equal(replacements.length, 1, "flag off must not replace the original router traversal");
  assert.equal(refreshes, 1, "flag off must not refresh the original router traversal");
  assert.equal(traversals.at(-1), "/project");
});

test("pending AI header is quiet only for flagged ticket routes; resolved titles and flag-off loading are unchanged", () => {
  let enabled = true;
  let pathname = "/detail/project-7049/31";
  let currentSession;
  const noop = () => null;
  const Header = load("src/components/AI_CHAT/ChatHeader.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => pathname, useRouter: () => ({}) },
    "@/hooks/useFlag": { useFlag: () => enabled },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: flag },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ sessions: [], currentSession, isSessionPending: true, isSidebarMode: true }) },
    "lucide-react": Object.fromEntries(["Check", "ChevronDown", "ChevronRight", "Ellipsis", "History", "Maximize2", "Minus", "PanelRight", "Pencil", "PictureInPicture2", "Pin", "PinOff", "SquarePen", "Trash2", "X"].map((name) => [name, noop])),
    "../Common/Tooltip": { __esModule: true, default: ({ children }) => children },
    "date-fns": { format: noop },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: noop, toggle_sidebar_button: noop, minimize_button: noop } } } },
    "@/lib/aiChatDisplayMode": { buildFullScreenChatPath: noop },
    "@/lib/aiModelOptions": { getMobileAiChatModelLabel: noop },
    "@/lib/state": { useRecoilState: () => [false, noop] },
    "react-hot-toast": { __esModule: true, default: noop },
    "@/store": {},
  }).ChatHeader;
  const render = () => renderToString(React.createElement(Header));
  assert.doesNotMatch(render(), /Loading\.\.\./);
  assert.match(render(), /AI Chat/);
  enabled = false;
  assert.match(render(), /Loading\.\.\./, "positive control exercises the original loading state");
  enabled = true;
  pathname = "/project";
  assert.match(render(), /Loading\.\.\./, "other routes retain the original behavior");
  pathname = "/detail/project-7049/31";
  currentSession = { id: 7, title: "Existing session" };
  assert.match(render(), /Existing session/);
});
