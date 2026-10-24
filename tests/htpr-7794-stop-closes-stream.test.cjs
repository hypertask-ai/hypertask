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
  assert.deepEqual(h.events, ["ok", "deadline cleared", "watch stopped", "lease released"]);
});

test("normal completion still delivers one done event and releases the lease", { timeout: 2000 }, async () => {
  const h = server({ complete: true });
  assert.equal(await h.response.text(), 'event: content\ndata: {"content":"Background answer"}\n\nevent: done\ndata: {"status":"complete","assistant_persisted":true}\n\n');
  await h.released.promise;
  assert.deepEqual(h.events, ["ok", "deadline cleared", "watch stopped", "lease released"]);
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

function client(t, { enabled = true, cancelStatus = 200, cancelResult = { success: true } } = {}) {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const requests = [];
  const controllers = [];
  const readers = [deferred(), deferred()];
  const cancellations = [];
  const mutations = [];
  const context = {
    stopClosesStream: enabled, connectionRetry: true,
    isByokBlocked: false, isTyping: false,
    editor: { getHTML: () => "<p>Hello</p>", getText: () => "Hello", commands: { clearContent() {} } },
    fileUpload: { fileItems: [], clearFiles() {} },
    messageQueueRef: { current: [] }, setQueuedMessages() {}, sendInFlightRef: { current: false },
    surface: "chat", inViewObject: {}, waitForChatSession: async () => ({ id: "session", messages: [] }),
    currentProject: { id: 1 }, processAttachments: async () => [],
    setIsTyping: (value) => { context.isTyping = value; mutations.push(["typing", value]); },
    addMessageToSessionQuery: (_id, message) => mutations.push(["message", message.content]),
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
      return Response.json(cancelResult, { status: cancelStatus });
    }
    requests.push(JSON.parse(options.body));
    const reading = readers[requests.length - 1];
    const response = new Response(new ReadableStream({
      start(controller) { controllers.push(controller); },
      pull() { reading.resolve(); },
    }, { highWaterMark: 0 }));
    return response;
  };
  const mocks = {
    react: { useCallback: (callback) => callback },
    "react-hot-toast": { default: { error: (message) => mutations.push(["toast", message]) } },
    "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
    "./aiChatShared": { parseAiStreamErrorContent: (value) => value },
    "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    "@/utils/helperFunctions/helperFunctions": {},
    "@/utils/helperFunctions/getFileTypeFromUrl": {},
  };
  const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", mocks);
  const { useAiChatAttachments } = load("src/hooks/MultiPages/AIChat/useAiChatAttachments.ts", mocks);
  const send = () => createAiChatSend(context).handleSendMessage();
  const stop = () => useAiChatAttachments(context).handleCancelStream();
  const waitForReader = async (index) => {
    await readers[index].promise;
  };
  const done = (index) => {
    controllers[index].enqueue(new TextEncoder().encode('event: done\ndata: {"status":"complete","assistant_persisted":true}\n\n'));
    controllers[index].close();
  };
  return { context, requests, cancellations, mutations, controllers, send, stop, waitForReader, done };
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
    assert.deepEqual(h.mutations, before);
    assert.equal(await h.send(), true);
    assert.equal(h.requests.length, 2);
    assert.equal(h.context.messageQueueRef.current.length, 1);
    h.done(1);
    assert.equal(await second, true);
    assert.equal(h.context.sendInFlightRef.current, false);
    assert.equal(h.context.isTyping, false);
  });
}

test("failed Stop keeps the active send locked and normal completion releases it", { timeout: 2000 }, async (t) => {
  const h = client(t, { cancelStatus: 503, cancelResult: { success: false } });
  const first = h.send();
  await h.waitForReader(0);
  const streamId = h.context.streamingRequestRef.current;
  await h.stop();
  assert.ok(h.context.sendInFlightRef.current);
  assert.equal(h.context.streamingRequestRef.current, streamId);
  assert.equal(h.context.isTyping, true);
  h.done(0);
  assert.equal(await first, true);
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
  h.done(0);
  assert.equal(await first, true);
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
      "@/hooks/useFlag": { useFlag: (key) => key === FLAG && enabled },
      "./useAiChatState": { useAiChatState: () => ({ sendInFlightRef: { current: false } }) },
      "./useAiChatSessions": { useAiChatSessions: () => ({}) },
      "./useAiChatAttachments": { useAiChatAttachments: (context) => { stopContext = context; return {}; } },
      "./aiChatSend": { createAiChatSend: (context) => { sendContext = context; return {}; } },
      "./aiChatKeyboard": { createAiChatKeyboard: () => ({}) },
      "./useAiChatPresentation": { useAiChatPresentation: () => ({}) },
    });
    useAiChat();
    assert.equal(sendContext.stopClosesStream, enabled);
    assert.equal(stopContext.stopClosesStream, enabled);
    assert.equal(stopContext.sendInFlightRef, sendContext.sendInFlightRef);
  });
}

test("Stop recovery is a registered Everyone-default bugfix", () => {
  const { FEATURE_FLAG_DEFINITIONS } = load("src/lib/flags/definitions.ts", {});
  const definition = FEATURE_FLAG_DEFINITIONS.find((entry) => entry.key === FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});
