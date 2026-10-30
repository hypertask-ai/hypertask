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

test("real history Back hides the stale ticket without refresh; Forward restores cached detail", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project?id=7049#board" });
  const names = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(names.map((name) => [name, global[name]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  window.scrollTo = () => {};
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.closest("[hidden]") ? [] : [{}]; };
  let settleTraversal;
  window.addEventListener("popstate", () => {
    const done = settleTraversal;
    settleTraversal = undefined;
    if (done) setImmediate(done);
  }, true);
  const historyScript = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8").match(/id="ht-cached-task-history"\s+dangerouslySetInnerHTML=\{\{\s+__html: "([^"]+)"/)?.[1];
  assert.ok(historyScript);
  new Function("window", "CustomEvent", historyScript)(window, window.CustomEvent);
  const client = new QueryClient();
  const renderer = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    client.clear();
    for (const name of names) global[name] = previous[name];
    dom.window.close();
  });
  let nextPath = "/project";
  let serverChildren = React.createElement("ul", { id: "kanban-page-container" }, React.createElement("li", null, "Board row"));
  const board = serverChildren;
  const detail = React.createElement("article", { id: "server-detail", "data-task-detail-path": "/detail/project-7049/31" },
    React.createElement("h1", { id: "title-input" }, "Server detail"));
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
      render();
    },
  };
  const Navigation = load("src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx", {
    "react-dom": require("react-dom"),
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => nextPath, useRouter: () => router },
    "@tanstack/react-query": { useQueryClient: () => client },
    "@/lib/state": { useRecoilValue: () => ({ id: 985 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: (key) => false },
    "@/lib/flags/keys": require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts"),
    "@/components/Modals/SwipeUnread/EmbeddedTaskDetail": { __esModule: true, default: ({ projectId, uniqueIndex }) => React.createElement("article", { id: "cached-detail", "data-task-detail-path": `/detail/project-${projectId}/${uniqueIndex}` },
      React.createElement("h1", { id: "title-input" }, "Cached detail")) },
    "@/lib/navigation/cachedTaskDetail": cache,
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
    "@/lib/constants/constants": { REACT_QUERY_KEYS: { uploadStates: ["Uploading_States"] } },
    "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionEmojiButton": {},
    "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/BottomRow/DescriptionReactions": {},
    "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentReactions": {},
    "@/components/PageComponents/TaskDetail/TaskMovement": {},
    "@/components/RTE/Extensions/lazyEmojiData": { ensureEmojiData: async () => {} },
  }).default;
  function render() { renderer.render(React.createElement(Navigation, { accountId: 985 }, serverChildren)); }
  const sourceState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["board"], renderedSearch: "?id=7049" } };
  window.history.replaceState(sourceState, "", window.location.href);
  window.addEventListener("popstate", () => {
    traversals.push(window.location.pathname);
    nextPath = window.location.pathname;
    serverChildren = detail;
    render();
  });
  const committedPaths = [];
  window.addEventListener("cached-task-detail-navigation", () => committedPaths.push(window.location.pathname));
  await React.act(async () => render());
  assert.deepEqual(committedPaths, ["/project"], "route commits publish their location even when every remaining flag is off");
  await React.act(async () => {
    cache.openCachedTaskDetail({ queryClient: client, accountId: 985, projectId: 7049, uniqueIndex: 31, href: "/detail/project-7049/31", task: { id: 42, projectId: 7049, uniqueIndex: 31, title: "Cached", description_: { content: "Body" } } });
    nextPath = "/detail/project-7049/31";
    render();
  });
  await React.act(async () => {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["detail"], renderedSearch: "" } }, "", window.location.href);
    serverChildren = detail;
    render();
  });
  const traverse = (method) => React.act(async () => {
    await new Promise((resolve) => {
      settleTraversal = resolve;
      window.history[method]();
    });
  });
  await traverse("back");
  assert.deepEqual(replacements, ["/project?id=7049#board"]);
  assert.equal(refreshes, 0, "board repair must not refresh and reset its scroll");
  assert.deepEqual(traversals, [], "capture must prevent Next from traversing the stale tree");
  assert.ok(document.querySelector("#server-detail").closest("[hidden]"), "the stale ticket stays hidden until the board arrives");
  assert.equal(document.querySelector("#cached-detail"), null);
  await React.act(async () => { serverChildren = board; render(); });
  assert.ok(document.querySelector("#kanban-page-container li"));
  assert.equal(document.querySelector("#kanban-page-container").closest("[hidden]"), null);
  assert.equal(document.querySelector("#server-detail"), null);
  await traverse("forward");
  assert.deepEqual(traversals, [], "cached Forward must also prevent stale native traversal");
  assert.ok(document.querySelector("#cached-detail"));
  assert.equal(document.querySelector("#server-detail"), null);
  assert.deepEqual(replacements, ["/project?id=7049#board"]);
  assert.equal(refreshes, 0);
});

test("pending AI header is quiet on ticket routes; resolved titles and other routes are unchanged", () => {
  let pathname = "/detail/project-7049/31";
  let currentSession;
  const noop = () => null;
  const Header = load("src/components/AI_CHAT/ChatHeader.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => pathname, useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
    "./AgentSidebarChatCommands": { AgentSidebarChatCommands: noop },
    "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px]" },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/flags/keys": require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts"),
    "@/lib/flags/definitions/htpr-8048-agent-sessions": { HTPR_8048_AGENT_SESSIONS_FLAG: "htpr-8048-agent-sessions" },
    "@/lib/flags/definitions/htpr-7764-chat-running": { HTPR_7764_CHAT_RUNNING_FLAG: "htpr-7764-chat-running" },
    "@/lib/flags/definitions/htpr-7773-chat-header-name": { HTPR_7773_CHAT_HEADER_NAME_FLAG: "htpr-7773-chat-header-name" },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/definitions/htpr-7575-phone-chat-delete": { HTPR_7575_PHONE_CHAT_DELETE_FLAG: "htpr-7575-phone-chat-delete" },

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
  pathname = "/project";
  assert.match(render(), /Loading\.\.\./, "other routes retain the original behavior");
  pathname = "/detail/project-7049/31";
  currentSession = { id: 7, title: "Existing session" };
  assert.match(render(), /Existing session/);
});
