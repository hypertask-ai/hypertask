const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const link = '<p><a href="https://app.hypertask.ai/detail/project-7049/1">QA-1</a></p>';

async function consume(events) {
  const messages = [], changes = [], navigations = [];
  const { consumeAiChatStream } = load("src/hooks/MultiPages/AIChat/aiChatStream.ts", {
    "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    "@/lib/realtime/shared": { TASK_EVENT: "task:changed" },
    "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
    "./aiChatShared": { parseAiStreamErrorContent: (value) => value },
  });
  const originalWindow = global.window, originalCustomEvent = global.CustomEvent, originalLog = console.log;
  global.window = { dispatchEvent: (event) => changes.push({ type: event.type, detail: event.detail }) };
  global.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
  console.log = () => {};
  try {
    await consumeAiChatStream({
      response: new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("")),
      session: { id: "session" }, assistantMessageId: "assistant",
      setAgentStatus() {}, updateSessionTitle() {}, setIsTyping() {},
      queryClient: { refetchQueries: async () => {} },
      addMessageToSessionQuery: (_, message) => messages.push(message),
      navigateToTask: (...args) => navigations.push(args),
    });
  } finally {
    global.window = originalWindow;
    global.CustomEvent = originalCustomEvent;
    console.log = originalLog;
  }
  return { messages, changes, navigations };
}

test("the early link is visible before completion, persists in the reply, and never auto-opens", async () => {
  const result = await consume([
    ["task_created", { content: link }], ["task_updated", { taskId: 123 }],
    ["content", { content: "Finished." }], ["done", { status: "complete", assistant_persisted: true }],
  ]);
  assert.equal(result.messages[0].content, link);
  assert.equal(result.messages[0].isDelivered, false);
  assert.equal(result.messages.at(-1).content, link + "Finished.");
  assert.equal(result.messages.at(-1).isDelivered, true);
  assert.deepEqual(result.changes, [{ type: "task:changed", detail: { taskId: 123 } }]);
  assert.deepEqual(result.navigations, []);
});

for (const terminal of [["error", { content: "Writer failed" }], ["done", { status: "error", content: "Writer failed" }]]) {
  test(`saved links survive ${terminal[0]} responses`, async () => {
    const result = await consume([["task_created", { content: link }], terminal, ["done", { status: "error" }]]);
    assert.equal(result.messages.at(-1).content, link + "Writer failed");
    assert.deepEqual(result.navigations, []);
  });
}

test("ordinary replies remain unchanged and malformed refresh events cannot touch tasks", async () => {
  const result = await consume([
    ["task_updated", { taskId: "123" }], ["task_updated", { taskId: -1 }],
    ["content", { content: "Hello" }], ["done", { status: "complete" }],
  ]);
  assert.equal(result.messages.at(-1).content, "Hello");
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.navigations, []);
});
