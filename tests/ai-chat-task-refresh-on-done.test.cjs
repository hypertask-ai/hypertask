const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const TASK_ID = 42;
const PROJECT_ID = 15;
const image = { fileName: "request.png", mimeType: "image/png", url: "data:image/png;base64,aW1hZ2U=" };
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function runTurn({ attachments = [], enabled = true, preserveEditorContent = false, activeTaskId = TASK_ID, status = "complete", navigateDuringSend = false, unmountBeforeSend = false } = {}) {
  const original = { window: global.window, document: global.document, fetch: global.fetch, log: console.log };
  const listeners = new Map();
  const cleanups = [];
  const reads = [];
  const payloads = [];
  const refs = { current: null };
  let currentTask = { id: activeTaskId, projectId: PROJECT_ID, uniqueIndex: 7049, title: "Before", description_: { content: "Local content", attachments: [] } };
  const updatedTask = { ...currentTask, title: "After", description_: { content: "AI edited description", attachments: [] } };
  let description = "Local content";
  const queryClient = { refetchQueries: async () => {}, cancelQueries: async () => {}, setQueryData: () => {}, invalidateQueries: async () => {} };
  global.window = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    dispatchEvent(event) { listeners.get(event.type)?.(event); return true; },
  };
  global.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  console.log = () => {};
  const context = {
    isByokBlocked: false, isTyping: false, editor: { getHTML: () => "<p>Edit this task</p>", getText: () => "Edit this task", commands: { clearContent() {} } },
    fileUpload: { fileItems: attachments.map((file) => ({ file })), clearFiles() {} },
    messageQueueRef: { current: [] }, setQueuedMessages() {}, sendInFlightRef: { current: false },
    surface: "task_detail", inViewObject: { taskId: TASK_ID }, waitForChatSession: async () => ({ id: "session", messages: [] }),
    currentProject: { id: PROJECT_ID }, processAttachments: async () => attachments, setIsTyping() {}, addMessageToSessionQuery() {},
    scopedProjectId: PROJECT_ID, isFullScreenChat: false, taskId: TASK_ID, modelTeamId: 1, contextList: [],
    currentAiOption: { id: "model", model: "model", source: "openai" }, pathname: "/detail/project-15/7049", currentUser: { id: 7 },
    streamingSessionRef: { ...refs }, streamingAssistantMessageRef: { ...refs }, streamingRequestRef: { ...refs },
    setCurrentStreamingSession() {}, chatRoute: "/api/ai/chat/stream", turnFailureState: true,
    setAgentStatus() {}, updateSessionTitle() {}, queryClient, drainQueuedMessage() {}, handleSendMessageRef: { current: null },
    reloadTaskAfterChat: enabled,
  };
  global.fetch = async (url, options) => {
    if (url === context.chatRoute) {
      payloads.push(JSON.parse(options.body));
      if (navigateDuringSend) context.inViewObject.taskId = 99;
      return new Response(`event: content\ndata: {"content":"Task updated"}\n\nevent: done\ndata: {"status":"${status}","assistant_persisted":true}\n\n`);
    }
    reads.push({ url, options });
    return Response.json(updatedTask);
  };
  try {
    const channel = { subscribed: true, bind() {}, unbind() {} };
    const client = { subscribe: () => channel, unsubscribe() {}, connection: { state: "connected", bind() {}, unbind() {} } };
    const { useTaskCommentsRealtime } = load("src/hooks/realtime/useTaskCommentsRealtime.ts", {
      react: { useEffect: (effect) => cleanups.push(effect()), useRef: (current) => ({ current }) },
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => true },
      "@/lib/flags/keys": {},
      "@/lib/taskDetailReads": {},
      "@/lib/realtime/client": { connectRealtimeClient: async () => client, releaseRealtimeClientIfIdle() {} },
      "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    });
    useTaskCommentsRealtime(activeTaskId, {
      currentUserId: 7, taskProjectId: PROJECT_ID, taskUniqueIndex: 7049, preserveEditorContent,
      setCurrentTask: (update) => { currentTask = update(currentTask); },
      setDescription: (value) => { description = value; },
    });
    await settle();
    if (unmountBeforeSend) cleanups.splice(0).forEach((cleanup) => cleanup?.());
    const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
      "react-hot-toast": { default: { error() {} } },
      "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
      "@/lib/aiChat/streamRefusal": {},
      "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
      "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
      "./aiChatShared": { parseAiStreamErrorContent: (value) => value },
      "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    });
    assert.equal(await createAiChatSend(context).handleSendMessage(), true);
    await settle();
    return { reads, payloads, currentTask, description, listeners };
  } finally {
    cleanups.forEach((cleanup) => cleanup?.());
    Object.assign(global, { window: original.window, document: original.document, fetch: original.fetch });
    console.log = original.log;
  }
}

for (const enabled of [false, true]) {
  test(`chat hook forwards the ticket-specific UI flag to the send path: ${enabled}`, () => {
    let sendContext;
    const flag = "htpr-7049-reload-after-image-chat";
    const { useAiChat } = load("src/hooks/MultiPages/AIChat/useAiChat.ts", {
      react: { useState: () => [0, () => {}] },
      "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
      "@/lib/flags/keys": { HTPR_7049_RELOAD_AFTER_IMAGE_CHAT_FLAG: flag },
      "./useAiChatState": { useAiChatState: () => ({}) },
      "./useAiChatSessions": { useAiChatSessions: () => ({}) },
      "./useAiChatAttachments": { useAiChatAttachments: () => ({}) },
      "./aiChatSend": { createAiChatSend: (context) => { sendContext = context; return {}; } },
      "./aiChatKeyboard": { createAiChatKeyboard: () => ({}) },
      "./useAiChatPresentation": { useAiChatPresentation: () => ({}) },
    });
    useAiChat();
    assert.equal(sendContext.reloadTaskAfterChat, enabled);
  });
}

for (const attachments of [[], [image]]) {
  const name = attachments.length ? "with an image" : "without an image";
  test(`successful task chat ${name} refreshes task detail without a websocket broadcast`, async () => {
    const result = await runTurn({ attachments, navigateDuringSend: true });
    assert.equal(result.reads.length, 1);
    assert.match(result.reads[0].url, /project=project-15&uniqueIndex=7049/);
    assert.equal(result.reads[0].options.cache, "no-store");
    assert.equal(result.currentTask.title, "After");
    assert.equal(result.description, "AI edited description");
    assert.deepEqual(result.payloads[0].attachments, attachments);
    assert.deepEqual(result.payloads[0].images64, attachments);
    assert.equal(result.payloads[0].default_context.task_id, TASK_ID);
  });
  test(`flag off leaves task chat ${name} on the existing refresh path`, async () => {
    const result = await runTurn({ attachments, enabled: false });
    assert.equal(result.reads.length, 0);
    assert.equal(result.currentTask.title, "Before");
  });
}

test("completion refresh preserves an active description draft", async () => {
  const result = await runTurn({ attachments: [image], preserveEditorContent: true });
  assert.equal(result.reads.length, 1);
  assert.equal(result.currentTask.title, "After");
  assert.equal(result.currentTask.description_.content, "Local content");
  assert.equal(result.description, "Local content");
});

for (const options of [{ activeTaskId: 99 }, { unmountBeforeSend: true }, { status: "error" }]) {
  test(`completion does not refresh an unrelated or closed task or failed turn: ${JSON.stringify(options)}`, async () => {
    const result = await runTurn({ attachments: [image], ...options });
    assert.equal(result.reads.length, 0);
    assert.equal(result.currentTask.title, "Before");
  });
}
