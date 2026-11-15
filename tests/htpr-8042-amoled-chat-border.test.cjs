const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const retiredSwitch = "htpr-8042-amoled-chat-border";

function windowView({ multiChat = false, mobile = false, minimized = false } = {}) {
  const load = loader({
    "@/lib/flags/definitions/htpr-7766-chat-shortcuts": { HTPR_7766_CHAT_SHORTCUTS_FLAG: "htpr-7766-chat-shortcuts" },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/hooks/useFlag": { useFlag: key => key === retiredSwitch ? false : key === "htpr-8334-multi-chat-windows" && multiChat },
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

test("desktop outline stays on without its retired switch", () => {
  const view = windowView();
  try {
    const panel = view.container.querySelector(".chatwindow");
    assert.ok(panel);
    assert.ok(panel.classList.contains("[outline:var(--outline-floating-panel)]"));
    assert.ok(panel.classList.contains("[outline-offset:var(--offset-floating-panel-outline)]"));
    assert.ok(panel.classList.contains("[--bs-border-radius:var(--radius-chat-window)]"));
    assert.ok(panel.classList.contains("h-[70svh]"));
    assert.ok(panel.classList.contains("w-[30vw]"));
    assert.equal(view.container.querySelector("header").textContent, "Saved conversation");
    assert.ok(view.container.querySelector('[aria-label="Message"]'));
  } finally { view.close(); }
});

test("desktop multi-chat uses a 4px control radius and keeps the outline", () => {
  const view = windowView({ multiChat: true });
  try {
    const panel = view.container.querySelector(".chatwindow");
    assert.equal(panel.classList.contains("[--bs-border-radius:4px]"), true);
    assert.equal(panel.classList.contains("[--bs-border-radius:var(--radius-chat-window)]"), false);
    assert.equal(panel.classList.contains("[outline:var(--outline-floating-panel)]"), true);
  } finally { view.close(); }
});

test("phone content keeps its sizing; the surrounding sheet owns its outline", () => {
  const view = windowView({ mobile: true });
  try {
    const panel = view.container.querySelector(".chatwindow");
    assert.equal(panel.classList.contains("[--bs-border-radius:4px]"), false);
    assert.ok(panel.classList.contains("rounded-none"));
    assert.ok(panel.classList.contains("h-full"));
    assert.equal(panel.classList.contains("[outline:var(--outline-floating-panel)]"), false);
  } finally { view.close(); }
});

test("phone multi-chat leaves the desktop control radius off", () => {
  const view = windowView({ mobile: true, multiChat: true });
  try {
    const panel = view.container.querySelector(".chatwindow");
    assert.equal(panel.classList.contains("[--bs-border-radius:4px]"), false);
    assert.equal(panel.classList.contains("[--bs-border-radius:var(--radius-chat-window)]"), false);
  } finally { view.close(); }
});

test("minimized conversation remains available", () => {
  const view = windowView({ minimized: true });
  try {
    assert.equal(view.container.querySelector(".chatwindow"), null);
    assert.match(view.container.querySelector("button").textContent, /Saved conversation/);
  } finally { view.close(); }
});
