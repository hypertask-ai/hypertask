const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const noop = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));

function load(file, mocks = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  }).outputText;
  new Function("require", "module", "exports", js)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`);
    return { __esModule: true, ...mocks[name] };
  }, loaded, loaded.exports);
  return loaded.exports;
}

const flag = load("src/lib/flags/definitions/htpr-7688-past-chats-first.ts");
const chip = load("src/lib/agentStatus/chip.ts");
const availability = load("src/lib/agents/chatAvailability.ts");

function hooks(onStateChange = noop) {
  const slots = [];
  let cursor = 0;
  const react = {
    useContext: () => false, useMemo: callback => callback(), useEffect: noop, useCallback: callback => callback,
    useRef: current => slots[cursor++] ??= { current },
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; onStateChange(slots[index]); }];
    },
  };
  return { react, reset: () => { cursor = 0; } };
}

function find(element, type) {
  if (!element || typeof element !== "object") return;
  if (element.type === type) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = find(child, type);
    if (found) return found;
  }
}

const personal = [2, 7, 0, 4, 1, 6, 3, 5].map(index => ({
  id: `personal-${index}`, title: `Saved chat ${index}`, agentId: null,
  updatedAt: `2026-10-${String(index + 10).padStart(2, "0")}T12:00:00Z`,
  createdAt: `2026-09-${String(28 - index).padStart(2, "0")}T12:00:00Z`,
}));
const agents = [
  { id: "working", displayName: "Runner", status: "working", deliveryMode: "webhook", runtimeType: "EXTERNAL" },
  { id: "quiet", displayName: "Quiet runner", status: "offline", deliveryMode: null, runtimeType: "NATIVE" },
  { id: "heartbeat", displayName: "Heartbeat runner", status: "connected", deliveryMode: "polling", runtimeType: "EXTERNAL" },
];

function menu({ enabled = true, paging = false, mobile = false } = {}) {
  const state = hooks();
  const selections = [], targets = [];
  let closed = 0, focused = 0, loads = 0;
  const history = { sessions: [...personal, { id: "agent-session", title: "Never list this", agentId: "working", updatedAt: "2099-01-01" }], sessionPagingEnabled: paging, hasMoreSessions: false, isLoadingMoreSessions: false };
  history.historySessions = history.sessions;
  history.loadMoreSessions = async () => { loads++; };
  const context = { target: { kind: "ai" }, agents, error: null, onSelectSession: id => selections.push(id), onSelect: target => targets.push(target), onRetry: noop };
  const { AgentSidebarChatCommands } = load("src/components/AI_CHAT/AgentSidebarChatCommands.tsx", {
    react: { ...state.react, useContext: () => mobile },
    "@/hooks/useFlag": { useFlag: key => {
      if (key === "htpr-7702-phone-chat-list") return false;
      assert.equal(key, flag.HTPR_7688_PAST_CHATS_FIRST_FLAG); return enabled;
    } },
    "@/lib/flags/definitions/htpr-7688-past-chats-first": flag,
    "@/lib/flags/definitions/htpr-7702-phone-chat-list": { HTPR_7702_PHONE_CHAT_LIST_FLAG: "htpr-7702-phone-chat-list" },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => history },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/components/Modals/commands/HTC/CommandList": { default: "CommandList" },
    "@/components/Modals/commands/HTC/commandSelection": { findCommandPosition: noop },
    "@/models/enums": { CommandMode: { GoToAgentChat: 1 } },
  });
  return {
    history, selections, targets,
    get closed() { return closed; }, get focused() { return focused; }, get loads() { return loads; },
    render() {
      state.reset();
      return find(AgentSidebarChatCommands({ context, anchorRef: { current: { focus: () => { focused++; } } }, onClose: () => { closed++; } }), "CommandList").props;
    },
  };
}

test("flag on lists AI chat, five newest personal titles, Show N more, then agents in the existing desktop and mobile rows", () => {
  for (const paging of [false, true]) for (const mobile of [false, true]) {
    const view = menu({ paging, mobile });
    const rows = view.render();
    assert.equal(rows.isMobile, mobile);
    assert.equal(rows.inline, true);
    assert.deepEqual(rows.commandLists.map(row => row.name), [
      "AI chat", "Saved chat 7", "Saved chat 6", "Saved chat 5", "Saved chat 4", "Saved chat 3", "Show 3 more",
      "Runner · working · webhook", "Quiet runner", "Heartbeat runner · polling",
    ]);
    rows.onClickHandler(rows.commandLists.find(row => row.key === "more"));
    assert.equal(view.closed, 0);
    assert.deepEqual(view.render().commandLists.map(row => row.name), [
      "AI chat", ...[7, 6, 5, 4, 3, 2, 1, 0].map(index => `Saved chat ${index}`),
      "Runner · working · webhook", "Quiet runner", "Heartbeat runner · polling",
    ]);
    assert.deepEqual(view.selections, []);
    assert.deepEqual(view.targets, []);
    assert.deepEqual(personal.map(session => session.id), [2, 7, 0, 4, 1, 6, 3, 5].map(index => `personal-${index}`));
  }
});

test("clicking a saved title invokes the explicit session-select path and closes the menu", () => {
  const view = menu();
  const rows = view.render();
  rows.onClickHandler(rows.commandLists.find(row => row.key === "session:personal-6"));
  assert.deepEqual(view.selections, ["personal-6"]);
  assert.deepEqual(view.targets, []);
  assert.equal(view.closed, 1);
  assert.equal(view.focused, 1);
});

test("Show more loads remaining paged history without closing or selecting a conversation", () => {
  const view = menu({ paging: true });
  view.history.hasMoreSessions = true;
  let rows = view.render();
  rows.onClickHandler(rows.commandLists.find(row => row.key === "more"));
  assert.equal(view.loads, 0);
  rows = view.render();
  assert.equal(rows.commandLists.find(row => row.key === "more").name, "Show more");
  rows.onClickHandler(rows.commandLists.find(row => row.key === "more"));
  assert.equal(view.loads, 1);
  view.history.isLoadingMoreSessions = true;
  rows = view.render();
  rows.onClickHandler(rows.commandLists.find(row => row.key === "more"));
  assert.equal(view.loads, 1);
  assert.equal(view.closed, 0);
  assert.deepEqual(view.selections, []);
});

test("flag off preserves AI and agent-only rows, legacy status words and agent selection", () => {
  const view = menu({ enabled: false });
  view.history.hasMoreSessions = true;
  const rows = view.render();
  assert.deepEqual(rows.commandLists.map(row => row.name), ["AI chat", "Runner · working · webhook", "Quiet runner · offline", "Heartbeat runner · connected · polling"]);
  rows.onClickHandler(rows.commandLists.find(row => row.key === "quiet"));
  assert.deepEqual(view.targets, [{ kind: "native-agent", agent: agents[1] }]);
  assert.deepEqual(view.selections, []);
});

function sidebar(initialSession = { id: "remembered", agentId: null }) {
  const events = [];
  const state = hooks(value => { if (value?.kind) events.push(`mode:${value.kind}`); });
  let nativeContext = null;
  let chat = {
    currentSession: initialSession, fileItems: [], editor: { getHTML: () => "", getText: () => "", commands: { setContent: noop } },
    resetFiles: noop, startNewSession: () => assert.fail("An explicit saved chat must not create a replacement"),
    selectSession: id => { events.push(`select:${id}`); chat = { ...chat, currentSession: { id, agentId: id === "native-session" ? "native" : null } }; },
  };
  const { AI_Chat_Sidebar } = load("src/components/AI_CHAT/AI_Chat_Sidebar.tsx", {
    react: { ...state.react, default: state.react },
    "@/hooks/useFlag": { useFlag: () => true }, "@/lib/flags/keys": { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: "sidebar" },
    "@/lib/flags/definitions/htpr-7688-past-chats-first": flag,
    "@/app/agents/chat/AgentChatClient": { default: "AgentChatClient" },
    "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: noop },
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => nativeContext, setNativeSidebarChat: value => { nativeContext = value; events.push(value ? "native:set" : "native:clear"); } },
    "@/utils/api/ai_chat/aiChatHelpers": { AI_Chat_API: { getSessionTranscript: async () => {} } },
    "@/store": { currentProjectAtom: "project", currentUserAtom: "user", aiChatSidebarWidthPxAtom: "width" },
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    "@/lib/state": { useRecoilValue: atom => atom === "project" ? { id: 15 } : { id: 6 }, useRecoilState: () => [320] },
    "./MessageList": { MessageList: "MessageList" }, "./WelcomeScreen": { WelcomeScreen: "WelcomeScreen" },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => chat },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} }, "./ChatHeader": { ChatHeader: "ChatHeader" },
    "./AI_Tiptap_Container": { AI_Tiptap_Container: "Composer" }, "./AiChatSidebarResizeHandle": { AiChatSidebarResizeHandle: "Resize" },
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 280 }, "@/utils/undoActions/helperFuncs": { cn: () => "" },
  });
  return { events, get nativeContext() { return nativeContext; }, get currentSession() { return chat.currentSession; }, showSession(session) { chat = { ...chat, currentSession: session }; }, render() {
    state.reset();
    return find(AI_Chat_Sidebar({}), "ChatHeader").props.sidebarChats;
  } };
}

const native = { kind: "native-agent", agent: { id: "native", runtimeType: "NATIVE", displayName: "Native" } };

test("saved chat selection clears native context before selecting and replaces the remembered AI session", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ success: true, session: { id: "native-session" } }) });
  try {
    for (const initial of [{ id: "remembered", agentId: null }, undefined]) {
      const view = sidebar(initial ?? null);
      view.render().onSelect(native);
      await tick();
      assert.equal(view.render().target.kind, "native-agent");
      view.events.length = 0;
      view.render().onSelectSession("picked");
      assert.equal(view.render().target.kind, "ai");
      assert.equal(view.nativeContext, null);
      assert.deepEqual(view.events, ["mode:ai", "native:clear", "select:picked"]);
      view.showSession({ id: "native-session", agentId: "native" });
      view.render().onSelect(native);
      await tick();
      view.render().onSelect({ kind: "ai" });
      assert.equal(view.currentSession.id, "picked", "native restoration must remember the explicit pick, not the older AI chat");
      view.render().onSelect({ kind: "external-agent", agent: agents[0] });
      view.render().onSelectSession("another-pick");
      assert.equal(view.render().target.kind, "ai");
      assert.equal(view.currentSession.id, "another-pick");
    }
  } finally { global.fetch = originalFetch; }
});

test("an in-flight native open cannot overwrite an explicit saved-chat selection", async () => {
  const originalFetch = global.fetch;
  let finish;
  global.fetch = () => new Promise(resolve => { finish = resolve; });
  try {
    const view = sidebar();
    view.render().onSelect(native);
    view.render().onSelectSession("picked-during-open");
    finish({ ok: true, json: async () => ({ success: true, session: { id: "native-session" } }) });
    await tick();
    assert.equal(view.render().target.kind, "ai");
    assert.equal(view.currentSession.id, "picked-during-open");
    assert.equal(view.nativeContext, null);
    assert.deepEqual(view.events.filter(event => event.startsWith("select:")), ["select:picked-during-open"]);
  } finally { global.fetch = originalFetch; }
});

function roster(enabled) {
  const queries = [], snapshots = [], flagReads = [];
  const now = Date.now();
  const rosterAgents = ["working", "quiet", "stale", "done", "denied", "foreign-native"].map(id => ({
    id, userId: id === "foreign-native" ? 7 : 6, runtimeType: id === "foreign-native" ? "NATIVE" : "EXTERNAL",
    displayName: "Same name", heartbeatAt: id === "quiet" ? new Date(now) : null,
    agentWebhookSubscription: id === "working" ? { active: true, events: ["chat.message"] } : null,
  }));
  const runs = [
    { agentId: "working", status: "ACTIVE", lastActivityAt: new Date(now - 60_000) },
    { agentId: "working", status: "ACTIVE", lastActivityAt: new Date(now - 120_000) },
    { agentId: "stale", status: "ACTIVE", lastActivityAt: new Date(now - chip.AGENT_STATUS_MAX_AGE_MS - 60_000) },
    { agentId: "done", status: "COMPLETED", lastActivityAt: new Date(now) },
    { agentId: "denied", status: "ACTIVE", lastActivityAt: new Date(now) },
  ];
  const { GET } = load("src/app/api/agent-sidebar-chats/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/prisma": { default: {
      agent: { findMany: async () => rosterAgents },
      chatSession: { findUnique: async ({ where }) => ({ id: where.userId_agentId.agentId }) },
      agentRun: { findMany: async query => {
        queries.push(query);
        return runs.filter(run => query.where.agentId.in.includes(run.agentId) && run.status === query.where.status && run.lastActivityAt >= query.where.lastActivityAt.gte);
      } },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
    "@/lib/agents/chatAccess": { loadSidebarChatBoard: async () => ({ id: 15 }), userTeamIds: async () => [], loadUserAgentChatSession: async ({ sessionId }) => ({ ok: sessionId !== "denied" }) },
    "@/lib/agents/chatService": { openAgentChat: noop }, "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
    "@/lib/agents/chatAvailability": availability,
    "@/utils/controllers/agents/boardMembers": { getAgentTeamIds: async () => new Map() },
    "@/lib/flags": { SHARED_AGENT_CHAT_FLAG: "shared", isFeatureEnabled: async (key, userId) => { flagReads.push([key, userId]); return enabled; } },
    "@/lib/flags/definitions/htpr-7688-past-chats-first": flag, "@/lib/agentStatus/chip": chip,
    "@/lib/api/rateLimit": { checkRestRateLimit: noop }, "@/lib/agentRuns/service": { browserMutationIsSameOrigin: noop },
    "@/lib/agents/runtimeState": {
      readAgentRuntimeSnapshot: async id => { snapshots.push(id); return id === "working" ? { status: "waiting" } : null; },
      filterRuntimeSnapshotToBoards: snapshot => snapshot, classifyRuntimeHealth: snapshot => snapshot.status,
    },
  });
  return { queries, snapshots, flagReads, get: () => GET({ headers: new Headers(), nextUrl: new URL("https://app.hypertask.ai/api/agent-sidebar-chats?projectId=15") }) };
}

test("roster batches authorized agent IDs once and marks only fresh ACTIVE runs working", async () => {
  const view = roster(true);
  const before = Date.now();
  const response = await view.get();
  const after = Date.now();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.agents.map(agent => [agent.id, agent.status, agent.deliveryMode]), [
    ["working", "working", "webhook"], ["quiet", null, "polling"], ["stale", null, null], ["done", null, null],
  ]);
  assert.deepEqual(view.flagReads, [[flag.HTPR_7688_PAST_CHATS_FIRST_FLAG, 6]]);
  assert.equal(view.queries.length, 1);
  const query = view.queries[0];
  assert.deepEqual(query.where.agentId.in, ["working", "quiet", "stale", "done"]);
  assert.equal(query.where.status, "ACTIVE");
  assert.ok(query.where.lastActivityAt.gte.getTime() >= before - chip.AGENT_STATUS_MAX_AGE_MS);
  assert.ok(query.where.lastActivityAt.gte.getTime() <= after - chip.AGENT_STATUS_MAX_AGE_MS);
  assert.deepEqual(query.select, { agentId: true });
  assert.deepEqual(query.distinct, ["agentId"]);
  assert.deepEqual(view.snapshots, [], "heartbeat/runtime snapshots must not decide working status with the fix on");
});

test("flag-off roster retains runtime and heartbeat status and never queries active runs", async () => {
  const view = roster(false);
  const body = await (await view.get()).json();
  assert.deepEqual(body.agents.map(agent => [agent.id, agent.status]), [["working", "waiting"], ["quiet", "connected"], ["stale", "offline"], ["done", "offline"]]);
  assert.deepEqual(view.queries, []);
  assert.deepEqual(view.snapshots, ["working", "quiet", "stale", "done"]);
});

test("the ticket bugfix flag defaults to Everyone with the agreed ship date and small release risk", () => {
  assert.equal(flag.default.key, "htpr-7688-past-chats-first");
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.shippedOn, "2026-10-23");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.ok(flag.default.releaseRisk.reason.length > 0);
});
