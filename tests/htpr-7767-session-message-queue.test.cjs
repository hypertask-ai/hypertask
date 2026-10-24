const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const { createSessionMessageQueue } = load("src/lib/aiChat/sessionMessageQueue.ts", {});
const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
  "react-hot-toast": { default: { error() {} } },
  "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
  "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
  "./aiChatStream": { consumeAiChatStream: async () => {} },
});
const { useAiChatSessions } = load("src/hooks/MultiPages/AIChat/useAiChatSessions.ts", {
  react: { useCallback: (callback) => callback, useRef: (current) => ({ current }), useEffect() {} },
  "@/lib/constants": { default: {} },
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => ({ resetFiles() {}, clearFiles() {} }) },
  "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
  "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
});

function storageFixture() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const flush = () => new Promise(setImmediate);
const message = (id, content) => ({ id, assistantMessageId: `assistant-${id}`, content, html: `<p>${content}</p>`, files: [], attachments: [] });

function chatFixture({ enabled = true, storage = storageFixture() } = {}) {
  let selected = "A", draft = "", clears = 0;
  const queue = enabled ? createSessionMessageQueue(985, storage, () => {}) : undefined;
  if (queue) queue.sessionId = selected;
  const messageQueueRef = { current: [] }, sendInFlightRef = { current: false };
  const context = {
    persistentQueue: queue, messageQueueRef, sendInFlightRef,
    sessionIntentGenerationRef: { current: 0 }, sessionSetupRef: { current: null }, resolvedBoardSessionRef: { current: null },
    clearMessageQueue: () => { messageQueueRef.current = []; },
    selectSessionInHistory: (id) => { selected = id; if (queue) queue.sessionId = id; },
    currentProject: { id: 15 }, previousProjectIdRef: { current: 15 }, currentUser: { id: 985 },
    pathname: "/chat", taskId: undefined, sessionsRef: { current: [] }, chatHistoryReadyRef: { current: true },
    setQueuedMessages() {}, setRecentChatBoardIds() {}, shouldLoadChatHistory: false,
  };
  const controls = useAiChatSessions(context);
  const sent = [], added = [];
  Object.assign(context, {
    isByokBlocked: false, isTyping: false,
    editor: { getText: () => draft, getHTML: () => `<p>${draft}</p>`, commands: { clearContent: () => { draft = ""; clears++; } } },
    fileUpload: { fileItems: [], clearFiles() {} }, surface: "chat", inViewObject: {},
    waitForChatSession: async () => ({ id: selected, messages: [] }),
    processAttachments: async () => [], setIsTyping() {}, addMessageToSessionQuery: (_id, item) => added.push(item),
    isFullScreenChat: true, contextList: [], currentAiOption: { id: "model", model: "model", source: "openai" },
    streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null }, streamingRequestRef: { current: null },
    setCurrentStreamingSession() {}, setAgentStatus() {}, updateSessionTitle() {},
    queryClient: {}, updateLastMessageInSessionCache() {}, appendMessageToSessionCache() {},
    drainQueuedMessage: controls.drainQueuedMessage, handleSendMessageRef: controls.handleSendMessageRef,
    reloadTaskAfterChat: false, chatRoute: "/api/ai/chat/stream",
  });
  const bind = (typing = false) => createAiChatSend({ ...context, isTyping: typing });
  const enqueue = async (text) => { draft = text; return bind(true).handleSendMessage(); };
  return { queue, storage, context, controls, bind, enqueue, sent, added, setDraft: (text) => { draft = text; }, draft: () => draft, clears: () => clears };
}

async function withTransport(fixture, check, statuses = []) {
  const original = { fetch: global.fetch, log: console.log };
  global.fetch = async (_url, options) => {
    fixture.sent.push(JSON.parse(options.body));
    const status = statuses.shift() ?? 200;
    return new Response(status === 409 ? 'event: error\ndata: {"content":"Another AI reply is already in progress."}\n\n' : "stream", { status });
  };
  console.log = () => {};
  try { await check(); } finally { global.fetch = original.fetch; console.log = original.log; }
}

test("now fixed: switching A to B and back, then reloading, retains only A's FIFO and attachments", async () => {
  const fixture = chatFixture();
  fixture.context.processAttachments = async () => [{ fileName: "note.txt", url: "data:text/plain;base64,QQ==", mimeType: "text/plain" }];
  assert.equal(await fixture.enqueue("first"), true);
  assert.equal(await fixture.enqueue("second"), true);
  fixture.controls.selectSession("B");
  assert.deepEqual(fixture.queue.get("B"), []);
  fixture.controls.selectSession("A");
  assert.deepEqual(fixture.queue.get("A").map((item) => item.content), ["first", "second"]);
  const reloaded = createSessionMessageQueue(985, fixture.storage, () => {});
  assert.deepEqual(reloaded.get("A").map((item) => [item.content, item.attachments[0].url]), [
    ["first", "data:text/plain;base64,QQ=="], ["second", "data:text/plain;base64,QQ=="],
  ]);
  assert.deepEqual(createSessionMessageQueue(986, fixture.storage, () => {}).get("A"), []);
  fixture.queue.set("A", reloaded.get("A"));
  fixture.bind();
  fixture.setDraft("unfinished next question");
  const clearsBefore = fixture.clears();
  await withTransport(fixture, async () => {
    fixture.controls.drainQueuedMessage("A"); await flush();
    fixture.controls.drainQueuedMessage("A"); await flush();
  });
  assert.deepEqual(fixture.sent.map((item) => [item.session_id, item.message, item.attachments[0].fileName]), [
    ["A", "first", "note.txt"], ["A", "second", "note.txt"],
  ]);
  assert.equal(fixture.draft(), "unfinished next question");
  assert.equal(fixture.clears(), clearsBefore);
  assert.deepEqual(createSessionMessageQueue(985, fixture.storage, () => {}).get("A"), []);
});

test("an A completion while B is selected neither loses A nor drains B; cancellation still removes only the chosen item", async () => {
  const fixture = chatFixture();
  assert.equal(await fixture.enqueue("A pending"), true);
  fixture.controls.selectSession("B");
  assert.equal(await fixture.enqueue("B cancelled"), true);
  assert.equal(await fixture.enqueue("B retained"), true);
  fixture.controls.removeQueuedMessage(fixture.queue.get("B")[0].id);
  fixture.bind();
  await withTransport(fixture, async () => {
    fixture.controls.drainQueuedMessage("A"); await flush();
    assert.deepEqual(fixture.sent, []);
    assert.deepEqual(fixture.queue.get("A").map((item) => item.content), ["A pending"]);
    fixture.controls.drainQueuedMessage("B"); await flush();
  });
  assert.deepEqual(fixture.sent.map((item) => [item.session_id, item.message]), [["B", "B retained"]]);
  assert.deepEqual(fixture.queue.get("A").map((item) => item.content), ["A pending"]);
});

test("a restored queue waits through a busy server without dropping or duplicating its user message", async () => {
  const fixture = chatFixture();
  fixture.queue.set("A", [message("one", "after reload")]);
  fixture.bind();
  const originalNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  try {
    await withTransport(fixture, async () => {
      fixture.controls.drainQueuedMessage("A"); await flush();
      assert.deepEqual(fixture.queue.get("A").map((item) => item.content), ["after reload"]);
      assert.deepEqual(fixture.added, []);
      fixture.controls.drainQueuedMessage("A"); await flush();
      assert.equal(fixture.sent.length, 1, "a busy retry must respect the server rate limit");
      now += 15000;
      fixture.controls.drainQueuedMessage("A"); await flush();
    }, [409, 200]);
  } finally { Date.now = originalNow; }
  assert.deepEqual(fixture.sent.map((item) => item.assistant_message_id), ["assistant-one", "assistant-one"]);
  assert.deepEqual(fixture.added.filter((item) => item.role === "human").map((item) => [item.id, item.content]), [["one", "after reload"]]);
  assert.deepEqual(fixture.queue.get("A"), []);
});

test("still works: flag off uses the original in-view enqueue, cancellation and automatic FIFO drain", async () => {
  const fixture = chatFixture({ enabled: false });
  assert.equal(await fixture.enqueue("legacy first"), true);
  assert.equal(await fixture.enqueue("legacy cancelled"), true);
  fixture.controls.removeQueuedMessage(fixture.context.messageQueueRef.current[1].id);
  fixture.bind();
  await withTransport(fixture, async () => { fixture.controls.drainQueuedMessage(); await flush(); });
  assert.deepEqual(fixture.sent.map((item) => [item.session_id, item.message]), [["A", "legacy first"]]);
  assert.equal(fixture.clears(), 3);
});

test("switching during queued session resolution cannot redirect A's message into B", async () => {
  const fixture = chatFixture();
  assert.equal(await fixture.enqueue("only for A"), true);
  let resolveSession;
  fixture.context.waitForChatSession = () => new Promise((resolve) => { resolveSession = resolve; });
  fixture.bind();
  await withTransport(fixture, async () => {
    fixture.controls.drainQueuedMessage("A");
    fixture.controls.selectSession("B");
    resolveSession({ id: "B", messages: [] });
    await flush();
  });
  assert.deepEqual(fixture.sent, []);
  assert.deepEqual(fixture.queue.get("A").map((item) => item.content), ["only for A"]);
});

test("slow attachment preparation preserves enqueue order and storage failure leaves the draft untouched", async () => {
  const fixture = chatFixture();
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  let preparations = 0;
  fixture.context.processAttachments = async () => ++preparations === 1 ? first : [];
  const firstSend = fixture.enqueue("slow first");
  fixture.setDraft("fast second");
  const secondSend = fixture.bind(false).handleSendMessage();
  resolveFirst([]);
  assert.deepEqual(await Promise.all([firstSend, secondSend]), [true, true]);
  assert.deepEqual(fixture.queue.get("A").map((item) => item.content), ["slow first", "fast second"]);
  const broken = chatFixture({ storage: { getItem: () => null, setItem: () => { throw new Error("quota"); } } });
  assert.equal(await broken.enqueue("keep this draft"), false);
  assert.equal(broken.draft(), "keep this draft");
  assert.equal(broken.clears(), 0);
});
