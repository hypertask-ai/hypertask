const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-7099-chat-connection-lost";
const LOST = "Connection lost. Reopen this chat shortly to check for the completed reply.";
const stream = (text) =>
  new Response(`event: content\ndata: {"content":"${text}"}\n\nevent: done\ndata: {"status":"complete","assistant_persisted":true}\n\n`);
const refusal = (status, text) =>
  new Response(`event: error\ndata: {"content":"${text}"}\n\n`, { status });
// A response whose body dies after the headers arrive, as a dropped connection does.
const brokenBody = () =>
  new Response(new ReadableStream({ pull(controller) { controller.error(new TypeError("network error")); } }));

// responses: one entry per fetch call: a Response, or an Error to reject with.
async function runTurn({ enabled, responses, stopAfterFirstFailure = false }) {
  const original = { fetch: global.fetch, log: console.log, error: console.error, setTimeout: global.setTimeout };
  const refs = { current: null };
  const added = [];
  const appended = [];
  const updated = [];
  const payloads = [];
  const delays = [];
  const context = {
    isByokBlocked: false, isTyping: false, editor: { getHTML: () => "<p>Hi</p>", getText: () => "Hi", commands: { clearContent() {} } },
    fileUpload: { fileItems: [], clearFiles() {} },
    messageQueueRef: { current: [] }, setQueuedMessages() {}, sendInFlightRef: { current: false },
    surface: "chat", inViewObject: {}, waitForChatSession: async () => ({ id: "session", messages: [] }),
    currentProject: { id: 1 }, processAttachments: async () => [], setIsTyping() {},
    addMessageToSessionQuery: (...args) => added.push(args[1]),
    scopedProjectId: 1, isFullScreenChat: false, taskId: undefined, modelTeamId: 1, contextList: [],
    currentAiOption: { id: "model", model: "model", source: "openai" }, pathname: "/chat/session", currentUser: { id: 7 },
    streamingSessionRef: { ...refs }, streamingAssistantMessageRef: { ...refs }, streamingRequestRef: { ...refs },
    setCurrentStreamingSession() {}, chatRoute: "/api/ai/chat/stream", turnFailureState: true,
    setAgentStatus() {}, updateSessionTitle() {}, queryClient: { refetchQueries: async () => {} },
    drainQueuedMessage() {}, handleSendMessageRef: { current: null }, reloadTaskAfterChat: false,
    updateLastMessageInSessionCache: (_id, message) => updated.push(message),
    appendMessageToSessionCache: (_id, message) => appended.push(message),
    connectionRetry: enabled,
  };
  let calls = 0;
  global.fetch = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    const next = responses[Math.min(calls++, responses.length - 1)];
    if (calls === 1 && stopAfterFirstFailure) context.streamingRequestRef.current = null;
    if (next instanceof Error) throw next;
    return next.clone();
  };
  global.setTimeout = (callback, ms) => { delays.push(ms); callback(); return 0; };
  console.log = () => {};
  console.error = () => {};
  try {
    const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
      "react-hot-toast": { default: { error() {} } },
      "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
      "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
      "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
      "./aiChatShared": { parseAiStreamErrorContent: (value) => value },
      "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    });
    assert.equal(await createAiChatSend(context).handleSendMessage(), true);
    return { added, appended, updated, payloads, delays, fetchCalls: calls };
  } finally {
    Object.assign(global, { fetch: original.fetch, setTimeout: original.setTimeout });
    console.log = original.log;
    console.error = original.error;
  }
}

const connectionDrop = () => new TypeError("Failed to fetch");
const lostNotices = (result) => [...result.appended, ...result.updated].filter((m) => m.content === LOST);

test("flag key matches the definition file", () => {
  const { HTPR_7099_CHAT_CONNECTION_LOST_FLAG } = load("src/lib/flags/keys.ts", {});
  assert.equal(HTPR_7099_CHAT_CONNECTION_LOST_FLAG, FLAG);
});

test("flag on: a dropped connection is retried and the reply lands", async () => {
  const result = await runTurn({ enabled: true, responses: [connectionDrop(), stream("42")] });
  assert.equal(result.fetchCalls, 2);
  assert.equal(lostNotices(result).length, 0);
  assert.ok(result.added.some((m) => m.content === "42" && m.isDelivered));
  assert.equal(result.payloads[0].assistant_message_id, result.payloads[1].assistant_message_id);
  assert.notEqual(result.payloads[0].stream_id, result.payloads[1].stream_id);
});

test("flag on: a stream that dies after the headers is retried", async () => {
  const result = await runTurn({ enabled: true, responses: [brokenBody(), stream("42")] });
  assert.equal(result.fetchCalls, 2);
  assert.equal(lostNotices(result).length, 0);
  assert.ok(result.added.some((m) => m.content === "42"));
});

test("flag on: a 409 busy after our own dropped attempt waits and retries", async () => {
  const result = await runTurn({
    enabled: true,
    responses: [connectionDrop(), refusal(409, "Another AI reply is already in progress."), stream("42")],
  });
  assert.equal(result.fetchCalls, 3);
  assert.equal(lostNotices(result).length, 0);
  assert.ok(result.added.some((m) => m.content === "42"));
});

test("flag on: a first-attempt refusal is shown as is, never retried", async () => {
  const result = await runTurn({ enabled: true, responses: [refusal(429, "Too many AI replies were started recently.")] });
  assert.equal(result.fetchCalls, 1);
  assert.equal(result.appended[0].content, "Too many AI replies were started recently.");
});

test("flag on: retries stop after the bounded attempts and show the notice", async () => {
  const result = await runTurn({ enabled: true, responses: [connectionDrop()] });
  assert.equal(result.fetchCalls, 4);
  assert.deepEqual(result.delays, [1500, 4000, 8000]);
  assert.equal(lostNotices(result).length, 1);
});

test("flag on: a reply the user stopped is not resent", async () => {
  const result = await runTurn({ enabled: true, responses: [connectionDrop(), stream("42")], stopAfterFirstFailure: true });
  assert.equal(result.fetchCalls, 1);
});

test("flag off: a dropped connection ends at once with the old notice", async () => {
  const result = await runTurn({ enabled: false, responses: [connectionDrop(), stream("42")] });
  assert.equal(result.fetchCalls, 1);
  assert.equal(lostNotices(result).length, 1);
  assert.deepEqual(result.delays, []);
});
