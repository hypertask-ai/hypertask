const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule, findElement } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const noop = () => {};
const availability = loadModule("src/lib/agents/chatAvailability.ts");

test("delivery mode reads as Online or Reads when it next runs, never the internal token", () => {
  assert.equal(availability.agentChatStatusLabel("webhook"), "Online");
  assert.equal(availability.agentChatStatusLabel("polling"), "Online");
  assert.equal(availability.agentChatStatusLabel(null), "Reads when it next runs");
  assert.equal(availability.chatStatusText({ displayName: "Quiet" }, "polling"), "Online");
  assert.equal(availability.chatStatusText({ displayName: "Quiet" }, null), "Reads when it next runs");
  const busy = {
    displayName: "Busy runner",
    working: { ticket: "HTPR-1", expiresAt: new Date(Date.now() + 60_000).toISOString() },
  };
  assert.equal(availability.chatStatusText(busy, "webhook"), "Working on HTPR-1");
});

const agents = [
  { id: "webhook", displayName: "Instant runner", status: "connected", deliveryMode: "webhook", runtimeType: "EXTERNAL" },
  { id: "polling", displayName: "Heartbeat runner", status: "connected", deliveryMode: "polling", runtimeType: "EXTERNAL" },
  { id: "quiet", displayName: "Quiet runner", status: null, deliveryMode: null, runtimeType: "EXTERNAL" },
];

function rowNames(enabled) {
  const react = {
    useContext: () => false, useEffect: noop, useMemo: (callback) => callback(),
    useRef: (current) => ({ current }),
    useState: (initial) => [initial, noop],
  };
  const { AgentSidebarChatCommands } = loadModule("src/components/AI_CHAT/AgentSidebarChatCommands.tsx", {
    react,
    "lucide-react": { Bot: () => null },
    "@/hooks/useFlag": { useFlag: (key) => key === "htpr-7688-past-chats-first" ? enabled : false },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ sessions: [], historySessions: [], sessionPagingEnabled: false, hasMoreSessions: false, runningSessionIds: [] }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/components/Modals/commands/HTC/CommandList": { default: "CommandList" },
    "@/components/Modals/commands/HTC/commandSelection": { findCommandPosition: noop },
    "@/models/enums": { CommandMode: { GoToAgentChat: 1 } },
  });
  const tree = AgentSidebarChatCommands({
    context: { target: { kind: "ai" }, agents, error: null, onSelect: noop, onSelectSession: noop, onRetry: noop },
    anchorRef: { current: null },
    onClose: noop,
  });
  return findElement(tree, "CommandList").props.commandLists.map((row) => row.name).filter((name) => name !== "AI chat");
}

for (const enabled of [true, false]) {
  test(`sidebar chat list rows show only Online or Reads when it next runs (past-chats-first ${enabled ? "on" : "off"})`, () => {
    const names = rowNames(enabled);
    assert.deepEqual(names, [
      "Instant runner · Online",
      "Heartbeat runner · Online",
      "Quiet runner · Reads when it next runs",
    ]);
    for (const name of names) assert.doesNotMatch(name, /webhook|polling|null|connected|offline/i);
  });
}

function renderPane(deliveryMode) {
  const { AgentChatPane } = loadModule("src/app/agents/chat/AgentChatPane.tsx", {
    "@/components/Agents/AgentAvatar": { default: () => null },
    "@/components/AI_CHAT/AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
    "@/components/AI_CHAT/TypingIndicator": { TypingIndicator: () => null },
    "@/components/RTE/Components/AudioButton": { AudioButton: () => null },
    "@/lib/configs/general.config": { MOBILE_TARGET: "" },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "lucide-react": { ArrowLeft: () => null, ChevronLeft: () => null, ChevronRight: () => null, Info: () => null },
    "@/hooks/useFlag": { useFlag: () => false },
    "./AgentChatFeedItems": {
      chatStatusText: availability.chatStatusText,
      emptyFeedText: () => "No messages",
      ActivityGroup: () => null, FeedFilter: () => null, MessageBubble: () => null, ScrollToBottomButton: () => null,
    },
  });
  return renderToStaticMarkup(React.createElement(AgentChatPane, {
    embedded: false, active: true, deliveryMode,
    selectedAgent: { id: "polling", displayName: "Heartbeat runner", photoURL: null, runtimeType: "EXTERNAL" },
    isExternal: true, isNarrow: false, mobileFullscreenChrome: false, detailsCollapsed: true,
    activityRowsEnabled: false, feedFilter: "all", isMbl: false, messages: [], visibleFeed: [],
    activeFeedFilter: "all", queuedMessages: [], mentionResults: [], mentionIndex: 0,
    reuseAiComposer: false, sending: false, sessionLoading: false, draft: "", mentionQuery: "",
  }));
}

for (const [mode, expected] of [["webhook", "Online"], ["polling", "Online"], [null, "Reads when it next runs"]]) {
  test(`agent chat header and hint say ${expected} when delivery mode is ${mode === null ? "none" : mode}`, () => {
    const text = renderPane(mode).replace(/<[^>]+>/g, " ");
    assert.match(text, new RegExp(expected));
    assert.doesNotMatch(text, /polling|webhook|Idle|runtime has not enabled chat/);
    assert.equal(text.match(new RegExp(expected, "g")).length, 2, "the header and the hint say it once each");
  });
}
