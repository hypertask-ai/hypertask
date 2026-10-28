const test = require("node:test");
const assert = require("node:assert/strict");
const { createAnthropic } = require("@ai-sdk/anthropic");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-7855-direct-prompt-cache";
const fixed = "Stable chat instructions. ".repeat(700);

function harness({ enabled = true, flagError = false } = {}) {
  const requests = [], checks = [];
  const api = load("src/app/api/ai/_lib/modelProvider.ts", {
    "@/lib/net/fetchWithoutBrotli": {},
    "@vercel/functions": { waitUntil: () => {} },
    "./aiUsage": { logAiUsage: async () => {} },
    "@/lib/ai/prompts/registry": { identifyPrompt: () => ({}) },
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => {} },
    "@/lib/errors/reportError": {},
    "@ai-sdk/anthropic": {
      createAnthropic: (options) => createAnthropic({
        ...options,
        fetch: async (_url, init) => {
          requests.push(JSON.parse(init.body));
          return Response.json({
            id: "fixture-message", type: "message", role: "assistant", model: "claude-sonnet-5-5",
            content: [{ type: "text", text: "Fixture reply" }], stop_reason: "end_turn", stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
        },
      }),
    },
    "@/app/api/ai/_lib/sharedAllowance": {
      gatewayCatalogModelSlug: (id) => id,
      createSharedAllowanceMiddleware: () => ({ specificationVersion: "v4" }),
    },
    "@/lib/aiModelOptions": { isHaiku45Model: () => false, isHaiku55Model: () => false },
    "@/lib/aiProviders": { getAiProviderInfo: () => ({}) },
    "@/lib/aiAllowancePolicy": {},
    "@/lib/aiUsageClassification": { isSystemAiFeature: () => false },
    "@/lib/ai/customEndpoint": { isCustomEndpointConfig: () => false },
    "@/lib/flags/definitions/htpr-7855-direct-prompt-cache": { HTPR_7855_DIRECT_PROMPT_CACHE_FLAG: FLAG },
    "@/lib/flags/definitions/htpr-7689-prompt-caching": { HTPR_7689_PROMPT_CACHING_FLAG: "htpr-7689-prompt-caching" },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      if (flagError) throw new Error("Flag service unavailable");
      return enabled;
    } },
  });
  const model = api.resolveAiModel("claude", "claude-sonnet-5-5", "fixture-key-not-real");
  api.configureAiModelUsage(model, { initiatingUserId: 985, feature: "chat" });
  return { api, model, requests, checks };
}

function params(suffix = "User 985; clock 2026-10-27; ticket A") {
  return {
    prompt: [
      { role: "system", content: fixed, providerOptions: { anthropic: { custom: "keep" } } },
      { role: "user", content: [{ type: "text", text: suffix }] },
    ],
    tools: [{ type: "function", name: "read_ticket", description: "Read a ticket", inputSchema: { type: "object", properties: {} } }],
    maxOutputTokens: 16,
  };
}

test("direct chat sends a real SDK system cache breakpoint, with live context after it", async () => {
  const h = harness();
  assert.equal(await h.api.aiPromptCachingEnabled(h.model), true);
  const first = params(), before = structuredClone(first);
  await h.model.doGenerate(first);
  await h.model.doGenerate(params("User 986; clock 2026-10-28; ticket B"));
  assert.deepEqual(first, before);
  assert.equal(h.requests.length, 2);
  for (const request of h.requests) {
    assert.equal(request.system.length, 1);
    assert.equal(request.system[0].text, fixed);
    assert.deepEqual(request.system[0].cache_control, { type: "ephemeral" });
    assert.equal(request.tools[0].name, "read_ticket");
    assert.equal(request.tools[0].cache_control, undefined);
    assert.equal(request.messages[0].content[0].cache_control, undefined);
  }
  assert.deepEqual(h.requests[0].system, h.requests[1].system);
  assert.deepEqual(h.requests[0].tools, h.requests[1].tools);
  assert.notDeepEqual(h.requests[0].messages, h.requests[1].messages);
  assert.deepEqual(h.checks, [[FLAG, 985]]);
});

test("off, flag errors, untrusted callers and non-chat calls keep direct requests unchanged", async () => {
  for (const [settings, context] of [
    [{ enabled: false }, {}], [{ flagError: true }, {}],
    [{}, { initiatingUserId: null }], [{}, { feature: "task-writer" }],
  ]) {
    const h = harness(settings);
    if (context.initiatingUserId === null) {
      const model = h.api.resolveAiModel("claude", "claude-sonnet-5-5", "fixture-key-not-real");
      h.api.configureAiModelUsage(model, { feature: "chat" });
      h.model = model;
    } else {
      h.api.configureAiModelUsage(h.model, context);
    }
    assert.equal(await h.api.aiPromptCachingEnabled(h.model), false);
    await h.model.doGenerate(params());
    assert.equal(h.requests[0].system[0].cache_control, undefined);
    assert.equal(h.requests[0].system[0].text, fixed);
    assert.equal(h.requests[0].messages[0].content[0].text, params().prompt[1].content[0].text);
  }
});

test("direct cache decision does not leak through fallback into gateway caching", async () => {
  const h = harness();
  assert.equal(await h.api.aiPromptCachingEnabled(h.model), true);
  const gateway = h.api.resolveGatewayModel("anthropic/claude-sonnet-5-5", "vck_fixture");
  h.api.inheritAiModelUsage(gateway, h.model);
  await h.api.aiPromptCachingEnabled(gateway);
  assert.deepEqual(h.checks.map(([key]) => key), [FLAG, "htpr-7689-prompt-caching"]);
});

test("chat assembly keeps real clock, user and ticket changes beyond the cached prefix", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T12:00:00Z") });
  const h = harness();
  const { generateText, jsonSchema, tool } = require("ai");
  const content = load("src/lib/ai/chatStream/content.ts");
  let snapshot = "Ticket A snapshot";
  const turn = load("src/lib/ai/chatStream/modelTurn.ts", {
    "@/lib/ai/prompts/registry": {},
    "@/lib/flags/keys": {},
    "@/lib/prisma": {},
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => snapshot },
    "@/app/api/ai/chat/stream/streamLease": {},
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": {},
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: fixed },
    "@/app/api/ai/_lib/modelProvider": h.api,
    "@/lib/ai/chatStream/content": content,
    "@/lib/ai/tools/metadata": {},
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: () => ({
      read_ticket: tool({ description: "Read a ticket", inputSchema: jsonSchema({ type: "object", properties: {} }) }),
    }) },
    "./modelReply": { generateModelReply: async (state, { instructions, messages, tools }) => {
      await generateText({ model: state.selected.model, instructions, messages, tools, maxOutputTokens: 16 });
    } },
    "./chatNames": { nameChatFromFirstMessage: async () => null },
  });
  for (const id of [985, 986]) {
    const model = h.api.resolveAiModel("claude", "claude-sonnet-5-5", "fixture-key-not-real");
    const body = { message: "Read this ticket", default_context: { scope: "ticket", task_id: id } };
    await turn.runModelTurn({ body, dbUser: { id, email: `qa-${id}@example.invalid`, displayName: `QA ${id}` },
      selected: { model }, contextTaskId: id, providerAbort: new AbortController(),
    }, body, {});
    snapshot = "Ticket B snapshot";
    t.mock.timers.setTime(new Date("2026-10-28T12:00:00Z").getTime());
  }
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[0].system, h.requests[1].system);
  assert.deepEqual(h.requests[0].system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(h.requests[0].tools, h.requests[1].tools);
  assert.match(h.requests[0].messages[0].content[0].text, /Ticket A snapshot/);
  assert.match(h.requests[1].messages[0].content[0].text, /Ticket B snapshot/);
  assert.match(h.requests[0].messages[0].content[0].text, /2026-10-27T12:00:00/);
  assert.match(h.requests[1].messages[0].content[0].text, /2026-10-28T12:00:00/);
  assert.match(h.requests[0].messages[0].content[0].text, /qa-985@example.invalid/);
  assert.match(h.requests[1].messages[0].content[0].text, /qa-986@example.invalid/);
});

test("direct cache flag stays limited for provider billing risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7855-direct-prompt-cache.ts").default;
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "money");
});
