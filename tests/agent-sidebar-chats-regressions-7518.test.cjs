const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./task-route-loader.cjs");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const hooks = { useCallback: (callback) => callback, useRef: (current) => ({ current }), useEffect: () => {} };
const noop = () => {};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const viewer = load("src/lib/agents/chatViewerState.ts", {});
const sendHook = load("src/app/agents/chat/useAgentChatSend.ts", {
  react: hooks,
  "@/hooks/useFlag": { useFlag: () => false },
  "@/lib/ai/chipEvents": { signalAiChip: () => {} },
  "@/hooks/MultiPages/AIChat/useDockedChatScope": { useDockedChatScope: () => [null, noop] },
  "@/lib/state": { useRecoilValue: () => null },
  "@/store": {},
  "next/navigation": { usePathname: () => "/project" },
  "react-hot-toast": { default: { error: assert.fail } },
}).useAgentChatSend;
const sessionHook = load("src/app/agents/chat/useAgentChatSession.ts", {
  react: hooks,
  "react-dom": { flushSync: (callback) => callback() },
  "react-hot-toast": { default: { error: assert.fail } },
  "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: noop },
  "@/lib/agents/chatViewerState": { markChatRead: noop, saveDraftToServer: noop },
}).useAgentChatSession;

function chatProps(embedded) {
  const props = {
    embedded, sessionIdRef: { current: "a" }, selectedIdRef: { current: "agent-a" },
    sendingRef: { current: false }, session: { id: "a" }, draft: "hello", currentUser: { id: 6 },
    draftRef: { current: "hello" }, draftHydratedRef: { current: null }, restoredDraftRef: { current: "" },
    messageQueueRef: { current: [] }, blockedQueueIdRef: { current: null }, awaitingRef: { current: false },
    loadGenRef: { current: 0 }, composerEditorRef: { current: null }, composerRef: { current: null },
    router: { replace: noop }, searchParams: new URLSearchParams(), roster: [], agents: [],
    setMessages: noop, setAgents: noop, setDeliveryNotice: noop, setAwaiting: noop,
    setReplyTimedOut: noop, setAwaitingSince: noop, setQueuedMessages: noop, setDraft: noop,
    setSending: (value) => { props.sending = value; }, setSession: (value) => { props.session = value; },
    setActivity: noop, setMessagesError: noop, setDeliveryMode: noop, setSessionLoading: noop,
    setSelectedId: noop, setStopping: noop, dismissMention: noop, focusComposer: noop, loadMessages: noop,
  };
  return props;
}

const sent = (id) => ({ ok: true, json: async () => ({ success: true, message: { id, content: "hello" } }) });

test("legacy agent switching during a pending send releases the lock and still permits the next send", async () => {
  const originalFetch = global.fetch;
  const first = deferred();
  const props = chatProps(undefined);
  let sends = 0;
  global.fetch = async () => ++sends === 1 ? first.promise : sent("b-message");
  try {
    const pending = sendHook(props).handleSend();
    assert.equal(props.sendingRef.current, true);
    props.sessionIdRef.current = "b";
    props.session = { id: "b" };
    first.resolve(sent("a-message"));
    await pending;
    assert.equal(props.sendingRef.current, false);
    assert.equal(props.sending, false);
    await sendHook(props).handleSend();
    assert.equal(sends, 2);
    assert.equal(props.sendingRef.current, false);
  } finally { global.fetch = originalFetch; }
});

test("embedded selection clears the old lock but an old completion cannot unlock the new request", async () => {
  const originalFetch = global.fetch;
  const first = deferred(), second = deferred(), opened = deferred();
  const props = chatProps({ projectId: 15, active: true });
  global.fetch = async (url) => url === "/api/agent-sidebar-chats"
    ? { ok: true, json: async () => ({ success: true, session: { id: "b" } }) }
    : url.includes("/a/") ? first.promise : second.promise;
  props.setSession = (value) => { props.session = value; if (value?.id === "b") opened.resolve(); };
  try {
    const pendingA = sendHook(props).handleSend();
    sessionHook(props).selectAgent({ id: "agent-b", runtimeType: "EXTERNAL" });
    assert.equal(props.sendingRef.current, false);
    assert.equal(props.sending, false);
    await opened.promise;
    const pendingB = sendHook(props).handleSend();
    assert.equal(props.sendingRef.current, true);
    first.resolve(sent("a-message"));
    await pendingA;
    assert.equal(props.sendingRef.current, true, "stale completion must not clear B's lock");
    assert.equal(props.sending, true);
    second.resolve(sent("b-message"));
    await pendingB;
    assert.equal(props.sendingRef.current, false);
    props.sendingRef.current = true;
    props.sending = true;
    sessionHook(props).clearSelectionState();
    assert.equal(props.sendingRef.current, false);
    assert.equal(props.sending, false);
  } finally { global.fetch = originalFetch; }
});

const sessionsHook = load("src/hooks/MultiPages/AIChat/useAiChatSessions.ts", {
  "@/hooks/useFlag": { useFlag: () => false },
  "@/lib/ai/chipEvents": { signalAiChip: () => {} },
  "@/lib/flags/definitions/htpr-7762-chat-new-session-focus": { HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG: "htpr-7762-chat-new-session-focus" },
  react: hooks,
  "@/lib/agents/chatViewerState": viewer,
  "@/lib/constants": { default: {} },
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => ({}) },
  "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
  "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
}).useAiChatSessions;

function boardContext(mapped, paging) {
  let displayed = mapped;
  const created = { id: "new-general", userId: 6, agentId: null, projectId: 15, taskId: null, messages: [] };
  const state = { map: { 15: mapped.id }, selected: [], created: 0 };
  const context = {
    currentProject: { id: 15 }, currentUser: { id: 6 }, sessionPagingEnabled: paging, agentSidebarChatsEnabled: true,
    sessionIntentGenerationRef: { current: 0 }, sessionSetupRef: { current: null },
    resolvedBoardSessionRef: { current: null }, previousProjectIdRef: { current: undefined },
    sessionsRef: { current: [mapped] }, chatHistoryReadyRef: { current: true },
    dockedChatScope: null, pathname: "/project", sessionContextKey: "user-6", aiChatBoardSessionMap: state.map,
    getDisplayedSession: () => displayed,
    resolveHistorySession: async () => mapped,
    selectSessionInHistory: async (id) => { state.selected.push(id); displayed = mapped; },
    createSession: async () => { state.created++; displayed = created; return created; },
    setAiChatBoardSessionMap: (update) => { state.map = update(state.map); },
  };
  return { context, state, created };
}

test("general board restoration refuses agent-valued maps and empty agent fallbacks but still restores general sessions", async () => {
  viewer.setNativeSidebarChat(null);
  for (const paging of [false, true]) {
    for (const agentId of [null, "native-agent"]) {
      const mapped = { id: "mapped", userId: 6, agentId, projectId: 15, taskId: null, messages: [] };
      const { context, state, created } = boardContext(mapped, paging);
      const restored = await sessionsHook(context).ensureSessionForCurrentBoard();
      assert.equal(restored.id, agentId ? created.id : mapped.id);
      assert.equal(state.created, agentId ? 1 : 0);
      assert.deepEqual(state.map, agentId ? {} : { 15: "mapped" });
      assert.deepEqual(state.selected, [], "a contaminated mapping must never select its agent thread");
    }
  }
});

test("explicit active native sidebar selection is still allowed to resolve its canonical session", async () => {
  const mapped = { id: "native", userId: 6, agentId: "agent", messages: [] };
  for (const paging of [false, true]) {
    const { context, state } = boardContext(mapped, paging);
    viewer.setNativeSidebarChat({ sessionId: "native", projectId: 15 });
    try {
      assert.equal((await sessionsHook(context).ensureSessionForCurrentBoard()).id, "native");
      assert.equal(state.created, 0);
    } finally { viewer.setNativeSidebarChat(null); }
  }
});

const createSend = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
  "@/lib/agents/chatViewerState": viewer,
  "./aiChatStream": { consumeAiChatStream: async () => {} },
  "react-hot-toast": { default: { error: assert.fail } },
  "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
  "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
}).createAiChatSend;

function sendContext(session, writes) {
  return {
    waitForChatSession: async () => session, processAttachments: async () => [],
    editor: { getText: () => "hello", getHTML: () => "<p>hello</p>", commands: { clearContent: noop } },
    sendInFlightRef: { current: false }, handleSendMessageRef: { current: null },
    fileUpload: { fileItems: [], clearFiles: noop }, addMessageToSessionQuery: noop, drainQueuedMessage: noop,
    isFullScreenChat: false, dockedProjectId: 15, scopedProjectId: 15,
    setAiChatBoardSessionMap: (update) => writes.push(update({ 15: "general" })),
    currentAiOption: { id: "fixture", model: "fixture", source: "fixture" }, billing: {},
    contextList: [], streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null },
    streamingRequestRef: { current: null }, setCurrentStreamingSession: noop, setIsTyping: noop,
    setAgentStatus: noop, chatRoute: "/api/ai/chat/stream", appendMessageToSessionCache: assert.fail,
    updateLastMessageInSessionCache: assert.fail,
  };
}

test("native sends never persist the general board map while ordinary AI sends still do", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("fixture stream");
  try {
    for (const agentId of [null, "native-agent"]) {
      const writes = [];
      const context = sendContext({ id: "sent-session", agentId, messages: [] }, writes);
      assert.equal(await createSend(context).handleSendMessage(), true);
      assert.deepEqual(writes, agentId ? [] : [{ 15: "sent-session" }]);
    }
  } finally { global.fetch = originalFetch; }
});

test("sidebar headers follow only active selection; clearing and replacement cannot tag legacy sessions", () => {
  viewer.setNativeSidebarChat(null);
  assert.deepEqual(viewer.sidebarChatHeaders("a"), {});
  viewer.setNativeSidebarChat({ sessionId: "a", projectId: 15 });
  const captured = viewer.sidebarChatHeaders("a");
  assert.deepEqual(captured, { "x-hypertask-sidebar-project": "15" });
  assert.deepEqual(viewer.sidebarChatHeaders("other"), {});
  viewer.setNativeSidebarChat({ sessionId: "b", projectId: 16 });
  assert.deepEqual(viewer.sidebarChatHeaders("a"), {});
  assert.deepEqual(viewer.sidebarChatHeaders("b"), { "x-hypertask-sidebar-project": "16" });
  viewer.setNativeSidebarChat(null);
  assert.equal(viewer.getNativeSidebarChat(), null);
  assert.deepEqual(viewer.sidebarChatHeaders("a"), {});
  assert.deepEqual(viewer.sidebarChatHeaders("b"), {});
  assert.deepEqual(captured, { "x-hypertask-sidebar-project": "15" }, "operation snapshots survive selection cleanup");
});

test("leaving native chat, flag Off, project/account change and unmount all clear sidebar registration", () => {
  const source = read("src/components/AI_CHAT/AI_Chat_Sidebar.tsx");
  assert.match(source, /const sidebarEnabled = enabled && !!projectId && !!currentUser/);
  assert.match(source, /\} else \{\s*setNativeSidebarChat\(null\);\s*if \(leaving\.kind === "native-agent"/);
  assert.match(source, /useEffect\(\(\) => \{\s*\+\+intentRef\.current;\s*setNativeSidebarChat\(null\);[^]*?return \(\) => \{[^]*?setNativeSidebarChat\(null\);\s*\};\s*\}, \[sidebarEnabled, projectId, currentUser\?\.id\]\)/);
});

test("in-flight native sends retain captured board context after selection cleanup", async () => {
  const originalFetch = global.fetch;
  const preparing = deferred();
  const started = deferred();
  const requests = [];
  global.fetch = async (_url, init) => { requests.push(init.headers); return new Response("fixture stream"); };
  viewer.setNativeSidebarChat({ sessionId: "native", projectId: 15 });
  try {
    const context = sendContext({ id: "native", agentId: "agent", messages: [] }, []);
    context.processAttachments = () => { started.resolve(); return preparing.promise; };
    const sending = createSend(context).handleSendMessage();
    await started.promise;
    viewer.setNativeSidebarChat(null);
    preparing.resolve([]);
    assert.equal(await sending, true);
    assert.equal(requests[0]["x-hypertask-sidebar-project"], "15");
    assert.deepEqual(viewer.sidebarChatHeaders("native"), {});
  } finally { viewer.setNativeSidebarChat(null); global.fetch = originalFetch; }
});

test("hidden-tab awaiting polling skips embedded chats only and still polls legacy chats", () => {
  const originalDocument = global.document;
  const originals = { setInterval: global.setInterval, clearInterval: global.clearInterval, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const effects = [];
  const useStream = load("src/app/agents/chat/useAgentChatStream.ts", {
    react: { useEffect: (callback) => effects.push(callback) },
    "@/lib/realtime/client": {}, "@/lib/realtime/shared": {},
  }).useAgentChatStream;
  const calls = [];
  let tick;
  global.document = { visibilityState: "hidden" };
  global.setInterval = (callback) => { tick = callback; return 1; };
  global.clearInterval = noop;
  global.setTimeout = () => 2;
  global.clearTimeout = noop;
  try {
    for (const embedded of [undefined, { active: true, projectId: 15 }]) {
      effects.length = 0;
      calls.length = 0;
      useStream({ embedded, currentUser: { id: 6 }, awaiting: true, session: { id: "a" }, loadMessages: (id) => calls.push(id) });
      const cleanup = effects[1]();
      tick();
      assert.deepEqual(calls, embedded ? [] : ["a"]);
      global.document.visibilityState = "visible";
      tick();
      assert.deepEqual(calls, embedded ? ["a"] : ["a", "a"]);
      cleanup();
      global.document.visibilityState = "hidden";
    }
    effects.length = 0;
    tick = undefined;
    useStream({ embedded: { active: false, projectId: 15 }, currentUser: { id: 6 }, awaiting: true, session: { id: "a" } });
    assert.equal(effects[1](), undefined);
    assert.equal(tick, undefined, "inactive embedded chats still do not poll");
  } finally { global.document = originalDocument; Object.assign(global, originals); }
});

test("old agent links redirect only to an eligible board and otherwise retain the legacy chat", async () => {
  const ts = require("typescript");
  const compiled = ts.transpileModule(read("src/app/agents/chat/page.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: "page.tsx",
  }).outputText;
  for (const { query, board, enabled = true, agentId = null, expected } of [
    { query: { agent: "agent-a" }, board: { id: 15 }, expected: "/project?agentSidebar=1&sidebarAgent=agent-a&id=15" },
    { query: { agent: "known" }, board: { id: 15 }, expected: "/project?agentSidebar=1&sidebarAgent=agent-a&id=15" },
    { query: { agent: "agent-a", projectId: "15" }, board: { id: 15 }, expected: "/project?agentSidebar=1&sidebarAgent=agent-a&id=15" },
    { query: { agent: "agent-a" }, board: null, expected: "legacy-agent-chat" },
    { query: { agent: "known" }, board: null, expected: "legacy-agent-chat" },
    { query: { agent: "unknown", projectId: "15" }, board: { id: 15 }, expected: "legacy-agent-chat" },
    { query: { agent: "agent-a", projectId: "15" }, board: null, expected: "legacy-agent-chat" },
    { query: { agent: "agent-a" }, board: { id: 15 }, enabled: false, expected: "legacy-agent-chat" },
    { query: { agent: "agent-a" }, board: { id: 15 }, agentId: "acting-agent", expected: "legacy-agent-chat" },
    { query: { agent: "agent-a", view: "rooms" }, board: { id: 15 }, expected: "legacy-agent-rooms" },
    { query: {}, board: null, expected: "/project?agentSidebar=1" },
  ]) {
    const boardQueries = [];
    const redirects = [];
    const currentUser = { id: 6 };
    const mocks = {
      "react/jsx-runtime": require("react/jsx-runtime"),
      "@/lib/prisma": { project: { findFirst: async (input) => { boardQueries.push(input); return board; } } },
      "@/lib/agents/visibility": { accessibleAgentWhere: (userId) => ({ userId }) },
      "@/lib/agents/ownedSlugs": { resolveOwnedAgent: async (_userId, ref) => ref === "known" ? { id: "agent-a" } : null },
      "@/lib/agents/slug": { looksLikeAgentId: (ref) => ref.startsWith("agent-") },
      "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({ scope: "human" }) },
      "next/headers": { headers: async () => new Headers(), cookies: async () => ({ get: () => ({ value: JSON.stringify(currentUser) }) }) },
      "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6, agentId }) },
      "@/lib/flags": { isFeatureEnabled: async (key) => key === "sidebar" ? enabled : true },
      "@/lib/flags/keys": { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: "sidebar", HTPR_6557_AGENT_ROOMS_FLAG: "rooms" },
      "next/navigation": { redirect: (url) => { redirects.push(url); return url; } },
      "./AgentChatClient": "legacy-agent-chat",
      "./AgentRoomClient": "legacy-agent-rooms",
    };
    const exports = {};
    new Function("require", "exports", compiled)((specifier) => {
      assert.ok(Object.hasOwn(mocks, specifier), `unexpected page dependency: ${specifier}`);
      return mocks[specifier];
    }, exports);
    const result = await exports.default({ searchParams: Promise.resolve(query) });
    if (expected.startsWith("/project")) {
      assert.equal(result, expected);
      assert.deepEqual(redirects, [expected]);
    } else {
      assert.equal(result.type, expected);
      assert.deepEqual(redirects, []);
      if (expected === "legacy-agent-chat") assert.deepEqual(result.props.currentUser, currentUser);
    }
    const resolvesBoard = enabled && !agentId && query.view !== "rooms" && query.agent && query.agent !== "unknown";
    assert.equal(boardQueries.length, resolvesBoard ? 1 : 0);
    if (resolvesBoard) {
      const { where } = boardQueries[0];
      assert.equal(where.scope, "human");
      assert.equal(where.status, "Normal");
      assert.equal(where.id, query.projectId ? Number(query.projectId) : undefined);
      assert.deepEqual(where.AND, [{ OR: [{ ownerId: 6 }, { members: { some: { userId: 6, agentId: null, status: "Accepted" } } }] }]);
      assert.deepEqual(where.members, { some: { agentId: "agent-a", status: "Accepted", agent: { userId: 6, revokedAt: null, archivedAt: null } } });
    }
  }
});

test("embedded awaiting chats reconcile on visibility before and after polling expires without changing legacy behavior", () => {
  const originalDocument = global.document;
  const originals = { setInterval: global.setInterval, clearInterval: global.clearInterval, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  const originalError = console.error;
  const effects = [];
  const useStream = load("src/app/agents/chat/useAgentChatStream.ts", {
    react: { useEffect: (callback) => effects.push(callback) },
    "@/lib/realtime/client": {}, "@/lib/realtime/shared": {},
  }).useAgentChatStream;
  try {
    for (const phase of ["before-timeout", "after-timeout", "already-timed-out"]) {
      const listeners = new Set();
      const calls = [], intervals = new Set(), timeouts = new Set(), errors = [];
      let timedOut = false;
      global.document = {
        visibilityState: "hidden",
        addEventListener: (event, callback) => { assert.equal(event, "visibilitychange"); listeners.add(callback); },
        removeEventListener: (event, callback) => { assert.equal(event, "visibilitychange"); listeners.delete(callback); },
      };
      global.setInterval = (callback) => { intervals.add(callback); return callback; };
      global.clearInterval = (id) => intervals.delete(id);
      global.setTimeout = (callback) => { timeouts.add(callback); return callback; };
      global.clearTimeout = (id) => timeouts.delete(id);
      console.error = (message) => errors.push(message);
      const props = {
        embedded: { active: true, projectId: 15 }, currentUser: { id: 6 }, awaiting: true, session: { id: "a" },
        awaitingSince: { sessionId: "a", at: Date.now() - (phase === "already-timed-out" ? 4 * 60 * 1000 : 0) },
        loadMessages: (id) => calls.push(id), setReplyTimedOut: (value) => { timedOut = value; },
      };
      effects.length = 0;
      useStream(props);
      const stopPolling = effects[1]();
      const stopVisibility = effects[2]();
      assert.equal(listeners.size, 1);
      for (const callback of intervals) callback();
      for (const callback of listeners) callback();
      assert.deepEqual(calls, [], "hidden embedded chats must not reload");
      if (phase === "after-timeout") for (const callback of timeouts) callback();
      assert.equal(timedOut, phase !== "before-timeout");
      assert.equal(intervals.size, phase === "before-timeout" ? 1 : 0);
      assert.deepEqual(errors, phase === "before-timeout" ? [] : ["[agent-chat] no reply after three minutes"]);
      global.document.visibilityState = "visible";
      for (const callback of listeners) callback();
      assert.deepEqual(calls, ["a"], "returning to the active conversation must recover missed replies even after timeout");
      stopPolling?.();
      stopVisibility();
      assert.equal(listeners.size, 0, "switching sessions or unmounting must remove the old listener");
      assert.equal(intervals.size, 0);
      assert.equal(timeouts.size, 0);
      for (const inactiveProps of [
        { embedded: undefined }, { embedded: { active: false, projectId: 15 } },
        { awaiting: false }, { session: null },
      ]) {
        effects.length = 0;
        useStream({ ...props, ...inactiveProps });
        assert.equal(effects[2](), undefined);
        assert.equal(listeners.size, 0, "legacy, inactive and non-awaiting chats must not acquire the embedded recovery listener");
      }
    }
  } finally { global.document = originalDocument; Object.assign(global, originals); console.error = originalError; }
});

function loadChatComponent(file, mocks) {
  const ts = require("typescript");
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((specifier) => {
    if (specifier === "react/jsx-runtime") return require(specifier);
    assert.ok(Object.hasOwn(mocks, specifier), `unexpected component dependency: ${specifier}`);
    return { __esModule: true, ...mocks[specifier] };
  }, exports);
  return exports;
}

function findElement(element, type) {
  if (!element || typeof element !== "object") return undefined;
  if (element.type === type) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = findElement(child, type);
    if (found) return found;
  }
}

test("native switching snapshots the latest draft and attachments after open, transcript and invalidation finish", async () => {
  const originalFetch = global.fetch;
  const opening = deferred(), transcript = deferred(), invalidation = deferred();
  const transcriptStarted = deferred(), invalidationStarted = deferred();
  let selected = deferred();
  const hookSlots = [];
  let cursor = 0;
  const react = {
    useContext: () => false, useEffect: noop, useCallback: (callback) => callback, useMemo: (callback) => callback(),
    useRef: (value) => { const slot = cursor++; return hookSlots[slot] ??= { current: value }; },
    useState: (value) => {
      const slot = cursor++;
      if (!(slot in hookSlots)) hookSlots[slot] = value;
      return [hookSlots[slot], (next) => { hookSlots[slot] = typeof next === "function" ? next(hookSlots[slot]) : next; }];
    },
  };
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("");
  const editorContent = dom.window.document.createElement("div");
  let html = "<p>Before loading</p>", text = "Before loading";
  let files = [{ name: "before.txt" }];
  const writes = [];
  let sidebarFlag = true;
  let sidebarTree;
  let chat = {
    currentSession: { id: "general", agentId: null }, fileItems: files,
    editor: { getHTML: () => html, getText: () => text, commands: { setContent: (value) => { html = value; editorContent.innerHTML = value; text = editorContent.textContent; } } },
    resetFiles: (value) => { files = value; chat = { ...chat, fileItems: value }; },
    selectSession: (id) => { chat = { ...chat, currentSession: { id, agentId: id === "general" ? null : "native-agent" } }; selected.resolve(); },
    startNewSession: assert.fail,
  };
  const mocks = {
    "@/hooks/MultiPages/AIChat/useChatShortcuts": { useChatShortcuts: () => ({ enabled: false }) },
    react: { ...react, default: react },
    "@/hooks/useFlag": { useFlag: key => key !== "htpr-7800-skill-runs-in-sidebar" && sidebarFlag },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: "htpr-7518-agent-sidebar-chats" },
    "@/lib/flags/definitions/htpr-7800-skill-runs-in-sidebar": { HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG: "htpr-7800-skill-runs-in-sidebar" },
    "@/lib/flags/definitions/htpr-7688-past-chats-first": { HTPR_7688_PAST_CHATS_FIRST_FLAG: "htpr-7688-past-chats-first" },
    "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder": { HTPR_7318_TICKET_CHAT_REMINDER_FLAG: "htpr-7318-ticket-chat-reminder" },
    "@/app/agents/chat/AgentChatClient": { default: "AgentChatClient" },
    "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: (...args) => writes.push(args) },
    "@/lib/agents/chatViewerState": viewer,
    "@/utils/api/ai_chat/aiChatHelpers": { AI_Chat_API: { getSessionTranscript: () => { transcriptStarted.resolve(); return transcript.promise; } } },
    "@/store": { currentProjectAtom: "project", currentUserAtom: "user", aiChatSidebarWidthPxAtom: "width" },
    "next/navigation": { useSearchParams: () => new URLSearchParams() },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: () => { invalidationStarted.resolve(); return invalidation.promise; } }) },
    "@/lib/state": { useRecoilValue: (atom) => atom === "project" ? { id: 15 } : { id: 6 }, useRecoilState: () => [320] },
    "./MessageList": { MessageList: "MessageList" }, "./WelcomeScreen": { WelcomeScreen: "WelcomeScreen" },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => chat },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "./ChatHeader": { ChatHeader: "ChatHeader" }, "./AI_Tiptap_Container": { AI_Tiptap_Container: "Composer" },
    "./AiChatSidebarResizeHandle": { AiChatSidebarResizeHandle: "ResizeHandle" },
    "@/lib/configs/style.config": { AI_CHAT_SIDEBAR_MIN_PX: 280 },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
  };
  const { AI_Chat_Sidebar } = loadChatComponent("src/components/AI_CHAT/AI_Chat_Sidebar.tsx", mocks);
  const render = () => { cursor = 0; sidebarTree = AI_Chat_Sidebar({}); return findElement(sidebarTree, "ChatHeader").props.sidebarChats; };
  const edit = (value, filename) => {
    text = value;
    html = `<p>${value}</p>`;
    files = [{ name: filename }];
    chat = { ...chat, fileItems: files };
    return render();
  };
  const native = { kind: "native-agent", agent: { id: "native-agent", displayName: "Native", runtimeType: "NATIVE" } };
  global.fetch = () => opening.promise;
  viewer.setNativeSidebarChat(null);
  try {
    render().onSelect(native);
    edit("While opening", "opening.txt");
    opening.resolve({ ok: true, json: async () => ({ success: true, session: { id: "native" } }) });
    await transcriptStarted.promise;
    edit("While reading transcript", "transcript.txt");
    transcript.resolve({ id: "native" });
    await invalidationStarted.promise;
    edit("While invalidating", "latest.txt");
    invalidation.resolve();
    await selected.promise;
    assert.equal(render().target.kind, "native-agent");
    assert.equal(html, "");
    assert.deepEqual(files, []);
    edit("Native draft", "native.txt").onSelect({ kind: "ai" });
    assert.equal(render().target.kind, "ai");
    assert.equal(html, "<p>While invalidating</p>");
    assert.deepEqual(files, [{ name: "latest.txt" }]);
    assert.deepEqual(writes.at(-1), [6, "native-agent", "Native draft"]);
    selected = deferred();
    render().onSelect(native);
    await selected.promise;
    assert.equal(render().target.kind, "native-agent");
    assert.equal(html, "<p>Native draft</p>");
    assert.deepEqual(files, [{ name: "native.txt" }]);
    assert.equal(findElement(sidebarTree, "Composer").props.active, true, "native selection keeps the shared composer active");
    render().onSelect({ kind: "external-agent", agent: { id: "external", displayName: "External", runtimeType: "EXTERNAL" } });
    render();
    assert.equal(findElement(sidebarTree, "Composer").props.active, false, "external selection disables the retained general composer");
    sidebarFlag = false;
    render();
    assert.equal(findElement(sidebarTree, "Composer").props.active, true, "Flag Off restores the legacy active composer");
  } finally { viewer.setNativeSidebarChat(null); global.fetch = originalFetch; dom.window.close(); }
});

test("sidebar command rows forward mobile context to the shared CommandList", () => {
  for (const isMobile of [false, true]) {
    const { AgentSidebarChatCommands } = loadChatComponent("src/components/AI_CHAT/AgentSidebarChatCommands.tsx", {
      react: { useContext: () => isMobile, useEffect: noop, useMemo: (callback) => callback(), useRef: (current) => ({ current }), useState: (value) => [value, noop] },
      "@/lib/contexts/mobileContext": { MobileViewContext: {} },
      "@/components/Modals/commands/HTC/CommandList": { default: "CommandList" },
      "@/components/Modals/commands/HTC/commandSelection": { findCommandPosition: noop },
      "@/hooks/useFlag": { useFlag: () => false },
      "@/lib/ai/chipEvents": { signalAiChip: () => {} },
      "@/lib/flags/definitions/htpr-7688-past-chats-first": { HTPR_7688_PAST_CHATS_FIRST_FLAG: "htpr-7688-past-chats-first" },
      "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder": { HTPR_7318_TICKET_CHAT_REMINDER_FLAG: "htpr-7318-ticket-chat-reminder" },
      "@/lib/flags/definitions/htpr-7702-phone-chat-list": { HTPR_7702_PHONE_CHAT_LIST_FLAG: "htpr-7702-phone-chat-list" },
      "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({}) },
      "@/models/enums": { CommandMode: { GoToAgentChat: 1 } },
    });
    const result = AgentSidebarChatCommands({ context: { target: { kind: "ai" }, agents: [] }, anchorRef: { current: null }, onClose: noop });
    assert.equal(findElement(result, "CommandList").props.isMobile, isMobile);
  }
});

test("a flagged sidebar deep link wakes the lazy runtime before the chat layout mounts on phones", () => {
  const source = read("src/components/ProviderGlobal/GloablProviders.tsx");
  assert.doesNotMatch(source, /useSearchParams/);
  assert.match(source, /const shouldMountChatRuntime =\s*chatRuntimeMounted \|\|\s*sidebarRequested \|\|/);
  const ts = require("typescript");
  const parsed = ts.createSourceFile("GloablProviders.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" &&
      node.arguments[0]?.getText(parsed).startsWith("agentSidebarChatsEnabled ?")) effect = node.arguments[0].getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(effect, "the parent provider must own the flagged cold-open effect");
  for (const enabled of [false, true]) {
    for (const search of ["", "?agentSidebar=1"]) {
      const writes = [];
      const callback = new Function("agentSidebarChatsEnabled", "window", "setSidebarRequested", "setSidebarMode", "setAiChatAutoOpenSuppressed", "setShowAiChatInterface", `return (${effect})`)(
        enabled, { location: { search } },
        (value) => writes.push(["runtime", value]), (value) => writes.push(["sidebar", value]),
        (value) => writes.push(["suppressed", value]), (value) => writes.push(["open", value]),
      );
      callback();
      assert.deepEqual(writes, enabled && search
        ? [["runtime", true], ["sidebar", true], ["suppressed", false], ["open", true]]
        : [["runtime", false]], "opening must not depend on the closed phone panel mounting; Off and unrequested routes stay closed");
    }
  }
});

test("flag Off ignores a stale native-sidebar registration when resolving the general board chat", async () => {
  const mapped = { id: "mapped", userId: 6, agentId: "native-agent", projectId: 15, taskId: null, messages: [] };
  for (const paging of [false, true]) {
    const { context, state, created } = boardContext(mapped, paging);
    context.agentSidebarChatsEnabled = false;
    viewer.setNativeSidebarChat({ sessionId: mapped.id, projectId: 15 });
    try {
      assert.equal((await sessionsHook(context).ensureSessionForCurrentBoard()).id, created.id);
      assert.equal(state.created, 1);
    } finally { viewer.setNativeSidebarChat(null); }
  }
});

test("chat orchestration forwards the sidebar flag without coupling it to history paging", () => {
  const flag = "htpr-7518-agent-sidebar-chats";
  for (const enabled of [false, true]) {
    let resolution;
    const { useAiChat } = load("src/hooks/MultiPages/AIChat/useAiChat.ts", {
      "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigateToTask() {} }) },
      react: { useState: (value) => [value, noop], useEffect: noop },
      "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
      "@/lib/ai/chipEvents": { signalAiChip: () => {} },
      "@/lib/state": { useRecoilState: () => [null, noop] }, "@/store": {},
      "./useAiChatState": { useAiChatState: () => ({ sessionPagingEnabled: true }) },
      "./useAiChatSessions": { useAiChatSessions: (context) => { resolution = context; return {}; } },
      "./aiChatSend": { createAiChatSend: () => ({}) },
      "./useAiChatAttachments": { useAiChatAttachments: () => ({}) },
      "./aiChatKeyboard": { createAiChatKeyboard: () => ({}) },
      "./useAiChatPresentation": { useAiChatPresentation: () => ({}) },
    });
    useAiChat();
    assert.equal(resolution.agentSidebarChatsEnabled, enabled);
    assert.equal(resolution.sessionPagingEnabled, false);
  }
});

test("Go to Agent Chat opens the board sidebar only with the ticket flag and a board; Off keeps the old route", () => {
  const originalWindow = global.window;
  const { CommandMode } = load("src/models/enums.ts", {});
  const { createCommandDispatcher } = load("src/components/commandDispatcher.ts", {
    "@/lib/agents/chatPaletteCommands": {}, "@/hooks/Kanban/mobileBoardGestures": {},
    "react-hot-toast": {}, "@/lib/constants": {}, "@/lib/constants/aiEvents": {},
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {}, "@/lib/tours/types": {},
    "./Modals/Settings/settingsNavigation": {}, "@/lib/snippets": {}, "@/lib/timeQuickLog": {},
    "@/lib/aiChatDisplayMode": {},
  });
  try {
    for (const enabled of [false, true]) for (const project of [undefined, { id: 15 }]) {
      const changes = [], pushes = [], replacements = [], events = [];
      global.window = { location: { pathname: "/project", search: "?id=15&surface=board" }, dispatchEvent: (event) => events.push(event.type) };
      createCommandDispatcher({
        agentSidebarChatsEnabled: enabled, _currentProject: project,
        setShowCommands: noop, setCommandMode: noop, boardCloseHandler: noop,
        setIsSidebarMode: (value) => changes.push(["sidebar", value]),
        setAiChatAutoOpenSuppressed: (value) => changes.push(["suppressed", value]),
        setAiChatExplicitOpenAt: (value) => assert.equal(typeof value, "number"),
        setShowAiChatInterface: (value) => changes.push(["open", value]),
        router: { push: (url) => pushes.push(url), replace: (url) => replacements.push(url) },
      }).handleAction(CommandMode.GoToAgentChat);
      if (enabled && project) {
        assert.deepEqual(changes, [["sidebar", true], ["suppressed", false], ["open", true]]);
        assert.deepEqual(replacements, ["/project?id=15&surface=board&agentSidebar=1"]);
        assert.deepEqual(events, ["ht-agent-sidebar-open"]);
        assert.deepEqual(pushes, []);
      } else {
        assert.deepEqual(pushes, ["/agents/chat"]);
        assert.deepEqual(changes, []);
        assert.deepEqual(replacements, []);
        assert.deepEqual(events, []);
      }
    }
  } finally { global.window = originalWindow; }
});

test("late history loads read current activity rather than the activity captured before awaiting", async () => {
  const originalFetch = global.fetch;
  const activity = { current: true };
  const reads = [];
  const useSession = load("src/app/agents/chat/useAgentChatSession.ts", {
    react: { ...hooks, useRef: () => activity },
    "react-dom": { flushSync: (callback) => callback() },
    "react-hot-toast": { default: { error: assert.fail } },
    "@/lib/agents/chatDrafts": { readDraft: () => "", writeDraft: noop },
    "@/lib/agents/chatViewerState": { markChatRead: (...args) => reads.push(args), saveDraftToServer: noop },
  }).useAgentChatSession;
  try {
    for (const [initial, final] of [[true, false], [false, true], [true, true], [false, false]]) {
      reads.length = 0;
      const pending = deferred();
      global.fetch = () => pending.promise;
      const props = chatProps({ projectId: 15, active: initial });
      const messages = [];
      props.setMessages = (value) => messages.push(value);
      const loading = useSession(props).loadMessages("a");
      useSession({ ...props, embedded: { projectId: 15, active: final } });
      pending.resolve({ ok: true, json: async () => ({ success: true, messages: [], viewer: { draft: "", unreadCount: 3 } }) });
      await loading;
      assert.equal(messages.length, 1, "hidden histories may still warm their retained feed");
      assert.deepEqual(reads, final ? [["a", 15]] : [], `${initial} -> ${final}`);
    }
    reads.length = 0;
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true, messages: [], viewer: { unreadCount: 1 } }) });
    await useSession(chatProps(undefined)).loadMessages("a");
    assert.deepEqual(reads, [["a", undefined]], "standalone chat retains read handling");
  } finally { global.fetch = originalFetch; }
});

test("conversation Escape is captured even when the mobile sheet moved focus away from the list", () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<button id='title' aria-label='Switch conversation'>AI chat</button><div id='host' tabindex='-1'></div><input id='other'>");
  const originalDocument = global.document, originalWindow = global.window;
  global.document = dom.window.document;
  global.window = dom.window;
  const host = document.getElementById("host"), title = document.getElementById("title");
  host.scrollIntoView = noop;
  const effects = [];
  let refs = 0, closed = 0, sheetClosed = 0;
  const { AgentSidebarChatCommands } = loadChatComponent("src/components/AI_CHAT/AgentSidebarChatCommands.tsx", {
    react: { useContext: () => true, useEffect: (callback) => effects.push(callback), useMemo: (callback) => callback(), useRef: () => ({ current: refs++ === 0 ? host : null }), useState: (value) => [value, noop] },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/components/Modals/commands/HTC/CommandList": { default: "CommandList" },
    "@/components/Modals/commands/HTC/commandSelection": { findCommandPosition: noop },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/definitions/htpr-7688-past-chats-first": { HTPR_7688_PAST_CHATS_FIRST_FLAG: "htpr-7688-past-chats-first" },
    "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder": { HTPR_7318_TICKET_CHAT_REMINDER_FLAG: "htpr-7318-ticket-chat-reminder" },
    "@/lib/flags/definitions/htpr-7702-phone-chat-list": { HTPR_7702_PHONE_CHAT_LIST_FLAG: "htpr-7702-phone-chat-list" },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({}) },
    "@/models/enums": { CommandMode: { GoToAgentChat: 1 } },
  });
  try {
    AgentSidebarChatCommands({ context: { target: { kind: "ai" }, agents: [] }, anchorRef: { current: title }, onClose: () => { closed++; } });
    const cleanup = effects[0]();
    document.addEventListener("keydown", () => { sheetClosed++; });
    document.getElementById("other").focus();
    document.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(closed, 1);
    assert.equal(sheetClosed, 0);
    assert.equal(document.activeElement, title);
    cleanup();
    title.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(sheetClosed, 1, "after picker unmount, the sheet regains its Escape handler");
    assert.equal(closed, 1);
  } finally { global.document = originalDocument; global.window = originalWindow; dom.window.close(); }
});

test("general editor dictation resolves the recorder inside its own composer rather than the first document id", () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<div data-ai-chat-composer-root><div data-ai-chat-recorder id="hidden"></div></div><div data-ai-chat-composer-root><div id="editor"></div><div data-ai-chat-recorder id="visible"></div></div>');
  const originalDocument = global.document;
  global.document = dom.window.document;
  const { createAiChatKeyboard } = load("src/hooks/MultiPages/AIChat/aiChatKeyboard.ts", {
    "@/lib/constants/keyboard-handler": { KeyCodes: { D: 68 } },
    "@/lib/skills/slashSkills": { SLASH_MENU_DOM_ID: "slash-menu" },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: {} },
    "./aiChatShared": {},
  });
  const clicks = [];
  document.getElementById("hidden").addEventListener("click", () => clicks.push("hidden"));
  document.getElementById("visible").addEventListener("click", () => clicks.push("visible"));
  let prevented = false;
  try {
    createAiChatKeyboard({ editor: { view: { dom: document.getElementById("editor") } }, isApple: false }).tiptapKeydown({
      keyCode: 68, ctrlKey: true, shiftKey: true, preventDefault: () => { prevented = true; },
    });
    assert.deepEqual(clicks, ["visible"]);
    assert.equal(prevented, true);
  } finally { global.document = originalDocument; dom.window.close(); }
});

test("switching away cancels the recorder and clears retained recording state before returning, without changing standalone chat", async () => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const previous = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, { exists: Object.hasOwn(global, key), value: global[key] }]));
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let stopped = 0, recording = false;
  function Recorder({ toggleRecording }) {
    React.useEffect(() => () => { stopped++; }, []);
    return React.createElement("button", { "data-recorder": true, onClick: () => toggleRecording(true) }, "Dictate");
  }
  function Composer({ controlledComposer }) {
    return React.createElement("div", null,
      React.createElement(Recorder, { toggleRecording: controlledComposer.onRecordingChange }),
      React.createElement("button", { "aria-label": "Send message", disabled: controlledComposer.sendDisabled }, "Send"));
  }
  const { AgentChatPane } = loadChatComponent("src/app/agents/chat/AgentChatPane.tsx", {
    react: React,
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": load("src/lib/flags/keys.ts", {}),
    "@/components/Agents/AgentAvatar": { default: () => null },
    "@/components/AI_CHAT/AI_Tiptap_Container": { AI_Tiptap_Container: Composer },
    "@/components/AI_CHAT/TypingIndicator": { TypingIndicator: () => null },
    "@/components/RTE/Components/AudioButton": { AudioButton: Recorder },
    "@/lib/configs/general.config": { MOBILE_TARGET: "" },
    "@/utils/undoActions/helperFuncs": { cn: () => "" },
    "lucide-react": { ArrowLeft: () => null, ChevronLeft: () => null, ChevronRight: () => null, Info: () => null },
    "./AgentChatFeedItems": { chatStatusText: () => "offline", emptyFeedText: () => "No messages" },
  });
  function RetainedChat({ active, embedded, reuseAiComposer }) {
    const [isRecording, setIsRecording] = React.useState(false);
    recording = isRecording;
    return React.createElement(AgentChatPane, {
      active, embedded, reuseAiComposer, isRecording, setIsRecording,
      selectedAgent: { id: "a", displayName: "Agent A" }, isExternal: true,
      draft: "Retained draft", messages: [], visibleFeed: [], queuedMessages: [],
      setIsDictationProcessing: noop, handleSend: noop,
    });
  }
  const container = document.getElementById("root");
  const root = createRoot(container);
  try {
    for (const embedded of [true, false]) for (const reuseAiComposer of [true, false]) {
      await React.act(async () => root.render(null));
      stopped = 0;
      const render = (active) => React.createElement(RetainedChat, { active, embedded, reuseAiComposer });
      const send = () => container.querySelector('[aria-label="Send message"]');
      await React.act(async () => root.render(render(true)));
      assert.equal(send().disabled, false);
      await React.act(async () => container.querySelector("[data-recorder]").click());
      assert.equal(recording, true);
      assert.equal(send().disabled, true);
      await React.act(async () => root.render(render(false)));
      assert.equal(stopped, 1, "deactivation must unmount the old recorder so its stream cleanup runs");
      assert.equal(container.querySelector("[data-recorder]"), null);
      assert.equal(recording, !embedded, "only the flagged embedded lifecycle resets the parent's recording state");
      await React.act(async () => root.render(render(true)));
      assert.equal(send().disabled, !embedded, "returning to the embedded draft must enable Send");
      if (!reuseAiComposer) assert.equal(container.querySelector("textarea").value, "Retained draft");
    }
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, saved] of previous) {
      if (saved.exists) global[key] = saved.value;
      else delete global[key];
    }
  }
});

for (const scenario of ["inactive", "active", "pending-permission"]) test({
  inactive: "switching general dictation to an agent stops all tracks, discards audio and ignores Enter while inactive",
  active: "active general dictation still records and Enter still transcribes, including the default active composer",
  "pending-permission": "switching to an agent while general dictation awaits permission stops late microphone tracks without recording",
}[scenario], async () => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai" });
  const keys = ["window", "document", "navigator", "localStorage", "MediaRecorder", "FileReader", "requestAnimationFrame", "cancelAnimationFrame", "fetch", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const tracks = [0, 0], recorders = [], submissions = [], transcripts = [], recordingStates = [];
  const permission = deferred();
  const stream = { getTracks: () => tracks.map((_, index) => ({ stop: () => { tracks[index]++; } })) };
  let acquisitions = 0;
  class Recorder extends dom.window.EventTarget {
    static isTypeSupported() { return true; }
    constructor(_stream, options) { super(); this.mimeType = options?.mimeType; this.state = "inactive"; this.stops = 0; recorders.push(this); }
    start() { this.state = "recording"; }
    requestData() {
      const event = new dom.window.Event("dataavailable");
      event.data = new Blob(["x".repeat(1400)]);
      this.dispatchEvent(event);
    }
    stop() { assert.equal(this.state, "recording"); this.state = "inactive"; this.stops++; }
    finish() { this.dispatchEvent(new dom.window.Event("stop")); }
  }
  class Reader {
    readAsDataURL() { this.result = "data:audio/webm;base64,YXVkaW8="; queueMicrotask(() => this.onloadend()); }
  }
  const globals = {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    navigator: { mediaDevices: { getUserMedia: () => { acquisitions++; return scenario === "pending-permission" ? permission.promise : Promise.resolve(stream); } } },
    MediaRecorder: Recorder, FileReader: Reader, requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
    fetch: async (...args) => { submissions.push(args); return new Response("data: dictated text\n"); },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { value, writable: true, configurable: true });
  const { AudioButton } = loadChatComponent("src/components/RTE/Components/AudioButton.tsx", {
    react: { ...React, default: React },
    "@/components/Common/Tooltip": { default: () => null },
    "lucide-react": Object.fromEntries(["Check", "ChevronDown", "Loader2", "Mic", "X"].map((name) => [name, () => null])),
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { fontSizes: {} } },
    "@/lib/constants/APIRouteConstants": { audioTranscriptRoute: "/api/audio-transcript" },
    "@/store": {}, "@/lib/state": { useRecoilValue: () => ({ id: 15 }) },
    "react-hot-toast": { default: { error: assert.fail } },
    "@/lib/utils/deliberateTap": load("src/lib/utils/deliberateTap.ts", {}),
    "@/lib/dictationLimits": load("src/lib/dictationLimits.ts", {}),
    "@/lib/dictationSse": load("src/lib/dictationSse.ts", {}),
    "./mobileAudioButtonPresentation": { mobileMicPresentation: () => ({ prominent: false }) },
  });
  const composerMocks = Object.fromEntries([
    "../Global/ModelSelectorDropdown", "../Common/Tooltip", "@/components/Modals/OptionPicker", "@/lib/configs/aiTaskWriter.config",
    "@/lib/controlledComposerEditor", "lucide-react", "../Common/AttachmentsUpload/ImageGalleryView",
    "@/lib/contexts/deviceContext", "@/lib/contexts/mobileContext", "@/store",
    "@/hooks/MultiPages/useGetAllTeamsMinimal", "@/utils/aiChat/sortBoardsByRecent",
    "@/utils/aiChat/extractPastedImageFiles", "./AiChatComposerActionRow", "./AttachmentButton",
    "./AiComposerTextarea", "@/lib/flags/keys", "./ChatScopeChip", "./SendMessageButton",
    "@/components/Common/QueuedMessagesStrip", "react-hot-toast", "@/utils/aiChat/focusRequestWindow",
    "@/hooks/MultiPages/AIChat/useDockedChatScope",
  ].map((specifier) => [specifier, {}]));
  const chat = {
    editor: { getHTML: () => "", getText: () => "" }, isTyping: false, isRecording: false,
    queuedMessages: [], contextList: [], fileItems: [],
    audioTiptapCallback: (text) => transcripts.push(text), toggleRecording: (value) => recordingStates.push(value),
  };
  const { AI_Tiptap_Container } = loadChatComponent("src/components/AI_CHAT/AI_Tiptap_Container.tsx", {
    ...composerMocks,
    "@/lib/flags/keys": load("src/lib/flags/keys.ts", {}),
    "@/hooks/MultiPages/AIChat/dockedChatScope": load("src/hooks/MultiPages/AIChat/dockedChatScope.ts", {}),
    react: { ...hooks, useContext: () => false, useMemo: (callback) => callback(), useState: (value) => [value, noop], useId: () => "general" },
    "@tiptap/react": { useEditorState: () => true },
    "@/styles/tiptap.module.scss": { default: {} },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => chat },
    "../RTE/Components/AudioButton": { default: AudioButton },
    "./AiChatComposerActionRow": { AiChatComposerActionRow: "ActionRow" },
    "next/navigation": { usePathname: () => "/project" },
    "@/lib/state": { useRecoilState: () => [null, noop] },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
  });
  const container = document.getElementById("root");
  const root = createRoot(container);
  const preCleanupKeys = [];
  function InactiveKeyProbe() {
    React.useLayoutEffect(() => {
      if (scenario === "inactive") assert.equal(recorders[0].state, "recording", "probe keys before passive cancellation clears the recording ref");
      for (const [value, code] of [["Enter", 13], ["Escape", 27]]) preCleanupKeys.push(key(value, code).defaultPrevented);
    }, []);
    return null;
  }
  const render = (active) => {
    const recorder = findElement(AI_Tiptap_Container({ active }), "ActionRow").props.recorder;
    assert.ok(recorder, "exercise the real general composer's recorder props");
    assert.equal(recorder.props.active, active ?? true);
    return React.createElement("div", { hidden: active === false }, recorder, active === false ? React.createElement(InactiveKeyProbe) : null);
  };
  const key = (value, keyCode) => {
    const event = new dom.window.KeyboardEvent("keydown", { key: value, keyCode, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event;
  };
  try {
    await React.act(async () => root.render(render(scenario === "active" ? undefined : true)));
    await React.act(async () => container.querySelector("[data-ai-chat-recorder]").click());
    assert.equal(acquisitions, 1);
    if (scenario === "active") {
      assert.deepEqual(recordingStates, [true]);
      let enter;
      await React.act(async () => { enter = key("Enter", 13); });
      assert.equal(enter.defaultPrevented, true);
      assert.equal(recorders[0].stops, 1);
      await React.act(async () => recorders[0].finish());
      assert.deepEqual(tracks, [1, 1]);
      assert.deepEqual(recordingStates, [true, false]);
      assert.equal(submissions.length, 1);
      assert.deepEqual(transcripts, ["dictated text"]);
      await React.act(async () => container.querySelector("[data-ai-chat-recorder]").click());
      let escape;
      await React.act(async () => { escape = key("Escape", 27); });
      assert.equal(escape.defaultPrevented, true, "active Escape still cancels recording");
      await React.act(async () => recorders[1].finish());
      assert.equal(submissions.length, 1, "active Escape discards rather than transcribes");
    } else {
      if (scenario === "inactive") assert.deepEqual(recordingStates, [true]);
      await React.act(async () => root.render(render(false)));
      assert.deepEqual(preCleanupKeys, [false, false], "inactive document keys must be ignored even before passive recording cancellation");
      if (scenario === "pending-permission") await React.act(async () => permission.resolve(stream));
      assert.deepEqual(tracks, [1, 1], "deactivation stops every track before the recorder's asynchronous stop event");
      if (scenario === "inactive") {
        assert.equal(recorders[0].stops, 1);
        assert.deepEqual(recordingStates, [true, false]);
      } else assert.equal(recorders.length, 0, "a late microphone grant must not start hidden recording");
      for (const [value, code] of [["Enter", 13], ["Escape", 27]]) {
        let event;
        await React.act(async () => { event = key(value, code); });
        assert.equal(event.defaultPrevented, false, "inactive recorders must not handle document keys");
      }
      await React.act(async () => container.querySelector("[data-ai-chat-recorder]").click());
      assert.equal(acquisitions, 1, "inactive recorders must not reacquire the microphone");
      if (scenario === "inactive") await React.act(async () => recorders[0].finish());
      assert.deepEqual(submissions, []);
      assert.deepEqual(transcripts, []);
      await React.act(async () => root.render(render(true)));
      assert.ok(container.querySelector("[data-ai-chat-recorder]"), "returning to general chat keeps its recorder mounted and idle");
    }
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});
