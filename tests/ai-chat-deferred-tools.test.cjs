const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const ai = require("ai");
const { z } = require("zod");
const { MockLanguageModelV4, simulateReadableStream } = require("ai/test");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const discovery = load(path.join(root, "src/lib/ai/tools/deferredTools.ts"));
const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7862-chat-deferred-tools.ts"));
let enabled = true;
let heartbeatStepCapEnabled = true;
const dependencies = {
  "@/lib/ai/teamAiFunding": require("./helpers/team-ai-funding-stub.cjs"),
  ai,
  "@/lib/net/downloadWithoutBrotli": {},
  "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false, backgroundClaudeModelEnabled: async () => false },
  "@/app/api/ai/_lib/byokKeys": {},
  "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} },
  "@/lib/aiModelOptions": { resolveHaikuModelId: (id) => id },
  "@/lib/aiProviders": {},
  "@/app/api/ai/_lib/heartbeatExecution": {},
  "@/app/api/ai/chat/stream/modelFallback": {},
  "@/app/api/ai/chat/stream/bulkTools": load(path.join(root, "src/app/api/ai/chat/stream/bulkTools.ts")),
  "@/lib/ai/chatStream/errors": { reportEmptyCompletion: async () => {} },
  "@/lib/ai/tools/constants": load(path.join(root, "src/lib/ai/tools/constants.ts")),
  "@/lib/ai/tools/deferredTools": discovery,
  "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
    assert.equal(userId, 985);
    if (key === "htpr-7857-heartbeat-step-cap") return heartbeatStepCapEnabled;
    assert.equal(key, "htpr-7862-chat-deferred-tools");
    return enabled;
  } },
  "@/lib/flags/keys": { ...definition, HTPR_7857_HEARTBEAT_STEP_CAP_FLAG: "htpr-7857-heartbeat-step-cap" },
  "@/lib/ai/chatStream/models": {},
  "@/lib/ai/chatStream/content": { withHigherEffort: (options) => options },
  "@/lib/ai/tools/metadata": { writeToolNames: new Set() },
};
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/ai/chatStream/modelReply.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const replyModule = { exports: {} };
new Function("module", "exports", "require", compiled)(replyModule, replyModule.exports, (id) => {
  assert.ok(Object.hasOwn(dependencies, id), `Unexpected import ${id}`);
  return dependencies[id];
});
const { generateModelReply } = replyModule.exports;
const usage = { inputTokens: { total: 100 }, outputTokens: { total: 10 } };
const fixture = () => {
  const executions = [];
  const tools = Object.fromEntries(discovery.CORE_CHAT_TOOL_NAMES.map((name) => [name, ai.tool({
    description: `Execute ${name}`,
    inputSchema: z.object({}).strict(),
    execute: async () => ({ success: true }),
  })]));
  tools.hypertask_list_views = ai.tool({
    description: "List saved board views.",
    inputSchema: z.object({ project_id: z.number().int().positive() }).strict(),
    execute: async (input) => {
      executions.push(input);
      return input.project_id === 15
        ? { success: true, views: [{ id: "view-15", title: "Bugs" }] }
        : { success: false, error: "User does not have access to project this view belongs to" };
    },
  });
  return { tools, executions };
};
const toolCall = (name, input) => ({ type: "tool-call", toolCallId: name, toolName: name, input: JSON.stringify(input) });
const streamResult = (content) => ({ stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
  { type: "stream-start", warnings: [] },
  ...content,
  { type: "finish", finishReason: { unified: content.some((chunk) => chunk.type === "tool-call") ? "tool-calls" : "stop" }, usage },
] }) });
const text = [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: "You cannot access that board." },
  { type: "text-end", id: "text" },
];
const stateFor = (model) => ({
  dbUser: { id: 985 }, gatewayTags: {}, selected: { model, resolvedModelId: "fixture" },
  providerAbort: new AbortController(), send() {}, recordTurnOutcome(outcome) { assert.equal(outcome, "ok"); },
});

test("stream dispatch exposes 23 common tools and discovers a deferred tool without bypassing its refusal", async () => {
  enabled = true;
  const { tools, executions } = fixture();
  const model = new MockLanguageModelV4({ doStream: [
    streamResult([toolCall("hypertask_search_tools", { query: "views" })]),
    streamResult([toolCall("hypertask_describe_tool", { name: "hypertask_list_views" })]),
    streamResult([toolCall("hypertask_list_views", { project_id: 99 })]),
    streamResult(text),
  ] });
  const reply = await generateModelReply(stateFor(model), { instructions: "Find saved views.", messages: [{ role: "user", content: "Find board 99 views." }], tools, toolExecutions: [] });
  assert.deepEqual(reply.chunks, ["You cannot access that board."]);
  assert.equal(model.doStreamCalls.length, 4);
  const first = model.doStreamCalls[0].tools.map((tool) => tool.name);
  assert.equal(first.length, 25);
  assert.ok(first.includes("hypertask_create_task"));
  assert.ok(first.includes("hypertask_add_comment"));
  assert.ok(first.includes("hypertask_inbox_archive"));
  assert.ok(first.includes("hypertask_search_tools"));
  assert.ok(!first.includes("hypertask_list_views"));
  assert.ok(!model.doStreamCalls[1].tools.some((tool) => tool.name === "hypertask_list_views"));
  const described = model.doStreamCalls[2].tools.find((tool) => tool.name === "hypertask_list_views");
  assert.deepEqual(described.inputSchema.required, ["project_id"]);
  assert.equal(described.inputSchema.additionalProperties, false);
  assert.deepEqual(executions, [{ project_id: 99 }]);
  assert.ok(model.doStreamCalls[3].prompt.some((message) => message.role === "tool" && JSON.stringify(message.content).includes("does not have access")));
  assert.ok(!Object.hasOwn(tools, "hypertask_search_tools"));
});

test("a discovered tool still executes an allowed request", async () => {
  enabled = true;
  const { tools, executions } = fixture();
  const model = new MockLanguageModelV4({ doStream: [
    streamResult([toolCall("hypertask_describe_tool", { name: "hypertask_list_views" })]),
    streamResult([toolCall("hypertask_list_views", { project_id: 15 })]),
    streamResult(text),
  ] });
  await generateModelReply(stateFor(model), { instructions: "Fixture", messages: [{ role: "user", content: "Fixture" }], tools, toolExecutions: [] });
  assert.deepEqual(executions, [{ project_id: 15 }]);
  assert.ok(model.doStreamCalls[2].prompt.some((message) => message.role === "tool" && JSON.stringify(message.content).includes("view-15")));
});

test("flag off sends the original full catalog without discovery", async () => {
  enabled = false;
  const { tools } = fixture();
  const model = new MockLanguageModelV4({ doStream: streamResult(text) });
  await generateModelReply(stateFor(model), { instructions: "Fixture", messages: [{ role: "user", content: "Fixture" }], tools, toolExecutions: [] });
  assert.deepEqual(model.doStreamCalls[0].tools.map((tool) => tool.name), Object.keys(tools));
});

test("empty-stream retry uses the same discovery path through generateText", async () => {
  enabled = true;
  const { tools, executions } = fixture();
  const model = new MockLanguageModelV4({
    doStream: streamResult([]),
    doGenerate: [
      { content: [toolCall("hypertask_describe_tool", { name: "hypertask_list_views" })], usage, finishReason: { unified: "tool-calls" }, warnings: [] },
      { content: [toolCall("hypertask_list_views", { project_id: 99 })], usage, finishReason: { unified: "tool-calls" }, warnings: [] },
      { content: [{ type: "text", text: "Board refused." }], usage, finishReason: { unified: "stop" }, warnings: [] },
    ],
  });
  const reply = await generateModelReply(stateFor(model), { instructions: "Fixture", messages: [{ role: "user", content: "Fixture" }], tools, toolExecutions: [] });
  assert.deepEqual(reply.chunks, ["Board refused."]);
  assert.ok(!model.doGenerateCalls[0].tools.some((tool) => tool.name === "hypertask_list_views"));
  assert.ok(model.doGenerateCalls[1].tools.some((tool) => tool.name === "hypertask_list_views"));
  assert.deepEqual(executions, [{ project_id: 99 }]);
});

test("catalog search, unknown names and per-turn isolation keep the stable prefix unchanged", async () => {
  const { tools } = fixture();
  const first = discovery.deferredChatTools(tools);
  const second = discovery.deferredChatTools(tools);
  const baseline = second.prepareStep();
  const result = await first.tools.hypertask_search_tools.execute({ query: "views" });
  assert.deepEqual(result.tools, [{ name: "hypertask_list_views", description: "Returns saved views." }]);
  const descriptor = await first.tools.hypertask_describe_tool.execute({ name: "hypertask_list_views" });
  assert.equal(descriptor.name, "hypertask_list_views");
  assert.ok(first.prepareStep().activeTools.includes("hypertask_list_views"));
  assert.deepEqual(second.prepareStep(), baseline);
  assert.deepEqual(await first.tools.hypertask_describe_tool.execute({ name: "toString" }), { error: "Unknown tool: toString" });
  assert.deepEqual(await first.tools.hypertask_describe_tool.execute({ name: "not_a_tool" }), { error: "Unknown tool: not_a_tool" });
  assert.equal(first.tools.hypertask_list_views, tools.hypertask_list_views);
  assert.deepEqual(discovery.deferredChatTools(tools).prepareStep(), baseline);
});

test("catalog resolves SDK description functions before searching or describing", async () => {
  const { tools } = fixture();
  tools.fixture_export = ai.tool({
    description: ({ context }) => context === undefined ? "Export a fixture." : "Other context.",
    inputSchema: z.object({}).strict(),
    execute: async () => ({ success: true }),
  });
  const catalog = discovery.deferredChatTools(tools);
  assert.deepEqual(await catalog.tools.hypertask_search_tools.execute({ query: "Export a fixture" }), {
    tools: [{ name: "fixture_export", description: "Export a fixture." }],
  });
  const described = await catalog.tools.hypertask_describe_tool.execute({ name: "fixture_export" });
  assert.equal(described.description, "Export a fixture.");
});

for (const [name, heartbeat, capped, expectedSteps] of [
  ["heartbeat", true, true, 4],
  ["ordinary agent chat", false, true, 32],
  ["heartbeat with cap off", true, false, 32],
]) {
  test(`${name} stops at ${expectedSteps} completed steps`, async () => {
    enabled = false;
    heartbeatStepCapEnabled = capped;
    let executed = 0;
    const tools = { fixture_read: ai.tool({
      inputSchema: z.object({}).strict(),
      execute: async () => { executed++; return { success: true }; },
    }) };
    const model = new MockLanguageModelV4({ doStream: () => streamResult([
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "Reading." },
      { type: "text-end", id: "text" },
      toolCall("fixture_read", {}),
    ]) });
    const state = { ...stateFor(model), actingAgent: { id: "fixture-agent" },
      heartbeatExecutionId: heartbeat ? "fixture-heartbeat" : undefined };
    const reply = await generateModelReply(state, {
      instructions: "Read until stopped.", messages: [{ role: "user", content: "Read." }],
      tools, toolExecutions: [],
    });
    assert.equal(model.doStreamCalls.length, expectedSteps);
    assert.equal(executed, expectedSteps);
    assert.equal(reply.chunks.join(""), "Reading.".repeat(expectedSteps));
    assert.equal(model.doGenerateCalls.length, 0);
  });
}

test("heartbeat empty-stream retry uses only its three remaining steps", async () => {
  enabled = false;
  heartbeatStepCapEnabled = true;
  let executed = 0;
  const tools = { fixture_read: ai.tool({
    inputSchema: z.object({}).strict(),
    execute: async () => { executed++; return { success: true }; },
  }) };
  const model = new MockLanguageModelV4({
    doStream: streamResult([]),
    doGenerate: () => ({ content: [toolCall("fixture_read", {})], usage,
      finishReason: { unified: "tool-calls" }, warnings: [] }),
  });
  const state = { ...stateFor(model), heartbeatExecutionId: "fixture-heartbeat",
    recordTurnOutcome(outcome) { assert.equal(outcome, "failed"); } };
  const reply = await generateModelReply(state, {
    instructions: "Read until stopped.", messages: [{ role: "user", content: "Read." }],
    tools, toolExecutions: [],
  });
  assert.equal(model.doStreamCalls.length, 1);
  assert.equal(model.doGenerateCalls.length, 3);
  assert.equal(executed, 3);
  assert.match(reply.chunks.join(""), /4/);
});
