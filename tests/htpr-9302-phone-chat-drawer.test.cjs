const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const DRAWER_FLAG = "htpr-9302-phone-chat-drawer";

async function mount({ mobile, drawer }) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project" });
  const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  const stamp = new Date().toISOString();
  const chats = [
    { id: "chat-budget", title: "Budget review", createdAt: stamp, updatedAt: stamp },
    { id: "chat-launch", title: "Launch plan", createdAt: stamp, updatedAt: stamp },
  ];
  const selected = [];
  const noop = () => {};
  const state = {
    sessions: chats,
    historySessions: chats,
    currentSession: chats[0],
    currentAiOption: {},
    isSidebarMode: true,
    runningSessionIds: [],
    selectSession: (id) => { selected.push(id); },
    togglePopover: noop,
    minimizeChat: noop,
    startNewSession: noop,
    deleteSession: noop,
    refreshHistorySessions: noop,
    loadMoreSessions: noop,
  };
  const atoms = { pinned: Symbol("pinned"), keepClosed: Symbol("keepClosed") };
  const { ChatHeader } = loadModule("src/components/AI_CHAT/ChatHeader.tsx", {
    react: React,
    "next/navigation": { usePathname: () => "/project", useRouter: () => ({ push: noop }), useSearchParams: () => new URLSearchParams() },
    "@/hooks/useFlag": { useFlag: (key) => key === DRAWER_FLAG && drawer },
    "@/hooks/General/useAiChatOpenPreferences": { useAiChatOpenPreferences: () => ({ enabled: false, values: {}, setPreference: noop }) },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => state },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px]" },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: () => ({}), minimize_button: () => ({}), toggle_sidebar_button: () => ({ text: "Sidebar" }), rename_chat_button: { text: "Rename chat" }, delete_chat_button: { text: "Delete chat" } } } } },
    "@/lib/aiChatDisplayMode": { buildFullScreenChatPath: () => "/chat" },
    "@/lib/aiModelOptions": { getMobileAiChatModelLabel: () => "AI" },
    "@/lib/state": {
      useRecoilState: (atom) =>
        atom === atoms.keepClosed
          ? [false, noop]
          : atom === atoms.pinned
            ? [false, noop]
            : [false, noop],
    },
    "@/store": { aiChatPinnedAtom: atoms.pinned, keepAiChatClosedAtom: atoms.keepClosed },
    "react-hot-toast": { __esModule: true, default: { error: noop } },
    "../Common/Tooltip": { __esModule: true, default: () => null },
    "./AgentSidebarChatCommands": { AgentSidebarChatCommands: () => null },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: () => null, ChatScopeControl: () => null },
  });
  const container = document.getElementById("root");
  const renderer = createRoot(container);
  const sidebarChats = { projectId: 15, target: { kind: "ai" }, agents: [], onSelect: noop };
  await React.act(async () => renderer.render(React.createElement(ChatHeader, { sidebarChats })));
  const cleanup = async () => {
    await React.act(async () => renderer.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  };
  return {
    container,
    selected,
    cleanup,
    click: (el) => React.act(async () => el.click()),
  };
}

async function openHistory(view) {
  const button = view.container.querySelector('[aria-label="Chat history"]');
  assert.ok(button);
  await view.click(button);
  return view.container.querySelector("#ai-chat-session-history");
}

test("phone flag on opens past chats in a side drawer and switches chats", async () => {
  const view = await mount({ mobile: true, drawer: true });
  try {
    const history = await openHistory(view);
    assert.equal(history.getAttribute("role"), "dialog");
    assert.equal(history.getAttribute("aria-label"), "Past chats");
    assert.match(history.className, /\bfixed\b/);
    assert.match(history.className, /\bleft-0\b/);
    assert.doesNotMatch(history.className, /\babsolute\b/);
    assert.match(history.textContent, /Budget review/);
    assert.match(history.textContent, /Launch plan/);
    await view.click(history.querySelector('[data-chat-session-id="chat-launch"]'));
    assert.deepEqual(view.selected, ["chat-launch"]);
    assert.equal(view.container.querySelector('[role="dialog"][aria-label="Past chats"]'), null);
  } finally {
    await view.cleanup();
  }
});

test("phone flag off keeps the history dropdown over the chat", async () => {
  const view = await mount({ mobile: true, drawer: false });
  try {
    const history = await openHistory(view);
    assert.equal(history.getAttribute("role"), null);
    assert.match(history.className, /\babsolute\b/);
    assert.match(history.className, /\bright-0\b/);
    assert.doesNotMatch(history.className, /\bfixed\b/);
    assert.match(history.textContent, /Launch plan/);
  } finally {
    await view.cleanup();
  }
});

test("desktop keeps the history dropdown when the phone drawer flag is on", async () => {
  const view = await mount({ mobile: false, drawer: true });
  try {
    const history = await openHistory(view);
    assert.equal(history.getAttribute("role"), null);
    assert.match(history.className, /\babsolute\b/);
    assert.match(history.className, /\bleft-0\b/);
    assert.doesNotMatch(history.className, /\bdrawer\b/);
    assert.doesNotMatch(history.className, /\bfixed\b/);
    assert.match(history.textContent, /Launch plan/);
  } finally {
    await view.cleanup();
  }
});

test("phone flag on closes the past-chat drawer on backdrop tap and Escape", async () => {
  const view = await mount({ mobile: true, drawer: true });
  try {
    const history = await openHistory(view);
    assert.match(history.className, /safe-area-inset-top/);
    assert.match(history.className, /safe-area-inset-left/);
    assert.match(history.className, /safe-area-inset-bottom/);
    const backdrop = [...view.container.querySelectorAll("div")].find((el) => el.getAttribute("aria-hidden") === "true" && el.className.includes("inset-0"));
    assert.ok(backdrop);
    assert.match(backdrop.className, /bg-black\/40/);
    await React.act(async () => {
      backdrop.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    assert.equal(view.container.querySelector('[role="dialog"][aria-label="Past chats"]'), null);
    assert.deepEqual(view.selected, []);
    await openHistory(view);
    await React.act(async () => {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(view.container.querySelector('[role="dialog"][aria-label="Past chats"]'), null);
  } finally {
    await view.cleanup();
  }
});
