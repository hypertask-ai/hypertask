const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const link = '<p><a href="https://app.hypertask.ai/detail/project-7049/1">QA-1</a></p>';

function turn(mode) {
  const persisted = [], finished = [];
  let toolSend;
  const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "" },
    "@/app/api/ai/chat/stream/streamLease": {
      acquireAiChatCompletionFence: async () => "fence", keepAiChatCompletionFenceAlive: () => async () => {},
      finishAiChatCompletionFence: async () => {}, releaseAiChatCompletionFence: async () => {},
    },
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": { persistAssistantMessage: async (input) => { persisted.push(input.content); return true; } },
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "chat prompt" },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
    "@/lib/ai/chatStream/content": { createUserContent: () => "request" },
    "@/lib/ai/tools/metadata": { writeToolNames: new Set() },
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: (_user, _body, send) => { toolSend = send; return {}; } },
    "./modelReply": { generateModelReply: async (_state, input) => {
      input.onContent("<p>Before.</p>");
      toolSend("task_created", { content: link });
      if (mode === "throw") throw new Error("Provider failed");
      if (mode === "failed") return;
      input.onContent("<p>After.</p>");
      return { chunks: ["<p>Before.</p>", "<p>After.</p>"] };
    } },
    "./chatNames": { nameChatFromFirstMessage: async () => null },
  });
  return { persisted, finished, run: () => runModelTurn({
    body: { session_id: "session", assistant_message_id: "assistant" }, dbUser: { id: 985 },
    streamId: "stream", streamLease: { redis: {} }, selected: { model: "test-model" },
    providerAbort: new AbortController(), send: () => false,
    finish: (...args) => finished.push(args),
  }, {}, {}) };
}

test("stored reply keeps the same explanation/link order after reload", async () => {
  const h = turn("complete");
  await h.run();
  assert.deepEqual(h.persisted, ["<p>Before.</p>" + link + "<p>After.</p>"]);
  assert.equal(h.finished[0][0], "complete");
});

for (const mode of ["failed", "throw"]) {
  test(`saved links persist without a connected client after provider ${mode}`, async () => {
    const h = turn(mode);
    if (mode === "throw") await assert.rejects(h.run(), /Provider failed/);
    else await h.run();
    assert.deepEqual(h.persisted, ["<p>Before.</p>" + link + "<p>Reply stopped. Your saved ticket remains.</p>"]);
    assert.deepEqual(h.finished, []);
  });
}
