const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7756-chat-opens-task";
const task = { id: 75293, projectId: 15, uniqueIndex: 7755, ticketNumber: "HTPR-7755" };
const user = { id: 985, email: "qa@example.test" };

function lookup({ enabled = true, tasks = [task], sendResult = true, sendError = false } = {}) {
  const events = [], queries = [], flags = [];
  const access = { members: { some: { userId: user.id } } };
  const { createGetTasksTool } = load("src/lib/ai/tools/getTasks.ts", {
    ai: { tool: (definition) => definition },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { flags.push([key, userId]); return enabled; } },
    "@/lib/flags/keys": { HTPR_7756_CHAT_OPENS_TASK_FLAG: flag },
    "@/lib/prisma": { default: { task: { findMany: async (query) => { queries.push(query); return tasks; } } } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (userId) => { assert.equal(userId, user.id); return access; } },
    "@/lib/mcp/tasks/mappers": { taskMcpGetInclude: () => ({}) },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value) => value, mapTaskToMcpGetResponse: (value) => value },
  });
  const tool = createGetTasksTool({
    user, sendStatus() {},
    send(event, data) {
      if (sendError) throw new Error("Disconnected");
      if (sendResult !== false) events.push({ event, data });
      return sendResult;
    },
  }).hypertask_get_tasks;
  return { execute: (input) => tool.execute(tool.inputSchema.parse(input)), tool, events, queries, flags, access };
}

async function consume(events, navigateToTask) {
  const messages = [], navigations = [], statuses = [];
  const { consumeAiChatStream } = load("src/hooks/MultiPages/AIChat/aiChatStream.ts", {
    "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    "@/lib/realtime/shared": {},
    "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
    "./aiChatShared": { parseAiStreamErrorContent: (value) => value },
  });
  const text = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const original = console.log;
  console.log = () => {};
  try {
    await consumeAiChatStream({
      response: new Response(text), session: { id: "session" }, assistantMessageId: "assistant",
      setAgentStatus() {}, updateSessionTitle() {}, setIsTyping: (value) => statuses.push(value),
      queryClient: { refetchQueries: async () => {} },
      addMessageToSessionQuery: (_, message) => messages.push(message),
      navigateToTask: navigateToTask === null ? undefined : (projectId, uniqueIndex) => {
        navigateToTask?.(projectId, uniqueIndex);
        navigations.push([projectId, uniqueIndex]);
      },
    });
  } finally {
    console.log = original;
  }
  return { messages, navigations, statuses };
}

for (const identifiers of [
  { ticket_numbers: ["HTPR-7755"] },
  { project_id: 15, unique_index: 7755 },
  { task_ids: [task.id] },
]) {
  test(`open by known ticket or task from a previous list emits navigation before reporting success: ${JSON.stringify(identifiers)}`, async () => {
    const h = lookup();
    const result = await h.execute({ ...identifiers, open: true });
    assert.equal(result.success, true);
    assert.equal(result.navigation_emitted, true);
    assert.deepEqual(h.events, [{ event: "open_task", data: { projectId: 15, uniqueIndex: 7755 } }]);
    assert.deepEqual(h.queries[0].where.project, h.access);
    assert.deepEqual(h.flags, [[flag, user.id]]);
    const client = await consume([
      ...h.events,
      { event: "content", data: { content: "Opened: HTPR-7755" } },
      { event: "done", data: { status: "complete", assistant_persisted: true } },
    ]);
    assert.deepEqual(client.navigations, [[15, 7755]]);
    assert.equal(client.messages.at(-1).content, "Opened: HTPR-7755");
  });
}

for (const options of [
  { enabled: false }, { tasks: [] }, { tasks: [task, { ...task, id: 99 }] },
  { sendResult: false }, { sendError: true },
]) {
  test(`failed open never reports navigation success: ${JSON.stringify(options)}`, async () => {
    const h = lookup(options);
    const result = await h.execute({ ticket_numbers: ["HTPR-7755"], open: true });
    assert.equal(result.success, false);
    assert.notEqual(result.navigation_emitted, true);
    assert.equal(h.events.length, 0);
    assert.ok(result.error);
  });
}

test("a partially unresolved request cannot open a different task", async () => {
  const h = lookup();
  const result = await h.execute({ task_ids: [task.id, 99], open: true });
  assert.equal(result.success, false);
  assert.equal(h.events.length, 0);
});

for (const enabled of [true, false]) {
  test(`ordinary detail lookup does not navigate or claim to open: flag ${enabled}`, async () => {
    const h = lookup({ enabled });
    const result = await h.execute({ task_ids: [task.id] });
    assert.equal(result.success, true);
    assert.deepEqual(result.tasks, [task]);
    assert.equal(Object.hasOwn(result, "navigation_emitted"), false);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.flags, []);
  });
}

for (const navigate of [null, () => { throw new Error("Router unavailable"); }]) {
  test(`client navigation failure replaces a later success claim: ${navigate === null ? "flag off" : "router failure"}`, async () => {
    const result = await consume([
      { event: "open_task", data: { projectId: 15, uniqueIndex: 7755 } },
      { event: "content", data: { content: "Opened: HTPR-7755" } },
      { event: "done", data: { status: "complete", assistant_persisted: true } },
    ], navigate);
    assert.deepEqual(result.navigations, []);
    assert.match(result.messages.at(-1).content, /could not open the task/);
    assert.doesNotMatch(result.messages.at(-1).content, /Opened/);
    assert.equal(result.statuses.at(-1), false);
  });
}

test("the client rejects malformed navigation without displaying a success claim", async () => {
  const result = await consume([
    { event: "open_task", data: { projectId: 15, uniqueIndex: "7755" } },
    { event: "content", data: { content: "Opened" } },
    { event: "done", data: { status: "complete" } },
  ]);
  assert.deepEqual(result.navigations, []);
  assert.match(result.messages.at(-1).content, /could not open/);
});

for (const enabled of [true, false]) {
  test(`the real chat hook gates the existing task navigator: ${enabled}`, () => {
    let context;
    const navigateToTask = () => {};
    const { useAiChat } = load("src/hooks/MultiPages/AIChat/useAiChat.ts", {
      react: { useState: () => [0, () => {}], useEffect() {} },
      "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigateToTask }) },
      "@/hooks/useFlag": { useFlag: (key) => key === flag && enabled },
      "@/lib/flags/keys": { HTPR_7756_CHAT_OPENS_TASK_FLAG: flag },
      "@/lib/state": { useRecoilState: () => [null, () => {}] },
      "@/store": {},
      "./useAiChatState": { useAiChatState: () => ({}) },
      "./useAiChatSessions": { useAiChatSessions: () => ({}) },
      "./useAiChatAttachments": { useAiChatAttachments: () => ({}) },
      "./aiChatSend": { createAiChatSend: (value) => { context = value; return {}; } },
      "./aiChatKeyboard": { createAiChatKeyboard: () => ({}) },
      "./useAiChatPresentation": { useAiChatPresentation: () => ({}) },
    });
    useAiChat();
    assert.equal(context.navigateToTask, enabled ? navigateToTask : undefined);
  });
}

test("the bugfix flag is registered for Everyone with release metadata", () => {
  const { FEATURE_FLAG_DEFINITIONS } = load("src/lib/flags/definitions.ts", {});
  const definition = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-24");
  assert.equal(definition.releaseRisk.risk, "small");
});

for (const enabled of [true, false]) {
  test(`the model receives the navigation-before-claim rule only with the server flag: ${enabled}`, async () => {
    let instructions;
    const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", {
      "@/lib/prisma": {},
      "@/lib/flags": { isFeatureEnabled: async (key) => key === flag && enabled },
      "@/lib/flags/keys": { HTPR_7756_CHAT_OPENS_TASK_FLAG: flag },
      "@/lib/ai/prompts/registry": {},
      "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "" },
      "@/app/api/ai/chat/stream/streamLease": {},
      "@/app/api/ai/_lib/heartbeatExecution": {},
      "@/app/api/ai/chat/stream/persistAssistantMessage": {},
      "@/utils/controllers/comments/linkifyTicketRefs": {},
      "@/app/api/ai/_lib/chatSkillResolution": {},
      "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "Existing instructions" },
      "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
      "@/lib/ai/chatStream/content": { createUserContent: () => "Open the task" },
      "@/lib/ai/tools/metadata": {},
      "@/lib/ai/chatStream/title": {},
      "@/lib/ai/tools": { buildTools: () => ({}) },
      "./modelReply": { generateModelReply: async (_, inputs) => { instructions = inputs.instructions; return null; } },
      "./chatNames": { nameChatFromFirstMessage: async () => null },
    });
    await runModelTurn({ body: {}, dbUser: user, selected: { model: "fixture" }, providerAbort: new AbortController() }, {}, {});
    if (enabled) {
      assert.match(instructions, /call hypertask_get_tasks with open=true/);
      assert.match(instructions, /before the tool returns navigation_emitted=true/);
      assert.match(instructions, /say you could not open the task/);
    } else {
      assert.equal(instructions, "Existing instructions");
    }
  });
}

for (const mode of ["connected", "disconnected", "enqueue failure"]) {
  test(`the real stream acknowledges navigation only after enqueue: ${mode}`, async () => {
    const frames = [];
    let emitted;
    const { runChatStream } = load("src/lib/ai/chatStream/runStream.ts", {
      "@/lib/prisma": {},
      "@/app/api/ai/chat/stream/streamLease": { createTurnDeadline: () => ({ clear() {} }), releaseAiChatStreamLease: async () => {} },
      "@/app/api/ai/_lib/heartbeatExecution": {},
      "@/app/api/ai/chat/stream/persistAssistantMessage": {},
      "@/utils/controllers/comments/linkifyTicketRefs": {},
      "@/lib/telemetry/aiChatObservability": {},
      "@vercel/functions": {},
      "@/lib/ai/chatAlerts/service": {},
      "@/app/api/ai/_lib/chatSkillResolution": { resolveSkillsForAiRequest: async () => ({}) },
      "@/lib/ai/chatStream/errors": { sseFrame: (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` },
      "./fleetTurn": { routeAgentMention: async () => false },
      "./modelTurn": { runModelTurn: async (state) => { emitted = state.send("open_task", { projectId: 15, uniqueIndex: 7755 }); } },
    });
    await runChatStream({
      enqueue(frame) {
        if (mode === "enqueue failure") throw new Error("Disconnected");
        frames.push(new TextDecoder().decode(frame));
      },
    }, {
      body: {}, dbUser: user, requestMessage: "Open the task", streamLease: {},
      selected: { resolvedModelId: "fixture", usageProvider: "fixture" },
      encoder: new TextEncoder(), clientConnected: mode !== "disconnected",
      turnStartedAtMs: Date.now(), maxDuration: 300,
    });
    assert.equal(emitted, mode === "connected");
    assert.deepEqual(frames, mode === "connected" ? ['event: open_task\ndata: {"projectId":15,"uniqueIndex":7755}\n\n'] : []);
  });
}
