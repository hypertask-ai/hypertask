const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const flag = load("src/lib/flags/definitions/htpr-7760-chat-surface.ts", {});
const { chatRequestSchema } = load("src/lib/ai/chatStream/request.ts", {
  "@/models/Views/model": { SORTING_MODES: ["Manual", "Priority"] },
});
const prompt = load("src/lib/ai/chatStream/prompt.ts", {
  "@/lib/ai/prompts/registry": { renderPrompt: () => "Base system prompt" },
  "@/app/api/ai/_lib/editorAiPrompts": { HOUSE_OUTPUT_STYLE: "" },
});
const screen = {
  project_id: 15, task_id: 75320, surface: "task_detail",
  surface_path: "/detail/project-15/7760", view_id: "bugs", view_name: "Bugs",
};

async function send({ fullscreen = false, userAgent = "Browser", screenContext = screen } = {}) {
  let payload;
  const fetchDescriptor = Object.getOwnPropertyDescriptor(global, "fetch");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, "navigator");
  Object.defineProperty(global, "navigator", { configurable: true, value: { userAgent } });
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response("event: done\ndata: {}\n\n");
  };
  const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
    "@/lib/agents/chatViewerState": { sidebarChatHeaders: () => ({}) },
    "./aiChatStream": { consumeAiChatStream: async () => {} },
    "react-hot-toast": { default: { error(message) { throw new Error(message); } } },
    "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
    "@/lib/aiChat/streamRefusal": {},
    "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
    "@/lib/aiChat/transportRetry": {},
    "@/lib/aiModelOptions": { chatModelRequestFields: () => ({}) },
  });
  const ref = () => ({ current: null });
  try {
    const context = {
      editor: { getText: () => "Which chat are you? Which ticket am I on?", getHTML: () => "<p>Which chat?</p>", commands: { clearContent() {} } },
      fileUpload: { fileItems: [], clearFiles() {} }, messageQueueRef: { current: [] },
      sendInFlightRef: { current: false }, surface: screenContext.surface,
      inViewObject: screenContext.task_id ? { taskId: screenContext.task_id } : null,
      waitForChatSession: async () => ({ id: "6279a850-6b3e-4fb5-8fa8-404c9a156620", messages: [] }),
      processAttachments: async () => [], currentProject: { id: 15, project_view: { user_project_views: [{ appliedView: { id: "bugs", title: "Bugs" } }] } },
      scopedProjectId: 15, isFullScreenChat: fullscreen, taskId: screenContext.task_id,
      currentUser: { id: 985 }, pathname: screenContext.surface_path,
      streamingSessionRef: ref(), streamingAssistantMessageRef: ref(), streamingRequestRef: ref(),
      handleSendMessageRef: ref(), chatRoute: "/api/ai/chat/stream",
      setIsTyping() {}, addMessageToSessionQuery() {}, setAiChatBoardSessionMap() {},
      setCurrentStreamingSession() {}, setAgentStatus() {}, drainQueuedMessage() {},
    };
    assert.equal(await createAiChatSend(context).handleSendMessage(), true);
    assert.ok(payload, "The real send path must send a request");
    return chatRequestSchema.parse(payload);
  } finally {
    Object.defineProperty(global, "fetch", fetchDescriptor);
    if (navigatorDescriptor) Object.defineProperty(global, "navigator", navigatorDescriptor);
    else delete global.navigator;
  }
}

async function modelInput(body, enabled = true) {
  let input;
  const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", {
    "@/lib/ai/prompts/registry": {},
    "@/lib/flags/keys": flag,
    "@/lib/prisma": {},
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      assert.equal(userId, 985);
      return key === flag.HTPR_7760_CHAT_SURFACE_FLAG && enabled;
    } },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "Title: Sidebar chat identity\nTicket: HTPR-7760" },
    "@/app/api/ai/chat/stream/streamLease": {},
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": {},
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/lib/ai/chatStream/prompt": prompt,
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
    "@/lib/ai/tools/metadata": {},
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: () => ({}) },
    "./modelReply": { generateModelReply: async (_state, options) => { input = options; return null; } },
    "./chatNames": { nameChatFromFirstMessage: async () => null },
  });
  await runModelTurn({
    body, dbUser: { id: 985, email: "qa@example.invalid", displayName: "QA" },
    selected: { model: {} }, contextTaskId: 75320, providerAbort: new AbortController(),
  }, body, {});
  assert.ok(input, "The real model turn must reach the provider boundary");
  return input;
}

test("sidebar request keeps chat identity separate from the current screen and ticket through to the model", async () => {
  const body = await send();
  assert.equal(body.surface, "sidebar");
  assert.deepEqual(body.default_context, screen);
  const input = await modelInput(body);
  assert.match(input.instructions, /You are the built-in AI chat in the Hypertask sidebar\./);
  assert.match(input.instructions, /do not claim you opened or navigated/);
  assert.match(input.messages[0].content, /Title: Sidebar chat identity/);
  assert.match(input.messages[0].content, /Ticket: HTPR-7760/);
  assert.match(input.messages[0].content, /"surface": "task_detail"/);
  assert.match(input.messages[0].content, /"view_name": "Bugs"/);
});

test("full-screen and desktop clients do not identify as the sidebar", async () => {
  for (const [options, surface, identity] of [
    [{ fullscreen: true, screenContext: { surface: "chat", surface_path: "/chat" } }, "fullscreen", "the built-in AI chat on Hypertask's full-screen chat page"],
    [{ userAgent: "Mozilla/5.0 HypertaskApp/1.0" }, "desktop", "the built-in AI chat in the Hypertask desktop app"],
  ]) {
    const body = await send(options);
    assert.equal(body.surface, surface);
    const input = await modelInput(body);
    assert.ok(input.instructions.includes(`You are ${identity}.`));
    assert.doesNotMatch(input.instructions, /You are the built-in AI chat in the Hypertask sidebar\./);
  }
});

test("explicit MCP and CLI callers retain their own identity at the native chat boundary", async () => {
  for (const [surface, identity] of [["mcp", "a connected MCP client"], ["cli", "the Hypertask CLI"]]) {
    const body = chatRequestSchema.parse({ message: "Which chat are you?", surface });
    const input = await modelInput(body);
    assert.ok(input.instructions.includes(`an AI assistant accessed through ${identity}`));
  }
});

test("flag Off and older requests preserve the original system instructions without guessing a client", async () => {
  const body = await send();
  assert.equal((await modelInput(body, false)).instructions, "Base system prompt");
  const legacy = chatRequestSchema.parse({ message: "Which chat are you?", default_context: screen });
  assert.equal((await modelInput(legacy)).instructions, "Base system prompt");
  assert.throws(() => chatRequestSchema.parse({ message: "Which chat?", surface: "invented-client" }));
});

test("the ticket bugfix defaults to Everyone with a bounded release risk", () => {
  assert.equal(flag.default.key, "htpr-7760-chat-surface");
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.match(flag.default.releaseRisk.reason, /tools and permissions are unchanged/);
});
