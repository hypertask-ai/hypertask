const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const hasRedis = spawnSync("redis-server", ["--version"]).status === 0;
const { once } = require("node:events");
const Redis = require("ioredis");
const { load } = require("./task-route-loader.cjs");

const { createSessionStreams } = load("src/lib/aiChat/sessionStreams.ts", {});
const { createSessionMessageQueue } = load("src/lib/aiChat/sessionMessageQueue.ts", {});
const { acquireAiChatStreamLease, releaseAiChatStreamLease, requestAiChatCancellation } = load("src/app/api/ai/chat/stream/streamLease.ts", {
  "@/lib/redis": { getRedis: () => { throw new Error("Real test Redis must be passed explicitly"); } },
});
const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
  "react-hot-toast": { default: { error() {} } },
  "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
  "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
  "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
  "@/lib/realtime/shared": { TASK_EVENT: "task" },
  "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
});
const { useAiChatSessions } = load("src/hooks/MultiPages/AIChat/useAiChatSessions.ts", {
  "@/hooks/useFlag": { useFlag: () => false },
  react: { useCallback: (fn) => fn, useRef: (current) => ({ current }), useEffect() {} },
  "@/lib/constants": { default: {} },
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "@/components/Common/AttachmentsUpload/FileUploadHandler": { useFileUpload: () => ({}) },
  "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
  "@/lib/demo/isGuestClient": { isGuestCookieUser: () => false },
});

const { useAiChatAttachments } = load("src/hooks/MultiPages/AIChat/useAiChatAttachments.ts", {
  "react-hot-toast": { default: { error() {} } },
  react: { useCallback: (fn) => fn },
  "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
  "@/utils/helperFunctions/helperFunctions": {},
  "@/lib/demo/guestBoardBuild": {},
});

let redis, server, directory;
test.before(async () => {
  if (!hasRedis) return;
  directory = mkdtempSync(join(tmpdir(), "htpr-7765-"));
  const socket = join(directory, "redis.sock");
  server = spawn("redis-server", ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Redis exited ${code}`)));
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("ready to accept connections")) resolve(); });
  });
  redis = new Redis({ path: socket, retryStrategy: () => 30 });
  redis.on("error", () => {});
  await once(redis, "ready");
});
test.after(async () => {
  if (redis) await redis.quit();
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  if (directory) rmSync(directory, { recursive: true, force: true });
});

const lease = (sessionId, streamId, enabled = true) => acquireAiChatStreamLease(985, { sessionId, streamId }, async () => redis, undefined, false, enabled);

test("three real Redis leases overlap, but the same session stays single-flight; cancellation and release are isolated", { skip: !hasRedis }, async () => {
  await redis.flushdb();
  const leases = await Promise.all([lease("A", "a"), lease("B", "b"), lease("C", "c")]);
  for (const acquired of leases) assert.equal(typeof acquired, "object");
  assert.equal(await lease("A", "second-a"), "busy");
  assert.equal(await requestAiChatCancellation(985, "A", "assistant-a", "a", async () => redis), "cancelling");
  assert.equal(await redis.get("ai-chat:cancel:user:985:session:B:stream:b"), null);
  assert.equal(await requestAiChatCancellation(985, "B", "assistant-b", "a", async () => redis), "unknown");
  await releaseAiChatStreamLease(leases[0]);
  assert.equal(await lease("B", "second-b"), "busy");
  assert.equal(await lease("C", "second-c"), "busy");
  assert.equal(typeof await lease("A", "replacement-a"), "object");
});

test("flag off still serializes a user's chats; parallel sessions retain the user-wide start limit", { skip: !hasRedis }, async () => {
  await redis.flushdb();
  const legacy = await lease("A", "a", false);
  assert.equal(typeof legacy, "object");
  assert.equal(await lease("B", "b", false), "busy");
  assert.equal(await lease("B", "b", true), "busy", "an old global turn still guards rollout");
  await redis.flushdb();
  for (let i = 0; i < 12; i++) assert.equal(typeof await lease(`session-${i}`, `stream-${i}`), "object");
  assert.equal(await lease("thirteenth", "stream"), "limited");
});

const flush = () => new Promise(setImmediate);
function fixture() {
  const streams = createSessionStreams(() => {});
  const stored = new Map();
  const queue = createSessionMessageQueue(985, {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  }, () => {});
  let selected = "A", draft = "";
  const sessions = new Map(["A", "B", "C"].map((id) => [id, { id, userId: 985, messages: [] }]));
  const added = [], sent = [], controllers = new Map();
  const fileItems = [];
  const context = {
    parallelStreams: streams, persistentQueue: queue,
    messageQueueRef: { current: [] }, sendInFlightRef: { current: false },
    sessionIntentGenerationRef: { current: 0 }, sessionSetupRef: { current: null }, resolvedBoardSessionRef: { current: null },
    clearMessageQueue() {}, selectSessionInHistory: (id) => { selected = id; queue.sessionId = id; },
    currentProject: { id: 15 }, previousProjectIdRef: { current: 15 }, currentUser: { id: 985 },
    pathname: "/chat", taskId: undefined, sessionsRef: { current: [...sessions.values()] }, chatHistoryReadyRef: { current: true },
    setQueuedMessages() {}, setRecentChatBoardIds() {}, shouldLoadChatHistory: false,
    getDisplayedSession: () => sessions.get(selected), resolveHistorySession: async (id) => sessions.get(id),
  };
  const controls = useAiChatSessions(context);
  Object.assign(context, {
    isByokBlocked: false, isTyping: false, stopClosesStream: true, settleSendRef: { current: null },
    editor: { getText: () => draft, getHTML: () => `<p>${draft}</p>`, commands: { clearContent: () => { draft = ""; } } },
    fileUpload: { fileItems, clearFiles: () => fileItems.splice(0), setFileItems: (update) => { const next = update([...fileItems]); fileItems.splice(0, fileItems.length, ...next); } },
    surface: "chat", inViewObject: {}, waitForChatSession: async () => sessions.get(selected), processAttachments: async () => [],
    setIsTyping() {}, setAgentStatus() {}, setCurrentStreamingSession() {},
    addMessageToSessionQuery: (id, message) => {
      added.push([id, message]);
      const session = sessions.get(id);
      const index = session.messages.findIndex((item) => item.id === message.id);
      if (index >= 0) session.messages[index] = message;
      else session.messages.push(message);
    },
    isFullScreenChat: true, contextList: [], currentAiOption: { id: "model", model: "model", source: "openai" },
    streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null }, streamingRequestRef: { current: null },
    updateSessionTitle() {}, queryClient: { refetchQueries: async () => {} },
    updateLastMessageInSessionCache() {}, appendMessageToSessionCache() {},
    drainQueuedMessage: controls.drainQueuedMessage, handleSendMessageRef: controls.handleSendMessageRef,
    reloadTaskAfterChat: false, chatRoute: "/api/ai/chat/stream",
  });
  const bind = () => createAiChatSend(context).handleSendMessage;
  const select = (id) => { controls.selectSession(id); return bind(); };
  select("A");
  return {
    streams, queue, context, controls, added, sent, controllers, fileItems, select,
    send(text) { draft = text; return bind()(); },
    async transport(url, options) {
      if (url.endsWith("/cancel")) return Response.json({ success: true });
      const payload = JSON.parse(options.body);
      sent.push(payload);
      return new Response(new ReadableStream({ start(controller) { controllers.set(payload.message, controller); } }));
    },
    finish(message, fail = false) {
      const controller = controllers.get(message);
      const content = fail ? "failed" : `reply-${message}`;
      controller.enqueue(new TextEncoder().encode(`event: ${fail ? "error" : "content"}\ndata: ${JSON.stringify({ content })}\n\nevent: done\ndata: ${JSON.stringify({ status: fail ? "error" : "success", assistant_persisted: true })}\n\n`));
      controller.close();
    },
  };
}

async function transport(f, run) {
  const previous = global.fetch, log = console.log;
  global.fetch = f.transport;
  console.log = () => {};
  try { await run(); } finally { global.fetch = previous; console.log = log; }
}

test("three real SSE consumers overlap; hidden-session FIFO drains without selecting it and no reply or status crosses sessions", async () => {
  const f = fixture();
  await transport(f, async () => {
    const a = f.send("a"); await flush();
    assert.equal(await f.send("a-queued-1"), true);
    assert.equal(await f.send("a-queued-2"), true);
    f.select("B"); const b = f.send("b"); await flush();
    f.select("C"); const c = f.send("c"); await flush();
    assert.deepEqual(f.sent.map((item) => item.session_id), ["A", "B", "C"]);
    assert.equal(f.streams.get("A").isTyping, true);
    assert.equal(f.streams.get("B").isTyping, true);
    assert.equal(f.streams.get("C").isTyping, true);
    f.finish("a"); await a; await flush();
    assert.equal(f.streams.get("C").isTyping, true);
    assert.deepEqual(f.sent.map((item) => item.message), ["a", "b", "c", "a-queued-1"]);
    f.finish("a-queued-1"); await flush();
    assert.equal(f.sent.at(-1).message, "a-queued-2");
    assert.equal(f.sent.at(-1).session_id, "A");
    assert.equal(f.sent.at(-1).chat_history.some((item) => item.content === "reply-a-queued-1"), true);
    f.finish("a-queued-2"); f.finish("b", true); await b;
    assert.equal(f.streams.get("C").sendInFlightRef.current, true);
    f.finish("c"); await c; await flush();
    assert.deepEqual(f.queue.get("A"), []);
    for (const [sessionId, item] of f.added) assert.equal(item.sessionId, sessionId);
    assert.equal(f.added.some(([id, item]) => id === "C" && item.content === "reply-c" && item.isDelivered), true);
    assert.equal(f.streams.get("A").sendInFlightRef.current, false);
    assert.equal(f.streams.get("C").isTyping, false);
  });
});

test("Stop for A leaves B running, including when the stopped A stream finishes later", async () => {
  const f = fixture();
  await transport(f, async () => {
    const a = f.send("a"); await flush();
    f.select("B"); const b = f.send("b"); await flush();
    const state = f.streams.get("A");
    await useAiChatAttachments({ ...f.context, ...state, currentStreamingSession: "A" }).handleCancelStream();
    assert.equal(state.isTyping, false);
    assert.equal(f.streams.get("B").sendInFlightRef.current, true);
    assert.notEqual(f.streams.get("B").streamingRequestRef.current, null);
    f.finish("a"); f.finish("b"); await Promise.all([a, b]);
  });
});

test("late acceptance of A removes only A's submitted attachments, preserving B's new files", async () => {
  const f = fixture();
  const original = { name: "a.txt" }, fresh = { name: "b.txt" };
  f.fileItems.push(original);
  const realTransport = f.transport;
  let accept;
  f.transport = (...args) => new Promise((resolve) => { accept = () => resolve(realTransport(...args)); });
  await transport(f, async () => {
    const a = f.send("a"); await flush();
    f.select("B");
    f.fileItems.splice(0, f.fileItems.length, fresh);
    accept(); await flush();
    assert.deepEqual(f.fileItems, [fresh]);
    f.finish("a"); await a;
    assert.deepEqual(f.fileItems, [fresh]);
  });
});

test("parallel-first then flag-off still refuses another turn in that same session", { skip: !hasRedis }, async () => {
  await redis.flushdb();
  const first = await lease("A", "first");
  assert.equal(typeof first, "object");
  assert.equal(await lease("A", "after-rollback", false), "busy");
  await releaseAiChatStreamLease(first);
  assert.equal(typeof await lease("A", "after-release", false), "object");
});

test("unresolved session submission preserves its draft instead of starting a hidden legacy stream", async () => {
  const f = fixture();
  f.context.getDisplayedSession = () => undefined;
  await transport(f, async () => {
    assert.equal(await f.send("draft while loading"), false);
    assert.deepEqual(f.sent, []);
    assert.equal(f.context.editor.getText(), "draft while loading");
  });
});

test("parallel Stop settles its mutex even when the older stop-close flag is off", async () => {
  const f = fixture();
  f.context.stopClosesStream = false;
  await transport(f, async () => {
    const a = f.send("a"); await flush();
    const runtime = f.streams.get("A");
    await useAiChatAttachments({ ...f.context, ...runtime, stopClosesStream: true, currentStreamingSession: "A" }).handleCancelStream();
    assert.equal(runtime.sendInFlightRef.current, false);
    const next = f.send("after-stop"); await flush();
    assert.deepEqual(f.sent.map((item) => item.message), ["a", "after-stop"]);
    f.finish("a"); f.finish("after-stop"); await Promise.all([a, next]);
    assert.equal(runtime.sendInFlightRef.current, false);
  });
});

test("deleting a background chat removes its queued follow-ups and background runtime", async () => {
  const f = fixture();
  f.context.deleteSessionInHistory = async () => true;
  const controls = useAiChatSessions(f.context);
  f.queue.set("A", [{ id: "queued", content: "never send", html: "never send", files: [], attachments: [] }]);
  f.select("B");
  await controls.deleteSession("A");
  assert.deepEqual(f.streams.sessionIds(), ["B"]);
  assert.deepEqual(f.queue.get("A"), []);
});

test("failed deletion preserves a background chat's pending messages", async () => {
  const f = fixture();
  f.context.deleteSessionInHistory = async () => false;
  const controls = useAiChatSessions(f.context);
  f.queue.set("A", [{ id: "queued", content: "keep", html: "keep", files: [], attachments: [] }]);
  await controls.deleteSession("A");
  assert.equal(f.queue.get("A")[0].content, "keep");
  assert.deepEqual(f.streams.sessionIds(), ["A"]);
});

test("parallel Stop before response headers drops only accepted files with the older stop-close flag off", async () => {
  const f = fixture();
  f.context.stopClosesStream = false;
  const submitted = { name: "submitted.txt" }, fresh = { name: "fresh.txt" };
  f.fileItems.push(submitted);
  const realTransport = f.transport;
  let accept;
  f.transport = (url, ...args) => url.endsWith("/cancel") ? realTransport(url, ...args)
    : new Promise((resolve) => { accept = () => resolve(realTransport(url, ...args)); });
  await transport(f, async () => {
    const a = f.send("a"); await flush();
    f.fileItems.push(fresh);
    const runtime = f.streams.get("A");
    await useAiChatAttachments({ ...f.context, ...runtime, stopClosesStream: true, currentStreamingSession: "A" }).handleCancelStream();
    assert.deepEqual(f.fileItems, [fresh]);
    accept(); await flush(); f.finish("a"); await a;
    assert.deepEqual(f.fileItems, [fresh]);
  });
});

test("parallel chat improvement defaults to Everyone with its own reversible ticket flag", () => {
  const { default: definition, HTPR_7765_PARALLEL_CHATS_FLAG: key } = load("src/lib/flags/definitions/htpr-7765-parallel-chats.ts", {});
  assert.equal(key, "htpr-7765-parallel-chats");
  assert.equal(definition.key, key);
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.kind, "improvement");
});
