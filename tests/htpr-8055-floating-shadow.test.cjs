const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const flag = "htpr-8055-floating-elevation";

function windowView({ enabled = true, mobile = false, framed = false } = {}) {
  const load = loader({
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": { HTPR_7766_CHAT_SHORTCUTS_FLAG: "htpr-7766-chat-shortcuts" },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/hooks/useFlag": {
      useFlag: key => (key === flag ? enabled : key === "htpr-8334-multi-chat-windows" ? framed : false),
    },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
      useAiChatContext: () => ({
        showWelcomeScreen: true,
        minimized: false,
        currentSession: { title: "Saved conversation" },
        chatWindows: { enabled: framed },
      }),
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
  view.render(React.createElement(ChatWindow, framed ? { framed: true } : {}));
  return view;
}

for (const enabled of [false, true]) {
  test(`desktop chat uses the shared floating shadow only with the flag: ${enabled}`, () => {
    const view = windowView({ enabled });
    try {
      const panel = view.container.querySelector(".chatwindow");
      assert.ok(panel.classList.contains("shadow-floating") === enabled);
      if (enabled) {
        assert.equal(panel.style.boxShadow, "");
      } else {
        assert.match(panel.style.boxShadow, /75px 45px rgb\(0 0 0 \/ 0\.5\)/);
      }
    } finally { view.close(); }
  });
}

test("phone chat sheet keeps no shadow with the flag on", () => {
  const view = windowView({ mobile: true });
  try {
    const panel = view.container.querySelector(".chatwindow");
    assert.equal(panel.classList.contains("shadow-floating"), false);
    assert.equal(panel.style.boxShadow, "");
  } finally { view.close(); }
});

test("a framed chat window keeps no shadow", () => {
  const view = windowView({ framed: true });
  try {
    const panel = view.container.querySelector(".chatwindow");
    assert.equal(panel.classList.contains("shadow-floating"), false);
    assert.equal(panel.style.boxShadow, "");
  } finally { view.close(); }
});

test("the shared shadow is a bugfix that ships to Everyone and rolls back", () => {
  const definition = loader()("src/lib/flags/definitions/htpr-8055-floating-elevation.ts").default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
