const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");
const root = path.resolve(__dirname, "..");
const FLAG = "htpr-8048-agent-sessions";

function service() {
  const sessions = [{ id: "default-session", userId: 6, agentId: "agent", agentSessionKey: "default", teamId: "team", title: "Runner" }];
  const participants = [];
  let enabled = true;
  let boardAllowed = true;
  const agent = { id: "agent", userId: 6, displayName: "Runner" };
  const { openAgentChat } = load("src/lib/agents/chatService.ts", {
    "@/lib/prisma": { default: {
      agent: { findFirst: async ({ where }) => where.id === agent.id ? agent : null },
      chatSession: {
        findUnique: async ({ where }) => sessions.find((row) => Object.entries(where.userId_agentId).every(([key, value]) => row[key] === value)) ?? null,
        upsert: async ({ where, create }) => {
          let row = sessions.find((item) => Object.entries(where.userId_agentId).every(([key, value]) => item[key] === value));
          if (!row) { row = { id: `session-${sessions.length}`, ...create }; sessions.push(row); }
          return row;
        },
      },
    } },
    "@/lib/flags": { SHARED_AGENT_CHAT_FLAG: "shared", isFeatureEnabled: async (key) => key === FLAG ? enabled : false },
    "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
    "@/utils/controllers/agents/boardMembers": { getAgentTeamIds: async () => new Map([[agent.id, "team"]]) },
    "./chatAccess": {
      loadSidebarChatAgent: async (userId, projectId, agentId) => boardAllowed && userId === 6 && projectId === 15 && agentId === agent.id ? agent : null,
      loadUserAgentChatSession: async ({ sessionId, userId, sidebarProjectId }) => {
        const session = sessions.find((row) => row.id === sessionId);
        return session && session.userId === userId && boardAllowed && sidebarProjectId === 15 ? { ok: true, session, agentId: session.agentId } : { ok: false };
      },
      ensureChatParticipant: async (id) => participants.push(id),
      userTeamIds: async () => [],
    },
  });
  return { sessions, participants, open: (options = {}) => openAgentChat({ userId: 6, agentId: agent.id, sidebarProjectId: 15, ...options }),
    setEnabled(value) { enabled = value; }, setBoardAllowed(value) { boardAllowed = value; } };
}

test("new agent sessions are distinct; opening the default conversation remains idempotent", async () => {
  const view = service();
  assert.deepEqual(await view.open(), { ok: true, session: { id: "default-session" } });
  const first = await view.open({ newSession: true });
  const second = await view.open({ newSession: true });
  assert.deepEqual(first, { ok: true, session: { id: "session-1" } });
  assert.deepEqual(second, { ok: true, session: { id: "session-2" } });
  assert.notEqual(view.sessions[1].agentSessionKey, view.sessions[2].agentSessionKey);
  assert.equal(view.sessions[0].agentSessionKey, "default");
  assert.deepEqual(await view.open(), { ok: true, session: { id: "default-session" } });
  assert.deepEqual(view.sessions.map((row) => row.teamId), ["team", "team", "team"]);
});

test("resuming validates the exact session and does not create or reset a conversation", async () => {
  const view = service();
  await view.open({ newSession: true });
  const before = structuredClone(view.sessions);
  assert.deepEqual(await view.open({ sessionId: "session-1" }), { ok: true, session: { id: "session-1" } });
  assert.deepEqual(view.sessions, before);
  assert.equal(view.participants.at(-1), "session-1");
  view.sessions.push({ id: "wrong-agent", userId: 6, agentId: "another-agent", agentSessionKey: "other", teamId: "team" });
  assert.equal((await view.open({ sessionId: "wrong-agent" })).ok, false);
  assert.equal((await view.open({ sessionId: "missing" })).ok, false);
  view.setBoardAllowed(false);
  assert.equal((await view.open({ sessionId: "session-1" })).ok, false);
  view.setBoardAllowed(true);
  assert.equal((await view.open({ sessionId: "session-1" })).ok, true);
});

test("flag Off denies new-session operations while preserving the default conversation", async () => {
  const view = service();
  view.setEnabled(false);
  assert.equal((await view.open({ newSession: true })).ok, false);
  assert.equal((await view.open({ sessionId: "default-session" })).ok, false);
  assert.deepEqual(await view.open(), { ok: true, session: { id: "default-session" } });
  assert.equal(view.sessions.length, 1);
  view.setEnabled(true);
  assert.equal((await view.open({ newSession: true })).ok, true);
});

function picker({ agentsOnly = true, agents = [{ id: "agent", displayName: "Runner", runtimeType: "EXTERNAL", sessions: [{ id: "saved", title: "Fix inbox" }] }] } = {}) {
  const slots = [];
  let cursor = 0;
  const selected = [], started = [], pages = [];
  let closed = 0;
  const noop = () => {};
  const react = { useContext: () => false, useEffect: noop, useMemo: (fn) => fn(), useRef: (current) => slots[cursor++] ??= { current },
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; } };
  const source = fs.readFileSync(path.join(root, "src/components/AI_CHAT/AgentSidebarChatCommands.tsx"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mocks = {
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/components/Modals/commands/HTC/CommandList": { default: "CommandList" },
    "@/components/Modals/commands/HTC/commandSelection": { findCommandPosition: noop },
    "@/models/enums": { CommandMode: { GoToAgentChat: 1 } },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/definitions/htpr-7688-past-chats-first": { HTPR_7688_PAST_CHATS_FIRST_FLAG: "past" },
    "@/lib/flags/definitions/htpr-7702-phone-chat-list": { HTPR_7702_PHONE_CHAT_LIST_FLAG: "phone" },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ sessions: [], hasMoreSessions: false }) },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => { assert.ok(name in mocks, name); return { __esModule: true, ...mocks[name] }; }, loadedModule, loadedModule.exports);
  function find(element) {
    if (!element || typeof element !== "object") return null;
    if (element.type === "CommandList") return element.props;
    for (const child of [element.props?.children].flat(Infinity)) { const found = find(child); if (found) return found; }
    return null;
  }
  return { selected, started, pages, get closed() { return closed; }, render() { cursor = 0; return find(loadedModule.exports.AgentSidebarChatCommands({ agentsOnly,
    context: { target: { kind: "ai" }, agents, error: null, onSelect: (target) => selected.push(target),
      onSelectAgentSession: (agent, id) => selected.push([agent.id, id]), onStartAgentSession: (agent) => started.push(agent.id), onLoadMoreAgentSessions: (agent) => pages.push(agent.id) },
    anchorRef: { current: { focus: noop } }, onClose: () => closed++ })); } };
}

test("agents expand to the existing command rows; new and saved sessions use distinct actions", () => {
  const view = picker();
  let rows = view.render();
  assert.deepEqual(rows.commandLists.map((row) => row.name), ["Runner"]);
  rows.onClickHandler(rows.commandLists[0]);
  rows = view.render();
  assert.deepEqual(rows.commandLists.map((row) => row.name), ["Runner", "Start a new session", "Fix inbox"]);
  rows.onClickHandler(rows.commandLists[2]);
  assert.deepEqual(view.selected, [["agent", "saved"]]);
  assert.equal(view.closed, 1);
  rows.onClickHandler(rows.commandLists[1]);
  assert.deepEqual(view.started, ["agent"]);
  assert.equal(view.closed, 2);
  assert.equal(rows.inline, true);
});

test("an empty agent roster renders without crashing; the legacy conversation mode remains usable", () => {
  assert.deepEqual(picker({ agents: [] }).render().commandLists, []);
  const view = picker({ agentsOnly: false });
  const rows = view.render();
  assert.equal(rows.commandLists[0].name, "AI chat");
  rows.onClickHandler(rows.commandLists[0]);
  assert.deepEqual(view.selected, [{ kind: "ai" }]);
});

test("the feature has an Everyone default and a reversible server/client flag", () => {
  const definition = load("src/lib/flags/definitions/htpr-8048-agent-sessions.ts", {}).default;
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "new");
});


test("Show more keeps the picker open while requesting the next agent page", () => {
  const view = picker({ agents: [{ id: "agent", displayName: "Runner", hasMoreSessions: true, sessions: [{ id: "latest", title: "Latest" }] }] });
  let rows = view.render();
  rows.onClickHandler(rows.commandLists[0]);
  rows = view.render();
  rows.onClickHandler(rows.commandLists.find((row) => row.name === "Show more"));
  assert.deepEqual(view.pages, ["agent"]);
  assert.equal(view.closed, 0);
  assert.deepEqual(view.selected, []);
});

test("roster paging reaches session 101 without exposing another team's titles", async () => {
  let enabled = true;
  const sessions = Array.from({ length: 101 }, (_, index) => ({ id: `saved-${index}`, title: `Session ${index}`, userId: 6, agentId: "agent", teamId: "team" }));
  sessions.push({ id: "private", title: "Other team", userId: 6, agentId: "agent", teamId: "other-team" });
  const queries = [];
  const { GET } = load("src/app/api/agent-sidebar-chats/route.ts", {
    "@/lib/prisma": { default: {
      agent: { findMany: async () => [{ id: "agent", userId: 6, runtimeType: "EXTERNAL", displayName: "Runner", agentWebhookSubscription: null }] },
      chatSession: {
        findUnique: async () => ({ id: "default-session" }),
        findMany: async (query) => {
          queries.push(query);
          const rows = sessions.filter((row) => row.userId === query.where.userId && row.agentId === query.where.agentId &&
            query.where.OR.some((condition) => condition.userId === row.userId || condition.teamId?.in.includes(row.teamId)));
          const start = query.cursor ? rows.findIndex((row) => row.id === query.cursor.id) + query.skip : 0;
          return rows.slice(start, start + query.take);
        },
      },
      agentRun: { findMany: async () => [] },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 7 }) },
    "@/lib/agents/chatAccess": {
      loadSidebarChatBoard: async () => ({ id: 15 }), userTeamIds: async () => ["team"],
      loadUserAgentChatSession: async ({ sessionId }) => ({ ok: sessionId !== "private", agentId: sessionId === "wrong-agent" ? "different" : "agent" }),
    },
    "@/lib/agents/chatService": { openAgentChat: async () => assert.fail("GET must not create sessions") },
    "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
    "@/lib/flags": { SHARED_AGENT_CHAT_FLAG: "shared", isFeatureEnabled: async (key) => key === FLAG ? enabled : true },
    "@/utils/controllers/agents/boardMembers": { getAgentTeamIds: async () => new Map([["agent", "team"]]) },
    "@/lib/agents/chatAvailability": { agentChatDeliveryMode: () => null, hasFreshAgentChatHeartbeat: () => false },
    "@/lib/agents/runtimeState": {},
    "@/lib/api/rateLimit": {}, "@/lib/agentRuns/service": {},
  });
  const get = (query = "") => GET({ headers: new Headers(), nextUrl: new URL(`https://app.hypertask.ai/api/agent-sidebar-chats?projectId=15${query}`) });
  const first = (await (await get()).json()).agents[0];
  assert.equal(first.sessions.length, 50);
  assert.equal(first.hasMoreSessions, true);
  const second = (await (await get("&agentId=agent&before=saved-49")).json()).agents[0];
  assert.equal(second.sessions[0].id, "saved-50");
  assert.equal(second.hasMoreSessions, true);
  const third = (await (await get("&agentId=agent&before=saved-99")).json()).agents[0];
  assert.deepEqual(third.sessions.map((row) => row.id), ["saved-100"]);
  assert.equal(third.hasMoreSessions, false);
  assert.deepEqual((await (await get("&agentId=agent&before=private")).json()).agents, []);
  assert.deepEqual((await (await get("&agentId=agent&before=wrong-agent")).json()).agents, []);
  assert.equal(queries.length, 3);
  enabled = false;
  assert.equal((await get("&agentId=agent&before=saved-49")).status, 404);
  const legacy = (await (await get()).json()).agents[0];
  assert.equal(Object.hasOwn(legacy, "sessions"), false);
});

test("mention routing updates a cached external composer without overwriting later drafts", () => {
  const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
  const updates = [];
  const noop = () => {};
  const state = { awaiting: false, draftRef: { current: "Existing agent draft" }, setDraft: (value) => updates.push(value) };
  const source = loader({
    "./useAgentChatState": { useAgentChatState: () => state },
    "./useAgentChatRoster": { useAgentChatRoster: () => ({}) },
    "./useAgentChatSession": { useAgentChatSession: () => ({ sessionName: "saved", loadMessages: noop }) },
    "./useAgentChatFeed": { useAgentChatFeed: () => ({}) },
    "./useAgentChatStream": { useAgentChatStream: noop },
    "./useAgentChatNavigation": { useAgentChatNavigation: () => ({}) },
    "./useAgentChatSend": { useAgentChatSend: () => ({ drainQueuedMessageRef: { current: noop } }) },
    "./useAgentChatComposer": { useAgentChatComposer: () => ({}) },
    "./useAgentLifecycle": { useAgentLifecycle: () => ({}) },
    "./useAgentChatDetailsSheet": { useAgentChatDetailsSheet: noop },
    "./AgentChatPane": { AgentChatPane: () => null },
    "./AgentChatView": { AgentChatView: () => null },
  });
  const AgentChatClient = source("src/app/agents/chat/AgentChatClient.tsx").default;
  const view = mount();
  try {
    const acknowledgements = [];
    const embedded = { projectId: 15, agent: { id: "agent" }, active: true, sessionId: "saved", requestId: 1,
      routedDraft: { text: "Please check this @Runner", requestId: 1 }, onRoutedDraftConsumed: (requestId) => acknowledgements.push(requestId) };
    view.render(React.createElement(AgentChatClient, { currentUser: { id: 6 }, embedded }));
    assert.deepEqual(updates, ["Please check this @Runner"]);
    assert.deepEqual(acknowledgements, [1]);
    assert.equal(state.draftRef.current, "Please check this @Runner");
    state.draftRef.current = "New unsent text";
    view.render(React.createElement(AgentChatClient, { key: "restored", currentUser: { id: 6 }, embedded: { ...embedded, requestId: 2, routedDraft: undefined } }));
    assert.equal(state.draftRef.current, "New unsent text");
    assert.equal(updates.length, 1);
  } finally { view.close(); }
});

test("external composer serializes real agent names and ticket references, not generic mention labels", () => {
  const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
  const { Editor } = require("@tiptap/core");
  let options;
  const source = loader({
    "@tiptap/react": { useEditor: (value) => { options = value; return null; }, EditorContent: () => null },
    "@/components/RTE/Components/AI_Chat/MentionData": { createMentionData: () => ({}) },
  });
  const ControlledComposerEditor = source("src/lib/controlledComposerEditor.tsx").ControlledComposerEditor;
  const view = mount();
  let editor;
  try {
    view.render(React.createElement(ControlledComposerEditor, { value: "", agentMentionProjectId: 15,
      onChange() {}, onKeyDown() {}, onEditor() {}, placeholder: "Message", ariaLabel: "Message" }));
    editor = new Editor({ ...options, element: document.createElement("div"),
      content: '<p>Ask <span data-type="mention" data-id="agent" data-label="agent" text="Runner">Runner</span> about <span data-type="mention" data-id="12" data-label="task" text="HTPR-12 Work">HTPR-12 Work</span></p>' });
    assert.equal(editor.getText(), "Ask @Runner about @HTPR-12 Work");
  } finally { editor?.destroy(); view.close(); }
});
