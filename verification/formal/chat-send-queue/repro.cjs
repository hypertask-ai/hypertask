const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const { load } = require(path.join(root, "tests/task-route-loader.cjs"));

const { createSessionMessageQueue } = load("src/lib/aiChat/sessionMessageQueue.ts", {});
const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
  "react-hot-toast": { default: { error() {} } },
  "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
  "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
  "./aiChatStream": { consumeAiChatStream: async () => {} },
});
const { useAiChatSessions } = load("src/hooks/MultiPages/AIChat/useAiChatSessions.ts", {
  "@/hooks/useFlag": { useFlag: () => false },
  "@/lib/ai/chipEvents": { signalAiChip: () => {} },
  "@/lib/flags/definitions/htpr-7762-chat-new-session-focus": { HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG: "htpr-7762-chat-new-session-focus" },
  react: { useCallback: (callback) => callback, useRef: (current) => ({ current }), useEffect() {} },
  "@/lib/constants": { default: {} },
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => ({ resetFiles() {}, clearFiles() {} }) },
  "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
  "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
});
const { resolveQueuedMessageCreatedAt } = load("src/lib/aiChat/queuedMessageOrder.ts", {});

const flush = () => new Promise(setImmediate);
const message = (id, content) => ({
  id,
  assistantMessageId: `assistant-${id}`,
  content,
  html: `<p>${content}</p>`,
  files: [],
  attachments: [],
});

function storageFixture() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function fixture() {
  const storage = storageFixture();
  const queue = createSessionMessageQueue(985, storage, () => {});
  let selected = "A";
  let draft = "";
  queue.sessionId = selected;
  const messageQueueRef = { current: [] };
  const sendInFlightRef = { current: false };
  const context = {
    persistentQueue: queue,
    messageQueueRef,
    sendInFlightRef,
    sessionIntentGenerationRef: { current: 0 },
    sessionSetupRef: { current: null },
    resolvedBoardSessionRef: { current: null },
    clearMessageQueue: () => { messageQueueRef.current = []; },
    selectSessionInHistory: (id) => { selected = id; queue.sessionId = id; },
    currentProject: { id: 15 },
    previousProjectIdRef: { current: 15 },
    currentUser: { id: 985 },
    pathname: "/chat",
    taskId: undefined,
    sessionsRef: { current: [] },
    chatHistoryReadyRef: { current: true },
    setQueuedMessages() {},
    setRecentChatBoardIds() {},
    shouldLoadChatHistory: false,
  };
  const controls = useAiChatSessions(context);
  const sent = [];
  Object.assign(context, {
    isByokBlocked: false,
    isTyping: false,
    editor: { getText: () => draft, getHTML: () => `<p>${draft}</p>`, commands: { clearContent: () => { draft = ""; } } },
    fileUpload: {
      fileItems: [],
      clearFiles() { context.fileUpload.fileItems = []; },
      setFileItems(update) { context.fileUpload.fileItems = update(context.fileUpload.fileItems); },
    },
    surface: "chat",
    inViewObject: {},
    waitForChatSession: async () => ({ id: selected, messages: [] }),
    processAttachments: async () => [],
    setIsTyping() {},
    addMessageToSessionQuery() {},
    isFullScreenChat: true,
    contextList: [],
    currentAiOption: { id: "model", model: "model", source: "openai" },
    streamingSessionRef: { current: null },
    streamingAssistantMessageRef: { current: null },
    streamingRequestRef: { current: null },
    setCurrentStreamingSession() {},
    setAgentStatus() {},
    updateSessionTitle() {},
    queryClient: {},
    updateLastMessageInSessionCache() {},
    appendMessageToSessionCache() {},
    drainQueuedMessage: controls.drainQueuedMessage,
    handleSendMessageRef: controls.handleSendMessageRef,
    reloadTaskAfterChat: false,
    chatRoute: "/api/ai/chat/stream",
  });
  const bind = (typing = false) => createAiChatSend({ ...context, isTyping: typing });
  const enqueue = async (text) => {
    draft = text;
    return bind(true).handleSendMessage();
  };
  return { queue, storage, context, controls, bind, enqueue, sent, storageValues: storage };
}

async function withTransport(fixtureUnderTest, statuses, check) {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  global.fetch = async (_url, options) => {
    const status = statuses.shift() ?? 200;
    if (status instanceof Error) throw status;
    fixtureUnderTest.sent.push(JSON.parse(options.body).message);
    return new Response("stream", { status });
  };
  console.log = () => {};
  console.error = () => {};
  try {
    await check();
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
}

async function failedSendKeepsTheOlderMessage() {
  const f = fixture();
  if (!await f.enqueue("one")) throw new Error("the first message did not enter the queue");
  if (!await f.enqueue("two")) throw new Error("the second message did not enter the queue");
  f.bind();
  await withTransport(f, [new Error("connection lost")], async () => {
    f.controls.drainQueuedMessage("A");
    await flush();
    await flush();
  });
  const afterFailure = f.queue.get("A").map((item) => item.content);
  const originalNow = Date.now;
  let now = originalNow() + 20000;
  Date.now = () => now;
  try {
    f.bind();
    await withTransport(f, [], async () => {
      f.controls.drainQueuedMessage("A");
      await flush();
      await flush();
      now += 20000;
      f.controls.drainQueuedMessage("A");
      await flush();
      await flush();
    });
    return { afterFailure, sent: f.sent, queueAfter: f.queue.get("A").map((item) => item.content) };
  } finally {
    Date.now = originalNow;
  }
}

async function switchKeepsTheQueue() {
  const f = fixture();
  if (!await f.enqueue("one")) throw new Error("the first message did not enter the queue");
  if (!await f.enqueue("two")) throw new Error("the second message did not enter the queue");
  f.controls.selectSession("B");
  const inB = f.queue.get("B").map((item) => item.content);
  f.controls.selectSession("A");
  const backInA = f.queue.get("A").map((item) => item.content);
  f.bind();
  await withTransport(f, [], async () => {
    f.controls.drainQueuedMessage("A");
    await flush();
    await flush();
    f.controls.drainQueuedMessage("A");
    await flush();
    await flush();
  });
  return { inB, backInA, sent: f.sent, queueAfter: f.queue.get("A").map((item) => item.content) };
}

async function queuedMessageSortsBeforeItsReply() {
  const replyCreatedAt = new Date("2026-11-20T10:00:00.500Z");
  const insertAt = new Date(replyCreatedAt.getTime() + 4000);
  const lookup = async () => ({ createdAt: replyCreatedAt });
  const createdAt = await resolveQueuedMessageCreatedAt("human", "assistant-1", lookup);
  const withoutBackdate = await resolveQueuedMessageCreatedAt("human", undefined, lookup);
  return {
    replyCreatedAt: replyCreatedAt.toISOString(),
    queuedCreatedAt: createdAt.toISOString(),
    before: createdAt.getTime() < replyCreatedAt.getTime(),
    preFixCreatedAt: (withoutBackdate ?? insertAt).toISOString(),
    preFixBefore: (withoutBackdate ?? insertAt).getTime() < replyCreatedAt.getTime(),
  };
}

async function replyStoredBetweenLookupAndInsert() {
  let reply = null;
  const createdAt = await resolveQueuedMessageCreatedAt("human", "assistant-1", async () => reply);
  reply = { createdAt: new Date("2026-11-20T10:00:00.500Z") };
  const storedCreatedAt = createdAt ?? new Date(reply.createdAt.getTime() + 1);
  return {
    lookupMissed: createdAt === undefined,
    replyCreatedAt: reply.createdAt.toISOString(),
    queuedCreatedAt: storedCreatedAt.toISOString(),
    before: storedCreatedAt.getTime() < reply.createdAt.getTime(),
  };
}

(async () => {
  const first = await failedSendKeepsTheOlderMessage();
  const second = await switchKeepsTheQueue();
  const third = await queuedMessageSortsBeforeItsReply();
  const fourth = await replyStoredBetweenLookupAndInsert();
  const result = {
    failedSend: first,
    switchChat: second,
    orderInHistory: third,
    lookupInsertRace: fourth,
  };
  console.log(JSON.stringify(result, null, 2));
  const clean = first.afterFailure.join(",") === "one,two"
    && first.sent.join(",") === "one,two"
    && first.queueAfter.length === 0
    && second.sent.join(",") === "one,two"
    && second.backInA.join(",") === "one,two"
    && second.inB.length === 0
    && second.queueAfter.length === 0
    && third.before
    && !third.preFixBefore
    && fourth.lookupMissed
    && !fourth.before;
  process.exitCode = clean ? 0 : 1;
})();
