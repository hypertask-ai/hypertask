const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const noop = () => {};

function pane() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai/agents/chat" });
  const previous = new Map(["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, { exists: Object.hasOwn(global, key), value: global[key] }]));
  Object.assign(global, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true });
  const { AgentChatPane } = load("src/app/agents/chat/AgentChatPane.tsx", {
    "lucide-react": { ArrowLeft: () => null, ChevronLeft: () => null, ChevronRight: () => null, Info: () => null },
    "@/components/Agents/AgentAvatar": { default: () => null },
    "@/components/AI_CHAT/AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
    "@/components/AI_CHAT/TypingIndicator": { TypingIndicator: () => null },
    "@/components/RTE/Components/AudioButton": { AudioButton: () => null },
    "@/lib/configs/general.config": { MOBILE_TARGET: "" },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "./AgentChatFeedItems": { chatStatusText: () => "offline", emptyFeedText: () => "No messages" },
  });
  const container = document.getElementById("root");
  const root = createRoot(container);
  return {
    container,
    render: (element) => React.act(() => root.render(element)),
    close() {
      React.act(() => root.unmount());
      dom.window.close();
      for (const [key, entry] of previous) {
        if (entry.exists) Object.defineProperty(global, key, { value: entry.value, configurable: true, writable: true });
        else delete global[key];
      }
    },
    AgentChatPane,
  };
}

function backButton(container) {
  return [...container.querySelectorAll("button")].find((node) => node.textContent.trim() === "Back to agents") ?? null;
}

test("empty standalone agent chat offers Back to agents and returns to the roster", () => {
  const view = pane();
  let returned = 0;
  try {
    view.render(React.createElement(view.AgentChatPane, {
      embedded: false, selectedAgent: null, backToRoster: () => { returned += 1; },
      setIsRecording: noop, setIsDictationProcessing: noop,
    }));
    const button = backButton(view.container);
    assert.ok(button, "the empty selection must show a visible Back to agents control");
    assert.match(view.container.textContent, /Select an agent to start chatting/);
    React.act(() => button.click());
    assert.equal(returned, 1);
  } finally { view.close(); }
});

test("empty embedded agent chat keeps the board sidebar and hides Back to agents", () => {
  const view = pane();
  try {
    view.render(React.createElement(view.AgentChatPane, {
      embedded: true, selectedAgent: null, backToRoster: noop,
      setIsRecording: noop, setIsDictationProcessing: noop,
    }));
    assert.equal(backButton(view.container), null);
    assert.match(view.container.textContent, /Select an agent to start chatting/);
  } finally { view.close(); }
});
