const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const FLAG = "htpr-7737-agent-hover-chat";
const SIDEBAR = "htpr-7518-agent-sidebar-chats";
const noop = () => {};
const agent = { kind: "agent", id: "agent-one", displayName: "Runner", runtimeType: "EXTERNAL", sessionId: "agent-session" };

test("hover chat is reversible and preserves profile links, human contacts and loading/error states", async () => {
  const view = mount();
  let enabled = true, sidebarEnabled = true;
  let query = { data: agent };
  const writes = [], navigations = [], events = [], closed = [];
  const pass = ({ children }) => children;
  const floating = {
    useFloating: () => ({ refs: { setFloating: noop }, context: {}, floatingStyles: {} }),
    useInteractions: () => ({ getFloatingProps: value => value }),
    FloatingFocusManager: pass, FloatingPortal: pass,
  };
  for (const key of ["autoUpdate", "flip", "offset", "safePolygon", "shift", "useDismiss", "useFocus", "useHover", "useRole"]) floating[key] = noop;
  const source = loader({
    "@/components/Common/UserAvatar": { default: () => null },
    "./TooltipPortal": { default: pass },
    "@/hooks/MultiPages/usePersonHovercard": { usePersonHovercard: () => query },
    "next/link": { default: "a" },
    "next/navigation": { usePathname: () => "/detail/project-7049/42", useRouter: () => ({ replace: (...args) => navigations.push(args) }) },
    "@/hooks/useFlag": { useFlag: key => key === FLAG ? enabled : key === SIDEBAR && sidebarEnabled },
    "@/lib/flags/keys": { HTPR_6950_TOOLTIP_TOP_LAYER_FLAG: "top-layer", HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: SIDEBAR },
    "@/lib/state": { useSetRecoilState: atom => value => writes.push([atom, value]) },
    "@/store": { isAiChatSidebarModeAtom: "sidebar", aiChatAutoOpenSuppressedAtom: "suppressed", aiChatExplicitOpenAtAtom: "explicit", showAIChatInterfaceAtom: "open" },
    "@floating-ui/react": floating,
  });
  const Surface = source("src/components/Common/PersonHovercard.tsx").PersonHovercardSurface;
  const render = () => view.render(React.createElement(Surface, { projectId: 7049, externallyOpen: true, onExternallyOpenChange: value => closed.push(value) }));
  const select = event => events.push(event.detail);
  window.addEventListener("ht-sidebar-agent-selected", select);
  const oldCustomEvent = global.CustomEvent;
  global.CustomEvent = window.CustomEvent;
  try {
    window.history.replaceState(null, "", "/detail/project-7049/42?inboxFlow=true");
    render();
    assert.equal(view.container.querySelector('a').getAttribute("href"), "/agents/agent-one");
    assert.equal(view.container.querySelector('button').textContent, "Chat");
    await React.act(async () => view.container.querySelector('button').click());
    assert.deepEqual(navigations, [["/detail/project-7049/42?inboxFlow=true&agentSidebar=1&sidebarAgent=agent-one", { scroll: false }]]);
    assert.deepEqual(events, [{ agentId: "agent-one" }]);
    assert.deepEqual(writes.filter(([key]) => key !== "explicit"), [["sidebar", true], ["suppressed", false], ["open", true]]);
    assert.ok(writes.find(([key, value]) => key === "explicit" && value > 0));
    assert.deepEqual(closed, [false]);
    enabled = false; render();
    assert.equal(view.container.querySelector('button'), null);
    assert.equal(view.container.querySelector('a').getAttribute("href"), "/agents/agent-one");
    enabled = true; sidebarEnabled = false; render();
    assert.equal(view.container.querySelector('button'), null);
    sidebarEnabled = true;
    query = { data: { kind: "user", id: 985, displayName: "Human", email: "qa@example.test" } }; render();
    assert.equal(view.container.querySelector('a'), null);
    assert.equal(view.container.querySelector('button').getAttribute("aria-label"), "Copy qa@example.test");
    assert.doesNotMatch(view.container.textContent, /Chat/);
    query = { isFetching: true }; render();
    assert.equal(view.container.querySelector('button'), null);
    query = { isError: true }; render();
    assert.match(view.container.textContent, /Contact details unavailable/);
    assert.equal(view.container.querySelector('button'), null);
  } finally { global.CustomEvent = oldCustomEvent; view.close(); }
});

for (const sessions of [false, true]) test(`existing sidebar dispatch selects repeated agent requests, sessions ${sessions}`, async () => {
  const view = mount();
  const originalFetch = global.fetch;
  const project = { id: 7049 }, user = { id: 985 };
  let header;
  const opened = [];
  const chat = { currentSession: { id: "general", agentId: null }, fileItems: [], resetFiles: noop, selectSession: noop, startNewSession: assert.fail };
  const source = loader({
    "react-hot-toast": { default: { error: assert.fail } },
    "@/hooks/useFlag": { useFlag: key => [FLAG, SIDEBAR, ...(sessions ? ["htpr-8048-agent-sessions"] : [])].includes(key) },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/lib/flags/keys": { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: SIDEBAR },
    "@/app/agents/chat/AgentChatClient": { default: () => null },
    "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: noop },
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => null, setNativeSidebarChat: noop },
    "@/utils/api/ai_chat/aiChatHelpers": { AI_Chat_API: {} },
    "@/store": { currentProjectAtom: "project", currentUserAtom: "user", aiChatSidebarWidthPxAtom: "width" },
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "@/lib/state": { useRecoilValue: atom => atom === "project" ? project : user, useRecoilState: () => [320] },
    "./MessageList": { MessageList: () => null }, "./WelcomeScreen": { WelcomeScreen: () => null },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => chat },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "./ChatHeader": { ChatHeader: props => { header = props.sidebarChats; return null; } },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
    "./AiChatSidebarResizeHandle": { AiChatSidebarResizeHandle: () => null },
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 280 },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.flat().filter(Boolean).join(" ") },
  });
  global.fetch = async (_url, options) => {
    if (options?.method === "POST") opened.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ success: true, agents: [agent], session: { id: "agent-session" } }) };
  };
  try {
    const Sidebar = source("src/components/AI_CHAT/AI_Chat_Sidebar.tsx").AI_Chat_Sidebar;
    await React.act(async () => view.render(React.createElement(Sidebar)));
    const select = async () => React.act(async () => window.dispatchEvent(new window.CustomEvent("ht-sidebar-agent-selected", { detail: { agentId: agent.id } })));
    await select();
    assert.equal(header.target.kind, "external-agent");
    assert.equal(header.target.agent.id, agent.id);
    await React.act(async () => header.onSelect({ kind: "ai" }));
    assert.equal(header.target.kind, "ai");
    await select();
    assert.equal(header.target.agent.id, agent.id);
    await React.act(async () => window.dispatchEvent(new window.CustomEvent("ht-sidebar-agent-selected", { detail: { agentId: "not-in-roster" } })));
    assert.equal(header.target.agent.id, agent.id);
    assert.equal(opened.length, sessions ? 2 : 0);
    if (sessions) assert.deepEqual(opened[0], { projectId: 7049, agentId: agent.id });
  } finally { view.close(); global.fetch = originalFetch; }
});
