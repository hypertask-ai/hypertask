const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-8042-amoled-chat-border";

function windowView({ enabled = true, mobile = false, minimized = false } = {}) {
  const load = loader({
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": { HTPR_7766_CHAT_SHORTCUTS_FLAG: "htpr-7766-chat-shortcuts" },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/hooks/useFlag": { useFlag: key => key === flag && enabled },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
      useAiChatContext: () => ({ showWelcomeScreen: true, minimized, currentSession: { title: "Saved conversation" } }),
    },
    "./MessageList": { MessageList: () => null },
    "./WelcomeScreen": { WelcomeScreen: () => React.createElement("p", null, "Welcome") },
    "./ChatHeader": { ChatHeader: () => React.createElement("header", null, "Saved conversation") },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: () => React.createElement("textarea", { "aria-label": "Message" }) },
    "@/lib/constants/APIRouteConstants": {},
    "@/lib/realtime/client": {},
    "../api/global": {},
  });
  const { ChatWindow } = load("src/components/AI_CHAT/ChatWindow.tsx");
  const view = mount();
  view.render(React.createElement(ChatWindow));
  return view;
}

for (const enabled of [false, true]) {
  test(`desktop outline is reversible: flag ${enabled}`, () => {
    const view = windowView({ enabled });
    try {
      const panel = view.container.querySelector(".chatwindow");
      assert.ok(panel);
      assert.equal(panel.classList.contains("[outline:var(--outline-floating-panel)]"), enabled);
      assert.equal(panel.classList.contains("[outline-offset:var(--offset-floating-panel-outline)]"), enabled);
      assert.equal(panel.classList.contains("[--bs-border-radius:var(--radius-chat-window)]"), enabled);
      assert.ok(panel.classList.contains("h-[70svh]"));
      assert.ok(panel.classList.contains("w-[30vw]"));
      assert.equal(view.container.querySelector("header").textContent, "Saved conversation");
      assert.ok(view.container.querySelector('[aria-label="Message"]'));
    } finally { view.close(); }
  });
}

test("phone content keeps its sizing; the surrounding sheet owns its outline", () => {
  const view = windowView({ mobile: true });
  try {
    const panel = view.container.querySelector(".chatwindow");
    assert.ok(panel.classList.contains("rounded-none"));
    assert.ok(panel.classList.contains("h-full"));
    assert.equal(panel.classList.contains("[outline:var(--outline-floating-panel)]"), false);
  } finally { view.close(); }
});

test("minimized conversation remains available", () => {
  const view = windowView({ minimized: true });
  try {
    assert.equal(view.container.querySelector(".chatwindow"), null);
    assert.match(view.container.querySelector("button").textContent, /Saved conversation/);
  } finally { view.close(); }
});

test("Everyone improvement has a small reversible release", () => {
  const definition = loader()("src/lib/flags/definitions/htpr-8042-amoled-chat-border.ts").default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
