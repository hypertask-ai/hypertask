const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const noop = () => {};
const hooks = { useCallback: (fn) => fn, useEffect: noop, useRef: (current) => ({ current }) };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function chatFixture(fullScreen) {
  const state = { draft: "first", html: "<p>first</p>", queued: [], payloads: [], created: [], messages: [] };
  const session = { id: "active-chat", userId: 985, agentId: null, taskId: null, messages: [] };
  const fileUpload = {
    fileItems: [],
    clearFiles() { this.fileItems = []; },
    resetFiles(files) { this.fileItems = files; },
  };
  const context = {
    isByokBlocked: false, isTyping: false, isFullScreenChat: fullScreen,
    surface: fullScreen ? "chat" : "board", pathname: fullScreen ? "/chat/active-chat" : "/project",
    currentUser: { id: 985 }, currentProject: { id: 15 }, scopedProjectId: 15, dockedProjectId: 15,
    currentAiOption: { id: "fixture", model: "fixture", source: "openai" }, contextList: [],
    editor: {
      getText: () => state.draft, getHTML: () => state.html,
      commands: { clearContent() { state.draft = ""; state.html = ""; } },
    },
    fileUpload, messageQueueRef: { current: [] }, sendInFlightRef: { current: false },
    setQueuedMessages(items) { state.queued = items; },
    handleSendMessageRef: { current: null },
    streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null },
    streamingRequestRef: { current: null }, setCurrentStreamingSession: noop,
    processAttachments: async () => [], setIsTyping: noop, setAgentStatus: noop,
    setAiChatBoardSessionMap: noop, updateSessionTitle: noop,
    addMessageToSessionQuery(id, message) { state.messages.push({ id, message }); },
    appendMessageToSessionCache: assert.fail, updateLastMessageInSessionCache: assert.fail,
    chatRoute: "/api/ai/chat/stream", sessionPagingEnabled: false,
    modelBilling: null, dockedChatScope: null, sessionContextKey: "fixture", agentSidebarChatsEnabled: false,
    sessionSetupRef: { current: null }, sessionIntentGenerationRef: { current: 0 },
    resolvedBoardSessionRef: { current: null }, previousProjectIdRef: { current: 15 },
    sessionsRef: { current: [session] }, chatHistoryReadyRef: { current: true }, aiChatBoardSessionMap: {},
    createSession() {
      const nested = { id: "nested-chat", parentSessionId: session.id, messages: [] };
      state.created.push(nested);
      return Promise.resolve(nested);
    },
  };
  const { useAiChatSessions } = load("src/hooks/MultiPages/AIChat/useAiChatSessions.ts", {
    react: hooks,
    "@/lib/agents/chatViewerState": { getNativeSidebarChat: () => null },
    "@/lib/constants": { default: { sendAiChatMessageRoute: context.chatRoute } },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => fileUpload },
    "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
    "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
  });
  const queues = useAiChatSessions(context);
  context.waitForChatSession = queues.ensureSessionForCurrentBoard;
  context.drainQueuedMessage = queues.drainQueuedMessage;
  context.handleSendMessageRef = queues.handleSendMessageRef;
  const streams = [];
  const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
    "./aiChatStream": { consumeAiChatStream: async () => {
      const stream = deferred();
      streams.push(stream);
      await stream.promise;
    } },
    "react-hot-toast": { default: { error: assert.fail } },
    "@/lib/agents/chatViewerState": { sidebarChatHeaders: () => ({}) },
    "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
  });
  const renderSender = () => createAiChatSend(context, { preserveComposer: true, onSettled: noop });
  const sender = renderSender();
  return { state, context, streams, queues, sender, renderSender };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function withChat(fullScreen, check) {
  const fixture = chatFixture(fullScreen);
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, "/api/ai/chat/stream");
    fixture.state.payloads.push(JSON.parse(options.body));
    return new Response("fixture stream");
  };
  try {
    await check(fixture);
  } finally {
    fixture.context.messageQueueRef.current = [];
    for (const stream of fixture.streams) stream.resolve();
    await settle();
    global.fetch = originalFetch;
  }
}

for (const fullScreen of [false, true]) {
  const surface = fullScreen ? "full-screen" : "sidebar";

  test(`${surface}: a busy send queues before typing state catches up, with cancellable FIFO delivery in the same session`, async () => {
    await withChat(fullScreen, async ({ state, context, streams, queues, sender, renderSender }) => {
      const first = sender.handleSendMessage();
      assert.equal(context.sendInFlightRef.current, true);
      state.draft = "second";
      state.html = "<p>second</p>";
      assert.equal(await sender.handleSendMessage(), true);
      assert.deepEqual(state.queued.map((item) => [item.content, item.html]), [["second", "<p>second</p>"]]);
      assert.equal(state.draft, "");
      await settle();
      assert.deepEqual(state.payloads.map((item) => [item.message, item.session_id]), [["first", "active-chat"]]);
      assert.deepEqual(state.created, []);

      context.isTyping = true;
      const streamingSender = renderSender();
      assert.equal(await streamingSender.handleSendMessage("cancel this"), true);
      assert.equal(await streamingSender.handleSendMessage("third"), true);
      assert.deepEqual(state.queued.map((item) => item.content), ["second", "cancel this", "third"]);
      queues.removeQueuedMessage(state.queued[1].id);
      assert.deepEqual(state.queued.map((item) => item.content), ["second", "third"]);

      streams[0].resolve();
      assert.equal(await first, true);
      await settle();
      assert.deepEqual(state.payloads.map((item) => [item.message, item.session_id]), [
        ["first", "active-chat"], ["second", "active-chat"],
      ]);
      assert.deepEqual(state.queued.map((item) => item.content), ["third"]);
      streams[1].resolve();
      await settle();
      assert.deepEqual(state.payloads.map((item) => [item.message, item.session_id]), [
        ["first", "active-chat"], ["second", "active-chat"], ["third", "active-chat"],
      ]);
      streams[2].resolve();
      await settle();
      assert.deepEqual(state.queued, []);
      assert.deepEqual(state.created, []);
      assert.equal(context.sendInFlightRef.current, false);
    });
  });

  test(`${surface}: an idle explicit-text send still starts immediately in the selected session`, async () => {
    await withChat(fullScreen, async ({ state, streams, sender }) => {
      const sending = sender.handleSendMessage("idle follow-up");
      await settle();
      assert.deepEqual(state.payloads.map((item) => [item.message, item.session_id]), [["idle follow-up", "active-chat"]]);
      assert.equal(state.messages[0].message.content, "idle follow-up");
      assert.equal(state.messages[0].message.sessionId, "active-chat");
      streams[0].resolve();
      assert.equal(await sending, true);
      assert.deepEqual(state.queued, []);
    });
  });
}

test("a busy search handoff still refuses without consuming its draft or attaching it to another send", async () => {
  await withChat(true, async ({ state, context, streams, sender }) => {
    const first = sender.handleSendMessage();
    await settle();
    state.draft = "keep my draft";
    assert.equal(await sender.handleSendMessage("search question", { preserveComposer: true }), false);
    assert.equal(state.draft, "keep my draft");
    assert.deepEqual(state.payloads.map((item) => item.message), ["first"]);
    assert.deepEqual(state.queued, []);
    streams[0].resolve();
    assert.equal(await first, true);
    assert.equal(context.sendInFlightRef.current, false);
  });
});
