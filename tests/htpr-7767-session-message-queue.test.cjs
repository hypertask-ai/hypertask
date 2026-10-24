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
  "@/hooks/useFlag": { useFlag: () => false },
  "@/lib/flags/definitions/htpr-7762-chat-new-session-focus": { HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG: "htpr-7762-chat-new-session-focus" },
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
    fileUpload: {
      fileItems: [],
      clearFiles() { context.fileUpload.fileItems = []; },
      setFileItems(update) { context.fileUpload.fileItems = update(context.fileUpload.fileItems); },
    }, surface: "chat", inViewObject: {},
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
    if (status instanceof Error) throw status;
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

for (const failure of [500, new TypeError("network unavailable"), 429]) {
  test(`a ${failure} refusal resumes the same session FIFO after backoff`, async () => {
    const fixture = chatFixture();
    fixture.queue.set("A", [message("one", "retry first"), message("two", "then second")]);
    fixture.bind();
    const originalNow = Date.now;
    let now = 100000;
    Date.now = () => now;
    try {
      await withTransport(fixture, async () => {
        fixture.controls.drainQueuedMessage("A"); await flush();
        assert.deepEqual(fixture.queue.get("A").map((item) => item.id), ["one", "two"]);
        assert.equal(fixture.added.filter((item) => item.role === "human").length, 0);
        const delay = failure === 429 ? 60000 : 15000;
        now += delay - 1;
        fixture.controls.drainQueuedMessage("A"); await flush();
        assert.equal(fixture.sent.length, 1);
        now++;
        fixture.controls.drainQueuedMessage("A"); await flush();
        fixture.controls.drainQueuedMessage("A"); await flush();
      }, [failure, 200, 200]);
    } finally { Date.now = originalNow; }
    assert.deepEqual(fixture.sent.map((item) => [item.session_id, item.message]), [
      ["A", "retry first"], ["A", "retry first"], ["A", "then second"],
    ]);
    assert.deepEqual(fixture.added.filter((item) => item.role === "human").map((item) => item.id), ["one", "two"]);
    assert.deepEqual(fixture.queue.get("A"), []);
  });
}

test("unchanged pending drafts enqueue once while edited drafts remain independently sendable", async () => {
  const fixture = chatFixture();
  let resolvePreparation;
  let preparations = 0;
  const preparation = new Promise((resolve) => { resolvePreparation = resolve; });
  fixture.context.processAttachments = async () => { preparations++; return preparation; };
  const first = fixture.enqueue("pending draft");
  const duplicate = fixture.bind(false).handleSendMessage();
  assert.equal(await duplicate, false);
  assert.equal(fixture.draft(), "pending draft");
  fixture.setDraft("edited draft");
  const edited = fixture.bind(false).handleSendMessage();
  resolvePreparation([]);
  assert.deepEqual(await Promise.all([first, edited]), [true, true]);
  assert.equal(preparations, 2);
  assert.deepEqual(fixture.queue.get("A").map((item) => item.content), ["pending draft", "edited draft"]);
  fixture.bind();
  await withTransport(fixture, async () => {
    fixture.controls.drainQueuedMessage("A"); await flush();
    fixture.controls.drainQueuedMessage("A"); await flush();
  });
  assert.deepEqual(fixture.sent.map((item) => item.message), ["pending draft", "edited draft"]);
  assert.deepEqual(fixture.queue.get("A"), []);
});

test("a pending draft with changed attachments permits its own submission", async () => {
  const fixture = chatFixture();
  let resolvePreparation;
  const preparation = new Promise((resolve) => { resolvePreparation = resolve; });
  fixture.context.processAttachments = () => preparation;
  fixture.context.fileUpload.fileItems = [{ id: "first-file" }];
  const first = fixture.enqueue("same text");
  fixture.context.fileUpload.fileItems = [{ id: "second-file" }];
  const edited = fixture.bind(false).handleSendMessage();
  resolvePreparation([]);
  assert.deepEqual(await Promise.all([first, edited]), [true, true]);
  assert.deepEqual(fixture.queue.get("A").map((item) => item.files[0].id), ["first-file", "second-file"]);
});

for (const change of ["unchanged", "added", "replaced", "removed"]) {
  test(`queue preparation preserves ${change} attachments without a second submission`, async () => {
    const fixture = chatFixture();
    const originalFile = { id: 1, file: new File(["original"], "original.txt") };
    const newFile = { id: 1, file: new File(["new"], "new.txt") };
    fixture.context.fileUpload.fileItems = [originalFile];
    let resolvePreparation;
    let preparedFiles;
    const preparation = new Promise((resolve) => { resolvePreparation = resolve; });
    fixture.context.processAttachments = (_html, files) => { preparedFiles = files; return preparation; };
    const pending = fixture.enqueue("same text");
    await flush();
    const changedFiles = change === "unchanged" ? [originalFile]
      : change === "added" ? [originalFile, newFile]
        : change === "replaced" ? [newFile] : [];
    fixture.context.fileUpload = { ...fixture.context.fileUpload, fileItems: changedFiles };
    fixture.bind(true);
    const attachments = [{ fileName: "original.txt", url: "data:text/plain;base64,b3JpZ2luYWw=", mimeType: "text/plain" }];
    resolvePreparation(attachments);
    assert.equal(await pending, true);
    assert.deepEqual(preparedFiles, [originalFile]);
    assert.deepEqual(fixture.queue.get("A").map((item) => item.attachments), [attachments]);
    assert.deepEqual(fixture.context.fileUpload.fileItems, change === "added" || change === "replaced" ? [newFile] : []);
    assert.equal(fixture.draft(), "");
  });
}

test("legacy history stays clean across repeated queue failures and recovery", async () => {
  const fixture = chatFixture();
  const originalMessages = [{ id: "previous", content: "previous question", role: "human" }];
  let cache = { data: { sessions: [{ id: "A", messages: originalMessages }] } };
  const queryClient = { setQueryData: (_key, update) => { cache = update(cache); } };
  const { useSessionAndChatHistory } = load("src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts", {
    react: { useCallback: (callback) => callback, useRef: (current) => ({ current }), useEffect() {}, useState: (initial) => [initial, () => {}] },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/store": { currentUserAtom: "user" },
    "@/lib/state": { useRecoilValue: (atom) => atom === "user" ? { id: 985, uid: "qa-985" } : null, useRecoilState: () => [null, () => {}] },
    "@/utils/api/ai_chat": { AI_Chat_API: { addMessage: async () => ({ data: {} }) } },
    "@tanstack/react-query": { useQuery: () => ({ data: cache, isSuccess: true }), useQueryClient: () => queryClient },
    "next/navigation": { usePathname: () => "/chat" },
    "./usePagedChatHistory": { usePagedChatHistory: () => ({}) },
    "./useDockedChatScope": { useDockedChatScope: () => [null] },
  });
  const history = useSessionAndChatHistory();
  assert.equal(history.sessionPagingEnabled, false);
  fixture.context.sessionPagingEnabled = history.sessionPagingEnabled;
  fixture.context.waitForChatSession = async () => cache.data.sessions[0];
  fixture.context.addMessageToSessionQuery = history.addMessageToSessionQuery;
  fixture.context.appendMessageToSessionCache = history.appendMessageToSessionCache;
  fixture.context.updateLastMessageInSessionCache = history.updateLastMessageInSessionCache;
  fixture.queue.set("A", [message("one", "retry this")]);
  fixture.bind();
  const originalNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  try {
    await withTransport(fixture, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        fixture.controls.drainQueuedMessage("A"); await flush();
        assert.deepEqual(cache.data.sessions[0].messages, originalMessages);
        assert.deepEqual(fixture.queue.get("A").map((item) => item.id), ["one"]);
        now += 15000;
      }
      fixture.controls.drainQueuedMessage("A"); await flush();
    }, [500, 500, 500, 200]);
  } finally { Date.now = originalNow; }
  assert.equal(fixture.sent.length, 4);
  assert.deepEqual(fixture.sent.map((item) => item.chat_history), Array.from({ length: 4 }, () => [{ content: "previous question", role: "human" }]));
  assert.deepEqual(cache.data.sessions[0].messages.map((item) => item.id), ["previous", "one", "assistant-one"]);
  assert.deepEqual(fixture.queue.get("A"), []);
});

for (const enabled of [false, true]) {
  test(`manual and deferred sends obey the synchronous mutex with persistence ${enabled}`, async () => {
    const fixture = chatFixture({ enabled });
    let resolveSession;
    fixture.context.waitForChatSession = () => new Promise((resolve) => { resolveSession = resolve; });
    const { handleSendMessage } = fixture.bind();
    await withTransport(fixture, async () => {
      const first = handleSendMessage("deferred first");
      assert.equal(fixture.context.sendInFlightRef.current, true);
      assert.equal(await handleSendMessage("concurrent deferred"), false);
      fixture.controls.drainQueuedMessage("A");
      assert.equal(fixture.sent.length, 0);
      resolveSession({ id: "A", messages: [] });
      assert.equal(await first, true);
      await flush();
    });
    assert.equal(fixture.context.sendInFlightRef.current, false);
    assert.deepEqual(fixture.sent.map((item) => item.message), ["deferred first"]);
  });
}
