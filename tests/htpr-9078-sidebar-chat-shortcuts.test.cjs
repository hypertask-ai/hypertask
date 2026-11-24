const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const flagKey = "htpr-9078-sidebar-chat-shortcuts";
const typing = loadModule("src/lib/keyboard/sidebarChatTyping.ts");
const flag = loadModule("src/lib/flags/definitions/htpr-9078-sidebar-chat-shortcuts.ts");

const SIDEBAR = `<div data-testid="ai-sidebar" data-ai-chat-panel>
  <div data-ai-chat-composer-root>
    <div data-ai-chat-composer data-agent-chat-ai-composer>
      <div id="agent-chat-composer-editor">
        <div class="tiptap ProseMirror outline-none py-2 text-dense" contenteditable="true" role="textbox" tabindex="0"></div>
      </div>
    </div>
  </div>
</div>
<main><input id="board-search" /></main>`;

function withDom(run) {
  const dom = new JSDOM(`<body>${SIDEBAR}</body>`, { pretendToBeVisual: true, url: "https://app.hypertask.ai/project/15" });
  const saved = new Map();
  for (const name of ["document", "window", "HTMLElement", "Element", "Node", "KeyboardEvent"]) {
    saved.set(name, Object.getOwnPropertyDescriptor(global, name));
    global[name] = name === "document" ? dom.window.document : dom.window[name];
  }
  try {
    return run(dom.window);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
}

function press(window, target, key, extra = {}) {
  const event = new window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

function listen(window, enabled) {
  const opened = [];
  const onCapture = enabled ? typing.sidebarChatTypingCapture : () => {};
  const onBubble = (event) => {
    if (typing.sidebarChatTypingBlocksShortcuts(event)) return;
    if (event.key === "?" || (event.key === "/" && event.shiftKey)) opened.push("shortcuts");
    else if (event.key === "/") opened.push("search");
    else opened.push(event.key);
  };
  window.document.addEventListener("keydown", onCapture, true);
  window.document.addEventListener("keydown", onBubble);
  return {
    opened,
    stop() {
      window.document.removeEventListener("keydown", onCapture, true);
      window.document.removeEventListener("keydown", onBubble);
    },
  };
}

test("sidebar chat shortcut flag is a reversible bugfix for everyone", () => {
  assert.equal(flag.HTPR_9078_SIDEBAR_CHAT_SHORTCUTS_FLAG, flagKey);
  assert.equal(flag.default.key, flagKey);
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
});

for (const enabled of [true, false]) {
  test(`typing ? / and hello in the sidebar agent chat with the fix ${enabled ? "on" : "off"}`, () => {
    withDom((window) => {
      const composer = window.document.querySelector("#agent-chat-composer-editor .ProseMirror");
      const board = window.document.querySelector("#board-search");
      composer.focus();
      const chat = listen(window, enabled);
      for (const key of ["h", "e", "l", "l", "o", "/", "?"]) {
        const event = press(window, composer, key, key === "?" ? { shiftKey: true } : {});
        assert.equal(event.defaultPrevented, false, key);
      }
      assert.deepEqual(chat.opened, enabled ? [] : ["h", "e", "l", "l", "o", "search", "shortcuts"]);
      chat.stop();

      board.focus();
      const outside = listen(window, enabled);
      press(window, board, "?", { shiftKey: true });
      press(window, board, "/");
      assert.deepEqual(outside.opened, ["shortcuts", "search"]);
      outside.stop();
    });
  });
}

test("a purpose-opened shortcuts list sits beside the open chat", () => {
  assert.equal(typing.shortcutsPanelRight(true), "var(--ht-ai-sidebar-width, 0px)");
  assert.equal(typing.shortcutsPanelRight(false), undefined);
});

function chain() {
  return { configure: () => ({}), extend: () => ({}), create: () => ({}) };
}

function editorPropsForChat() {
  const writingAssistance = { attributes: { "data-writing-assistance": "on" }, handleKeyDown: () => false };
  let options;
  const stubs = {
    react: { useRef: (initial) => ({ current: initial }), useEffect: () => {}, useContext: () => false },
    "next/navigation": { usePathname: () => "/project" },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": { HTPR_6906_AUTOCAP_UNDO_FLAG: "htpr-6906-autocap-undo", LOCAL_WRITING_ASSISTANCE_FLAG: "local-writing-assistance" },
    "@/lib/flags/definitions/htpr-5908-retype-lowercase": { HTPR_5908_RETYPE_LOWERCASE_FLAG: "htpr-5908-retype-lowercase" },
    "@/lib/flags/definitions/htpr-8263-full-screen-chat-cleanup": { HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG: "htpr-8263-full-screen-chat-cleanup" },
    "@/lib/flags/definitions/htpr-8824-ai-chat-one-composer": { HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG: "htpr-8824-ai-chat-one-composer" },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/components/RTE/Components/AI_Chat/MentionData": { createMentionData: () => ({}) },
    "@/components/RTE/Extensions/LinkableMention": { LinkableMention: chain() },
    "@/components/RTE/Extensions/SlashCommands/SlashCommands": { __esModule: true, default: () => ({}) },
    "@/components/RTE/Extensions/SafeSplitBlock": { SafeSplitBlock: {} },
    "@/components/RTE/writingAssistance": { writingAssistanceEditorProps: writingAssistance, LocalWritingAssistance: chain() },
    "@/styles/tiptap.module.scss": { __esModule: true, default: {} },
    "@tiptap/react": {
      Extension: { create: (options) => options },
      useEditor: (received) => {
        options = received;
        return { isDestroyed: false, state: { tr: {} }, view: { dispatch: () => {} } };
      },
    },
    "@tiptap/extension-highlight": { __esModule: true, default: chain() },
    "@tiptap/extension-ordered-list": { __esModule: true, default: chain() },
    "@tiptap/extension-task-item": { __esModule: true, default: chain() },
    "@tiptap/extension-task-list": { __esModule: true, default: chain() },
    "@tiptap/extension-underline": { __esModule: true, default: chain() },
    "@tiptap/extension-gapcursor": { __esModule: true, default: {} },
    "@tiptap/extension-placeholder": { __esModule: true, default: chain() },
    "@tiptap/starter-kit": { __esModule: true, default: chain() },
  };
  loadModule("src/hooks/MultiPages/AIChat/useAiTiptap.ts", stubs).default({ contextCallback: () => {} });
  return { options, writingAssistance };
}

test("the chat composer answers to the name Message and keeps its writing assistance", () => {
  const { options, writingAssistance } = editorPropsForChat();
  assert.equal(options.editorProps.attributes["aria-label"], "Message");
  assert.deepEqual(options.editorProps.attributes, { "data-writing-assistance": "on", "aria-label": "Message" });
  assert.equal(options.editorProps.handleKeyDown, writingAssistance.handleKeyDown);
});

test("the phone chat button is named Open AI chat like the desktop one", () => {
  const MobileTabBar = loadModule("src/components/Global/MobileTabBar.tsx", {
    react: React,
    "next/link": { __esModule: true, default: ({ href, children }) => React.createElement("a", { href }, children) },
    "next/navigation": { usePathname: () => "/project" },
    "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => true },
    "@/hooks/General/useHydrated": { useHydrated: () => true },
    "@/lib/flags/definitions/htpr-8038-chat-opener-ready": { HTPR_8038_CHAT_OPENER_READY_FLAG: "htpr-8038-chat-opener-ready" },
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
    "@/lib/firstScreen/display": { projectDisplayDay: () => 1 },
    "react-icons/fa": { FaInbox: () => null },
    "react-icons/ci": { CiSearch: () => null },
    "lucide-react": { Calendar: () => null, Sparkles: () => null, SquareKanban: () => null },
    "@/components/ProviderGlobal/useGlobalUIState": {
      useGlobalUIState: () => ({ toggleAIChatInterface() {}, showAiChatInterface: false, closeAIChatInterface() {} }),
    },
    "@/hooks/Homepage/useAppShellSurfaceShortcuts": { __esModule: true, default: () => ({ navigateToBoard() {} }) },
    "@/hooks/Inbox/useGetNotifications": { useGetNotificationCount: () => ({ data: { unseen: 0 } }) },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "./mobileShellVisibility": loadModule("src/components/Global/mobileShellVisibility.ts"),
    "./mobileDockHeight": { clearMobileDockHeight() {}, publishMobileDockHeight() {}, releaseMobileDockHeight() {} },
  }).default;
  const html = renderToStaticMarkup(React.createElement(MobileTabBar, { currentUserId: 985 }));
  const doc = new JSDOM(html).window.document;
  const chat = doc.querySelector('nav[aria-label="Primary navigation"] button[aria-label="Open AI chat"]');
  assert.ok(chat, "the phone dock names its chat button Open AI chat");
  assert.equal(chat.getAttribute("aria-pressed"), "false");
});

test("the shortcuts panel keeps the chat width only while the fix is on", () => {
  const BackDrop = loadModule("src/components/sidebars/BackDropContainer.tsx", {
    react: React,
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  }).default;
  const render = (enabled) => {
    const Component = loadModule("src/components/sidebars/keyboardShortcuts.tsx", {
      react: React,
      "lucide-react": require("lucide-react"),
      "@/lib/flags/keys": {
        HTPR_7045_SHORTCUTS_HELP_PHONE_FLAG: "htpr-7045-shortcuts-help-phone",
        HTPR_7564_PHONE_SHORTCUTS_HEADER_FLAG: "htpr-7564-phone-shortcuts-header",
      },
      "@/lib/flags/definitions/htpr-8929-column-select-all": { HTPR_8929_COLUMN_SELECT_ALL_FLAG: "htpr-8929-column-select-all" },
      "@/lib/flags/definitions/htpr-9078-sidebar-chat-shortcuts": { HTPR_9078_SIDEBAR_CHAT_SHORTCUTS_FLAG: flagKey },
      "@/lib/keyboard/sidebarChatTyping": typing,
      "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
      "@/lib/state": { useRecoilValue: () => false, useRecoilState: () => [true, () => {}] },
      "@/store": { appShellRailAtom: {}, showShortcutsAtom: {} },
      "./BackDropContainer": { __esModule: true, default: BackDrop },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
      "@/lib/constants/keyboard-handler": { KeyCodes: { ESCAPE: 27 } },
      "@/lib/configs/general.config": {
        DIV_ID_CONSTANTS: { keyboardShortcuts: "shortcuts-help" },
        INPUT_ID_CONSTANTS: { KeyboardShortcuts: "shortcuts-search" },
      },
      "@/lib/constants/shortcuts": { getKeyboardShortcuts: () => [] },
    }).default;
    return new JSDOM(renderToStaticMarkup(React.createElement(Component))).window.document.getElementById("shortcuts-help");
  };
  const on = render(true);
  const off = render(false);
  assert.equal(on.style.right, typing.shortcutsPanelRight(true));
  assert.equal(off.style.right, "");
  assert.equal(on.style.fontSize, "14px");
  assert.equal(off.style.fontSize, "14px");
  assert.ok(off.className.includes("right-0"));
});
