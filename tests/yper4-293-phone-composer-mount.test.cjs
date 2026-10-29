const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const noop = () => null;

test("phone cached composer keeps its draft and focus when Next publishes the detail pathname", async () => {
  let pathname = "/project";
  let isMobile = true;
  const MobileViewContext = React.createContext(true);
  const dependencies = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": { ChevronLeft: noop },
    "@/components/Common/Tooltip": { __esModule: true, default: noop },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@/hooks/useFlag": { useFlag: () => true, useFlagLoaded: () => true, useFlagReady: () => true },
    "@/lib/flags/definitions/htpr-8038-chat-opener-ready": { HTPR_8038_CHAT_OPENER_READY_FLAG: "htpr-8038-chat-opener-ready" },
    "@/lib/flags/definitions/htpr-7622-ai-settings": { HTPR_7622_AI_SETTINGS_FLAG: "htpr-7622-ai-settings" },
    "@/lib/flags/keys": {
      HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG: "htpr-7055-chat-overlays-ticket",
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  const Frame = exports.default;
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/project?id=1" });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require("react-dom/client");
  let mounts = 0;
  function Composer() {
    const [draft, setDraft] = React.useState("");
    React.useEffect(() => { mounts += 1; }, []);
    return React.createElement("textarea", {
      "data-testid": "comment-composer", value: draft,
      onInput: (event) => setDraft(event.currentTarget.value),
      onChange: noop,
    });
  }
  const reactRoot = createRoot(document.getElementById("root"));
  const render = (chatOpen = false) => reactRoot.render(React.createElement(MobileViewContext.Provider, { value: isMobile },
    React.createElement(Frame, {
      onOpenAIChat: noop, chatOpen, mobileTopBarVisible: isMobile,
      panels: React.createElement("aside", { "data-testid": "chat-panels" }),
    }, React.createElement(Composer))));
  try {
    // Native history exposes the cached ticket while Next still holds the board pathname.
    await React.act(async () => render());
    const composer = document.querySelector('[data-testid="comment-composer"]');
    composer.focus();
    await React.act(async () => {
      composer.value = "Unsent phone comment";
      composer.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    pathname = "/detail/project-1/1";
    await React.act(async () => render());
    assert.ok(document.querySelector('[data-testid="comment-composer"]') === composer, "pathname update must not replace the composer DOM node");
    assert.equal(mounts, 1, "the composer mounts only once");
    assert.equal(composer.value, "Unsent phone comment");
    assert.equal(document.activeElement, composer, "focus survives the pathname update");
    const workspace = document.querySelector("[data-ai-workspace]");
    assert.equal(workspace.className, "outline-none mobile-tab-bar-content pt-[var(--mobile-top-bar-h)]", "closed phone detail keeps its existing workspace classes");
    assert.equal(document.querySelector('[data-testid="chat-panels"]'), null, "closed phone detail still omits chat panels");
    for (const chatOpen of [true, false]) {
      await React.act(async () => render(chatOpen));
      assert.equal(document.querySelector('[data-testid="comment-composer"]'), composer, "opening or closing phone chat must not remount the composer");
      assert.equal(composer.value, "Unsent phone comment");
      assert.equal(document.activeElement, composer);
      assert.equal(Boolean(document.querySelector('[data-testid="chat-panels"]')), chatOpen);
    }
    for (const mobile of [false, true]) {
      const previousComposer = document.querySelector('[data-testid="comment-composer"]');
      isMobile = mobile;
      await React.act(async () => render());
      assert.notEqual(document.querySelector('[data-testid="comment-composer"]'), previousComposer, "a ticket breakpoint change retains production's scroll-initialization lifecycle");
    }
    assert.equal(mounts, 3, "only actual ticket breakpoint changes restart the thread");
    pathname = "/project";
    await React.act(async () => render());
    const boardComposer = document.querySelector('[data-testid="comment-composer"]');
    for (const mobile of [false, true]) {
      isMobile = mobile;
      await React.act(async () => render());
      assert.equal(document.querySelector('[data-testid="comment-composer"]'), boardComposer, "board breakpoint changes still keep their subtree mounted");
    }
    assert.equal(mounts, 3);
  } finally {
    await React.act(async () => reactRoot.unmount());
    global.window = previous.window;
    global.document = previous.document;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    dom.window.close();
  }
});
