const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const SIDEBAR_FLAG = "htpr-7518-agent-sidebar-chats";
const LINKED_AGENT = "agent-two";
const FIRST_BOARD = 7049;
const RESOLVED_BOARD = 7050;
const noop = () => {};
const roster = [
  { id: "agent-one", displayName: "Runner", runtimeType: "EXTERNAL" },
  { id: LINKED_AGENT, displayName: "Linked runner", runtimeType: "EXTERNAL" },
];

function sidebarUnderTest(state) {
  const seen = { header: null, posts: [] };
  const source = loader({
    "react-hot-toast": { default: { error: noop } },
    "@/hooks/useFlag": { useFlag: () => state.enabled },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/lib/flags/keys": { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: SIDEBAR_FLAG },
    "@/app/agents/chat/AgentChatClient": { default: () => null },
    "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: noop },
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => null, setNativeSidebarChat: noop },
    "@/utils/api/ai_chat/aiChatHelpers": { AI_Chat_API: {} },
    "@/store": { currentProjectAtom: "project", currentUserAtom: "user", aiChatSidebarWidthPxAtom: "width" },
    "next/navigation": { useSearchParams: () => new URLSearchParams(state.searchParams) },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "@/lib/state": {
      useRecoilValue: (atom) => atom === "project" ? state.project : state.user,
      useRecoilState: () => [320],
    },
    "./MessageList": { MessageList: () => null },
    "./WelcomeScreen": { WelcomeScreen: () => null },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": {
      useAiChatContext: () => ({
        currentSession: { id: "general", agentId: null }, fileItems: [], resetFiles: noop, selectSession: noop,
        editor: { getHTML: () => "", getText: () => "" }, showGeneralChat: async () => {}, startNewSession: async () => {},
      }),
    },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "./ChatHeader": { ChatHeader: (props) => { seen.header = props.sidebarChats; return null; } },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
    "./AiChatSidebarResizeHandle": { AiChatSidebarResizeHandle: () => null },
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 280 },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.flat().filter(Boolean).join(" ") },
  });
  return { Sidebar: source("src/components/AI_CHAT/AI_Chat_Sidebar.tsx").AI_Chat_Sidebar, seen };
}

async function sidebarSession(state) {
  const view = mount();
  const { Sidebar, seen } = sidebarUnderTest(state);
  const originalFetch = global.fetch;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
  global.fetch = async (url, options) => {
    if (options?.method === "POST") {
      seen.posts.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ success: true, session: { id: `session-${JSON.parse(options.body).agentId}` } }) };
    }
    if (state.holdRoster) return new Promise(() => {});
    return { ok: true, json: async () => ({ success: true, agents: roster }) };
  };
  const render = async () => {
    await React.act(async () => { view.render(React.createElement(Sidebar)); });
    await flush();
  };
  return {
    seen,
    render,
    loadedBoard: () => seen.header?.target,
    close() { global.fetch = originalFetch; view.close(); },
  };
}

test("the sidebar load keeps a deep-linked agent chat selected on a cold page load", async () => {
  const state = {
    enabled: true, project: { id: FIRST_BOARD }, user: { id: 985 },
    searchParams: { sidebarAgent: LINKED_AGENT }, holdRoster: false,
  };
  const session = await sidebarSession(state);
  try {
    await session.render();
    assert.equal(session.loadedBoard().kind, "external-agent", "the link selects the named agent once the roster arrives");
    assert.equal(session.loadedBoard().agent.id, LINKED_AGENT);
    assert.deepEqual(session.seen.posts.map((body) => body.agentId), [LINKED_AGENT]);

    state.project = { id: RESOLVED_BOARD };
    state.holdRoster = true;
    await session.render();

    assert.equal(session.loadedBoard().kind, "external-agent", "the sidebar load must not fall back to the plain AI chat");
    assert.equal(session.loadedBoard().agent.id, LINKED_AGENT);
  } finally { session.close(); }
});

test("opening the sidebar without a link still shows the plain AI chat", async () => {
  const state = {
    enabled: true, project: { id: FIRST_BOARD }, user: { id: 985 },
    searchParams: {}, holdRoster: false,
  };
  const session = await sidebarSession(state);
  try {
    await session.render();
    assert.equal(session.loadedBoard().kind, "ai");
    state.project = { id: RESOLVED_BOARD };
    state.holdRoster = true;
    await session.render();
    assert.equal(session.loadedBoard().kind, "ai");
    assert.deepEqual(session.seen.posts, []);
  } finally { session.close(); }
});
