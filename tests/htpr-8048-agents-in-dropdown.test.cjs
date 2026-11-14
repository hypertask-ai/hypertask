const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const AGENT_FLAG = "htpr-8048-agent-sessions";
const MENUS_FLAG = "htpr-8956-ai-chat-header-menus";
const day = 24 * 60 * 60 * 1000;
const stamp = (offset) => new Date(Date.now() - offset).toISOString();
const noop = () => {};
const createRootLazy = (element) => require("react-dom/client").createRoot(element);

function makeAgents() {
  return ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((displayName, index) => ({
    id: `agent-${index}`,
    displayName,
    photoURL: null,
    runtimeType: "NATIVE",
    sessionId: null,
    status: null,
    deliveryMode: null,
    hasMoreSessions: index === 4,
    sessions: index === 3 ? [] : [{ id: `session-${index}`, title: `${displayName} planning`, createdAt: stamp(index * day), updatedAt: stamp(index * day) }],
  }));
}

async function mount({ agentFlag = true, menusFlag = true, mobile = false, target = { kind: "ai" } } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/chat" });
  const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  const chats = [["Today chat", 0], ["Old chat", 30 * day]].map(([title, offset], index) => ({ id: `chat-${index}`, title, createdAt: stamp(offset), updatedAt: stamp(offset) }));
  const agentSession = target.kind === "native-agent" ? { id: "session-0", title: "Alpha planning", createdAt: stamp(0), updatedAt: stamp(0) } : undefined;
  const state = { sessions: chats, currentSession: agentSession ?? chats[0], currentAiOption: {}, isSidebarMode: true, selectSession: noop, togglePopover: noop, minimizeChat: noop, runningSessionIds: [] };
  const calls = { started: [], selected: [], more: [] };
  const flags = { [AGENT_FLAG]: agentFlag, [MENUS_FLAG]: menusFlag };
  const { ChatHeader } = loadModule("src/components/AI_CHAT/ChatHeader.tsx", {
    react: React,
    "next/navigation": { usePathname: () => "/chat", useRouter: () => ({ push: noop }), useSearchParams: () => new URLSearchParams() },
    "@/hooks/useFlag": { useFlag: (key) => flags[key] ?? false },
    "@/hooks/General/useAiChatOpenPreferences": { useAiChatOpenPreferences: () => ({ enabled: false, values: {}, setPreference: noop }) },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => state },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px]" },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: () => ({}), minimize_button: () => ({}), toggle_sidebar_button: () => ({ text: "Sidebar" }), rename_chat_button: { text: "Rename chat" }, delete_chat_button: { text: "Delete chat" } } } } },
    "@/lib/aiChatDisplayMode": { buildFullScreenChatPath: () => "/chat" },
    "@/lib/aiModelOptions": { getMobileAiChatModelLabel: () => "AI" },
    "@/lib/state": { useRecoilState: () => [false, noop] },
    "@/store": {},
    "react-hot-toast": { __esModule: true, default: { error: noop } },
    "../Common/Tooltip": { __esModule: true, default: () => null },
    "./AgentSidebarChatCommands": { AgentSidebarChatCommands: () => null },
  });
  const container = document.getElementById("root");
  const renderer = createRootLazy(container);
  const agents = makeAgents();
  const sidebarChats = {
    projectId: 15,
    target: target.kind === "ai" ? target : { ...target, agent: agents[0] },
    agents,
    error: null,
    onSelect: noop,
    onSelectSession: noop,
    onRetry: noop,
    onSelectAgentSession: (agent, id) => calls.selected.push([agent.id, id]),
    onStartAgentSession: (agent) => calls.started.push(agent.id),
    onLoadMoreAgentSessions: (agent) => calls.more.push(agent.id),
  };
  await React.act(async () => renderer.render(React.createElement(ChatHeader, { sidebarChats })));
  const cleanup = async () => {
    await React.act(async () => renderer.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  };
  const click = (el) => React.act(async () => el.click());
  const openHistory = () => click(container.querySelector('[aria-label="Chat history"]'));
  const key = (el, name) => React.act(async () => { el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  const type = (el, value) => React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  return { container, calls, cleanup, click, openHistory, key, type, dom };
}

const agentRows = (container) => [...container.querySelectorAll("[data-agent-id]")].map((el) => el.textContent);

test("title dropdown shows the 3 most recent agents and an All N agents row above history", async () => {
  const { container, openHistory, click, cleanup } = await mount();
  try {
    await openHistory();
    const menu = container.querySelector("#ai-chat-session-history");
    assert.deepEqual(agentRows(container), ["Alpha", "Bravo", "Charlie"]);
    assert.ok(menu.querySelector('[data-testid="ai-chat-agents-section"]').compareDocumentPosition(menu.querySelector("[data-chat-session-id]")) & 4, "agents come before history rows");
    const all = [...menu.querySelectorAll("button")].find((el) => el.textContent === "All 5 agents");
    assert.ok(all);
    await click(all);
    assert.equal(agentRows(container).length, 5);
    assert.ok(agentRows(container).includes("Echo"));
  } finally {
    await cleanup();
  }
});

test("the separate Bot button is gone on desktop with both flags", async () => {
  const { container, cleanup } = await mount();
  try {
    assert.equal(container.querySelector('[aria-label="Agent sessions"]'), null);
  } finally {
    await cleanup();
  }
});

test("desktop with only the agent flag keeps the Bot button, and mobile keeps it too", async () => {
  const agentOnly = await mount({ menusFlag: false });
  try {
    assert.ok(agentOnly.container.querySelector('[aria-label="Agent sessions"]'));
  } finally {
    await agentOnly.cleanup();
  }
  const phone = await mount({ mobile: true });
  try {
    assert.ok(phone.container.querySelector('[aria-label="Agent sessions"]'));
  } finally {
    await phone.cleanup();
  }
});

test("flag off: no Agents section in the dropdown", async () => {
  const { container, openHistory, cleanup } = await mount({ agentFlag: false });
  try {
    await openHistory();
    assert.equal(container.querySelector('[data-testid="ai-chat-agents-section"]'), null);
  } finally {
    await cleanup();
  }
});

test("search filters agents and chats together", async () => {
  const { container, openHistory, type, cleanup } = await mount();
  try {
    await openHistory();
    await type(container.querySelector('input[aria-label="Search chats"]'), "echo");
    assert.deepEqual(agentRows(container), ["Echo"]);
    assert.equal(container.textContent.includes("All 5 agents"), false);
    await type(container.querySelector('input[aria-label="Search chats"]'), "zzz");
    assert.deepEqual(agentRows(container), []);
    assert.ok(container.textContent.includes("No chats found"));
  } finally {
    await cleanup();
  }
});

test("opening an agent swaps the list in place with back, New session and past sessions", async () => {
  const { container, calls, openHistory, click, key, cleanup } = await mount();
  try {
    await openHistory();
    await click([...container.querySelectorAll("button")].find((el) => el.textContent === "All 5 agents"));
    await click(container.querySelector('[data-agent-id="agent-4"]'));
    const view = container.querySelector('[data-testid="ai-chat-agent-view"]');
    assert.ok(view);
    assert.equal(container.querySelector('[data-testid="ai-chat-agents-section"]'), null);
    assert.equal(container.querySelector('input[aria-label="Search chats"]'), null);
    const labels = [...view.querySelectorAll("button")].map((el) => el.textContent);
    assert.ok(labels[0].includes("Echo"));
    assert.ok(labels[1].startsWith("New session"));
    assert.ok(labels.includes("Echo planning"));
    assert.ok(labels.includes("Show more"));
    await click([...view.querySelectorAll("button")].find((el) => el.textContent === "Show more"));
    assert.deepEqual(calls.more, ["agent-4"]);
    await key(view, "ArrowLeft");
    assert.ok(container.querySelector('[data-testid="ai-chat-agents-section"]'));
    await click(container.querySelector('[data-agent-id="agent-4"]'));
    await key(container.querySelector('[data-testid="ai-chat-agent-view"]'), "Enter");
    assert.deepEqual(calls.started, ["agent-4"]);
    assert.equal(container.querySelector("#ai-chat-session-history"), null);
  } finally {
    await cleanup();
  }
});

test("Escape in the agent view goes back first, then closes the dropdown", async () => {
  const { container, openHistory, click, key, dom, cleanup } = await mount();
  try {
    await openHistory();
    await click(container.querySelector('[data-agent-id="agent-1"]'));
    await key(dom.window.document, "Escape");
    assert.equal(container.querySelector('[data-testid="ai-chat-agent-view"]'), null);
    assert.ok(container.querySelector("#ai-chat-session-history"));
    await key(dom.window.document, "Escape");
    assert.equal(container.querySelector("#ai-chat-session-history"), null);
  } finally {
    await cleanup();
  }
});

test("picking a past agent session resumes it", async () => {
  const { container, calls, openHistory, click, cleanup } = await mount();
  try {
    await openHistory();
    await click(container.querySelector('[data-agent-id="agent-1"]'));
    await click(container.querySelector('[data-chat-session-id="session-1"]'));
    assert.deepEqual(calls.selected, [["agent-1", "session-1"]]);
  } finally {
    await cleanup();
  }
});

test("history lists agent sessions with the grey agent name", async () => {
  const { container, openHistory, cleanup } = await mount();
  try {
    await openHistory();
    const row = container.querySelector('#ai-chat-session-history [data-chat-session-id="session-2"]');
    assert.ok(row);
    assert.ok(row.querySelector("span.text-icon-dark-gray").textContent === "Charlie");
  } finally {
    await cleanup();
  }
});

test("talking to an agent: the title pill shows the Bot icon, the agent name and the session", async () => {
  const { container, cleanup } = await mount({ target: { kind: "native-agent" } });
  try {
    const title = container.querySelector('[aria-label="Chat history"]');
    assert.ok(title.querySelector("svg.lucide-bot"));
    assert.ok(title.textContent.includes("Alpha"));
    assert.equal(title.querySelector('[data-testid="ai-chat-agent-session-title"]').textContent, "Alpha planning");
  } finally {
    await cleanup();
  }
});

test("MentionList: Agents group moves first behind the flag, order untouched otherwise", () => {
  const { moveAgentMentionsFirst } = loadModule("src/components/RTE/mentionNavigation.ts");
  const items = [
    { type: "projectHeading" }, { type: "project", id: 1 },
    { type: "taskHeading" }, { type: "task", id: 2 },
    { type: "agentHeading" }, { type: "agent", id: 3 },
    { type: "peopleHeading" }, { type: "name", id: 4 },
  ];
  assert.deepEqual(moveAgentMentionsFirst(items).map((item) => item.type), ["agentHeading", "agent", "projectHeading", "project", "taskHeading", "task", "peopleHeading", "name"]);
  const noAgents = items.filter((item) => item.type !== "agent");
  assert.deepEqual(moveAgentMentionsFirst(noAgents), noAgents);
  const alreadyFirst = items.slice(4);
  assert.deepEqual(moveAgentMentionsFirst(alreadyFirst), alreadyFirst);
});

async function mentionList({ agentFlag }) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/chat" });
  const globals = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
  dom.window.matchMedia = () => ({ matches: false });
  const rendered = [];
  const { default: MentionList } = loadModule("src/components/RTE/Components/AI_Chat/MentionList.tsx", {
    react: React,
    "@/hooks/useFlag": { useFlag: (key) => key === AGENT_FLAG && agentFlag },
    "@/components/AI_CHAT/MentionListComp": { MentionListRows: (props) => { rendered.push(props.items.map((item) => item.type)); return null; } },
    "@/lib/state": { useRecoilState: () => [false, noop] },
    "@/store": { showMentionListAtom: Symbol("mention") },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { aiMentionList: "ai-mention-list" }, generalConfig: {} },
  });
  const ref = React.createRef();
  const commands = [];
  const callbacks = [];
  const items = [
    { type: "taskHeading" }, { type: "task", id: 2, name: "Task", ticketNumber: "T-1", project_id: 1, index: 1 },
    { type: "agentHeading" }, { type: "agent", id: "agent-1", name: "Alpha" },
  ];
  const renderer = createRootLazy(document.getElementById("root"));
  await React.act(async () => renderer.render(React.createElement(MentionList, { ref, items, command: (data) => commands.push(data), contextCallback: (item) => callbacks.push(item) })));
  const cleanup = async () => {
    await React.act(async () => renderer.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  };
  return { ref, commands, callbacks, rendered, cleanup };
}

function fakeKeyEvent(key) {
  const event = { key, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  return event;
}

test("MentionList: Enter on an agent selects it and stops the key reaching the send handler", async () => {
  const { ref, commands, callbacks, rendered, cleanup } = await mentionList({ agentFlag: true });
  try {
    assert.deepEqual(rendered.at(-1), ["agentHeading", "agent", "taskHeading", "task"]);
    const event = fakeKeyEvent("Enter");
    let handled;
    await React.act(async () => { handled = ref.current.onKeyDown({ event }); });
    assert.equal(handled, true);
    assert.equal(event.stopped, true);
    assert.equal(event.prevented, true);
    assert.deepEqual(commands, [{ id: "agent-1", text: "Alpha", label: "agent" }]);
    assert.equal(callbacks[0].id, "agent-1");
  } finally {
    await cleanup();
  }
});

test("MentionList: flag off keeps the server order and does not touch the key event", async () => {
  const { ref, commands, rendered, cleanup } = await mentionList({ agentFlag: false });
  try {
    assert.deepEqual(rendered.at(-1), ["taskHeading", "task", "agentHeading", "agent"]);
    const event = fakeKeyEvent("Enter");
    await React.act(async () => { ref.current.onKeyDown({ event }); });
    assert.equal(event.stopped, false);
    assert.equal(commands[0].label, "task");
  } finally {
    await cleanup();
  }
});

function placeholderFor(attribute, agentFlag = true) {
  const chain = () => ({ configure: () => ({}), extend: () => ({}), create: () => ({}) });
  const captured = {};
  const stubs = {
    react: { useRef: (initial) => ({ current: initial }), useContext: () => false, useEffect: noop },
    "next/navigation": { usePathname: () => "/project" },
    "@/hooks/useFlag": { useFlag: (key) => key === AGENT_FLAG && agentFlag },
    "@/lib/flags/keys": { HTPR_6906_AUTOCAP_UNDO_FLAG: "a", LOCAL_WRITING_ASSISTANCE_FLAG: "b" },
    "@/lib/flags/definitions/htpr-5908-retype-lowercase": { HTPR_5908_RETYPE_LOWERCASE_FLAG: "c" },
    "@/lib/flags/definitions/htpr-8263-full-screen-chat-cleanup": { HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG: "d" },
    "@/lib/flags/definitions/htpr-8824-ai-chat-one-composer": { HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG: "e" },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/components/RTE/Components/AI_Chat/MentionData": { createMentionData: () => ({}) },
    "@/components/RTE/Extensions/LinkableMention": { LinkableMention: chain() },
    "@/components/RTE/Extensions/SlashCommands/SlashCommands": { __esModule: true, default: () => ({}) },
    "@/components/RTE/writingAssistance": { writingAssistanceEditorProps: {}, LocalWritingAssistance: chain() },
    "@/components/RTE/Extensions/SafeSplitBlock": { SafeSplitBlock: {} },
    "@/styles/tiptap.module.scss": { __esModule: true, default: {} },
    "@tiptap/extension-highlight": { __esModule: true, default: chain() },
    "@tiptap/extension-ordered-list": { __esModule: true, default: chain() },
    "@tiptap/extension-task-item": { __esModule: true, default: chain() },
    "@tiptap/extension-task-list": { __esModule: true, default: chain() },
    "@tiptap/extension-underline": { __esModule: true, default: chain() },
    "@tiptap/extension-gapcursor": { __esModule: true, default: {} },
    "@tiptap/starter-kit": { __esModule: true, default: chain() },
    "@tiptap/extension-placeholder": { __esModule: true, default: { configure: (options) => { captured.placeholder = options.placeholder; return {}; } } },
    "@tiptap/react": { Extension: chain(), useEditor: () => ({ isDestroyed: false, state: { tr: {} }, view: { dispatch: noop } }) },
  };
  const { default: useTiptapForAI } = loadModule("src/hooks/MultiPages/AIChat/useAiTiptap.ts", stubs);
  useTiptapForAI({ contextCallback: noop, listening: false });
  const editor = { view: { dom: { closest: (selector) => (selector === "[data-sidebar-agent]" && attribute ? { getAttribute: () => attribute } : null) } } };
  return captured.placeholder({ editor });
}

test("arrow keys move the active agent row and Enter opens it", async () => {
  const { container, openHistory, key, cleanup } = await mount();
  try {
    await openHistory();
    const menu = container.querySelector("#ai-chat-session-history");
    const search = container.querySelector('input[aria-label="Search chats"]');
    await key(search, "ArrowDown");
    assert.equal(container.querySelector('[data-agent-id="agent-0"]').getAttribute("aria-selected"), "true");
    await key(menu, "ArrowDown");
    assert.equal(container.querySelector('[data-agent-id="agent-1"]').getAttribute("aria-selected"), "true");
    await key(menu, "Enter");
    assert.ok(container.querySelector('[data-testid="ai-chat-agent-view"]'));
  } finally {
    await cleanup();
  }
});

test("native agent chat reads Message <agent>; without an agent the default placeholder stays", () => {
  assert.equal(placeholderFor("Alpha"), "Message Alpha");
  assert.equal(placeholderFor(null), "Focus with CTRL + Q, @ for context");
  assert.equal(placeholderFor("Alpha", false), "Focus with CTRL + Q, @ for context");
});
