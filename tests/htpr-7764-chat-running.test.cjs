const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const noop = () => {};
const FLAG = "htpr-7764-chat-running";
const { createSessionStreams } = loader()("src/lib/aiChat/sessionStreams.ts");

function fixture({ enabled = true, mobile = false, parallel = true, sidebar = true } = {}) {
  const view = mount();
  HTMLElement.prototype.scrollIntoView = noop;
  const Chat = React.createContext(null);
  const Mobile = React.createContext(mobile);
  const parameters = new URLSearchParams();
  const sessions = ["A", "B", "C"].map(id => ({ id, title: `Chat ${id}`, createdAt: new Date(), updatedAt: new Date(), agentId: null }));
  let streams, select, refresh, minimize, current = "A", minimized = false;
  const mocks = {
    "next/navigation": { usePathname: () => "/project", useSearchParams: () => parameters, useRouter: () => ({ push: noop }) },
    "@/hooks/useFlag": { useFlag: key => key === FLAG ? enabled : key === "htpr-7765-parallel-chats" ? parallel : ["htpr-7688-past-chats-first", "htpr-7773-chat-header-name", "htpr-7708-chat-list-rows"].includes(key) },
    "@/lib/flags/keys": { HTPR_7765_PARALLEL_CHATS_FLAG: "htpr-7765-parallel-chats" },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => React.useContext(Chat) },
    "@/lib/contexts/mobileContext": { MobileViewContext: Mobile },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/state": { useRecoilState: () => React.useState(null) },
    "@/store": {},
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.flat().filter(Boolean).join(" ") },
    "../Common/Tooltip": { default: () => null },
    "@/lib/aiModelOptions": { getMobileAiChatModelLabel: () => "GPT" },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: () => ({}), minimize_button: () => ({}) } } } },
    "@/utils/getCurrentUser": { getCurrentUserFromCookies: () => ({ id: 985 }) },
    "./MobileCommandIcon": { MobileCommandIcon: () => React.createElement("span", { "data-mobile-icon": true }) },
    "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: () => ({}) },
    "./useAiChatState": { useAiChatState: () => ({ parallelStreams: parallel ? streams : undefined, isTyping: streams.get("A").isTyping, currentStreamingSession: "A", currentSession: sessions.find(s => s.id === current) }) },
    "./useAiChatSessions": { useAiChatSessions: () => ({ fileUpload: {} }) },
    "./useAiChatAttachments": { useAiChatAttachments: () => ({}) },
    "./aiChatSend": { createAiChatSend: () => ({}) },
    "./aiChatKeyboard": { createAiChatKeyboard: () => ({}) },
    "./useAiChatPresentation": { useAiChatPresentation: () => ({}) },
    "@/lib/ai/chipEvents": { signalAiChip: noop },
  };
  const load = loader(mocks);
  const { useAiChat } = load("src/hooks/MultiPages/AIChat/useAiChat.ts");
  const { ChatHeader } = load("src/components/AI_CHAT/ChatHeader.tsx");
  function App() {
    const [, update] = React.useState(0);
    refresh = () => update(version => version + 1);
    streams ??= createSessionStreams(refresh);
    const chat = useAiChat();
    select = id => { current = id; refresh(); };
    minimize = () => { minimized = !minimized; refresh(); };
    return React.createElement(Chat.Provider, { value: { ...chat, sessions, historySessions: sessions, currentSession: sessions.find(s => s.id === current), minimizeChat: minimize, selectSession: select, togglePopover: noop, currentAiOption: {}, minimized } },
      React.createElement("div", { "data-minimized": minimized }, React.createElement(ChatHeader, sidebar ? { sidebarChats: { target: { kind: "ai" }, agents: [], onSelect: noop, onSelectSession: select } } : {})));
  }
  view.render(React.createElement(App));
  return {
    ...view, streams,
    update: callback => React.act(() => callback()),
    select: id => React.act(() => select(id)),
    minimize: () => React.act(() => minimize()),
    menu() {
      const button = sidebar ? view.container.querySelector('[aria-label="Switch conversation"]') : view.container.querySelector('[aria-controls="ai-chat-session-history"]');
      React.act(() => button.click());
    },
  };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "phone" : "desktop"} header and real command rows show independent runs, clear on finish/stop/failure, and keep selection`, () => {
    const view = fixture({ mobile });
    try {
      assert.equal(view.container.querySelector('[role="status"]'), null);
      view.update(() => { view.streams.get("A").setIsTyping(true); view.streams.get("B").setIsTyping(true); });
      assert.equal(view.container.querySelectorAll('[aria-label="Chat running"]').length, 1);
      view.minimize();
      assert.equal(view.container.querySelector('[data-minimized]').getAttribute("data-minimized"), "true");
      assert.ok(view.container.querySelector('[aria-label="Chat running"]'));
      view.menu();
      const row = id => view.container.querySelector(`[data-command-key="session:${id}"]`);
      assert.ok(row("A").querySelector('[role="status"]'));
      assert.ok(row("B").querySelector('[role="status"]'));
      assert.equal(row("C").querySelector('[role="status"]'), null);
      view.select("C");
      assert.equal(view.container.querySelector('[aria-label="Switch conversation"]').querySelector('[role="status"]'), null);
      view.update(() => view.streams.get("A").setIsTyping(false));
      assert.equal(row("A").querySelector('[role="status"]'), null);
      assert.ok(row("B").querySelector('[role="status"]'));
      view.update(() => view.streams.get("B").setIsTyping(false));
      assert.equal(view.container.querySelector('[role="status"]'), null);
      view.update(() => view.streams.get("C").setIsTyping(true));
      assert.ok(row("C").querySelector('[role="status"]'));
      view.update(() => view.streams.get("C").setIsTyping(false));
      assert.equal(view.container.querySelector('[role="status"]'), null);
      view.update(() => row("B").click());
      assert.match(view.container.querySelector('[aria-label="Switch conversation"]').textContent, /Chat B/);
    } finally { view.close(); }
  });
}

test("flag Off hides all indicators while concurrent replies and row selection stay available", () => {
  const view = fixture({ enabled: false });
  try {
    view.update(() => { view.streams.get("A").setIsTyping(true); view.streams.get("B").setIsTyping(true); });
    view.menu();
    assert.equal(view.container.querySelector('[role="status"]'), null);
    view.update(() => view.container.querySelector('[data-command-key="session:B"]').click());
    assert.match(view.container.querySelector('[aria-label="Switch conversation"]').textContent, /Chat B/);
    assert.equal(view.streams.get("A").isTyping, true);
    assert.equal(view.streams.get("B").isTyping, true);
  } finally { view.close(); }
});

test("legacy single-stream mode marks the streaming session after selecting an idle chat", () => {
  const view = fixture({ parallel: false, sidebar: false });
  try {
    view.update(() => view.streams.get("A").setIsTyping(true));
    view.select("B");
    assert.equal(view.container.querySelector('[role="status"]'), null);
    view.menu();
    const rows = [...view.container.querySelectorAll("li")];
    assert.ok(rows.find(row => row.textContent === "Chat A").querySelector('[role="status"]'));
    assert.equal(rows.find(row => row.textContent === "Chat B").querySelector('[role="status"]'), null);
    view.update(() => view.streams.get("A").setIsTyping(false));
    assert.equal(view.container.querySelector('[role="status"]'), null);
  } finally { view.close(); }
});

test("indicator flag ships for Everyone with a low-risk rollback", () => {
  const definition = loader()("src/lib/flags/definitions/htpr-7764-chat-running.ts").default;
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
