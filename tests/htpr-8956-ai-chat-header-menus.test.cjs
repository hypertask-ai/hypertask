const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-8956-ai-chat-header-menus";
const day = 24 * 60 * 60 * 1000;

async function mount({ enabled }) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/chat" });
  const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  const stamp = (offset) => new Date(Date.now() - offset).toISOString();
  const chats = [["Today chat", 0], ["Week chat", 3 * day], ["Old chat", 30 * day]].map(([title, offset], index) => ({ id: `chat-${index}`, title, createdAt: stamp(offset), updatedAt: stamp(offset) }));
  const store = { pinned: true, keepClosed: false }, noop = () => {};
  const state = { sessions: chats, currentSession: chats[0], currentAiOption: {}, isSidebarMode: true, selectSession: noop, togglePopover: noop, minimizeChat: noop };
  const atoms = { pinned: Symbol("pinned"), keepClosed: Symbol("keepClosed") };
  const { ChatHeader } = loadModule("src/components/AI_CHAT/ChatHeader.tsx", {
    react: React,
    "next/navigation": { usePathname: () => "/chat", useRouter: () => ({ push: noop }), useSearchParams: () => new URLSearchParams() },
    "@/hooks/useFlag": { useFlag: (key) => (key === FLAG ? enabled : key === "htpr-7530-keep-ai-chat-closed") },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => state },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px]" },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: () => ({}), minimize_button: () => ({}), toggle_sidebar_button: () => ({ text: "Sidebar" }), rename_chat_button: { text: "Rename chat" }, delete_chat_button: { text: "Delete chat" } } } } },
    "@/lib/aiChatDisplayMode": { buildFullScreenChatPath: () => "/chat" },
    "@/lib/aiModelOptions": { getMobileAiChatModelLabel: () => "AI" },
    "@/lib/state": {
      useRecoilState: (atom) =>
        atom === atoms.keepClosed
          ? [store.keepClosed, (value) => { store.keepClosed = value; }]
          : atom === atoms.pinned
            ? [store.pinned, (value) => { store.pinned = value; }]
            : [false, noop],
    },
    "@/store": { aiChatPinnedAtom: atoms.pinned, keepAiChatClosedAtom: atoms.keepClosed },
    "react-hot-toast": { __esModule: true, default: { error: noop } },
    "../Common/Tooltip": { __esModule: true, default: () => null },
    "./AgentSidebarChatCommands": { AgentSidebarChatCommands: () => null },
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
  return { container, store, cleanup, click: (el) => React.act(async () => el.click()) };
}

test("flag on: clock gone, title pill opens grouped searchable history", async () => {
  const { container, click, cleanup } = await mount({ enabled: true });
  try {
    assert.equal(container.querySelectorAll('[aria-label="Chat history"]').length, 1);
    await click(container.querySelector('[aria-label="Chat history"]'));
    const history = container.querySelector("#ai-chat-session-history");
    assert.ok(history);
    for (const label of ["Today", "Previous 7 days", "Older"]) assert.ok(history.textContent.includes(label), label);
    assert.ok(history.querySelector('input[placeholder="Search chats"]'));
    await click(container.querySelector('[aria-label="Chat history"]'));
    assert.equal(container.querySelector("#ai-chat-session-history"), null);
  } finally {
    await cleanup();
  }
});

test("flag on: three-dot menu lists the spec rows and Pin / Keep closed behave as a pair", async () => {
  const { container, store, click, cleanup } = await mount({ enabled: true });
  try {
    const openMenu = () => click(container.querySelector('[aria-haspopup="menu"]'));
    await openMenu();
    const items = () => [...container.querySelectorAll('[role="menu"] [role^="menuitem"]')].map((el) => el.textContent);
    assert.deepEqual(items(), ["Pin chat open", "Keep chat closed", "Floating window", "Full screen", "Rename chat", "Delete chat"]);
    assert.equal(container.querySelector('[role="menuitemradio"][aria-checked="true"]').textContent, "Pin chat open");

    await click([...container.querySelectorAll('[role="menuitemradio"]')][1]);
    assert.equal(store.keepClosed, true);
    assert.equal(store.pinned, false);

    await openMenu();
    assert.equal(container.querySelector('[role="menuitemradio"][aria-checked="true"]').textContent, "Keep chat closed");
    await click([...container.querySelectorAll('[role="menuitemradio"]')][0]);
    assert.equal(store.pinned, true);
    assert.equal(store.keepClosed, false);
  } finally {
    await cleanup();
  }
});

test("flag off: old menu stays", async () => {
  const { container, click, cleanup } = await mount({ enabled: false });
  try {
    await click(container.querySelector('[aria-haspopup="menu"]'));
    assert.equal(container.querySelector('[role="menuitemradio"]'), null);
  } finally {
    await cleanup();
  }
});
