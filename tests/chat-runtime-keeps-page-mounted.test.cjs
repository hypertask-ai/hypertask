const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

// HTPR-6751: the AI chat auto-opens on desktop boards. Loading the chat used to
// swap the frame around the page, so React remounted the whole board and its
// columns vanished until the board data was fetched again.
const root = path.resolve(__dirname, "..");
const chatContextModule = { exports: {} };
const frameModule = { exports: {} };
const hostModule = { exports: {} };
const noop = () => {};
const moduleMocks = {
  "next/navigation": { usePathname: () => "/project" },
  "lucide-react": { ChevronLeft: () => null },
  "@/components/Common/Tooltip": { __esModule: true, default: () => null },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  "@/lib/contexts/Multipages/AI_Agent/chatContext": chatContextModule.exports,
};

function load(relativePath, target) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", compiled)(
    (specifier) => moduleMocks[specifier] ?? require(specifier),
    target,
    target.exports,
  );
  return target.exports;
}

load("src/lib/contexts/Multipages/AI_Agent/chatContext.ts", chatContextModule);
const AIChatClosedLayout = load("src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx", frameModule).default;
const ChatRuntimeHost = load("src/components/ProviderGlobal/ChatRuntimeHost.tsx", hostModule).default;
const { ChatContext, useOptionalAiChatContext } = chatContextModule.exports;

function withDom(url) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
  const previous = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
    global.window = previous.window;
    global.document = previous.document;
    global.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  };
}

test("mounting the chat runtime keeps an open board mounted", async () => {
  const restore = withDom("https://app.hypertask.ai/project?id=1");

  let boardMounts = 0;
  let seenChat;
  const Board = () => {
    seenChat = useOptionalAiChatContext();
    React.useEffect(() => {
      boardMounts += 1;
    }, []);
    return React.createElement("div", { "data-testid": "board" }, "Todo");
  };
  const chatValue = { showAiChatInterface: true };
  const Runtime = ({ onValue, children }) => {
    React.useLayoutEffect(() => onValue(chatValue), [onValue]);
    return React.createElement(ChatContext.Provider, { value: chatValue }, children);
  };
  const Panels = () => React.createElement("aside", { "data-testid": "chat" });

  const reactRoot = createRoot(document.getElementById("root"));
  const render = (mounted) =>
    reactRoot.render(
      React.createElement(
        ChatRuntimeHost,
        { mounted, holdChildren: false, loading: null, Runtime },
        React.createElement(
          AIChatClosedLayout,
          {
            onOpenAIChat: noop,
            chatOpen: mounted,
            panels: mounted ? React.createElement(Panels) : undefined,
          },
          React.createElement(Board),
        ),
      ),
    );

  try {
    await React.act(async () => render(false));
    const boardNode = document.querySelector("[data-testid=board]");
    assert.ok(boardNode, "board renders before the chat loads");
    assert.equal(seenChat, undefined);

    await React.act(async () => render(true));
    assert.ok(document.querySelector("[data-testid=chat]"), "chat panels render beside the board");
    assert.equal(document.querySelector("[data-testid=board]"), boardNode, "the board DOM node survives");
    assert.equal(boardMounts, 1, "the board is not remounted when the chat loads");
    assert.equal(seenChat, chatValue, "the board still receives the chat context");
  } finally {
    await React.act(async () => reactRoot.unmount());
    restore();
  }
});

test("routes that read the chat context wait for it", async () => {
  const restore = withDom("https://app.hypertask.ai/detail/project-1/1");

  const Detail = () => {
    const chat = chatContextModule.exports.useAiChatContext();
    return React.createElement("div", { "data-testid": "detail" }, String(chat.showAiChatInterface));
  };
  let release;
  const ready = new Promise((resolve) => (release = resolve));
  const Runtime = React.lazy(async () => {
    await ready;
    return {
      default: ({ children }) =>
        React.createElement(ChatContext.Provider, { value: { showAiChatInterface: false } }, children),
    };
  });
  const reactRoot = createRoot(document.getElementById("root"));
  try {
    await React.act(async () =>
      reactRoot.render(
        React.createElement(
          ChatRuntimeHost,
          { mounted: true, holdChildren: true, loading: React.createElement("p", { role: "status" }, "Loading AI chat"), Runtime },
          React.createElement(Detail),
        ),
      ),
    );
    assert.equal(document.querySelector("[role=status]")?.textContent, "Loading AI chat");
    assert.equal(document.querySelector("[data-testid=detail]"), null);

    await React.act(async () => {
      release();
      await ready;
    });
    assert.equal(document.querySelector("[data-testid=detail]")?.textContent, "false");
  } finally {
    await React.act(async () => reactRoot.unmount());
    restore();
  }
});

test("the chat runtime survives moving from a board to a task", async () => {
  const restore = withDom("https://app.hypertask.ai/project?id=1");
  let runtimeMounts = 0;
  const Runtime = ({ onValue, children }) => {
    const [value] = React.useState(() => ({ showAiChatInterface: true }));
    React.useEffect(() => {
      runtimeMounts += 1;
    }, []);
    React.useLayoutEffect(() => onValue(value));
    return React.createElement(ChatContext.Provider, { value }, children);
  };
  const Page = ({ name }) => {
    const chat = useOptionalAiChatContext();
    return React.createElement("div", { "data-testid": name }, String(chat?.showAiChatInterface));
  };
  const reactRoot = createRoot(document.getElementById("root"));
  const render = (holdChildren, name) =>
    reactRoot.render(
      React.createElement(
        ChatRuntimeHost,
        { mounted: true, holdChildren, loading: null, Runtime },
        React.createElement(Page, { name }),
      ),
    );
  try {
    await React.act(async () => render(false, "board"));
    assert.equal(document.querySelector("[data-testid=board]")?.textContent, "true");
    await React.act(async () => render(true, "detail"));
    assert.equal(document.querySelector("[data-testid=detail]")?.textContent, "true");
    assert.equal(runtimeMounts, 1, "opening a task keeps the same chat runtime, so a draft survives");
  } finally {
    await React.act(async () => reactRoot.unmount());
    restore();
  }
});
