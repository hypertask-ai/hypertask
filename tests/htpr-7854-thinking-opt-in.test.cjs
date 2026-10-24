const { withStubs } = require("./helpers/stub-map.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const reasoning = load(path.join(root, "src/app/api/ai/_lib/reasoningEffort.ts"));
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));

const EXPECTED = {
  "chat-title": "none",
  labels: "none",
  summaries: "none",
  tldr: "none",
  heartbeat: "none",
  "suggested-questions": "none",
  "slash-rewrite": "none",
  chat: "low",
  "hyper-mentioned": "low",
  "task-writer": "low",
};

test("one map is the effort each feature sends", () => {
  assert.deepEqual(reasoning.FEATURE_REASONING_EFFORT, EXPECTED);
  for (const [feature, level] of Object.entries(EXPECTED)) {
    assert.equal(reasoning.effortForFeature(feature), level, feature);
  }
  assert.equal(reasoning.effortForFeature("smart-label"), "none");
  assert.equal(reasoning.effortForFeature("summary"), "none");
  assert.equal(reasoning.effortForFeature("task-questions"), "none");
  assert.equal(reasoning.effortForFeature("editor"), "none");
  assert.equal(reasoning.effortForFeature("status-update"), "none");
  assert.equal(reasoning.effortForFeature("chat-title", "high"), "high");
  assert.equal(reasoning.effortForFeature("labels", "medium"), "medium");
  assert.equal(reasoning.CHAT_TITLE_MAX_OUTPUT_TOKENS, 64);
});

test("installed SDK types name the provider knobs this map writes", () => {
  const anthropic = fs.readFileSync(path.join(root, "node_modules/@ai-sdk/anthropic/dist/index.d.ts"), "utf8");
  const openai = fs.readFileSync(path.join(root, "node_modules/@ai-sdk/openai/dist/index.d.ts"), "utf8");
  const openrouter = fs.readFileSync(path.join(root, "node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts"), "utf8");
  const gateway = fs.readFileSync(path.join(root, "node_modules/@ai-sdk/gateway/dist/index.d.ts"), "utf8");
  assert.match(anthropic, /type: z\.ZodLiteral<"adaptive">/);
  assert.match(anthropic, /type: z\.ZodLiteral<"disabled">/);
  assert.match(anthropic, /effort: z\.ZodOptional<z\.ZodEnum<\{[\s\S]*?low: "low";[\s\S]*?medium: "medium";[\s\S]*?high: "high"/);
  assert.match(openai, /reasoningEffort\?: "none" \| "low" \| "medium" \| "high"/);
  assert.match(openrouter, /effort: 'xhigh' \| 'high' \| 'medium' \| 'low' \| 'minimal' \| 'none'/);
  const gatewayOptions = gateway.slice(gateway.indexOf("type GatewayProviderOptions"), gateway.indexOf("type GatewayEmbeddingModelId"));
  assert.doesNotMatch(gatewayOptions, /reasoningEffort|thinkingConfig/);
  const googlePath = path.join(root, "node_modules/@ai-sdk/google/dist/index.d.ts");
  const deepseekPath = path.join(root, "node_modules/@ai-sdk/deepseek/dist/index.d.ts");
  if (fs.existsSync(googlePath)) {
    const google = fs.readFileSync(googlePath, "utf8");
    assert.match(google, /thinkingConfig\?: \{\s*thinkingBudget\?: number \| undefined;\s*includeThoughts\?: boolean \| undefined;\s*thinkingLevel\?: "minimal" \| "low" \| "medium" \| "high"/);
  }
  if (fs.existsSync(deepseekPath)) {
    const deepseek = fs.readFileSync(deepseekPath, "utf8");
    assert.match(deepseek, /thinking\?: \{\s*type\?: 'enabled' \| 'disabled';/);
    assert.match(deepseek, /reasoningEffort\?: 'low' \| 'high' \| 'max'/);
  }
});

test("each provider gets its own option shape for every feature effort", () => {
  const providers = ["anthropic", "openai", "google", "deepseek", "openrouter", "gateway", "xai", "moonshot", "alibaba", "zhipu", "baseten", "custom"];
  for (const [feature, level] of Object.entries(EXPECTED)) {
    for (const provider of providers) {
      const sent = reasoning.translateReasoning({ feature, provider, modelId: provider === "deepseek" ? "deepseek/deepseek-v4.1-flash-1017" : "fixture-model" });
      assert.equal(sent.level, level, `${provider} ${feature}`);
      if (provider === "anthropic") {
        if (level === "none") {
          assert.deepEqual(sent.providerOptions.anthropic.thinking, { type: "disabled" });
          assert.equal(sent.providerOptions.anthropic.effort, undefined);
        } else {
          assert.deepEqual(sent.providerOptions.anthropic.thinking, { type: "adaptive" });
          assert.equal(sent.providerOptions.anthropic.effort, level);
        }
      } else if (provider === "openai") {
        assert.equal(sent.providerOptions.openai.reasoningEffort, level);
      } else if (provider === "google") {
        if (level === "none") assert.equal(sent.providerOptions.google.thinkingConfig.thinkingBudget, 0);
        else assert.equal(sent.providerOptions.google.thinkingConfig.thinkingLevel, level);
      } else if (provider === "openrouter") {
        assert.equal(sent.providerOptions.openrouter.reasoning.effort, level);
      } else if (provider === "deepseek") {
        if (level === "none") {
          assert.equal(sent.modelId, "deepseek/deepseek-v4.1-flash-1017-fast");
          assert.equal(sent.providerOptions.deepseek.thinking.type, "disabled");
        } else {
          assert.equal(sent.modelId, "deepseek/deepseek-v4.1-flash-1017");
          assert.equal(sent.providerOptions.deepseek.reasoningEffort, level);
          assert.equal(sent.providerOptions.deepseek.thinking.type, "enabled");
        }
      } else {
        assert.equal(sent.providerOptions, undefined, provider);
        assert.equal(sent.note, undefined, provider);
      }
    }
  }
  const pro = reasoning.translateReasoning({ feature: "summaries", provider: "deepseek", modelId: "deepseek/deepseek-v4-pro" });
  assert.equal(pro.modelId, "deepseek/deepseek-v4-pro");
  assert.equal(pro.note, reasoning.DEEPSEEK_NONE_UNCHANGED_NOTE);
  assert.equal(pro.providerOptions, undefined);
  const medium = reasoning.translateReasoning({ feature: "chat", provider: "deepseek", explicit: "medium", modelId: "deepseek/deepseek-v4-pro" });
  assert.equal(medium.providerOptions.deepseek.reasoningEffort, "high");
  assert.equal(medium.note, reasoning.DEEPSEEK_MEDIUM_NOTE);
  const low = reasoning.translateReasoning({ feature: "chat", provider: "deepseek", modelId: "deepseek/deepseek-v4-pro" });
  assert.equal(low.providerOptions.deepseek.reasoningEffort, "low");
  assert.equal(low.providerOptions.deepseek.thinking.type, "enabled");
  const kept = reasoning.translateReasoning({ feature: "chat-title", provider: "anthropic", explicit: "high" });
  assert.equal(kept.providerOptions.anthropic.effort, "high");
  assert.equal(kept.providerOptions.anthropic.thinking.type, "adaptive");
});

function loadTs(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: (id) => stubs[id] ?? require(id),
    process, performance, console,
  }, { filename });
  return loadedModule.exports;
}

function loadProvider({ flagOn }) {
  const filename = path.join(root, "src/app/api/ai/_lib/modelProvider.ts");
  const extra = {};
  const stubs = withStubs({
    "@/lib/net/fetchWithoutBrotli": { fetchWithoutBrotli: async () => { throw new Error("Unexpected network request"); } },
    "@/lib/flags": { isFeatureEnabled: async (key) => flagOn && key === "htpr-7854-ai-thinking-opt-in" },
    "@/lib/flags/definitions/htpr-7854-ai-thinking-opt-in": reasoning,
    "@vercel/functions": { waitUntil: () => undefined },
    "./aiUsage": { logAiUsage: async () => undefined },
    "@/lib/ai/prompts/registry": { identifyPrompt: () => ({ promptId: "fixture", promptVersion: "1" }) },
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => undefined },
    "@/lib/errors/reportError": { reportError: async () => undefined },
    "@ai-sdk/anthropic": { createAnthropic: () => ({}) },
    "@ai-sdk/openai": { createOpenAI: () => ({ chat: () => ({}) }) },
    "@openrouter/ai-sdk-provider": { createOpenRouter: () => ({}) },
    ai: { createGateway: () => ({}), wrapLanguageModel: ({ model }) => model, wrapImageModel: (model) => model },
    "@/app/api/ai/_lib/sharedAllowance": {},
    "@/lib/aiModelOptions": catalog,
    "@/lib/aiProviders": load(path.join(root, "src/lib/aiProviders.ts")),
    "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => true },
    "@/lib/aiAllowancePolicy": {},
    "@/lib/aiUsageClassification": { INCLUDED_WITH_HYPERTASK_GATEWAY_TAG: "included", isSystemAiFeature: () => false },
    "@/lib/ai/customEndpoint": { isCustomEndpointConfig: () => false, normalizeCustomEndpointConfig: (value) => value },
  }, extra);
  extra["@/app/api/ai/_lib/reasoningEffort"] = loadTs("src/app/api/ai/_lib/reasoningEffort.ts", stubs);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: (id) => stubs[id] ?? require(id),
    process, performance, console,
  }, { filename });
  return loadedModule.exports;
}

async function sent(api, { flagContext, modelId, params }) {
  const middleware = api.createUsageTracingMiddleware(flagContext, modelId);
  return middleware.transformParams({ params: { prompt: [], ...params } });
}

test("flag on sends the mapped effort and flag off keeps today's Haiku default", async () => {
  const on = loadProvider({ flagOn: true });
  const off = loadProvider({ flagOn: false });
  const haiku = "claude-haiku-5-5";
  for (const [feature, level] of Object.entries(EXPECTED)) {
    const params = await sent(on, {
      flagContext: { userId: 7, provider: "anthropic", reasoningFeature: feature },
      modelId: haiku,
      params: { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" }, thinking: { type: "adaptive" }, effort: "medium" } } },
    });
    assert.equal(params.providerOptions.anthropic.cacheControl.type, "ephemeral", feature);
    if (level === "none") {
      assert.equal(params.providerOptions.anthropic.thinking.type, "disabled", feature);
      assert.equal(params.providerOptions.anthropic.effort, undefined, feature);
    } else {
      assert.equal(params.providerOptions.anthropic.thinking.type, "adaptive", feature);
      assert.equal(params.providerOptions.anthropic.effort, level, feature);
    }
    assert.equal("temperature" in params, false);
  }
  const opted = await sent(on, {
    flagContext: { userId: 7, provider: "anthropic", reasoningFeature: "chat-title", reasoningEffort: "high" },
    modelId: haiku,
    params: {},
  });
  assert.equal(opted.providerOptions.anthropic.effort, "high");
  assert.equal(opted.providerOptions.anthropic.thinking.type, "adaptive");
  const modelHigh = await sent(on, {
    flagContext: { userId: 7, provider: "openai", reasoningFeature: "chat" },
    modelId: "gpt-6-luna",
    params: { providerOptions: { openai: { reasoningEffort: "high", promptCacheKey: "fixture" } }, temperature: 1 },
  });
  assert.equal(modelHigh.providerOptions.openai.reasoningEffort, "high");
  assert.equal(modelHigh.providerOptions.openai.promptCacheKey, "fixture");
  assert.equal(modelHigh.temperature, 1);
  const luna = await sent(on, {
    flagContext: { userId: 7, provider: "openai", reasoningFeature: "summaries" },
    modelId: "gpt-6-luna",
    params: { providerOptions: { openai: { reasoningEffort: "medium" } } },
  });
  assert.equal(luna.providerOptions.openai.reasoningEffort, "none");
  const google = await sent(on, {
    flagContext: { userId: 7, provider: "google", reasoningFeature: "chat" },
    modelId: "google/gemini-3.5-flash-lite",
    params: {},
  });
  assert.equal(google.providerOptions.google.thinkingConfig.thinkingLevel, "low");
  const unchanged = await sent(off, {
    flagContext: { userId: 7, provider: "anthropic", reasoningFeature: "chat-title" },
    modelId: haiku,
    params: { maxOutputTokens: 4000 },
  });
  assert.equal(unchanged.providerOptions.anthropic.thinking.type, "adaptive");
  assert.equal(unchanged.providerOptions.anthropic.effort, "medium");
  const short = await sent(off, {
    flagContext: { userId: 7, provider: "openrouter", feature: "summary" },
    modelId: haiku,
    params: { maxOutputTokens: 500, providerOptions: { openrouter: { reasoning: { effort: "high" } }, anthropic: { cacheControl: { type: "ephemeral" } } } },
  });
  assert.equal(short.providerOptions.anthropic.thinking.type, "disabled");
  assert.equal(short.providerOptions.anthropic.effort, "low");
  assert.equal(short.providerOptions.openrouter.reasoning.enabled, false);
  const other = await sent(off, {
    flagContext: { userId: 7, provider: "openai", reasoningFeature: "chat" },
    modelId: "gpt-6-luna",
    params: { temperature: 1 },
  });
  assert.equal(other.providerOptions, undefined);
  assert.equal(other.temperature, 1);
});

test("chat title caps output at 64 tokens only when the flag is on", async () => {
  for (const flagOn of [true, false]) {
    let captured;
    let configured;
    const filename = path.join(root, "src/lib/ai/chatStream/title.ts");
    const stubs = {
      "@/lib/net/downloadWithoutBrotli": { downloadWithoutBrotli: undefined },
      "@/app/api/ai/_lib/modelProvider": {
        resolveAiModel: () => ({ modelId: "gpt-6-luna" }),
        aiUsageProviderForCredential: () => "openai",
        configureAiModelUsage: (_model, context) => { configured = context; },
        isAiGatewayEnabled: () => true,
        providerOptionsForAiModel: () => ({ gateway: { tags: ["chat"] } }),
      },
      "@/lib/aiModelOptions": { defaultModelKeyFor: () => "gpt-6-luna" },
      "@/app/api/ai/_lib/byokKeys": {
        resolveAiFallbackCredential: async (run) => run(),
        getAiDefaultModelContext: async () => ({ haiku55Enabled: false, byok: undefined }),
        resolveAutomaticAiModel: () => ({ modelId: "gpt-6-luna" }),
        getByokOrTeamGatewayApiKeyForProvider: async () => "fixture",
      },
      "@/lib/ai/prompts/registry": { renderPrompt: () => "Name this chat" },
      "@/app/api/ai/_lib/reasoningEffort": {
        aiThinkingOptInEnabled: async () => flagOn,
        CHAT_TITLE_MAX_OUTPUT_TOKENS: 64,
      },
      ai: { generateText: async (args) => { captured = args; return { text: "Weekly plan" }; } },
    };
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loadedModule = { exports: {} };
    vm.runInNewContext(code, {
      module: loadedModule,
      exports: loadedModule.exports,
      require: (id) => stubs[id] ?? require(id),
      process, console,
    }, { filename });
    const title = await loadedModule.exports.generateConversationTitle("Plan the week", "Plan the week", "fixture", { userId: 7 }, { userId: 7 });
    assert.equal(title, "Weekly plan");
    assert.equal(configured.reasoningFeature, "chat-title");
    assert.equal(captured.providerOptions.gateway.tags[0], "chat");
    assert.equal(captured.providerOptions.anthropic, undefined);
    if (flagOn) assert.equal(captured.maxOutputTokens, 64);
    else assert.equal(captured.maxOutputTokens, undefined);
  }
});
