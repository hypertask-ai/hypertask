const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const query = require("@tanstack/react-query");
const { loader } = require("./helpers/htpr-7260-ui.cjs");
const { load } = require("./task-route-loader.cjs");
const navigation = load("src/lib/aiChat/chatNavigationState.ts", {});
const flag = "htpr-7783-remember-chat";
const atoms = Object.fromEntries(["currentUserAtom", "currentProjectAtom", "fullScreenChatScopeAtom", "composeTaskChatIntroAtom", "composeTaskSkillFollowupAtom", "showAIChatInterfaceAtom", "aiChatAutoOpenPageAtom", "aiChatNewTicketPathAtom", "aiChatAutoOpenSuppressedAtom", "aiChatPinnedAtom", "recentChatBoardIdsAtom", "aiChatBoardSessionMapAtom", "aiChatExplicitOpenAtAtom", "isAiChatSidebarModeAtom", "showMentionListAtom", "inViewObjectAtom", "dockedChatScopeAtom", "dockedChatScopePickedOnBoardAtom", "aiChatPendingPromptAtom"].map(name => [name, name]));
const response = data => ({ data });
const row = (id, projectId = 15, userId = 985) => ({ id, projectId, userId, taskId: null, agentId: null, title: id, createdAt: new Date(), updatedAt: new Date(`2026-10-24T${id === "explicit-new" ? "13" : id === "newest" ? "12" : "11"}:00:00.000Z`), messages: [{ id: `${id}-message`, role: "assistant", content: `History ${id}`, createdAt: new Date() }] });

async function withChat(options, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/chat" });
  const previous = new Map(["window", "document", "navigator", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(global, key, { configurable: true, writable: true, value });
  const values = new Map([[atoms.currentUserAtom, { id: 985, uid: "qa" }], [atoms.currentProjectAtom, { id: 15 }], [atoms.fullScreenChatScopeAtom, options.fullscreen ? (options.allBoards ? null : 15) : null], [atoms.recentChatBoardIdsAtom, []], [atoms.aiChatBoardSessionMapAtom, {}], [atoms.showAIChatInterfaceAtom, !options.panel], [atoms.dockedChatScopeAtom, options.dockedScope ?? null], [atoms.aiChatPendingPromptAtom, options.pendingPrompt ?? null]]);
  const listeners = new Set();
  const set = (atom, next) => { const value = typeof next === "function" ? next(values.get(atom) ?? null) : next; if (Object.is(value, values.get(atom))) return; values.set(atom, value); listeners.forEach(fn => fn()); };
  const setters = new Map();
  const setter = atom => { if (!setters.has(atom)) setters.set(atom, next => set(atom, next)); return setters.get(atom); };
  const state = { useRecoilValue: atom => React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => values.get(atom) ?? null), useRecoilState: atom => [state.useRecoilValue(atom), setter(atom)], useSetRecoilState: setter };
  let nativeSidebar = null;
  let pathname = options.fullscreen ? "/chat" : "/project", visible = true, history, resolver, chatState, panelReserve, messageListElement;
  const panelReserves = [];
  const rows = options.rows ?? [row("newest"), row("older"), row("other-board", 25), row("other-user", 15, 2343)];
  const calls = [];
  const api = {
    addMessage: async (_sessionId, message) => response({ message }),
    getAllSessions: async () => { if (options.historyLoad) await options.historyLoad; if (options.historyError) throw new Error("History unavailable"); return response({ success: true, sessions: rows.filter(item => item.userId === values.get(atoms.currentUserAtom).id) }); },
    getSessionPage: async (scope = {}) => {
      if (options.historyLoad) await options.historyLoad;
      if (options.historyError) throw new Error("History unavailable");
      calls.push(["page", scope]);
      const visible = rows.filter(item => item.userId === values.get(atoms.currentUserAtom).id && (scope.taskId === undefined || item.taskId === scope.taskId) && (!scope.projectId || (item.projectId === scope.projectId && item.taskId === null)));
      const offset = Number(scope.cursor ?? 0), limit = scope.limit ?? 30;
      return response({ success: true, sessions: visible.slice(offset, offset + limit).map(({ messages, ...item }) => ({ ...item, hasMessages: messages.length > 0 })), nextCursor: offset + limit < visible.length ? String(offset + limit) : null });
    },
    getSessionTranscript: async id => { calls.push(["transcript", id]); if (options.transcriptLoad) await options.transcriptLoad; return rows.find(item => item.id === id && item.userId === values.get(atoms.currentUserAtom).id) ?? null; },
    createSessionNext: async (taskId, projectId) => { calls.push(["create", taskId, projectId]); const session = { ...row("explicit-new"), taskId: taskId ?? null, projectId: projectId ?? null, messages: [] }; rows.unshift(session); return response({ success: true, session }); },
  };
  const wire = load("src/utils/api/ai_chat/aiChatHelpers.ts", { "@/lib/constants": { default: {} }, "@/utils/axiosClient": { default: {} } });
  const source = loader({
    "@/tiptap/pm/state": { EditorState: { create: value => value } },
    "@tiptap/pm/state": { EditorState: { create: value => value } },
    "@/store": atoms, "@/lib/state": state,
    "@/hooks/useFlag": { useFlag: key => key === "htpr-6929-compose-task-writer" ? !!options.compose : key === "htpr-8088-manual-chat" ? !!options.manualChat : key === "htpr-7736-chat-follows-task" ? !!options.followsTask : key === flag ? options.enabled !== false : key === "htpr-6971-chat-history-paging" ? options.paged : key === "htpr-7518-agent-sidebar-chats" ? !!options.agentSidebar : ["htpr-7052-chat-names", "htpr-6936-ask-ai-fullscreen"].includes(key), useFlagReady: () => true },
    "@/lib/flags/keys": { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "htpr-6929-compose-task-writer", HTPR_7783_REMEMBER_CHAT_FLAG: flag, HTPR_6971_CHAT_HISTORY_PAGING_FLAG: "htpr-6971-chat-history-paging", HTPR_7052_CHAT_NAMES_FLAG: "htpr-7052-chat-names", HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: "htpr-7518-agent-sidebar-chats", HTPR_6936_ASK_AI_FULLSCREEN_FLAG: "htpr-6936-ask-ai-fullscreen" },
    "@/lib/aiChat/chatNavigationState": navigation,
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => nativeSidebar },
    "next/dynamic": { default: () => () => null },
    "@/hooks/MultiPages/AIChat/useAiChat": { useAiChat: () => useChatContext() },
    "next/navigation": { usePathname: () => pathname, useSearchParams: () => new URLSearchParams() },
    "@/utils/api/ai_chat": { ...wire, AI_Chat_API: api },
    "@/lib/constants": { default: {} }, "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => ({}) },
    "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false }, "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
    "@/hooks/RecoilRoot/useHypertasksRecoilStates": { default: () => ({}) }, "@/components/Modals/McpToken/hooks/useMcpToken": { useMcpToken: () => ({}) },
    "./useAiChatModelPreference": { useAiChatModelPreference: () => ({}) }, "./aiChatShared": { aiOptionsWithoutOpenRouter: [] },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ ...history, chatMounted: true, registerMessageListRef: element => { messageListElement = element; }, handleMessageListScroll() {}, scrollMessagesToBottom: () => { if (messageListElement) messageListElement.scrollTop = 1000; } }) },
    "./MessageItem": { MessageItem: ({ message }) => React.createElement("p", null, message.content) }, "./TypingIndicator": { TypingIndicator: () => null },
    "./useAiChatOpenPreferences": { useSyncAiChatOpenPreferences() {}, useAiChatOpenPreferences: () => ({ enabled: true, ready: true, flagReady: true, values: { aiChatOpenBoards: options.boardAutoOpen !== false, aiChatOpenTickets: true, aiChatOpenNewTickets: options.newTicketAutoOpen !== false } }) },
  });
  const { useAiChatSessions } = source("src/hooks/MultiPages/AIChat/useAiChatSessions.ts");
  const { useAiChatState } = source("src/hooks/MultiPages/AIChat/useAiChatState.ts");
  const { ChatRuntime } = source("src/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context.tsx");
  const { MessageList } = source("src/components/AI_CHAT/MessageList.tsx");
  const { useAiChatAutoOpen } = source("src/hooks/General/useAiChatAutoOpen.ts");
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let root = createRoot(document.getElementById("root"));
  function useChatContext() {
    chatState = useAiChatState();
    history = { ...chatState, sessions: chatState.sessions, isSuccess: chatState.chatHistoryReady, selectSession: chatState.selectSessionInHistory, startNewSession: chatState.createSession };
    resolver = useAiChatSessions({ ...chatState, agentSidebarChatsEnabled: !!options.agentSidebar });
    return { ...chatState, ...resolver, editorEnabled: false, fileItems: [], layoutKeydown() {}, handleSendMessage: async (prompt, options) => {
      const session = await resolver.ensureSessionForCurrentBoard(0);
      assert.ok(session, "pending prompt resolves a session before sending");
      calls.push(["send", session.id, prompt, options]);
      return true;
    } };
  }
  function Probe() {
    if (options.panel) { panelReserve = useAiChatAutoOpen(false).reserve; panelReserves.push(panelReserve); return null; }
    useChatContext();
    return options.scroll ? React.createElement(MessageList, { sidebarKey: "ai" }) : React.createElement("div", null, chatState.currentSession?.messages.map(item => item.content).join(" "));
  }
  const flush = async () => { for (let i = 0; i < 5; i++) await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); };
  const render = async () => { await React.act(async () => root.render(React.createElement(query.QueryClientProvider, { client }, visible ? (options.runtime ? React.createElement(ChatRuntime, { onValue() {} }) : React.createElement(Probe)) : null))); await flush(); };
  try {
    await render();
    await check({ reserve: () => panelReserve, panelReserves, history: () => history, chatState: () => chatState, resolver: () => resolver, calls, rows, dom, values, flush, render,
      setNativeSidebar: value => { nativeSidebar = value; },
      set: async (atom, value) => { await React.act(async () => set(atom, value)); await flush(); },
      visit: async route => { pathname = route; await render(); },
      settings: async () => { visible = false; pathname = "/settings/profile"; await render(); },
      returnToChat: async route => { visible = true; pathname = route ?? (options.fullscreen ? "/chat" : "/project"); await render(); },
      reload: async () => { await React.act(async () => root.unmount()); client.clear(); if (options.panel) values.set(atoms.showAIChatInterfaceAtom, false); root = createRoot(document.getElementById("root")); await render(); },
    });
  } finally {
    await React.act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
  }
}

for (const paged of [false, true]) for (const fullscreen of [false, true]) {
  test(`${paged ? "paged" : "legacy"} ${fullscreen ? "fullscreen" : "docked"}: Settings and reload keep the selected older chat and history without creating a session`, async () => {
    await withChat({ paged, fullscreen }, async view => {
      await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
      assert.equal(view.history().currentSession.id, "older");
      await view.settings(); await view.returnToChat();
      assert.equal(view.history().currentSession.id, "older");
      assert.equal(document.body.textContent, "History older");
      await view.reload();
      assert.equal(view.history().currentSession.id, "older");
      assert.equal(document.body.textContent, "History older");
      assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
      await React.act(async () => { await view.resolver().startNewSession(); }); await view.flush();
      assert.equal(view.history().currentSession.id, "explicit-new");
      assert.equal(view.calls.filter(([type]) => type === "create").length, 1);
    });
  });
}

test("selection is isolated by user and board", async () => {
  await withChat({ paged: true }, async view => {
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    await view.set(atoms.currentProjectAtom, { id: 25 });
    assert.equal(view.history().currentSession.id, "other-board");
    await view.set(atoms.currentProjectAtom, { id: 15 });
    assert.equal(view.history().currentSession.id, "older");
    await view.set(atoms.currentUserAtom, { id: 2343, uid: "other" });
    assert.equal(view.history().currentSession.id, "other-user");
    await view.set(atoms.currentUserAtom, { id: 985, uid: "qa" });
    assert.equal(view.history().currentSession.id, "older");
  });
});

test("composer draft survives Settings, a reload and switching conversations", async () => {
  await withChat({ paged: true }, async view => {
    let html = "", updates = new Set();
    const editor = { get isEmpty() { return !html; }, state: {}, view: { updateState() {} }, isDestroyed: false, commands: { setContent: value => { html = value; } }, getHTML: () => html, on: (_event, fn) => updates.add(fn), off: (_event, fn) => updates.delete(fn) };
    await React.act(async () => view.chatState().editorMountProps.onEditor(editor));
    html = "<p>Keep this unsent draft</p>"; updates.forEach(fn => fn());
    await view.settings(); await view.returnToChat();
    html = "";
    await React.act(async () => view.chatState().editorMountProps.onEditor(editor));
    assert.equal(html, "<p>Keep this unsent draft</p>");
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    assert.equal(html, "");
    html = "<p>Older thread draft</p>"; updates.forEach(fn => fn());
    await view.reload();
    html = "";
    await React.act(async () => view.chatState().editorMountProps.onEditor(editor));
    assert.equal(html, "<p>Older thread draft</p>");
  });
});

test("a silent sidebar composer swap cannot overwrite the previous conversation's draft", async () => {
  await withChat({ paged: true }, async view => {
    let html = "";
    const updates = new Set();
    const editor = { get isEmpty() { return !html; }, state: {}, view: { updateState() {} }, isDestroyed: false, commands: { setContent: value => { html = value; } }, getHTML: () => html, on: (_event, fn) => updates.add(fn), off: (_event, fn) => updates.delete(fn) };
    await React.act(async () => view.chatState().editorMountProps.onEditor(editor));
    html = "<p>General draft</p>"; updates.forEach(fn => fn());
    const key = view.chatState().navigationKey;
    await React.act(async () => {
      const selected = view.history().selectSession("older");
      editor.commands.setContent("", { emitUpdate: false });
      await selected;
    }); await view.flush();
    assert.equal(window.sessionStorage.getItem("ht:aiChatDraft:985:newest"), "<p>General draft</p>");
    assert.equal(html, "");
    html = "<p>Other draft</p>"; updates.forEach(fn => fn());
    await React.act(async () => {
      const selected = view.history().selectSession("newest");
      editor.commands.setContent("<p>General draft</p>", { emitUpdate: false });
      await selected;
    }); await view.flush();
    assert.equal(window.sessionStorage.getItem("ht:aiChatDraft:985:older"), "<p>Other draft</p>");
    assert.equal(html, "<p>General draft</p>");
    await view.settings(); await view.returnToChat();
    html = "";
    await React.act(async () => view.chatState().editorMountProps.onEditor(editor));
    assert.equal(html, "<p>General draft</p>");
    await view.reload();
    html = "";
    await React.act(async () => view.chatState().editorMountProps.onEditor(editor));
    assert.equal(html, "<p>General draft</p>");
  });
});

test("scrolling up survives Settings and reload instead of jumping to the newest message", async () => {
  await withChat({ paged: true, scroll: true }, async view => {
    const element = document.querySelector(".overflow-y-auto");
    assert.equal(element.scrollTop, 1000);
    Object.defineProperties(element, { scrollHeight: { value: 1200 }, clientHeight: { value: 200 } });
    element.scrollTop = 120;
    await React.act(async () => element.dispatchEvent(new window.Event("scroll", { bubbles: true })));
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    assert.equal(element.scrollTop, 1000);
    element.scrollTop = 340;
    await React.act(async () => element.dispatchEvent(new window.Event("scroll", { bubbles: true })));
    await React.act(async () => { await view.history().selectSession("newest"); }); await view.flush();
    assert.equal(element.scrollTop, 120);
    await view.settings(); await view.returnToChat();
    assert.equal(document.querySelector(".overflow-y-auto").scrollTop, 120);
    await view.reload();
    assert.equal(document.querySelector(".overflow-y-auto").scrollTop, 120);
  });
});

for (const open of [false, true]) test(`Settings and reload restore a ${open ? "open" : "closed"} panel without overriding it with auto-open preferences`, async () => {
  await withChat({ panel: true }, async view => {
    await view.set(atoms.showAIChatInterfaceAtom, open);
    await view.visit("/settings/profile");
    await view.visit("/project");
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), open);
    await view.reload();
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), open);
    assert.equal(view.reserve(), open);
    await view.set(atoms.showAIChatInterfaceAtom, !open);
    assert.equal(view.reserve(), !open);
  });
});

for (const open of [false, true]) for (const route of ["/chat", "/settings/profile"]) test(`saved ${open ? "open" : "closed"} panel never reserves space on ${route}`, async () => {
  await withChat({ panel: true }, async view => {
    await view.set(atoms.showAIChatInterfaceAtom, open);
    await view.settings();
    view.panelReserves.length = 0;
    await view.returnToChat(route);
    assert.ok(view.panelReserves.length > 0);
    assert.ok(view.panelReserves.every(reserve => reserve === false));
    assert.equal(navigation.readChatNavigationState(navigation.chatNavigationKey(985, 15)).open, open);
    await view.settings();
    await view.returnToChat("/project");
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), open);
    assert.equal(view.reserve(), open);
  });
});

test("flag off retains newest-session initialization after remount", async () => {
  await withChat({ paged: true, fullscreen: true, enabled: false }, async view => {
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    assert.equal(view.history().currentSession.id, "older");
    await view.settings(); await view.returnToChat();
    assert.equal(view.history().currentSession.id, "newest");
  });
});

test("the bugfix flag defaults to Everyone and documents rollback risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7783-remember-chat.ts", {}).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-24");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});

test("corrupt or blocked browser storage does not prevent using chat", async () => {
  await withChat({ paged: true, fullscreen: true }, async view => {
    const key = navigation.chatNavigationKey(985, 15, undefined, true);
    navigation.writeChatNavigationState(key, { sessionId: "older", draft: "<p>Draft</p>" });
    assert.equal(navigation.readChatNavigationState(key).sessionId, "older");
    window.localStorage.setItem(key, "not json");
    assert.deepEqual(navigation.readChatNavigationState(key), {});
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    assert.equal(view.history().currentSession.id, "older");
    assert.deepEqual(navigation.readChatNavigationState(key), {});
  });
});

test("an empty board waits for an explicit send without leaving the welcome screen loading", async () => {
  await withChat({ paged: true, rows: [] }, async view => {
    assert.equal(view.chatState().showWelcomeScreen, true);
    assert.equal(view.chatState().isSessionPending, false);
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
    await React.act(async () => { const selected = await view.resolver().ensureSessionForCurrentBoard(); assert.equal(selected.id, "explicit-new"); }); await view.flush();
    assert.equal(view.history().currentSession.id, "explicit-new");
    assert.equal(view.calls.filter(([type]) => type === "create").length, 1);
  });
});

test("the returning board can finish loading after Settings without restoring another board's panel state", async () => {
  await withChat({ panel: true }, async view => {
    await view.set(atoms.showAIChatInterfaceAtom, true);
    navigation.writeChatNavigationState(navigation.chatNavigationKey(985, 25), { open: false });
    await view.visit("/settings/profile");
    await view.set(atoms.currentProjectAtom, { id: 25 });
    await view.visit("/project");
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), false);
    await view.set(atoms.currentProjectAtom, { id: 15 });
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), true);
  });
});

test("a first visit with no saved panel state still follows the existing auto-open preference", async () => {
  await withChat({ panel: true }, async view => {
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), true);
    assert.equal(view.reserve(), true);
    assert.equal(navigation.readChatNavigationState(navigation.chatNavigationKey(985, 15)).open, true);
  });
});

test("legacy ticket chat restores an explicitly chosen conversation instead of forcing the ticket's default thread", async () => {
  await withChat({ paged: false }, async view => {
    view.rows[0].taskId = 43;
    await view.set(atoms.inViewObjectAtom, { taskId: 43 });
    await view.visit("/detail/project-15/43");
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    assert.equal(view.history().currentSession.id, "older");
    await view.settings(); await view.returnToChat("/detail/project-15/43");
    assert.equal(view.history().currentSession.id, "older");
    assert.equal(document.body.textContent, "History older");
    const session = await view.resolver().ensureSessionForCurrentBoard();
    assert.equal(session.id, "older");
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
  });
});

for (const paged of [false, true]) test(`${paged ? "paged" : "legacy"}: a failed history request is not treated as an empty chat list`, async () => {
  for (const historyError of [true, false]) await withChat({ paged, rows: [], historyError }, async view => {
    let selected;
    await React.act(async () => { selected = await view.resolver().ensureSessionForCurrentBoard(0); }); await view.flush();
    if (historyError) {
      assert.equal(selected, undefined);
      assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
    } else {
      assert.equal(selected.id, "explicit-new");
      assert.equal(view.calls.filter(([type]) => type === "create").length, 1);
    }
  });
});

for (const paged of [false, true]) for (const allBoards of [false, true]) {
  test(`${paged ? "paged" : "legacy"} ${allBoards ? "All boards" : "board"}: automatic general-chat initialization skips the newest agent conversation`, async () => {
    const agent = { ...row("newest"), agentId: "native-agent" };
    await withChat({ paged, allBoards, fullscreen: allBoards, rows: [agent, row("older")] }, async view => {
      assert.equal(view.history().currentSession.id, "older");
      assert.equal((await view.resolver().ensureSessionForCurrentBoard(0)).id, "older");
      assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
      assert.equal(view.calls.some(([type, id]) => type === "transcript" && id === agent.id), false);
      if (paged) assert.ok(view.calls.some(([type, scope]) => type === "page" && scope.projectId === (allBoards ? undefined : 15) && scope.limit === 30));
    });
  });
}

for (const paged of [false, true]) for (const hasGeneralSession of [false, true]) {
  test(`${paged ? "paged" : "legacy"}: general sending refuses displayed and saved agent sessions and ${hasGeneralSession ? "resolves a general conversation" : "creates a general conversation"}`, async () => {
    const agent = { ...row("newest"), agentId: "native-agent" };
    await withChat({ paged, rows: [agent, ...(hasGeneralSession ? [row("older")] : [])] }, async view => {
      await React.act(async () => { await view.history().selectSession(agent.id); }); await view.flush();
      assert.equal(view.history().currentSession.id, agent.id);
      assert.equal(navigation.readChatNavigationState(view.chatState().navigationKey).sessionId, agent.id);
      let selected;
      await React.act(async () => { selected = await view.resolver().ensureSessionForCurrentBoard(0); }); await view.flush();
      assert.equal(selected.id, hasGeneralSession ? "older" : "explicit-new");
      assert.equal(selected.agentId, null);
      assert.equal(view.history().currentSession.id, selected.id);
      assert.equal(view.calls.filter(([type]) => type === "create").length, hasGeneralSession ? 0 : 1);
    });
  });
}

for (const paged of [false, true]) test(`${paged ? "paged" : "legacy"}: explicit native-agent selection still resolves its canonical conversation`, async () => {
  const agent = { ...row("native"), agentId: "native-agent" };
  await withChat({ paged, agentSidebar: true, rows: [row("newest"), agent] }, async view => {
    assert.equal(view.history().currentSession.id, "newest");
    view.setNativeSidebar({ sessionId: agent.id, projectId: 15 });
    await React.act(async () => { await view.history().selectSession(agent.id); }); await view.flush();
    assert.equal((await view.resolver().ensureSessionForCurrentBoard(0)).id, agent.id);
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
  });
});

for (const paged of [false, true]) for (const dockedScope of [25, "all"]) {
  test(`${paged ? "paged" : "legacy"}: New chat stays selected in ${dockedScope === "all" ? "All boards" : "another board"} after Settings and reload`, async () => {
    await withChat({ paged, dockedScope }, async view => {
      const previousId = dockedScope === "all" ? "newest" : "other-board";
      assert.equal(view.history().currentSession.id, previousId);
      let created;
      await React.act(async () => { created = await view.resolver().startNewSession(); }); await view.flush();
      assert.equal(view.chatState().dockedChatScope, dockedScope);
      assert.equal(view.chatState().scopedProjectId, dockedScope === "all" ? undefined : 25);
      assert.equal(created.projectId, dockedScope === "all" ? null : 25);
      assert.equal(view.history().currentSession.id, "explicit-new");
      assert.equal(navigation.readChatNavigationState(view.chatState().navigationKey).sessionId, created.id);
      await view.settings(); await view.returnToChat();
      assert.equal(view.history().currentSession.id, created.id);
      await view.reload();
      assert.equal(view.chatState().dockedChatScope, dockedScope);
      assert.equal(view.history().currentSession.id, created.id);
      assert.equal(view.calls.filter(([type]) => type === "create").length, 1);
    });
  });
}

for (const fullscreen of [false, true]) test(`empty ${fullscreen ? "fullscreen" : "docked"} All boards finishes initialization without creating a conversation`, async () => {
  await withChat({ paged: true, fullscreen, allBoards: true, dockedScope: "all", rows: [] }, async view => {
    await view.set(atoms.currentProjectAtom, null);
    assert.equal(view.chatState().currentSession, undefined);
    assert.equal(view.chatState().chatHistoryReady, true);
    assert.equal(view.chatState().isSessionPending, false);
    assert.equal(view.chatState().showWelcomeScreen, true);
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
  });
});

for (const paged of [false, true]) for (const fullscreen of [false, true]) {
  test(`${paged ? "paged" : "legacy"}: pending ${fullscreen ? "fullscreen" : "docked"} Ask AI waits for successful empty history, creates and sends once`, async () => {
    let finishHistory;
    const historyLoad = new Promise(resolve => { finishHistory = resolve; });
    const pendingPrompt = fullscreen ? { query: "Where is my work?", fullScreen: true } : "Where is my work?";
    await withChat({ paged, fullscreen, rows: [], runtime: true, pendingPrompt, historyLoad }, async view => {
      assert.equal(view.chatState().chatHistoryReady, false);
      assert.equal(view.calls.filter(([type]) => type === "create" || type === "send").length, 0);
      assert.equal(view.values.get(atoms.aiChatPendingPromptAtom), pendingPrompt);
      await React.act(async () => finishHistory()); await view.flush();
      assert.equal(view.calls.filter(([type]) => type === "create").length, 1);
      assert.deepEqual(view.calls.filter(([type]) => type === "send"), [["send", "explicit-new", "Where is my work?", fullscreen ? { preserveComposer: true } : undefined]]);
      assert.equal(view.values.get(atoms.aiChatPendingPromptAtom), null);
      assert.equal(view.history().currentSession.id, "explicit-new");
      await view.render(); await view.reload();
      assert.equal(view.calls.filter(([type]) => type === "create").length, 1);
      assert.equal(view.calls.filter(([type]) => type === "send").length, 1);
    });
  });
}

for (const paged of [false, true]) test(`${paged ? "paged" : "legacy"}: pending Ask AI does not create or send when history fails`, async () => {
  const pendingPrompt = { query: "Keep this question", fullScreen: true };
  await withChat({ paged, fullscreen: true, rows: [], runtime: true, pendingPrompt, historyError: true }, async view => {
    assert.equal(view.chatState().chatHistoryReady, false);
    assert.equal(view.values.get(atoms.aiChatPendingPromptAtom), pendingPrompt);
    assert.equal(view.calls.filter(([type]) => type === "create" || type === "send").length, 0);
  });
});

for (const paged of [false, true]) test(`${paged ? "paged" : "legacy"}: flag-off New chat retains the production scope reset`, async () => {
  await withChat({ paged, enabled: false, dockedScope: 25 }, async view => {
    await React.act(async () => { await view.resolver().startNewSession(); }); await view.flush();
    assert.equal(view.chatState().dockedChatScope, null);
    assert.equal(view.history().currentSession.id, paged ? "newest" : "explicit-new");
    assert.equal(view.calls.filter(([type]) => type === "create").length, 1);
  });
});


test("following tickets keeps the chosen conversation with remembered navigation", async () => {
  await withChat({ paged: true, followsTask: true }, async view => {
    await view.set(atoms.inViewObjectAtom, { taskId: 43 });
    await view.visit("/detail/project-15/43");
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    const key = view.chatState().navigationKey;
    await view.set(atoms.inViewObjectAtom, { taskId: 44 });
    await view.visit("/detail/project-15/44");
    assert.equal(view.chatState().navigationKey, key);
    assert.equal(view.history().currentSession.id, "older");
    assert.equal((await view.resolver().ensureSessionForCurrentBoard(0)).id, "older");
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
  });
});

test("first manual send from a ticket creates a general conversation", async () => {
  await withChat({ paged: true, manualChat: true, rows: [] }, async view => {
    await view.set(atoms.inViewObjectAtom, { taskId: 43 });
    await view.visit("/detail/project-15/43");
    assert.equal(view.chatState().chatHistoryReady, true);
    const session = await view.resolver().ensureSessionForCurrentBoard(0);
    assert.equal(session.id, "explicit-new");
    assert.equal(session.taskId, null);
    assert.equal(view.calls.filter(([type]) => type === "create").length, 1);
  });
});

test("restored closed board does not bypass auto-open policy on later visits", async () => {
  await withChat({ panel: true, boardAutoOpen: false }, async view => {
    await view.set(atoms.showAIChatInterfaceAtom, false);
    await view.visit("/settings/profile");
    await view.visit("/project");
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), false);
    await view.visit("/detail/project-15/43");
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), true);
    await view.visit("/project");
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), false);
  });
});


for (const paged of [false, true]) test(`${paged ? "paged" : "legacy"}: an explicit compose intent replaces the following conversation`, async () => {
  await withChat({ paged, followsTask: true, compose: true, rows: [row("newest"), row("older"), { ...row("compose-target"), taskId: 44 }] }, async view => {
    await view.set(atoms.inViewObjectAtom, { taskId: 43 });
    await view.visit("/detail/project-15/43");
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    await view.set(atoms.composeTaskChatIntroAtom, { taskId: 44, content: "Task intro" });
    await view.set(atoms.inViewObjectAtom, { taskId: 44 });
    await view.visit("/detail/project-15/44");
    assert.equal(view.history().currentSession.id, "compose-target");
    assert.equal((await view.resolver().ensureSessionForCurrentBoard(0)).id, "compose-target");
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
  });
});


for (const paged of [false, true]) test(`${paged ? "paged" : "legacy"}: explicit task intent wins over saved selection on remount`, async () => {
  await withChat({ paged, followsTask: true, compose: true, rows: [row("newest"), row("older"), { ...row("compose-target"), taskId: 43 }] }, async view => {
    await view.set(atoms.inViewObjectAtom, { taskId: 43 });
    await view.visit("/detail/project-15/43");
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    await view.settings();
    await view.set(atoms.composeTaskChatIntroAtom, { taskId: 43, content: "Task intro" });
    await view.returnToChat("/detail/project-15/43");
    assert.equal(view.history().currentSession.id, "compose-target");
    assert.equal((await view.resolver().ensureSessionForCurrentBoard(0)).id, "compose-target");
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
  });
});


test("following tickets reuses task-only history without creating a replacement", async () => {
  await withChat({ paged: true, followsTask: true, rows: [{ ...row("older"), taskId: 43 }] }, async view => {
    await view.set(atoms.inViewObjectAtom, { taskId: 44 });
    await view.visit("/detail/project-15/44");
    assert.equal(view.history().currentSession.id, "older");
    assert.equal((await view.resolver().ensureSessionForCurrentBoard(0)).id, "older");
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
  });
});

test("selecting a transcript after empty initialization waits without replacing it", async () => {
  let finishTranscript;
  const transcriptLoad = new Promise(resolve => { finishTranscript = resolve; });
  await withChat({ paged: true, rows: [], transcriptLoad }, async view => {
    assert.equal(view.chatState().chatHistoryReady, true);
    view.rows.push(row("older"));
    let selection;
    await React.act(async () => { selection = view.history().selectSession("older"); }); await view.flush();
    assert.equal(view.chatState().isSessionPending, true);
    assert.equal(view.chatState().chatHistoryReady, false);
    assert.equal(await view.resolver().ensureSessionForCurrentBoard(0), undefined);
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
    await React.act(async () => { finishTranscript(); await selection; }); await view.flush();
    assert.equal(view.history().currentSession.id, "older");
    assert.equal((await view.resolver().ensureSessionForCurrentBoard(0)).id, "older");
  });
});

for (const enabled of [false, true]) test(`new-ticket preference ${enabled ? "opens" : "closes"} chat after Settings despite remembered panel state`, async () => {
  await withChat({ panel: true, newTicketAutoOpen: enabled }, async view => {
    await view.set(atoms.showAIChatInterfaceAtom, !enabled);
    await view.visit("/settings/profile");
    await view.set(atoms.aiChatNewTicketPathAtom, "/detail/project-15/43");
    await view.visit("/detail/project-15/43");
    assert.equal(view.values.get(atoms.showAIChatInterfaceAtom), enabled);
    assert.equal(view.reserve(), enabled);
  });
});

test("legacy Compose intent replaces an unrelated active session without ticket following", async () => {
  await withChat({ paged: false, compose: true, rows: [row("older"), { ...row("compose-target"), taskId: 43 }] }, async view => {
    await view.set(atoms.inViewObjectAtom, { taskId: 43 });
    await view.visit("/detail/project-15/43");
    await React.act(async () => { await view.history().selectSession("older"); }); await view.flush();
    assert.equal(view.history().currentSession.id, "older");
    await view.set(atoms.composeTaskChatIntroAtom, { taskId: 43, content: "Task intro" });
    assert.equal(view.history().currentSession.id, "compose-target");
    assert.equal(view.calls.filter(([type]) => type === "create").length, 0);
  });
});
