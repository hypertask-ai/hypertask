const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-7794-stop-closes-stream";
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function server({ partial = false, throws = false, disconnect = false, complete = false, enabled = true } = {}) {
  const started = deferred();
  const resume = deferred();
  const released = deferred();
  const events = [];
  let cancel;
  let signal;
  const mocks = {
    "@/lib/prisma": { default: {} },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      if (key === FLAG) { assert.equal(userId, 7); return enabled; }
      return false;
    } },
    "@/app/api/ai/chat/stream/streamLease": {
      createTurnDeadline: () => ({ clear: () => events.push("deadline cleared") }),
      watchAiChatCancellation: (_redis, _user, _session, _stream, callback) => {
        cancel = callback;
        return () => events.push("watch stopped");
      },
      releaseAiChatStreamLease: async (lease) => { assert.equal(lease.id, "lease"); events.push("lease released"); released.resolve(); },
      acquireAiChatCompletionFence: async () => "fence",
      keepAiChatCompletionFenceAlive: () => async () => {},
      finishAiChatCompletionFence: async () => {},
    },
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": { persistAssistantMessage: async () => true },
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async (event) => { events.push(event.outcome); } },
    "@vercel/functions": { waitUntil() {} },
    "@/lib/ai/chatAlerts/service": { recordAiChatAlertSample: async () => {} },
    "@/app/api/ai/_lib/chatSkillResolution": { resolveSkillsForAiRequest: async () => ({ cleanedText: "hello" }) },
    "./fleetTurn": { routeAgentMention: async () => false },
    "./chatNames": { nameChatFromFirstMessage: async () => null },
    "@/lib/ai/prompts/registry": {},
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => [] },
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "Chat" },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
    "@/lib/ai/chatStream/content": { createUserContent: () => "hello" },
    "@/lib/ai/tools/metadata": { writeToolNames: new Set() },
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: () => ({}) },
    "@/lib/net/downloadWithoutBrotli": {},
    "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false, backgroundClaudeModelEnabled: async () => false },
    "@/app/api/ai/_lib/byokKeys": {},
    "@/lib/aiModelOptions": { resolveHaikuModelId: (model) => model },
    "@/lib/aiProviders": {},
    "@/app/api/ai/chat/stream/modelFallback": {},
    "@/app/api/ai/chat/stream/bulkTools": { hasVisibleCompletion: (chunks) => chunks.join("").length > 0 },
    "@/lib/ai/chatStream/models": {},
    ai: {
      stepCountIs: () => () => false,
      streamText: (options) => {
        signal = options.abortSignal;
        return { textStream: (async function* () {
          started.resolve();
          if (disconnect || complete) {
            if (disconnect) await resume.promise;
            yield "Background answer";
            return;
          }
          if (partial) yield "Partial answer";
          cancel();
          assert.equal(signal.aborted, true);
          if (throws) throw new Error("Aborted");
        })() };
      },
    },
    "@/lib/ai/tools/constants": { MAX_TOOL_STEPS: 3, SSE_HEADERS: { "Content-Type": "text/event-stream" } },
    "@/lib/ai/chatStream/errors": {
      sseFrame: (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      reportHandledChatError: async (error) => { throw error; },
      includedAllowanceError: () => false,
    },
  };
  const { createChatStream } = load("src/lib/ai/chatStream/stream.ts", mocks);
  const response = createChatStream({
    body: { session_id: "session", assistant_message_id: "assistant", message: "hello" },
    dbUser: { id: 7 }, requestMessage: "hello", gatewayTags: {},
    selected: { model: {}, resolvedModelId: "test-model", usageProvider: "test" },
    streamId: "stream", streamLease: { id: "lease", redis: {} },
    turnStartedAtMs: Date.now(), maxDuration: 300,
  });
  return { response, started, resume, released, events, signal: () => signal };
}

for (const partial of [false, true]) {
  test(`graceful Stop ${partial ? "mid-answer" : "before first token"} emits done and closes SSE`, { timeout: 2000 }, async () => {
    const h = server({ partial });
    const text = await h.response.text();
    await h.released.promise;
    const content = partial ? 'event: content\ndata: {"content":"Partial answer"}\n\n' : "";
    assert.equal(text, content + 'event: done\ndata: {"status":"error","cancelled":true,"content":"Stream cancelled."}\n\n');
    assert.deepEqual(h.events, ["cancelled", "deadline cleared", "watch stopped", "lease released"]);
  });
}

test("thrown Stop still emits exactly one terminal event and releases its lease", { timeout: 2000 }, async () => {
  const h = server({ throws: true });
  assert.equal(await h.response.text(), 'event: done\ndata: {"status":"error","cancelled":true,"content":"Stream cancelled."}\n\n');
  await h.released.promise;
  assert.deepEqual(h.events, ["cancelled", "deadline cleared", "watch stopped", "lease released"]);
});

test("disconnect still completes inference in the background without aborting the provider", { timeout: 2000 }, async () => {
  const h = server({ disconnect: true });
  await h.started.promise;
  await h.response.body.cancel();
  assert.equal(h.signal().aborted, false);
  assert.deepEqual(h.events, []);
  h.resume.resolve();
  await h.released.promise;
  assert.equal(h.signal().aborted, false);
  assert.deepEqual(h.events, ["ok", "deadline cleared", "deadline cleared", "watch stopped", "lease released"]);
});

test("normal completion still delivers one done event and releases the lease", { timeout: 2000 }, async () => {
  const h = server({ complete: true });
  assert.equal(await h.response.text(), 'event: content\ndata: {"content":"Background answer"}\n\nevent: done\ndata: {"status":"complete","assistant_persisted":true}\n\n');
  await h.released.promise;
  assert.deepEqual(h.events, ["ok", "deadline cleared", "deadline cleared", "watch stopped", "lease released"]);
});

test("server flag Off retains graceful cancellation without finishing SSE", { timeout: 2000 }, async () => {
  const h = server({ enabled: false });
  await h.released.promise;
  const reader = h.response.body.getReader();
  let closed = false;
  const pending = reader.read().then((result) => { closed = result.done; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  assert.deepEqual(h.events, ["cancelled", "deadline cleared", "watch stopped", "lease released"]);
  await reader.cancel();
  await pending;
});

function legacyHistory(enabled, demo = false) {
  const session = { id: "session", messages: [] };
  let cached = { data: { sessions: [session] } };
  let demoSessions = [session];
  const { useSessionAndChatHistory } = load("src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts", {
    react: {
      useCallback: (callback) => callback, useEffect() {}, useRef: (value) => ({ current: value }),
      useState: (value) => Array.isArray(value)
        ? [demoSessions, (next) => { demoSessions = typeof next === "function" ? next(demoSessions) : next; }]
        : [value, () => {}],
    },
    "@/hooks/useFlag": { useFlag: (key) => key === FLAG && enabled },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/store": { currentUserAtom: "user" },
    "@/lib/state": {
      useRecoilValue: (atom) => atom === "user" ? { id: 7, uid: "user" } : null,
      useRecoilState: () => [null, () => {}],
    },
    "next/navigation": { usePathname: () => demo ? "/demo" : "/chat/session" },
    "./useDockedChatScope": { useDockedChatScope: () => [null] },
    "./usePagedChatHistory": { usePagedChatHistory: () => ({}) },
    "@tanstack/react-query": {
      useQuery: () => ({ data: cached, isSuccess: true }),
      useQueryClient: () => ({
        setQueryData: (_key, update) => { cached = update(cached); },
      }),
    },
    "@/utils/api/ai_chat": { AI_Chat_API: { addMessage: async (_id, message) => ({ data: { message } }) } },
  });
  const history = useSessionAndChatHistory();
  return {
    add: history.addMessageToSessionQuery,
    messages: () => demo ? demoSessions[0].messages : cached.data.sessions[0].messages,
  };
}

function client(t, { enabled = true, cancelStatus = 200, cancelResult = { success: true }, drainQueue = false, delayResponse = false, delayCancel = false } = {}) {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const requests = [];
  const controllers = [];
  const readers = [deferred(), deferred()];
  const started = [deferred(), deferred()];
  const responses = [deferred(), deferred()];
  const cancelResponse = deferred();
  const history = legacyHistory(enabled);
  const messages = { get: (id) => history.messages().find((message) => message.id === id) };
  let handoffs = 0;
  const cancellations = [];
  const mutations = [];
  const context = {
    stopClosesStream: enabled, connectionRetry: true,
    isByokBlocked: false, isTyping: false,
    editor: { getHTML: () => "<p>Hello</p>", getText: () => "Hello", commands: { clearContent() {} } },
    fileUpload: {
      fileItems: [],
      clearFiles() { this.fileItems = []; },
      setFileItems(update) { this.fileItems = update(this.fileItems); },
    },
    messageQueueRef: { current: [] }, setQueuedMessages() {}, sendInFlightRef: { current: false }, settleSendRef: { current: null },
    surface: "chat", inViewObject: {}, waitForChatSession: async () => ({ id: "session", messages: [] }),
    currentProject: { id: 1 }, processAttachments: async () => [],
    setIsTyping: (value) => { context.isTyping = value; mutations.push(["typing", value]); },
    addMessageToSessionQuery: (id, message, ...options) => {
      history.add(id, message, ...options);
      mutations.push(["message", message.content]);
    },
    scopedProjectId: 1, modelTeamId: 1, contextList: [],
    currentAiOption: { id: "model", model: "model", source: "openai" }, pathname: "/chat/session", currentUser: { id: 7 },
    streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null }, streamingRequestRef: { current: null },
    setCurrentStreamingSession: (value) => { context.currentStreamingSession = value; },
    chatRoute: "/api/ai/chat/stream", setAgentStatus: (value) => mutations.push(["status", value]),
    updateSessionTitle() {}, queryClient: { refetchQueries: async () => {} },
    drainQueuedMessage: () => mutations.push(["drain"]), handleSendMessageRef: { current: null }, reloadTaskAfterChat: false,
    updateLastMessageInSessionCache: (_id, message) => mutations.push(["error", message.content]),
    appendMessageToSessionCache: (_id, message) => mutations.push(["error", message.content]),
    ensureSessionForCurrentBoard: async () => ({ id: "session", messages: [] }),
  };
  global.fetch = async (url, options) => {
    if (url.endsWith("/cancel")) {
      cancellations.push(JSON.parse(options.body));
      if (delayCancel) await cancelResponse.promise;
      return Response.json(cancelResult, { status: cancelStatus });
    }
    requests.push(JSON.parse(options.body));
    const index = requests.length - 1;
    const reading = readers[index];
    const response = new Response(new ReadableStream({
      start(controller) { controllers.push(controller); },
      pull() { reading.resolve(); },
    }, { highWaterMark: 0 }));
    started[index].resolve();
    if (delayResponse) await responses[index].promise;
    return response;
  };
  const mocks = {
    react: { useCallback: (callback) => callback, useRef: (value) => ({ current: value }), useEffect() {} },
    "react-hot-toast": { default: { error: (message) => mutations.push(["toast", message]) } },
    "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
    "./aiChatShared": { parseAiStreamErrorContent: (value) => value },
    "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    "@/utils/helperFunctions/helperFunctions": {},
    "@/utils/helperFunctions/getFileTypeFromUrl": {},
    "@/hooks/useFlag": { useFlag: () => enabled },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/lib/flags/keys": { HTPR_7794_STOP_CLOSES_STREAM_FLAG: FLAG },
  };
  const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", mocks);
  const { useAiChatAttachments } = load("src/hooks/MultiPages/AIChat/useAiChatAttachments.ts", mocks);
  if (drainQueue) {
    const { useAiChatSessions } = load("src/hooks/MultiPages/AIChat/useAiChatSessions.ts", {
      ...mocks,
      "@/lib/constants": { default: { sendAiChatMessageRoute: context.chatRoute } },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => context.fileUpload },
      "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
      "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
    });
    const sessions = useAiChatSessions(context);
    context.handleSendMessageRef = sessions.handleSendMessageRef;
    context.drainQueuedMessage = () => {
      mutations.push(["drain"]);
      sessions.drainQueuedMessage();
    };
  }
  const send = ({ preserveComposer = true } = {}) => createAiChatSend(context, {
    preserveComposer,
    onSettled: () => { handoffs += 1; },
  }).handleSendMessage();
  const stop = () => useAiChatAttachments(context).handleCancelStream();
  const waitForReader = async (index) => {
    await readers[index].promise;
  };
  const emit = (index, event, data) => {
    controllers[index].enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };
  const done = (index) => {
    emit(index, "done", { status: "complete", assistant_persisted: true });
    controllers[index].close();
  };
  return {
    context, requests, cancellations, mutations, messages, controllers, send, stop, waitForReader, done, emit,
    handoffs: () => handoffs,
    waitForRequest: (index) => started[index].promise,
    releaseResponse: (index) => responses[index].resolve(),
    releaseCancel: () => cancelResponse.resolve(),
  };
}

for (const [cancelStatus, lateError] of [[200, false], [409, false], [200, true]]) {
  test(`acknowledged Stop (${cancelStatus}, late ${lateError ? "error" : "done"}) allows a new send while the old SSE hangs`, { timeout: 2000 }, async (t) => {
    const h = client(t, { cancelStatus, cancelResult: cancelStatus === 409 ? { status: "completed" } : { success: true } });
    const first = h.send();
    await h.waitForReader(0);
    await h.stop();
    assert.equal(h.context.sendInFlightRef.current, false);
    assert.equal(h.context.isTyping, false);
    assert.equal(h.cancellations[0].stream_id, h.requests[0].stream_id);
    const second = h.send();
    await h.waitForReader(1);
    assert.equal(h.requests.length, 2);
    assert.notEqual(h.requests[0].stream_id, h.requests[1].stream_id);
    const activeStream = h.context.streamingRequestRef.current;
    const before = h.mutations.slice();
    if (lateError) h.controllers[0].error(new TypeError("Connection lost"));
    else h.done(0);
    await first;
    assert.equal(h.context.streamingRequestRef.current, activeStream);
    assert.equal(h.context.isTyping, true);
    assert.ok(h.context.sendInFlightRef.current);
    assert.deepEqual(h.mutations.filter(([kind]) => kind !== "message"), before.filter(([kind]) => kind !== "message"));
    if (!lateError) {
      assert.equal(h.messages.get(h.requests[0].assistant_message_id).isDelivered, true);
    }
    assert.equal(await h.send(), true);
    assert.equal(h.requests.length, 2);
    assert.equal(h.context.messageQueueRef.current.length, 1);
    h.done(1);
    assert.equal(await second, true);
    assert.equal(h.context.sendInFlightRef.current, false);
    assert.equal(h.context.isTyping, false);
  });
}

for (const demo of [false, true]) {
  for (const enabled of [false, true]) {
    test(`legacy ${demo ? "demo" : "signed-in"} cache ${enabled ? "updates the matching reply" : "retains last-message replacement with flag Off"}`, () => {
      const history = legacyHistory(enabled, demo);
      history.add("session", { id: "old", content: "Old partial", role: "assistant" }, true);
      history.add("session", { id: "new", content: "New partial", role: "assistant" }, true);
      history.add("session", { id: "old", content: "Old complete", role: "assistant", isDelivered: true }, true, true);
      assert.deepEqual(history.messages().map(({ id, content }) => [id, content]), enabled
        ? [["old", "Old complete"], ["new", "New partial"]]
        : [["old", "Old partial"], ["old", "Old complete"]]);
    });
  }
}

for (const delayResponse of [false, true]) {
  test(`completed Stop preserves unread reply content and done (${delayResponse ? "before response headers" : "during SSE"})`, { timeout: 2000 }, async (t) => {
    const h = client(t, { cancelStatus: 409, cancelResult: { status: "completed" }, delayResponse });
    const first = h.send();
    await h.waitForRequest(0);
    if (!delayResponse) {
      await h.waitForReader(0);
      h.emit(0, "content", { content: "Completed " });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(h.messages.get(h.requests[0].assistant_message_id).content, "Completed ");
    }
    await h.stop();
    assert.equal(h.context.sendInFlightRef.current, false);
    assert.equal(h.context.isTyping, false);
    h.emit(0, "content", { content: delayResponse ? "Completed reply" : "reply" });
    h.done(0);
    h.releaseResponse(0);
    assert.equal(await first, true);
    const message = h.messages.get(h.requests[0].assistant_message_id);
    assert.equal(message.content, "Completed reply");
    assert.equal(message.isDelivered, true);
    assert.equal(h.context.isTyping, false);
    assert.equal(h.handoffs(), 1);
    assert.equal(h.mutations.filter(([kind]) => kind === "drain").length, 1);
  });
}

test("graceful Stop keeps the partial answer instead of replacing it with cancellation text", { timeout: 2000 }, async (t) => {
  const h = client(t);
  const first = h.send();
  await h.waitForReader(0);
  h.emit(0, "content", { content: "The answer so far" });
  await new Promise((resolve) => setImmediate(resolve));
  await h.stop();
  h.emit(0, "done", { status: "error", cancelled: true, content: "Stream cancelled." });
  h.controllers[0].close();
  h.releaseResponse(0);
  assert.equal(await first, true);
  const message = h.messages.get(h.requests[0].assistant_message_id);
  assert.equal(message.content, "The answer so far");
  assert.equal(message.isDelivered, true);
});

test("graceful Stop before the first word shows cancellation text", { timeout: 2000 }, async (t) => {
  const h = client(t);
  const first = h.send();
  await h.waitForReader(0);
  await h.stop();
  h.emit(0, "done", { status: "error", cancelled: true, content: "Stream cancelled." });
  h.controllers[0].close();
  h.releaseResponse(0);
  assert.equal(await first, true);
  assert.equal(h.messages.get(h.requests[0].assistant_message_id).content, "Stream cancelled.");
});

test("Stop before response headers drops the sent files before the successor can resend them", { timeout: 2000 }, async (t) => {
  const h = client(t, { delayResponse: true });
  const sent = { name: "invoice.pdf" };
  const newer = { name: "draft.png" };
  h.context.fileUpload.fileItems = [sent];
  const first = h.send({ preserveComposer: false });
  await h.waitForRequest(0);
  h.context.fileUpload.fileItems = [sent, newer];
  await h.stop();
  assert.deepEqual(h.context.fileUpload.fileItems, [newer], "the stopped send drops its files while its headers are still blocked");
  h.releaseResponse(0);
  await h.waitForReader(0);
  h.done(0);
  assert.equal(await first, true);
  assert.deepEqual(h.context.fileUpload.fileItems, [newer]);
});

test("late content and done update only their own reply without clearing the newer send status", { timeout: 2000 }, async (t) => {
  const h = client(t);
  const first = h.send();
  await h.waitForReader(0);
  await h.stop();
  const second = h.send();
  await h.waitForReader(1);
  h.emit(1, "content", { content: "New reply" });
  h.emit(1, "status", { content: "New send working" });
  await new Promise((resolve) => setImmediate(resolve));
  const activeStream = h.context.streamingRequestRef.current;
  const sharedBefore = h.mutations.filter(([kind]) => kind !== "message");
  h.emit(0, "status", { content: "Old send working" });
  h.emit(0, "content", { content: "Old reply finished" });
  h.done(0);
  assert.equal(await first, true);
  assert.equal(h.messages.get(h.requests[0].assistant_message_id).content, "Old reply finished");
  assert.equal(h.messages.get(h.requests[0].assistant_message_id).isDelivered, true);
  assert.equal(h.messages.get(h.requests[1].assistant_message_id).content, "New reply");
  assert.equal(h.messages.get(h.requests[1].assistant_message_id).isDelivered, false);
  assert.equal(h.context.streamingRequestRef.current, activeStream);
  assert.equal(h.context.sendInFlightRef.current, true);
  assert.equal(h.context.isTyping, true);
  assert.deepEqual(h.mutations.filter(([kind]) => kind !== "message"), sharedBefore);
  h.done(1);
  assert.equal(await second, true);
  assert.equal(h.messages.get(h.requests[1].assistant_message_id).isDelivered, true);
  assert.equal(h.handoffs(), 2);
});

for (const cancelStatus of [200, 409]) {
  test(`acknowledged Stop (${cancelStatus}) drains a queued send and notifies handoff exactly once before old SSE settles`, { timeout: 2000 }, async (t) => {
    const h = client(t, {
      drainQueue: true, cancelStatus,
      cancelResult: cancelStatus === 409 ? { status: "completed" } : { success: true },
    });
    const first = h.send();
    await h.waitForReader(0);
    assert.equal(await h.send(), true);
    assert.equal(h.context.messageQueueRef.current.length, 1);
    const settleFirst = h.context.settleSendRef.current;
    await h.stop();
    await h.waitForReader(1);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].message, "Hello");
    assert.equal(h.context.messageQueueRef.current.length, 0);
    assert.equal(h.handoffs(), 1);
    assert.equal(h.mutations.filter(([kind]) => kind === "drain").length, 1);
    const activeStream = h.context.streamingRequestRef.current;
    const settleSecond = h.context.settleSendRef.current;
    settleFirst();
    h.done(0);
    assert.equal(await first, true);
    assert.equal(h.handoffs(), 1);
    assert.equal(h.mutations.filter(([kind]) => kind === "drain").length, 1);
    assert.equal(h.context.streamingRequestRef.current, activeStream);
    assert.equal(h.context.sendInFlightRef.current, true);
    assert.equal(h.context.isTyping, true);
    assert.equal(h.context.settleSendRef.current, settleSecond);
    h.done(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.handoffs(), 2);
    assert.equal(h.mutations.filter(([kind]) => kind === "drain").length, 2);
    assert.equal(h.context.sendInFlightRef.current, false);
    assert.equal(h.context.settleSendRef.current, null);
    settleSecond();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.handoffs(), 2);
    assert.equal(h.mutations.filter(([kind]) => kind === "drain").length, 2);
  });
}

test("late Stop acknowledgement cannot settle the queued successor after normal completion", { timeout: 2000 }, async (t) => {
  const h = client(t, { drainQueue: true, delayCancel: true });
  const first = h.send();
  await h.waitForReader(0);
  assert.equal(await h.send(), true);
  const stopping = h.stop();
  h.done(0);
  assert.equal(await first, true);
  await h.waitForReader(1);
  const activeStream = h.context.streamingRequestRef.current;
  h.releaseCancel();
  await stopping;
  assert.equal(h.handoffs(), 1);
  assert.equal(h.mutations.filter(([kind]) => kind === "drain").length, 1);
  assert.equal(h.context.streamingRequestRef.current, activeStream);
  assert.equal(h.context.sendInFlightRef.current, true);
  assert.equal(h.context.isTyping, true);
  h.done(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.handoffs(), 2);
  assert.equal(h.context.sendInFlightRef.current, false);
});

test("failed Stop keeps the active send locked and normal completion releases it", { timeout: 2000 }, async (t) => {
  const h = client(t, { cancelStatus: 503, cancelResult: { success: false } });
  const first = h.send();
  await h.waitForReader(0);
  const streamId = h.context.streamingRequestRef.current;
  await h.stop();
  assert.ok(h.context.sendInFlightRef.current);
  assert.equal(h.context.streamingRequestRef.current, streamId);
  assert.equal(h.context.isTyping, true);
  assert.equal(h.handoffs(), 0);
  h.done(0);
  assert.equal(await first, true);
  assert.equal(h.handoffs(), 1);
  assert.equal(h.context.sendInFlightRef.current, false);
  assert.equal(h.context.isTyping, false);
});

test("simultaneous sends are refused until normal completion", { timeout: 2000 }, async (t) => {
  const h = client(t);
  const first = h.send();
  assert.equal(await h.send(), false);
  await h.waitForReader(0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.context.sendInFlightRef.current, true);
  h.done(0);
  assert.equal(await first, true);
  assert.equal(h.context.sendInFlightRef.current, false);
});

test("flag Off retains the old send lock until the original stream finishes", { timeout: 2000 }, async (t) => {
  const h = client(t, { enabled: false });
  const first = h.send();
  await h.waitForReader(0);
  await h.stop();
  assert.equal(h.context.sendInFlightRef.current, true);
  assert.equal(await h.send(), false);
  assert.equal(h.requests.length, 1);
  assert.equal(h.handoffs(), 0);
  assert.equal(h.mutations.filter(([kind]) => kind === "drain").length, 0);
  h.done(0);
  assert.equal(await first, true);
  assert.equal(h.handoffs(), 1);
  assert.equal(h.mutations.filter(([kind]) => kind === "drain").length, 1);
  assert.equal(h.context.sendInFlightRef.current, false);
});

for (const enabled of [false, true]) {
  test(`chat hook shares the Stop recovery flag with cancellation and sending: ${enabled}`, () => {
    let sendContext;
    let stopContext;
    const { useAiChat } = load("src/hooks/MultiPages/AIChat/useAiChat.ts", {
      react: { useState: () => [0, () => {}], useEffect() {} },
      "@/lib/state": { useRecoilState: () => [null, () => {}] },
      "@/store": {},
      "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigateToTask: () => {} }) },
      "@/lib/flags/keys": { HTPR_7756_CHAT_OPENS_TASK_FLAG: "htpr-7756-chat-opens-task", HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG: "htpr-7518-agent-sidebar-chats", HTPR_7337_EDIT_WITH_AI_FLAG: "htpr-7337-edit-with-ai", HTPR_6936_ASK_AI_FULLSCREEN_FLAG: "htpr-6936-ask-ai-fullscreen", HTPR_7049_RELOAD_AFTER_IMAGE_CHAT_FLAG: "htpr-7049-reload-after-image-chat", HTPR_7099_CHAT_CONNECTION_LOST_FLAG: "htpr-7099-chat-connection-lost", HTPR_6971_CHAT_HISTORY_PAGING_FLAG: "htpr-6971-chat-history-paging", HTPR_7316_CHAT_SCOPE_TICKET_FLAG: "htpr-7316-chat-scope-ticket", HTPR_7794_STOP_CLOSES_STREAM_FLAG: FLAG },
      "@/hooks/useFlag": { useFlag: (key) => key === FLAG && enabled },
      "@/lib/ai/chipEvents": { signalAiChip: () => {} },
      "./useAiChatState": { useAiChatState: () => ({ sendInFlightRef: { current: false }, settleSendRef: { current: null } }) },
      "./useAiChatSessions": { useAiChatSessions: () => ({}) },
      "./useAiChatAttachments": { useAiChatAttachments: (context) => { stopContext = context; return {}; } },
      "./aiChatSend": { createAiChatSend: (context) => { sendContext = context; return {}; } },
      "./aiChatKeyboard": { createAiChatKeyboard: () => ({}) },
      "./useAiChatPresentation": { useAiChatPresentation: () => ({}) },
    });
    useAiChat();
    assert.equal(sendContext.stopClosesStream, enabled);
    assert.equal(stopContext.stopClosesStream, enabled);
    assert.equal(stopContext.settleSendRef, sendContext.settleSendRef);
    assert.equal(sendContext.settleSendRef.current, null);
  });
}

test("Stop recovery is a registered Everyone-default bugfix", () => {
  const { FEATURE_FLAG_DEFINITIONS } = load("src/lib/flags/definitions.ts", {});
  const definition = FEATURE_FLAG_DEFINITIONS.find((entry) => entry.key === FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
