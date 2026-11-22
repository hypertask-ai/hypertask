const assert = require("node:assert/strict");
const test = require("node:test");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const SIDEBAR_FLAG = "htpr-7518-agent-sidebar-chats";
const SESSIONS_FLAG = "htpr-8048-agent-sessions";
const noop = () => {};
const project = { id: 7049 };
const linkedAgent = { id: "agent-linked", displayName: "Linked", photoURL: null, runtimeType: "EXTERNAL" };
const otherAgent = { ...linkedAgent, id: "agent-other", displayName: "Other" };
const otherRuntimeAgent = { ...linkedAgent, id: "agent-linked", displayName: "Linked", runtimeType: "NATIVE" };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createSidebar({ role, sessions, rosterGate, postGate }) {
  const state = { viewer: 985, header: null, posts: [], rosterReads: 0 };
  const agent = role === "NATIVE" ? otherRuntimeAgent : linkedAgent;
  const chat = {
    currentSession: { id: "general", agentId: null },
    fileItems: [],
    resetFiles: noop,
    selectSession: noop,
    startNewSession: async () => {},
    showGeneralChat: async () => {},
    editor: { getHTML: () => "", getText: () => "", commands: { setContent: noop } },
  };
  const source = loader({
    "react-hot-toast": { default: { error: noop } },
    "@/hooks/useFlag": { useFlag: (key) => key === SIDEBAR_FLAG || (sessions && key === SESSIONS_FLAG) },
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    "@/lib/flags/keys": { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: SIDEBAR_FLAG },
    "@/app/agents/chat/AgentChatClient": { default: () => null },
    "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: noop },
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => null, setNativeSidebarChat: noop },
    "@/utils/api/ai_chat/aiChatHelpers": { AI_Chat_API: { getSessionTranscript: async () => ({}) } },
    "@/store": { currentProjectAtom: "project", currentUserAtom: "user", aiChatSidebarWidthPxAtom: "width" },
    "next/navigation": { useSearchParams: () => new URLSearchParams({ sidebarAgent: linkedAgent.id }) },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "@/lib/state": { useRecoilValue: (atom) => atom === "project" ? project : { id: state.viewer }, useRecoilState: () => [320, noop] },
    "./MessageList": { MessageList: () => null },
    "./WelcomeScreen": { WelcomeScreen: () => null },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => chat },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "./ChatHeader": { ChatHeader: (props) => { state.header = props.sidebarChats; return null; } },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: () => null },
    "./AiChatSidebarResizeHandle": { AiChatSidebarResizeHandle: () => null },
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 280 },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.flat().filter(Boolean).join(" ") },
  });
  const fetch = async (url, options) => {
    if (options?.method === "POST") {
      state.posts.push(JSON.parse(options.body));
      if (postGate) await postGate.promise;
      return { ok: true, json: async () => ({ success: true, session: { id: "agent-session" } }) };
    }
    state.rosterReads += 1;
    if (rosterGate) await rosterGate.promise;
    return { ok: true, json: async () => ({ success: true, agents: [agent, otherAgent] }) };
  };
  return { state, agent, Sidebar: source("src/components/AI_CHAT/AI_Chat_Sidebar.tsx").AI_Chat_Sidebar, fetch };
}

function openSidebar({ role = "EXTERNAL", sessions = false, rosterGate, postGate } = {}) {
  const view = mount();
  const sidebar = createSidebar({ role, sessions, rosterGate, postGate });
  const originalFetch = global.fetch;
  global.fetch = sidebar.fetch;
  const render = () => React.act(async () => view.render(React.createElement(sidebar.Sidebar)));
  const setViewer = async (id) => {
    sidebar.state.viewer = id;
    await render();
  };
  return {
    ...sidebar,
    render,
    setViewer,
    close() {
      view.close();
      global.fetch = originalFetch;
    },
  };
}

function selectedAgentId(header) {
  return header.target.kind === "ai" ? null : header.target.agent.id;
}

test("a viewer reset after the roster lands still opens the linked agent", async () => {
  for (const sessions of [false, true]) {
    for (const role of ["EXTERNAL", "NATIVE"]) {
      const sidebar = openSidebar({ role, sessions });
      try {
        await sidebar.render();
        assert.equal(selectedAgentId(sidebar.state.header), sidebar.agent.id, "the cold load opens the linked agent");
        await sidebar.setViewer(986);
        assert.equal(selectedAgentId(sidebar.state.header), sidebar.agent.id, `${role} sidesteps the AI chat after the reset, sessions ${sessions}`);
        if (sessions) assert.deepEqual(sidebar.state.posts.at(-1), { projectId: 7049, agentId: sidebar.agent.id });
        else assert.deepEqual(sidebar.state.posts, []);
      } finally { sidebar.close(); }
    }
  }
});

test("a reset that lands while the linked agent is opening leaves it open", async () => {
  const postGate = deferred();
  const sidebar = openSidebar({ sessions: true, postGate });
  try {
    await sidebar.render();
    assert.equal(selectedAgentId(sidebar.state.header), null, "the open is still in flight");
    await sidebar.setViewer(986);
    postGate.resolve();
    await React.act(async () => {});
    assert.equal(selectedAgentId(sidebar.state.header), linkedAgent.id);
    assert.equal(sidebar.state.posts.length, 2, "the reset reopens the link instead of dropping it");
    assert.deepEqual(sidebar.state.posts.at(-1), { projectId: 7049, agentId: linkedAgent.id });
  } finally { sidebar.close(); }
});

test("ten cold loads of an agent link all open the named agent", async () => {
  for (let load = 0; load < 10; load += 1) {
    const rosterGate = deferred();
    const sidebar = openSidebar({ sessions: load % 2 === 0, role: load % 3 === 0 ? "NATIVE" : "EXTERNAL", rosterGate });
    try {
      await sidebar.render();
      for (let tick = 0; tick < load % 4; tick += 1) await React.act(async () => {});
      if (load % 3 === 0) await sidebar.setViewer(986);
      rosterGate.resolve();
      await React.act(async () => {});
      await React.act(async () => {});
      if (load % 3 !== 0) await sidebar.setViewer(986);
      assert.equal(selectedAgentId(sidebar.state.header), sidebar.agent.id, `cold load ${load} must open the linked agent, not the AI chat`);
    } finally { sidebar.close(); }
  }
});

test("a roster refresh never replays the link over a chat the person picked", async () => {
  const sidebar = openSidebar({ sessions: true });
  try {
    await sidebar.render();
    assert.equal(selectedAgentId(sidebar.state.header), linkedAgent.id);
    await React.act(async () => sidebar.state.header.onSelect({ kind: "ai" }));
    assert.equal(selectedAgentId(sidebar.state.header), null);
    const before = sidebar.state.posts.length;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await React.act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
    await React.act(async () => {});
    assert.equal(selectedAgentId(sidebar.state.header), null, "a refresh keeps the person's own choice");
    assert.equal(sidebar.state.posts.length, before, "no extra chat is opened behind their back");
  } finally { sidebar.close(); }
});
