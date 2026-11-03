const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createHmac, createHash } = require("node:crypto");
const { createJiti } = require("jiti");
const ai = require("ai");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { fsCache: false });
const flagPath = "src/lib/flags/definitions/htpr-7689-prompt-caching.ts";
const flag = jiti(path.join(root, flagPath));
const fixtureSecret = "offline-fixture-signing-secret";

function load(file, stubs = {}, globals = {}) {
  const filename = path.join(root, file);
  const code = jiti.transform({ source: fs.readFileSync(filename, "utf8"), filename, ts: true });
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports,
    jitiImport: async (id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      throw new Error(`Unexpected dynamic import: ${id}`);
    },
    require: (id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id === "node:crypto") return require(id);
      throw new Error(`Unexpected import: ${id}`);
    },
    process: { env: {} },
    performance, setTimeout, clearTimeout, ReadableStream, URL, Buffer,
    ...globals,
  }, { filename });
  return mod.exports;
}

function harness({ enabled = true, flagError = false, secret = fixtureSecret } = {}) {
  const checks = [], middlewares = [], sent = [];
  const factory = (provider) => {
    const create = (modelId) => ({
      specificationVersion: "v4", provider, modelId, supportedUrls: {},
      doGenerate: async (params) => {
        sent.push(params);
        return { content: [{ type: "text", text: "Fixture reply" }], finishReason: { unified: "stop" }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } };
      },
      doStream: async (params) => {
        sent.push(params);
        return { stream: new ReadableStream({ start(controller) { controller.close(); } }) };
      },
    });
    return Object.assign(create, { chat: create });
  };
  const modelApi = load("src/app/api/ai/_lib/modelProvider.ts", {
    "@/lib/net/fetchWithoutBrotli": {},
    "@/lib/flags/definitions/htpr-7689-prompt-caching": flag,
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      if (flagError) throw new Error("Offline flag failure");
      return enabled;
    } },
    "@vercel/functions": { waitUntil: () => {} },
    "./aiUsage": { logAiUsage: async () => {} },
    "@/lib/ai/prompts/registry": { identifyPrompt: () => ({ promptId: "fixture", promptVersion: "1" }) },
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => {} },
    "@/lib/errors/reportError": {},
    "@ai-sdk/anthropic": { createAnthropic: () => factory("anthropic.messages") },
    "@ai-sdk/openai": { createOpenAI: () => factory("openai.chat") },
    "@openrouter/ai-sdk-provider": { createOpenRouter: () => factory("openrouter") },
    ai: {
      createGateway: () => factory("gateway"),
      wrapLanguageModel: (options) => {
        middlewares.push(...[options.middleware].flat());
        return ai.wrapLanguageModel(options);
      },
    },
    "@/app/api/ai/_lib/sharedAllowance": {
      gatewayCatalogModelSlug: (id) => id,
      sharedAiAllowanceErrorMessage: () => null,
      createSharedAllowanceMiddleware: () => ({ specificationVersion: "v4" }),
    },
    "@/lib/aiModelOptions": { isHaiku45Model: () => false, isHaiku55Model: () => false },
    "@/lib/aiProviders": { getAiProviderInfo: () => ({ openAiCompatibleBaseUrl: "https://fixture.invalid" }) },
    "@/lib/aiAllowancePolicy": {},
    "@/lib/aiUsageClassification": { isSystemAiFeature: () => false },
    "@/lib/ai/customEndpoint": { isCustomEndpointConfig: (value) => Boolean(value && typeof value === "object") },
  }, { process: { env: { BETTER_AUTH_SECRET: secret } } });
  function resolve(slug = "anthropic/claude-sonnet-fixture", { direct = false, gatewayCredential = false, context = {} } = {}) {
    const model = direct
      ? modelApi.resolveAiModel(slug.startsWith("anthropic/") ? "claude" : "openai", slug, "fixture-direct-key")
      : gatewayCredential
        ? modelApi.resolveAiModel("claude", "claude-sonnet-fixture", "vck_fixture")
        : modelApi.resolveGatewayModel(slug, "vck_fixture");
    modelApi.configureAiModelUsage(model, { userId: 6, initiatingUserId: 985, teamId: "team-a", ...context });
    const middleware = middlewares.at(-1);
    return { model, transform: (params, type = "generate") => middleware.transformParams({ params, type, model }) };
  }
  return { ...modelApi, resolve, checks, sent };
}

function params() {
  return {
    prompt: [
      { role: "system", content: "Stable instructions", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" }, other: "keep" }, gateway: { marker: "keep" } } },
      { role: "system", content: "Suffix" },
      { role: "user", content: [{ type: "text", text: "Question" }] },
    ],
    maxOutputTokens: 400,
    headers: { "x-existing": "keep" },
    providerOptions: { gateway: { tags: ["chat", "team:team-a"], order: ["anthropic"], custom: { keep: true } }, openai: { reasoningEffort: "high" }, anthropic: { effort: "high" } },
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

for (const [name, slug, options] of [
  ["gateway Claude", "anthropic/claude-sonnet-fixture", {}],
  ["gateway OpenAI", "openai/gpt-fixture", {}],
  ["direct BYOK", "anthropic/claude-sonnet-fixture", { direct: true }],
]) {
  test(`Off keeps the exact params object and keys for ${name}`, async () => {
    const h = harness({ enabled: false });
    const { transform } = h.resolve(slug, options);
    const input = params(), before = structuredClone(input);
    assert.equal(await transform(input), input);
    assert.deepEqual(input, before);
    const minimal = { prompt: [] };
    assert.equal(await transform(minimal), minimal);
    assert.deepEqual(Object.keys(minimal), ["prompt"]);
  });
}

test("On gateway Claude deep-merges auto caching and removes only the legacy system marker", async () => {
  const h = harness();
  const { transform } = h.resolve();
  const input = params(), before = structuredClone(input);
  const output = plain(await transform(input));
  const expected = structuredClone(before);
  expected.providerOptions.gateway.caching = "auto";
  delete expected.prompt[0].providerOptions.anthropic.cacheControl;
  assert.deepEqual(output, expected);
  assert.deepEqual(input, before);
  assert.deepEqual(h.checks, [[flag.HTPR_7689_PROMPT_CACHING_FLAG, 985]]);
  assert.deepEqual(plain(await transform(input, "stream")), expected);
  assert.equal(h.checks.length, 1);
});

test("actual gateway transport enables caching even when usage attribution says Claude", async () => {
  const h = harness();
  const { transform } = h.resolve(undefined, { gatewayCredential: true });
  assert.equal((await transform(params())).providerOptions.gateway.caching, "auto");
});

test("On direct BYOK ignores a gateway-looking model id and usage provider", async () => {
  const h = harness();
  const { transform, model } = h.resolve("anthropic/claude-sonnet-fixture", { direct: true, context: { provider: "gateway", trustedChatSessionId: "session-a" } });
  const input = params();
  assert.equal(model.modelId, "anthropic/claude-sonnet-fixture");
  assert.equal(await transform(input), input);
  assert.equal(await h.aiPromptCachingEnabled(model), false);
  assert.deepEqual(h.checks, []);
});

test("OpenAI keys are bounded opaque HMACs, stable per session and isolated by team or personal user", async () => {
  const h = harness();
  const key = async (context) => {
    const { transform } = h.resolve("openai/gpt-fixture", { context });
    const input = params(), before = structuredClone(input);
    const result = await transform(input);
    assert.deepEqual(input, before);
    const expected = structuredClone(before);
    expected.providerOptions.openai.promptCacheKey = result.providerOptions.openai.promptCacheKey;
    assert.deepEqual(plain(result), expected);
    return result.providerOptions.openai.promptCacheKey;
  };
  const first = await key({ trustedChatSessionId: "session-a" });
  const expected = createHmac("sha256", fixtureSecret).update("htpr-7689:v1:team:team-a:session-a").digest("base64url").slice(0, 32);
  assert.equal(first, expected);
  assert.match(first, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(await key({ trustedChatSessionId: "session-a" }), first);
  assert.notEqual(await key({ trustedChatSessionId: "session-b" }), first);
  assert.notEqual(await key({ trustedChatSessionId: "session-a", teamId: "team-b" }), first);
  const personal = await key({ trustedChatSessionId: "session-a", teamId: null });
  assert.notEqual(personal, first);
  assert.notEqual(await key({ trustedChatSessionId: "session-a", teamId: null, initiatingUserId: 986 }), personal);
});

test("OpenAI without a trusted session or signing secret leaves params unchanged", async () => {
  for (const [settings, context] of [[{}, {}], [{ secret: "" }, { trustedChatSessionId: "session-a" }]]) {
    const h = harness(settings);
    const { transform } = h.resolve("openai/gpt-fixture", { context });
    const input = params();
    assert.equal(await transform(input), input);
    assert.deepEqual(input, params());
  }
});

test("background attribution to an eligible task creator does not supply an initiator", async () => {
  const h = harness();
  const { transform } = h.resolve(undefined, { context: { userId: 6, initiatingUserId: null, feature: "summary", trustedChatSessionId: "untrusted-scope" } });
  const input = params();
  assert.equal(await transform(input), input);
  assert.deepEqual(input, params());
  assert.deepEqual(h.checks, []);
  const trusted = h.resolve(undefined, { context: { feature: "summary", initiatingUserId: 985 } });
  assert.equal((await trusted.transform(input)).providerOptions.gateway.caching, "auto");
});

test("flag lookup failure and other gateway vendors fail closed", async () => {
  const h = harness({ flagError: true });
  const input = params();
  assert.equal(await h.resolve().transform(input), input);
  assert.deepEqual(h.checks, [[flag.HTPR_7689_PROMPT_CACHING_FLAG, 985]]);
  assert.equal(await harness().resolve("google/gemini-fixture").transform(input), input);
});

test("fallback models inherit the evaluated flag, trusted initiator and session", async () => {
  const h = harness();
  const original = h.resolve("openai/gpt-fixture", { context: { trustedChatSessionId: "session-a" } });
  const first = await original.transform(params());
  const fallback = h.resolve("openai/gpt-fallback", { context: { initiatingUserId: null } });
  h.inheritAiModelUsage(fallback.model, original.model);
  const next = await fallback.transform(params());
  assert.match(next.providerOptions.openai.promptCacheKey, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(next.providerOptions.openai.promptCacheKey, first.providerOptions.openai.promptCacheKey);
  assert.equal(h.checks.length, 1);
});

test("the central wrapper applies the policy to generate and stream sends", async () => {
  const h = harness();
  const { model } = h.resolve();
  const input = params();
  await model.doGenerate(input);
  const stream = await model.doStream(input);
  await stream.stream.getReader().read();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].providerOptions.gateway.caching, "auto");
  assert.deepEqual(plain(h.sent[1]), plain(h.sent[0]));
});

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-10-23T12:34:56.000Z"])); }
}
const content = load("src/lib/ai/chatStream/content.ts", {}, { Date: FixedDate });
const body = {
  message: "Current question", chat_history: [{ role: "user", content: "Earlier question" }, { role: "assistant", content: "Earlier reply" }],
  context_list: [{ id: 42 }], default_context: { scope: "ticket", task_id: 42 },
};
const user = { id: 985, email: "qa@example.invalid", displayName: "QA" };

test("chat Off matches the frozen original byte snapshot, including both clocks", () => {
  const output = content.createUserPrompt(body, user, "Ticket snapshot", false);
  assert.equal(createHash("sha256").update(output).digest("hex"), "42b74ddbb2c8344d8c413d5e1b0763448d80f25539df705b53b9e981269f717a");
  assert.equal(content.createUserContent(body, user, "Ticket snapshot"), output);
});

test("chat On keeps stable rules first and query, selection and both clocks at the end", () => {
  const output = content.createUserPrompt(body, user, "Ticket snapshot", true);
  const history = output.indexOf("CHAT HISTORY:");
  assert.ok(output.indexOf("IMPORTANT: Analyze") < history);
  assert.ok(output.indexOf("SCOPE:") < history);
  assert.ok(history < output.indexOf("context_list:"));
  assert.ok(history < output.indexOf("Ticket snapshot"));
  assert.ok(history < output.indexOf("User query: Current question"));
  assert.ok(output.indexOf("User query: Current question") < output.indexOf("Today's Date & Time:"));
  assert.ok(output.indexOf("User query: Current question") < output.indexOf("[Current Time:"));
  assert.equal((output.match(/\[Current Time:/g) ?? []).length, 1);
  assert.equal((output.match(/Today's Date & Time:/g) ?? []).length, 1);
  assert.equal(content.createUserContent(body, user, "Ticket snapshot", true), output);
});

test("the ticket flag remains an improvement restricted to Owner and QA for money risk", () => {
  assert.equal(flag.default.key, "htpr-7689-prompt-caching");
  assert.equal(flag.default.kind, "improvement");
  assert.equal(flag.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.default.releaseRisk.highRisk, "money");
});

test("chat uses one server-evaluated decision for prompt ordering and provider caching", async () => {
  for (const enabled of [false, true]) {
    const h = harness({ enabled });
    const { model, transform } = h.resolve("openai/gpt-fixture", { context: { initiatingUserId: null } });
    let userPrompt;
    const turn = load("src/lib/ai/chatStream/modelTurn.ts", {
      "@/lib/ai/prompts/registry": {},
      "@/lib/flags/keys": {},
      "@/lib/prisma": {},
      "@/lib/flags": { isFeatureEnabled: async () => false },
      "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "Ticket snapshot" },
      "@/app/api/ai/chat/stream/streamLease": {},
      "@/app/api/ai/_lib/heartbeatExecution": {},
      "@/app/api/ai/chat/stream/persistAssistantMessage": {},
      "@/utils/controllers/comments/linkifyTicketRefs": {},
      "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "Fixed system rules" },
      "@/app/api/ai/_lib/modelProvider": h,
      "@/lib/flags/definitions/htpr-7683-ai-chat-ticket-rows": { HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG: "htpr-7683-ai-chat-ticket-rows" },
      "@/lib/flags/definitions/htpr-7622-ai-settings": { HTPR_7622_AI_SETTINGS_FLAG: "htpr-7622-ai-settings" },
      "@/lib/flags/definitions/htpr-7780-docs-routing": { HTPR_7780_DOCS_ROUTING_FLAG: "htpr-7780-docs-routing" },
      "@/lib/ai/settings/catalog": { settingsPages: {}, settingProposalCard: () => ({}) },
      "./ticketGroups": {},
      "@/lib/ai/tools/showTicketRows": { TICKET_ROWS_PROMPT: "rows prompt" },
      "@/lib/ai/chatStream/content": content,
      "@/lib/ai/tools/metadata": {},
      "@/lib/ai/chatStream/title": {},
      "@/lib/ai/tools": { buildTools: () => ({}) },
      "./modelReply": { generateModelReply: async (_state, inputs) => { userPrompt = inputs.messages[0].content; } },
      "./chatNames": { nameChatFromFirstMessage: async () => null },
    });
    await turn.runModelTurn({ body, dbUser: user, selected: { model }, trustedChatSessionId: "owned-session", providerAbort: new AbortController() }, body, {});
    assert.equal(userPrompt, content.createUserPrompt(body, user, "Ticket snapshot", enabled));
    const input = params();
    const output = await transform(input);
    if (enabled) {
      assert.match(output.providerOptions.openai.promptCacheKey, /^[A-Za-z0-9_-]{32}$/);
    } else {
      assert.equal(output, input);
    }
    assert.deepEqual(h.checks, [[flag.HTPR_7689_PROMPT_CACHING_FLAG, 985]]);
  }
});

test("legacy promptCache instructions retain their boundary and content on the auto path", async () => {
  const legacy = load("src/app/api/ai/_lib/promptCache.ts");
  const fixed = "Stable policy ".repeat(200);
  const prompt = legacy.cachedInstructions({ modelId: "claude-fixture", fixed, suffix: "Variable tail", enabled: true });
  const h = harness();
  const output = await h.resolve().transform({ prompt });
  assert.equal(output.providerOptions.gateway.caching, "auto");
  assert.deepEqual(plain(output.prompt).map(({ role, content }) => ({ role, content })), [
    { role: "system", content: fixed }, { role: "system", content: "Variable tail" },
  ]);
  assert.equal(output.prompt[0].providerOptions.anthropic.cacheControl, undefined);
  assert.deepEqual(plain(prompt[0].providerOptions), { anthropic: { cacheControl: { type: "ephemeral" } } });
});

test("only an ownership-checked chat session becomes a trusted cache scope", async () => {
  for (const owned of [false, true]) {
    const h = harness();
    const { model, transform } = h.resolve("openai/gpt-fixture");
    const lookups = [];
    const turn = load("src/lib/ai/chatStream/turnModel.ts", {
      "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => {} },
      "@/lib/flags/keys": { HTPR_7730_DEEPSEEK_FLASH_FAST_FLAG: "htpr-7730-deepseek-flash-fast" },
      "next/server": {},
      "@/lib/prisma": { __esModule: true, default: {
        chatSession: { findFirst: async (args) => { lookups.push(plain(args)); return owned ? { agent: null } : null; } },
        userSetting: { findUnique: async () => ({}) },
      } },
      "@/app/api/ai/_lib/modelProvider": h,
      "@/lib/aiModelOptions": { getDefaultAiModelOptionForPlan: () => ({}), isLunaBlockedForPlan: () => false, isGrokGemini4ModelKey: () => false },
      "@/lib/flags/definitions/htpr-7683-ai-chat-ticket-rows": { HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG: "htpr-7683-ai-chat-ticket-rows" },
      "@/lib/flags/definitions/htpr-7622-ai-settings": { HTPR_7622_AI_SETTINGS_FLAG: "htpr-7622-ai-settings" },
      "@/lib/ai/settings/catalog": { settingsPages: {}, settingProposalCard: () => ({}) },
      "./ticketGroups": {},
      "@/lib/ai/tools/showTicketRows": { TICKET_ROWS_PROMPT: "rows prompt" },
      "@/app/api/ai/_lib/chatTeamContext": {
        resolveChatTeamContext: async () => ({ teamId: "team-a" }),
        buildChatProviderContext: () => ({ keyLookupContext: { trustedTeamId: "team-a" } }),
      },
      "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
      "@/lib/aiProviders": {},
      "@/lib/aiModelPreferences": { getAiModelPreferenceIds: () => ({}) },
      "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "Pro", haiku55ModelEnabled: async () => false, assertModelAllowedForPlan: async () => {} },
      "@/app/api/ai/_lib/byokKeys": { getByokOrTeamGatewayApiKeyForProvider: async () => "vck_fixture" },
      "@/lib/ai/teamAiFunding": require("./helpers/team-ai-funding-stub.cjs"),
      "@/lib/nativeAgent/modelPin": { resolveAgentModelPin: () => null },
      "@/app/api/ai/_lib/providerGate": {},
      "@/lib/ai/chatStream/errors": { reportHandledChatError: async (error) => { throw error; } },
      "@/lib/ai/tools/helpers": { loadActingAgent: async () => null },
      "@/lib/ai/chatStream/models": { resolveModelSelection: () => ({ provider: "openai", model: "gpt-fixture" }), selectModel: () => ({ model, resolvedModelId: "gpt-fixture" }) },
    });
    const result = await turn.loadTurnModel({ session_id: "requested-session" }, user);
    assert.deepEqual(lookups[0].where, { id: "requested-session", userId: 985 });
    assert.equal(result.trustedChatSessionId, owned ? "requested-session" : null);
    h.configureAiModelUsage(model, { trustedChatSessionId: result.trustedChatSessionId });
    const input = params();
    const output = await transform(input);
    if (owned) assert.match(output.providerOptions.openai.promptCacheKey, /^[A-Za-z0-9_-]{32}$/);
    else assert.equal(output, input);
  }
});

test("On direct OpenAI never receives a prompt cache key even with a trusted session", async () => {
  const h = harness();
  const { transform, model } = h.resolve("openai/gpt-fixture", { direct: true, context: { trustedChatSessionId: "session-a" } });
  assert.equal(model.modelId, "openai/gpt-fixture");
  const input = params();
  assert.equal(await transform(input), input);
  assert.deepEqual(input, params());
  assert.deepEqual(h.checks, []);
});

test("chat reordering preserves attachment parts and leaves the default Off path unchanged", () => {
  const request = { ...body, images64: [{ url: "data:image/png;base64,YQ==", fileName: "fixture.png", mimeType: "image/png" }] };
  const off = plain(content.createUserContent(request, user, "Ticket snapshot"));
  const on = plain(content.createUserContent(request, user, "Ticket snapshot", true));
  assert.equal(off[0].text, content.createUserPrompt(request, user, "Ticket snapshot", false));
  assert.equal(on[0].text, content.createUserPrompt(request, user, "Ticket snapshot", true));
  assert.deepEqual(off.slice(1), [{ type: "file", mediaType: "image/png", filename: "fixture.png", data: { type: "data", data: "YQ==" } }]);
  assert.deepEqual(on.slice(1), off.slice(1));
});
