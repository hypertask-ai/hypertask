const { loadModule } = require("./helpers/loadModule.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const reasoning = load(path.join(root, "src/app/api/ai/_lib/reasoningEffort.ts"));
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const preference = load(path.join(root, "src/lib/aiThinkingPreference.ts"));

function loadProvider({ flag7854 }) {
  const stubs = {
    "@/lib/net/fetchWithoutBrotli": { fetchWithoutBrotli: async () => { throw new Error("Unexpected network request"); } },
    "@/lib/flags": { isFeatureEnabled: async (key) => flag7854 && key === "htpr-7854-ai-thinking-opt-in" },
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
  };
  return loadModule("src/app/api/ai/_lib/modelProvider.ts", stubs);
}

async function sent(api, { context, modelId, params = {} }) {
  const middleware = api.createUsageTracingMiddleware(context, modelId);
  return middleware.transformParams({ params: { prompt: [], ...params } });
}

test("saved choice defaults to thinking off and low effort", () => {
  assert.deepEqual(preference.parseAiThinkingPreference(undefined), { enabled: false, effort: "low" });
  assert.deepEqual(preference.parseAiThinkingPreference(null), { enabled: false, effort: "low" });
  assert.deepEqual(preference.parseAiThinkingPreference("on"), { enabled: false, effort: "low" });
  assert.deepEqual(preference.parseAiThinkingPreference({ enabled: "yes", effort: "max" }), { enabled: false, effort: "low" });
  assert.deepEqual(preference.parseAiThinkingPreference({ enabled: true, effort: "high" }), { enabled: true, effort: "high" });
  assert.deepEqual(preference.AI_THINKING_EFFORTS, ["low", "medium", "high"]);
});

test("thinking off sends no effort and thinking on sends the chosen level", () => {
  assert.equal(preference.thinkingPreferenceToEffort({ enabled: false, effort: "high" }), "none");
  for (const effort of preference.AI_THINKING_EFFORTS) {
    assert.equal(preference.thinkingPreferenceToEffort({ enabled: true, effort }), effort);
  }
});

test("controls show only for models whose provider has a thinking parameter", () => {
  const supported = catalog.aiModelDefinitions.filter((definition) => preference.modelSupportsThinkingControl(definition.key));
  assert.ok(supported.length > 0);
  for (const definition of supported) {
    assert.ok(["openai", "anthropic", "google", "deepseek"].includes(definition.provider), definition.key);
  }
  for (const definition of catalog.aiModelDefinitions) {
    if (["xai", "moonshot", "alibaba", "zhipu", "baseten", "custom", "gateway"].includes(definition.provider)) {
      assert.equal(preference.modelSupportsThinkingControl(definition.key), false, definition.key);
    }
  }
  assert.equal(preference.modelSupportsThinkingControl("custom"), false);
});

test("each provider maps the saved choice to its own request shape", () => {
  const cases = [
    { modelId: "claude-sonnet-5-5", provider: "anthropic" },
    { modelId: "gpt-6-luna", provider: "openai" },
    { modelId: "gemini-4-flash", provider: "google" },
    { modelId: "deepseek-v4.1-flash", provider: "deepseek" },
  ];
  for (const { modelId, provider } of cases) {
    for (const effort of ["low", "medium", "high"]) {
      const on = reasoning.applyReasoningToParams({}, { reasoningFeature: "chat", reasoningEffort: effort, provider }, modelId);
      const options = on.providerOptions;
      if (provider === "anthropic") {
        assert.equal(options.anthropic.thinking.type, "adaptive");
        assert.equal(options.anthropic.effort, effort);
      }
      if (provider === "openai") assert.equal(options.openai.reasoningEffort, effort);
      if (provider === "google") assert.equal(options.google.thinkingConfig.thinkingLevel, effort);
      if (provider === "deepseek") {
        assert.equal(options.deepseek.thinking.type, "enabled");
        assert.equal(options.deepseek.reasoningEffort, effort === "medium" ? "high" : effort);
      }
    }
    const off = reasoning.applyReasoningToParams(
      { providerOptions: { anthropic: { thinking: { type: "adaptive" }, effort: "max" }, openai: { reasoningEffort: "high" } } },
      { reasoningFeature: "chat", reasoningEffort: "none", provider },
      modelId,
    );
    if (provider === "anthropic") {
      assert.equal(off.providerOptions.anthropic.thinking.type, "disabled");
      assert.equal(off.providerOptions.anthropic.effort, undefined);
    }
    if (provider === "openai") assert.equal(off.providerOptions.openai.reasoningEffort, "none");
    if (provider === "google") assert.equal(off.providerOptions.google.thinkingConfig.thinkingBudget, 0);
    if (provider === "deepseek") assert.equal(off.providerOptions?.deepseek, undefined);
  }
});

test("providers without a knob receive nothing", () => {
  for (const provider of ["xai", "moonshot", "alibaba", "zhipu", "baseten", "gateway", "custom"]) {
    const params = { providerOptions: { fixture: { kept: true } } };
    const result = reasoning.applyReasoningToParams(params, { reasoningFeature: "chat", reasoningEffort: "high", provider }, `${provider}-model`);
    assert.deepEqual(result.providerOptions, { fixture: { kept: true } }, provider);
  }
});

test("the saved choice applies even when the 7854 flag is off", async () => {
  const api = loadProvider({ flag7854: false });
  const on = await sent(api, {
    context: { userId: 7, provider: "openai", reasoningFeature: "chat", reasoningEffort: "medium", userReasoning: true },
    modelId: "gpt-6-luna",
  });
  assert.equal(on.providerOptions.openai.reasoningEffort, "medium");
  const off = await sent(api, {
    context: { userId: 7, provider: "openai", reasoningFeature: "chat", reasoningEffort: "none", userReasoning: true },
    modelId: "gpt-6-luna",
    params: { providerOptions: { openai: { reasoningEffort: "high" } } },
  });
  assert.equal(off.providerOptions.openai.reasoningEffort, "none");
});

test("without the saved choice nothing changes from HTPR-7854", async () => {
  const flagOff = loadProvider({ flag7854: false });
  const untouched = { providerOptions: { openai: { reasoningEffort: "high" } } };
  const result = await sent(flagOff, {
    context: { userId: 7, provider: "openai", reasoningFeature: "chat" },
    modelId: "gpt-6-luna",
    params: untouched,
  });
  assert.deepEqual(result.providerOptions, untouched.providerOptions);
  const flagOn = loadProvider({ flag7854: true });
  const chat = await sent(flagOn, {
    context: { userId: 7, provider: "openai", reasoningFeature: "chat" },
    modelId: "gpt-6-luna",
  });
  assert.equal(chat.providerOptions.openai.reasoningEffort, "low");
});

test("flag, server check and selector wiring are in the source", () => {
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  assert.match(read("src/lib/flags/definitions/htpr-9004-thinking-effort.ts"), /defaultMode: "OWNER_AND_QA"/);
  assert.match(read("src/lib/ai/chatStream/thinkingChoice.ts"), /isFeatureEnabled\(HTPR_9004_THINKING_EFFORT_FLAG, userId\)/);
  assert.match(read("src/app/api/users/preferences/route.ts"), /isFeatureEnabled\(HTPR_9004_THINKING_EFFORT_FLAG/);
  assert.match(read("src/components/Global/ModelSelectorDropdown.tsx"), /useFlag\(HTPR_9004_THINKING_EFFORT_FLAG\)/);
  assert.match(read("src/components/AI_CHAT/AI_Tiptap_Container.tsx"), /useFlag\(HTPR_9004_THINKING_EFFORT_FLAG\)/);
});
