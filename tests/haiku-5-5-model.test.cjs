const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ai = require("ai");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const ladder = load(path.join(root, "src/lib/systemModelLadder.ts"));
const pricing = load(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"));
const composer = load(path.join(root, "src/app/api/android/ai/composer/config.ts"));
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const option = catalog.getAiModelOptionById("claude-haiku-5-5");

function moduleWithStubs(relativePath, stubs, extra = "") {
  const filename = path.join(root, relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code + extra, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => stubs[id] ?? require(id),
    process, performance, setTimeout, clearTimeout, ReadableStream, console,
  }, { filename });
  return loadedModule.exports;
}

function harness({ enabled = true, flagError = false, userId = 985, input = 100, output = 20, anthropicFactory } = {}) {
  const rows = [], pending = [], calls = [], checks = [];
  const usage = { inputTokens: { total: input }, outputTokens: { total: output } };
  const result = { content: [], usage, finishReason: { unified: "stop" } };
  const factory = (provider) => (modelId) => ({
    specificationVersion: "v4", provider, modelId, supportedUrls: {},
    doGenerate: async (params) => { calls.push(params); return result; },
    doStream: async (params) => {
      calls.push(params);
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "finish", usage, finishReason: { unified: "stop" } });
        controller.close();
      } }) };
    },
  });
  const api = moduleWithStubs("src/app/api/ai/_lib/modelProvider.ts", {
    "@vercel/functions": { waitUntil: (promise) => pending.push(promise) },
    "./aiUsage": { logAiUsage: async (row) => rows.push(row) },
    "@/lib/ai/prompts/registry": { identifyPrompt: () => ({ promptId: "fixture", promptVersion: "1" }) },
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => {} },
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@ai-sdk/anthropic": { createAnthropic: anthropicFactory ?? (() => Object.assign(factory("anthropic"), { tools: {} })) },
    "@ai-sdk/openai": { createOpenAI: () => Object.assign(factory("openai"), { chat: factory("openai"), tools: {} }) },
    "@openrouter/ai-sdk-provider": { createOpenRouter: () => factory("openrouter") },
    ai: { ...ai, createGateway: () => factory("gateway") },
    "@/app/api/ai/_lib/sharedAllowance": pricing,
    "@/lib/aiModelOptions": catalog,
    "@/lib/aiProviders": load(path.join(root, "src/lib/aiProviders.ts")),
    "@/lib/flags/keys": keys,
    "@/lib/flags": { isFeatureEnabled: async (key, id) => {
      checks.push([key, id]);
      if (flagError) throw new Error("flag read failed");
      return enabled;
    } },
    "@/lib/aiAllowancePolicy": { FREE_TEAM_AI_ALLOWANCE_USD: 1, PAID_TEAM_AI_ALLOWANCE_USD: 5 },
    "@/lib/aiUsageClassification": { isSystemAiFeature: () => false, INCLUDED_WITH_HYPERTASK_GATEWAY_TAG: "system" },
    "@/lib/ai/customEndpoint": { isCustomEndpointConfig: () => false },
  });
  const makeModel = (provider = "claude", modelId = option.directModel, credential = "fixture-direct") => {
    const model = api.resolveAiModel(provider, modelId, credential);
    api.configureAiModelUsage(model, { userId, feature: "chat" });
    return model;
  };
  return { api, rows, calls, checks, makeModel, flush: async () => Promise.all(pending.splice(0)) };
}

const params = { prompt: [], temperature: 0.2, topP: 0.7, topK: 3 };

test("Haiku 5.5 is adjacent to 4.5, tier 1, adaptive medium, with gateway and direct ids", () => {
  assert.ok(option);
  assert.equal(option.source, "claude");
  assert.equal(option.model, "claude-haiku-5.5");
  assert.equal(option.directModel, "claude-haiku-5-5");
  assert.equal(catalog.aiModelOptions.indexOf(option), catalog.aiModelOptions.findIndex((entry) => entry.id === "claude-haiku-4.5") + 1);
  assert.equal(catalog.getAiModelDefinition(option.modelKey).priceTier, 1);
  assert.equal(catalog.getAiModelDefinition(option.modelKey).provider, "anthropic");
  assert.equal(catalog.isPremiumAiModelKey(option.modelKey), false);
  assert.equal(option.providerOptions.anthropic.thinking.type, "adaptive");
  assert.equal(option.providerOptions.anthropic.effort, "medium");
});

test("web, settings and agent pickers use the flag filter; Android hides it while off", () => {
  for (const file of [
    "src/components/Global/ModelSelectorDropdown.tsx",
    "src/components/Modals/Settings/AiFeaturesSection.tsx",
    "src/app/agents/[agentId]/AgentConfigForm.tsx",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /useFlag\(HTPR_7010_HAIKU_5_5_FLAG\)/);
    assert.match(source, /isAiModelOptionVisible\(option, false\)/);
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let visibilityExpression;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === "visibleModelOptions") {
        visibilityExpression = node.initializer.getText(sourceFile);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    assert.ok(visibilityExpression, `${file} gates its model list explicitly`);
    for (const haiku55Enabled of [false, true]) {
      const visible = vm.runInNewContext(visibilityExpression, {
        haiku55Enabled,
        aiModelOptions: catalog.aiModelOptions,
        isAiModelOptionVisible: catalog.isAiModelOptionVisible,
      });
      assert.deepEqual(visible, catalog.aiModelOptions.filter((entry) => catalog.isAiModelOptionVisible(entry, haiku55Enabled)));
    }
  }
  assert.equal(catalog.isAiModelOptionVisible(option, false), false);
  assert.equal(catalog.isAiModelOptionVisible(option, true), true);
  assert.equal(catalog.isAiModelOptionVisible(catalog.getAiModelOptionById("claude-haiku-4.5"), false), true);
  const input = { settings: {}, customEndpointConfigured: false, storePlanId: "Free", providersWithByok: new Set() };
  const off = composer.buildComposerConfig(input);
  const on = composer.buildComposerConfig({ ...input, haiku55Enabled: true });
  assert.equal(off.models.some((entry) => entry.id === option.id), false);
  assert.equal(on.models.some((entry) => entry.id === option.id), true);
  assert.equal(on.selectedModelId, off.selectedModelId);
  const mentions = fs.readFileSync(path.join(root, "src/utils/controllers/tasks/taskSearchByParam.ts"), "utf8");
  assert.match(mentions, /model.key !== "claude-haiku-5-5" \|\| haiku55Enabled/);
});

test("server rejects both inference methods, gateway and direct/raw ids when flag is off", async () => {
  for (const [provider, id, credential] of [
    ["claude", option.directModel, "fixture-direct"],
    ["claude", option.model, "vck_fixture"],
    ["gateway", `anthropic/${option.model}`, "vck_fixture"],
    ["openrouter", `anthropic/${option.model}`, "fixture-direct"],
  ]) {
    for (const method of ["doGenerate", "doStream"]) {
      const h = harness({ enabled: false });
      await assert.rejects(h.makeModel(provider, id, credential)[method](params), /model is unavailable/);
      assert.equal(h.calls.length, 0);
      assert.deepEqual(h.checks, [["htpr-7010-haiku-5-5", 985]]);
    }
  }
});

test("missing user or failed flag evaluation fails closed, without altering older models", async () => {
  for (const setup of [{ userId: null }, { flagError: true }]) {
    const h = harness(setup);
    await assert.rejects(h.makeModel().doGenerate(params), /model is unavailable/);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ enabled: false });
  await h.makeModel("claude", "claude-haiku-4.5").doGenerate(params);
  assert.equal(h.calls[0].temperature, 0.2);
  assert.equal(h.checks.length, 0);
  await h.flush();
});

test("allowed direct and gateway inference strips all sampling settings for generate and stream", async () => {
  for (const credential of ["fixture-direct", "vck_fixture"]) {
    for (const method of ["doGenerate", "doStream"]) {
      const h = harness();
      const model = h.makeModel("claude", credential.startsWith("vck_") ? option.model : option.directModel, credential);
      assert.equal(model.modelId, credential.startsWith("vck_") ? `anthropic/${option.model}` : option.directModel);
      h.api.providerOptionsForAiModel(model, "chat", { userId: 985 }, option);
      const result = await model[method](params);
      if (result.stream) for await (const chunk of result.stream) assert.equal(chunk.type, "finish");
      assert.equal(h.calls.length, 1);
      for (const key of ["temperature", "topP", "topK"]) assert.equal(key in h.calls[0], false);
      assert.equal(h.calls[0].providerOptions.anthropic.thinking.type, "adaptive");
      assert.equal(h.calls[0].providerOptions.anthropic.effort, "medium");
      await h.flush();
      assert.equal(h.rows[0].totalTokens, 120);
      assert.ok(Math.abs(h.rows[0].costUsd - 0.00002) < 1e-12);
    }
  }
});

test("real Anthropic SDK transport sends the direct id, adaptive medium and no sampling fields", async () => {
  let body;
  const { createAnthropic } = require("@ai-sdk/anthropic");
  const h = harness({ anthropicFactory: (config) => createAnthropic({
    ...config,
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: "msg_fixture", type: "message", role: "assistant", model: option.directModel,
        content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { headers: { "content-type": "application/json" } });
    },
  }) });
  await h.makeModel().doGenerate({
    ...params, maxOutputTokens: 64,
    prompt: [{ role: "user", content: [{ type: "text", text: "fixture" }] }],
  });
  assert.equal(body.model, "claude-haiku-5-5");
  for (const key of ["temperature", "top_p", "top_k"]) assert.equal(key in body, false);
  assert.equal(body.thinking.type, "adaptive");
  assert.equal(body.output_config.effort, "medium");
  await h.flush();
  assert.equal(h.rows[0].totalTokens, 120);
});

test("editor and chat selectors preserve Haiku ids and omit temperature", () => {
  const h = harness();
  const selectorStubs = {
    "@/lib/aiModelOptions": catalog,
    "@/lib/systemModelLadder": ladder,
    "@/app/api/ai/_lib/modelProvider": h.api,
    "@/app/api/ai/_lib/providerGate": {},
    "@/lib/ai/chatStream/prompt": { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES: ["claude-opus", "claude-sonnet-5", "claude-haiku-5"] },
    "@/lib/ai/tools/constants": load(path.join(root, "src/lib/ai/tools/constants.ts")),
    "@/lib/ai/chatStream/types": {},
  };
  const chat = moduleWithStubs("src/lib/ai/chatStream/models.ts", selectorStubs);
  const editor = moduleWithStubs("src/app/api/ai/_lib/editorAi.ts", {
    ...selectorStubs,
    "./editorAiPrompts": {}, "next/headers": {}, ai,
    "@ai-sdk/anthropic": { createAnthropic: () => ({ tools: {} }) },
    "@ai-sdk/openai": { createOpenAI: () => ({ tools: {} }) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
    "@/app/api/ai/_lib/customInstructions": {},
    "@/app/api/ai/_lib/byokKeys": {}, "@/app/api/ai/_lib/sharedAllowance": pricing,
    "@/app/api/ai/chat/stream/modelFallback": {},
    "@/lib/aiModelPreferences": {}, "@/app/api/ai/_lib/planGate": {},
    "@/app/api/ai/_lib/taskWriterPrompt": {}, "@/app/api/ai/_lib/taskWriterBoardResearch": {},
    "@/lib/prisma": {},
  });
  for (const credential of ["fixture-direct", "vck_fixture"]) {
    const selectedChat = chat.selectModel("claude", option.model, credential, option);
    const selectedEditor = editor.selectEditorModel("claude", option.model, credential, { modelOption: option });
    for (const selected of [selectedChat, selectedEditor]) {
      assert.equal(selected.model.modelId, credential.startsWith("vck_") ? `anthropic/${option.model}` : option.directModel);
      assert.equal("temperature" in selected.settings, false);
    }
  }
});

test("both price tiers apply to total request tokens, including the exact boundary and reservations", async () => {
  for (const slug of [option.directModel, `anthropic/${option.model}`]) {
    const rates = await pricing.modelPricing(slug);
    assert.equal(rates.inputUsdPerToken, 0.10 / 1_000_000);
    assert.equal(rates.outputUsdPerToken, 0.50 / 1_000_000);
    assert.ok(Math.abs(pricing.modelCostUsd(rates, 90_000, 10_000) - 0.014) < 1e-12);
    assert.ok(Math.abs(pricing.modelCostUsd(rates, 90_000, 10_001) - 0.0700025) < 1e-12);
    const prompt = "x".repeat(100_000);
    const estimatedInput = Buffer.byteLength(JSON.stringify(prompt));
    const expected = Math.ceil((pricing.modelCostUsd(rates, estimatedInput, 1) * 1.5 + 0.01) * 1_000_000);
    assert.equal(pricing.estimateReservationMicroUsd({ pricing: rates, prompt, maxOutputTokens: 1 }), expected);
  }
  const source = fs.readFileSync(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"), "utf8");
  assert.match(source, /const actualUsd = modelCostUsd\(pricing, inputTokens, outputTokens\)/);
  const h = harness({ input: 90_000, output: 10_001 });
  await h.makeModel().doGenerate(params);
  await h.flush();
  assert.ok(Math.abs(h.rows[0].costUsd - 0.0700025) < 1e-12);
});

test("plan defaults, automatic replacements, fast ladder and stream fallbacks remain unchanged", () => {
  assert.equal(catalog.defaultAiModelOption.id, "gemini-3.5-flash-lite");
  assert.equal(catalog.preferredAiModelOption.id, "gpt-6-luna");
  for (const plan of ["Free", "Pro", "AI", "BYOK", null]) {
    const expected = plan === "Pro" || plan === "AI" ? "gpt-6-luna" : "gemini-3.5-flash-lite";
    assert.equal(catalog.getDefaultAiModelOptionForPlan(plan).id, expected);
  }
  assert.equal(catalog.getDefaultAiModelOptionForPlan("BYOK", true).id, "gpt-6-luna");
  assert.equal(catalog.getDefaultAiModelOptionForPlan("Free", false, true).id, "gpt-6-luna");
  assert.deepEqual(ladder.SYSTEM_MODEL_LADDERS.fast.map((entry) => entry.model), [
    "google/gemini-3.5-flash-lite", "openai/gpt-6-luna", "anthropic/claude-haiku-4.5",
    "deepseek/deepseek-v4.1-flash", "moonshotai/kimi-k2.5", "alibaba/qwen3.7-plus", "zai/glm-5.3-flash",
  ]);
  assert.equal(ladder.resolveUserFacingModelOption("aiChat", {}).id, "gemini-3.5-flash-lite");
  assert.equal(ladder.resolveUserFacingModelOption("aiChat", {}, option.id).id, option.id);
  const anthropic = catalog.aiModelOptions.filter((entry) => catalog.getAiModelDefinition(entry.modelKey).provider === "anthropic");
  assert.equal(catalog.pickAutoAiModelOption(anthropic).id, "claude-haiku-4.5");
  assert.equal(catalog.pickReplacementAiModelOption("claude-haiku-4.5", anthropic).id, "claude-haiku-4.5");
  const fallback = load(path.join(root, "src/app/api/ai/chat/stream/modelFallback.ts"));
  assert.equal(fallback.previousModelForFailedStream(option.model, { status: 404 }, false, false), null);
});
