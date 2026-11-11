const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { z } = require("zod");
const { asSchema, generateText, tool } = require("ai");
const { createOpenAI } = require("@ai-sdk/openai");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const { compactChatToolSchemas } = load(path.join(root, "src/lib/ai/tools/compactSchemas.ts"));
const { LEAN_AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT, CHAT_REQUEST_WRITING_STYLE } = load(path.join(root, "src/lib/ai/chatStream/prompt.ts"));

test("lean routing uses registered names and retains write safeguards", async () => {
  const { chatToolSchemas } = await import("../scripts/chat-prefix-budget.mjs");
  const names = new Set(Object.keys(chatToolSchemas()));
  for (const name of LEAN_AGENT_SYSTEM_PROMPT.match(/\b(?:hypertask_\w+|rag_retrieval|search_help_docs)\b/g)) {
    assert.ok(names.has(name), `Unregistered tool ${name}`);
  }
  assert.doesNotMatch(LEAN_AGENT_SYSTEM_PROMPT, /RAGRetrievalTool|### 1\.|### 3\.|FINAL REMINDER|Valid filter keys/);
  for (const rule of [/REPLACES the task's/, /add_labels \/ remove_labels/, /confirmation_required/, /yes in a NEW/, /never infer identifiers/, /has_due_date: true/, /Only pass the filters/]) {
    assert.match(LEAN_AGENT_SYSTEM_PROMPT, rule);
  }
  assert.match(CHAT_REQUEST_WRITING_STYLE, /user_context person's own next message/);
  assert.match(CHAT_REQUEST_WRITING_STYLE, /outranks "End with one next action"/);
  assert.match(CHAT_REQUEST_WRITING_STYLE, /what the task is/);
});

test("wire schemas drop redundant metadata, but keep real UUID validation and execution", async () => {
  const calls = [];
  const original = { uuid_probe: tool({ description: "Probe", inputSchema: z.object({ id: z.string().uuid() }), execute: async (input) => { calls.push(input); return input; } }) };
  const compact = compactChatToolSchemas(original);
  const before = asSchema(original.uuid_probe.inputSchema);
  const after = asSchema(compact.uuid_probe.inputSchema);
  assert.ok(before.jsonSchema.$schema);
  assert.ok(before.jsonSchema.properties.id.pattern);
  assert.equal(after.jsonSchema.$schema, undefined);
  assert.equal(after.jsonSchema.properties.id.pattern, undefined);
  assert.equal(after.jsonSchema.properties.id.format, "uuid");
  assert.equal((await after.validate({ id: "not-a-uuid" })).success, false);
  const valid = { id: "00000000-0000-4000-8000-000000000001" };
  assert.equal((await after.validate(valid)).success, true);
  await compact.uuid_probe.execute(valid);
  assert.deepEqual(calls, [valid]);
  assert.ok(before.jsonSchema.$schema, "Compaction must not mutate the original tool");
  const sent = [];
  const provider = createOpenAI({ apiKey: "isolated-test", fetch: async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return Response.json({ id: "probe", object: "chat.completion", created: 0, model: "gpt-4o-mini", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  } });
  for (const tools of [original, compact]) {
    await generateText({ model: provider.chat("gpt-4o-mini"), prompt: "Probe", tools, maxRetries: 0 });
  }
  assert.ok(sent[0].tools[0].function.parameters.$schema, "Provider currently forwards $schema");
  assert.equal(sent[1].tools[0].function.parameters.$schema, undefined);
  assert.equal(sent[1].tools[0].function.parameters.properties.id.pattern, undefined);
});

test("complete runtime catalog has a smaller prefix and growth breaches its budget", async () => {
  const { chatToolSchemas, measurePrefix, assertBudget } = await import("../scripts/chat-prefix-budget.mjs");
  const tools = chatToolSchemas();
  const before = measurePrefix(AGENT_SYSTEM_PROMPT, tools);
  const after = measurePrefix(`${LEAN_AGENT_SYSTEM_PROMPT}\n\n${CHAT_REQUEST_WRITING_STYLE}`, compactChatToolSchemas(tools));
  console.log("HTPR-7861 prefix", JSON.stringify({ before, after, tokenizer: "cl100k_base proxy" }));
  assert.ok(after.toolCount >= 84, "Measure the complete catalog, not only the golden ten");
  assert.ok(after.totalTokens < before.totalTokens);
  assertBudget(after, 22462);
  assert.throws(() => assertBudget({ ...after, totalTokens: after.totalTokens + 1 }, after.totalTokens), /exceeds budget/);
  assertBudget(after, after.totalTokens);
});
