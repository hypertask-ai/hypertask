const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
let pathname = "/project";
const mocks = {
  "next/navigation": { usePathname: () => pathname, useRouter: () => ({ replace: () => {} }) },
  "lucide-react": { ChevronLeft: () => null },
  "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
  "@/store": { currentUserAtom: {} },
  "@/hooks/useFlag": { useFlag: () => true },
  "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "htpr-6752-instant-ticket-open" },
  "@/components/Common/Tooltip": { __esModule: true, default: () => null },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
};
function load(relativePath) {
  const exports = {};
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", compiled)((name) => mocks[name] ?? require(name), exports);
  return exports;
}
const context = load("src/lib/contexts/Multipages/AI_Agent/chatContext.ts");
mocks["@/lib/contexts/Multipages/AI_Agent/chatContext"] = context;
const ChatRuntimeHost = load("src/components/ProviderGlobal/ChatRuntimeHost.tsx").default;
const AIChatClosedLayout = load("src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx").default;
const FullScreenChatLoading = load("src/components/AI_CHAT/FullScreenChatLoading.tsx").default;
const queryClient = new (require("@tanstack/react-query").QueryClient)();
mocks["@tanstack/react-query"] = { useQueryClient: () => queryClient };
mocks["@/components/Modals/SwipeUnread/EmbeddedTaskDetail"] = { __esModule: true, default: () => null };
mocks["@/lib/navigation/cachedTaskDetail"] = require("jiti").createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
})(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
const CachedTaskDetailNavigation = load("src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx").default;

// Execute the production shell's JSX, not a copy of its route/loading policy.
const globalSource = ts.createSourceFile("GloablProviders.tsx", fs.readFileSync(path.join(root, "src/components/ProviderGlobal/GloablProviders.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let shell;
let mountPolicy;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(globalSource) === "ChatRuntimeHost") shell = node.getText(globalSource);
  if (ts.isVariableDeclaration(node) && node.name.getText(globalSource) === "shouldMountChatRuntime") mountPolicy = node.initializer.getText(globalSource);
  ts.forEachChild(node, visit);
}
visit(globalSource);
assert.ok(shell && mountPolicy, "the actual global chat shell must be exercised");
const compiledShell = ts.transpileModule(`
export function Shell({ pathname, children, ChatRuntime }) {
  const instantTicketOpen = false;
  const isFullScreenChat = pathname.startsWith('/chat');
  const isTaskDetailPage = pathname.startsWith('/detail');
  const shouldMountAgentChatRuntime = false;
  const authenticatedUserId = 2343;
  const chatRuntimeMounted = false;
  const showAiChatInterface = false;
  const shouldMountChatRuntime = ${mountPolicy};
  const showMobileTabBar = false;
  const mobileBottomInsetVisible = false;
  const mobilePullCommandVisible = false;
  const openAIChatInterface = () => {};
  const AIChatPanels = () => null;
  return (${shell});
}`, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const shellExports = {};
new Function("require", "exports", "ChatRuntimeHost", "AIChatClosedLayout", "FullScreenChatLoading", "Suspense", "CachedTaskDetailNavigation", compiledShell)(require, shellExports, ChatRuntimeHost, AIChatClosedLayout, FullScreenChatLoading, React.Suspense, CachedTaskDetailNavigation);

for (const mobile of [true, false]) {
  test(`${mobile ? "phone" : "desktop"} ticket shell renders immediately while chat is pending and does not remount when it resolves`, async () => {
    const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/project?id=6859" });
    const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
    global.window = dom.window;
    global.document = dom.window.document;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const reactRoot = createRoot(document.getElementById("root"));
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    const chatValue = { showAiChatInterface: false };
    const Runtime = React.lazy(async () => {
      await ready;
      return { default: ({ onValue }) => {
        React.useLayoutEffect(() => onValue(chatValue), [onValue]);
        return null;
      } };
    });
    let detailMounts = 0;
    let seenChat;
    const Detail = () => {
      seenChat = context.useOptionalAiChatContext();
      React.useEffect(() => { detailMounts += 1; }, []);
      return React.createElement("button", { "data-detail": true }, "QA ticket");
    };
    const render = (route, children) => {
      pathname = route;
      reactRoot.render(React.createElement(mocks["@/lib/contexts/mobileContext"].MobileViewContext.Provider, { value: mobile }, React.createElement(shellExports.Shell, { pathname: route, ChatRuntime: Runtime }, children)));
    };
    try {
      await React.act(async () => render("/project", React.createElement("div", null, "Todo")));
      await React.act(async () => render("/detail/project-6859/43", React.createElement(Detail)));
      const detailNode = document.querySelector("[data-detail]");
      assert.ok(detailNode, "cached ticket content must not wait for chat chunks");
      assert.equal(document.querySelector("[role=status]"), null, "ticket navigation must not show Loading AI chat");
      assert.equal(seenChat, undefined);
      await React.act(async () => { release(); await ready; });
      assert.equal(document.querySelector("[data-detail]"), detailNode, "chat readiness must not replace ticket DOM");
      assert.equal(detailMounts, 1);
      assert.equal(seenChat, chatValue);
    } finally {
      await React.act(async () => reactRoot.unmount());
      global.window = previous.window;
      global.document = previous.document;
      global.IS_REACT_ACT_ENVIRONMENT = previous.act;
      dom.window.close();
    }
  });
}

mocks["@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context"] = context;
mocks["@/utils/helperFunctions/TaskDetail"] = { wrapBlockQuote: (text) => `<blockquote>${text}</blockquote>` };
mocks["@/store"] = { showAIChatInterfaceAtom: "open", aiChatAutoOpenSuppressedAtom: "suppressed", aiChatExplicitOpenAtAtom: "explicit" };
const writes = [];
mocks["@/lib/state"] = { useRecoilState: (atom) => [false, (value) => writes.push([atom, value])] };
const { useCommentToAiChat } = load("src/hooks/MultiPages/AIChat/useCommentToAiChat.ts");
mocks["@/lib/configs/taskDetail.config"] = { __esModule: true, default: { elementIds: { commentInput: "comment-input" } } };
mocks["@/lib/constants/TaskDetail"] = {};
mocks["@/lib/constants/constants"] = {};
const { useTaskDetailCommandActions } = load("src/app/detail/[...slug]/useTaskDetailCommandActions.tsx");

test("ticket AI commands triggered before the runtime is ready wait without blocking ticket rendering or dropping the action", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-6859/43" });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const reactRoot = createRoot(document.getElementById("root"));
  let commands;
  let taskCommands;
  const sent = [];
  const inserted = [];
  let started = 0;
  const task = {
    currentId: "comment-0", comments: [{ text: "QA comment", creator: { id: 2343 } }],
    setAiChatAutoOpenSuppressed: () => {}, setAiChatExplicitOpenAt: () => {}, setShowAiChatInterface: () => {},
  };
  const Detail = () => {
    commands = useCommentToAiChat();
    taskCommands = useTaskDetailCommandActions(() => task);
    return React.createElement("div", null, "QA ticket");
  };
  const render = (value) => reactRoot.render(React.createElement(context.ChatContext.Provider, { value }, React.createElement(Detail)));
  try {
    writes.length = 0;
    await React.act(async () => render(undefined));
    assert.equal(document.body.textContent, "QA ticket", "missing chat context must not crash the ticket");
    let summary;
    let branch;
    await React.act(async () => {
      summary = commands.summarizeTicket();
      branch = taskCommands.branchInNewChat();
    });
    assert.ok(writes.some(([atom, value]) => atom === "open" && value === true));
    assert.equal(sent.length, 0);
    assert.equal(started, 0);
    Object.assign(task, {
      startNewSession: async () => { started += 1; },
      aiChatEditor: { commands: { setContent: (html) => inserted.push(html), focus: () => {} } },
    });
    await React.act(async () => {
      render({ chatHistoryReady: true, isTyping: false, handleSendMessage: async (prompt) => sent.push(prompt) });
    });
    await React.act(async () => { await Promise.all([summary, branch]); });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Summarize this ticket/);
    assert.equal(started, 1);
    assert.deepEqual(inserted, ["<blockquote>QA comment</blockquote>"]);
  } finally {
    await React.act(async () => reactRoot.unmount());
    global.window = previous.window;
    global.document = previous.document;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    dom.window.close();
  }
});
