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
    process, performance, setTimeout, clearTimeout, ReadableStream, Response, console,
  }, { filename });
  return loadedModule.exports;
}

function harness({ enabled = true, flagError = false, userId = 985, input = 100, output = 20, anthropicFactory, unavailableHaiku = false, unavailableStatus = 404 } = {}) {
  const rows = [], pending = [], calls = [], checks = [];
  const usage = { inputTokens: { total: input }, outputTokens: { total: output } };
  const result = { content: [], usage, finishReason: { unified: "stop" } };
  const factory = (provider) => (modelId) => ({
    specificationVersion: "v4", provider, modelId, supportedUrls: {},
    doGenerate: async (params) => {
      calls.push({ ...params, requestedModelId: modelId });
      if (unavailableHaiku && catalog.isHaiku55Model(modelId)) throw Object.assign(new Error("model unavailable"), { status: unavailableStatus });
      return result;
    },
    doStream: async (params) => {
      calls.push({ ...params, requestedModelId: modelId });
      if (unavailableHaiku && catalog.isHaiku55Model(modelId)) throw Object.assign(new Error("model unavailable"), { status: unavailableStatus });
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
    "@/lib/ai/customEndpoint": load(path.join(root, "src/lib/ai/customEndpoint.ts")),
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
    assert.match(source, /useFlag\(\s*HTPR_7010_HAIKU_5_5_FLAG\s*,?\s*\)/);
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
  assert.equal(on.selectedModelId, input.storePlanId === "Free" ? (input.lunaFree ? "gpt-6-luna" : "gemini-3.5-flash-lite") : "claude-haiku-5-5");
  assert.equal(on.models.some((entry) => entry.id === "claude-haiku-4.5"), false);
  const mentions = fs.readFileSync(path.join(root, "src/utils/controllers/tasks/taskSearchByParam.ts"), "utf8");
  assert.match(mentions, /haiku55Enabled\s*\? model.key !== "claude-haiku-4.5"\s*: model.key !== "claude-haiku-5-5"/);
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
  assert.deepEqual(h.checks, [["htpr-7010-haiku-5-5", 985]]);
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
    "@/lib/aiProviders": load(path.join(root, "src/lib/aiProviders.ts")),
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


test("server upgrades every saved/raw Haiku 4.5 spelling for generate and stream, including BYOK", async () => {
  for (const [provider, id, credential] of [
    ["claude", "claude-haiku-4.5", "fixture-direct"],
    ["claude", "claude-haiku-4-5", "fixture-direct"],
    ["claude", "anthropic/claude-haiku-4.5", "fixture-direct"],
    ["claude", "claude-haiku-4-5-20251001", "fixture-direct"],
    ["claude", "claude-haiku-4.5", "vck_fixture"],
    ["gateway", "anthropic/claude-haiku-4.5", "vck_fixture"],
    ["openrouter", "anthropic/claude-haiku-4.5", "fixture-direct"],
  ]) {
    for (const method of ["doGenerate", "doStream"]) {
      for (const enabled of [false, true]) {
        const h = harness({ enabled });
        const result = await h.makeModel(provider, id, credential)[method](params);
        if (result.stream) for await (const chunk of result.stream) assert.equal(chunk.type, "finish");
        assert.equal(h.calls.length, 1);
        assert.equal(catalog.isHaiku55Model(h.calls[0].requestedModelId), enabled);
        assert.equal("temperature" in h.calls[0], !enabled);
        await h.flush();
        assert.equal(catalog.isHaiku55Model(h.rows[0].model), enabled);
        if (enabled) assert.ok(Math.abs(h.rows[0].costUsd - 0.00002) < 1e-12);
      }
    }
  }
});

test("Haiku 4.5 is untouched without a user or when its flag lookup fails", async () => {
  for (const setup of [{ userId: null }, { flagError: true }]) {
    const h = harness(setup);
    await h.makeModel("claude", "claude-haiku-4.5").doGenerate(params);
    assert.equal(h.calls[0].requestedModelId, "claude-haiku-4.5");
    assert.equal(h.calls[0].temperature, 0.2);
    await h.flush();
  }
});

test("gateway-only system model requests upgrade using the attached user context", async () => {
  for (const enabled of [false, true]) {
    const h = harness({ enabled });
    const model = h.api.resolveGatewayModel("anthropic/claude-haiku-4.5", "vck_fixture");
    h.api.configureAiModelUsage(model, { userId: 985, feature: "summary" });
    await model.doGenerate(params);
    assert.equal(catalog.isHaiku55Model(h.calls[0].requestedModelId), enabled);
    await h.flush();
  }
});

test("chat and editor selection resolve saved personal, team and agent Haiku picks before credential lookup", () => {
  const h = harness();
  const providerGate = { filterModelOptionForTeam: (entry) => entry };
  const stubs = {
    "@/lib/aiModelOptions": catalog, "@/lib/systemModelLadder": ladder,
    "@/app/api/ai/_lib/providerGate": providerGate,
    "@/lib/aiProviders": load(path.join(root, "src/lib/aiProviders.ts")),
    "@/app/api/ai/_lib/modelProvider": h.api,
    "@/lib/ai/chatStream/prompt": { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES: ["claude-haiku-5"] },
    "@/lib/ai/tools/constants": load(path.join(root, "src/lib/ai/tools/constants.ts")),
    "@/lib/ai/chatStream/types": {},
  };
  const chat = moduleWithStubs("src/lib/ai/chatStream/models.ts", stubs);
  const editor = moduleWithStubs("src/app/api/ai/_lib/editorAi.ts", {
    ...stubs, "./editorAiPrompts": {}, "next/headers": {}, ai,
    "@ai-sdk/anthropic": { createAnthropic: () => ({ tools: {} }) },
    "@ai-sdk/openai": { createOpenAI: () => ({ tools: {} }) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
    "@/app/api/ai/_lib/customInstructions": {}, "@/app/api/ai/_lib/byokKeys": {},
    "@/app/api/ai/_lib/sharedAllowance": pricing, "@/app/api/ai/chat/stream/modelFallback": {},
    "@/lib/aiModelPreferences": {}, "@/app/api/ai/_lib/planGate": {},
    "@/app/api/ai/_lib/taskWriterPrompt": {}, "@/app/api/ai/_lib/taskWriterBoardResearch": {}, "@/lib/prisma": {},
  });
  for (const api of [chat, editor]) {
    assert.equal(api.defaultModelSelection({}, "aiChat", "claude-haiku-4.5", true, option).modelOption.id, option.id);
    assert.equal(api.defaultModelSelection({ featureModels: { aiChat: "claude-haiku-4.5" } }, "aiChat", null, true, option).modelOption.id, option.id);
    assert.equal(api.defaultModelSelection({}, "aiChat", "claude-haiku-4.5", true, catalog.preferredAiModelOption).modelOption.id, "claude-haiku-4.5");
  }
  for (const raw of ["claude-haiku-4.5", "claude-haiku-4-5", "anthropic/claude-haiku-4.5"]) {
    assert.equal(chat.resolveModelSelection("claude", raw, raw, {}, "aiChat", null, option).modelOption.id, option.id);
  }
});


test("custom BYOK endpoints upgrade persisted Haiku model ids only with the flag on", async () => {
  for (const enabled of [false, true]) {
    const h = harness({ enabled });
    await h.makeModel("custom", "custom", { apiKey: "fixture", baseUrl: "https://example.test/v1", modelId: "claude-haiku-4-5" }).doGenerate(params);
    assert.equal(catalog.isHaiku55Model(h.calls[0].requestedModelId), enabled);
    await h.flush();
  }
});

function editorWithFallback(h, credentialPicks, enabled = true, credential = "fixture-direct", plan = "Pro", byokProvider = null) {
  return moduleWithStubs("src/app/api/ai/_lib/editorAi.ts", {
    "@/lib/aiModelOptions": catalog, "@/lib/systemModelLadder": ladder,
    "@/app/api/ai/_lib/modelProvider": h.api,
    "@/app/api/ai/_lib/providerGate": moduleWithStubs("src/app/api/ai/_lib/providerGate.ts", {
      "@/lib/prisma": {}, "@/lib/aiModelOptions": catalog,
      "@/lib/aiProviders": load(path.join(root, "src/lib/aiProviders.ts")),
      "@/utils/controllers/projects/getAllIncludes": {},
    }),
    "@/lib/aiProviders": load(path.join(root, "src/lib/aiProviders.ts")),
    "@/lib/aiModelPreferences": load(path.join(root, "src/lib/aiModelPreferences.ts")),
    "@/lib/prisma": { userSetting: { findUnique: async () => null } },
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => plan, lunaFreePlanEnabled: async () => true, haiku55ModelEnabled: async () => enabled, assertModelAllowedForPlan: async () => {} },
    "@/app/api/ai/_lib/byokKeys": {
      getAiDefaultModelContext: async () => ({ haiku55Enabled: enabled, plan, hasByok: Boolean(byokProvider), byok: enabled && byokProvider ? { provider: byokProvider, credential } : undefined }),
      getByokOrTeamGatewayApiKeyForModelOption: async (entry) => { credentialPicks.push(entry.id); return entry.id === "gpt-6-luna" && typeof credential === "object" ? "fixture-openai" : credential; },
      getByokOrTeamGatewayApiKeyForProvider: async (provider) => { credentialPicks.push(provider); return credential; },
    },
    "@/app/api/ai/chat/stream/modelFallback": load(path.join(root, "src/app/api/ai/chat/stream/modelFallback.ts")),
    "@/app/api/ai/_lib/sharedAllowance": pricing,
    "@ai-sdk/anthropic": { createAnthropic: () => ({ tools: { webSearch_20250305: () => ({}) } }) },
    "@ai-sdk/openai": { createOpenAI: () => ({ tools: { webSearch: () => ({}) } }) },
    "./editorAiPrompts": {}, "next/headers": {}, ai,
    "@/utils/controllers/turbopuffer/turbopufferHelper": {}, "@/app/api/ai/_lib/customInstructions": {},
    "@/app/api/ai/_lib/taskWriterPrompt": {}, "@/app/api/ai/_lib/taskWriterBoardResearch": {},
  });
}

test("editor request defaults to Haiku and its unavailable-model fallback resolves Luna's own BYOK credential", async () => {
  for (const method of ["doGenerate", "doStream"]) {
    const h = harness({ unavailableHaiku: true });
    const credentialPicks = [];
    const editor = editorWithFallback(h, credentialPicks);
    const selected = await editor.selectTaskWriterModel({ userId: 985, aiFeature: "taskWriter", teamContext: { teamId: "fixture-team", settings: {} } });
    assert.equal(selected.modelId, option.model);
    const result = await selected.model[method](params);
    if (result.stream) for await (const chunk of result.stream) assert.equal(chunk.type, "finish");
    assert.deepEqual(credentialPicks, ["claude-haiku-5-5", "gpt-6-luna"]);
    assert.equal(selected.modelId, "gpt-6-luna");
    assert.equal(selected.provider, "openai");
    assert.deepEqual(h.calls.map((call) => call.requestedModelId), ["claude-haiku-5-5", "gpt-6-luna"]);
    await h.flush();
    assert.equal(h.rows.find((row) => row.model === "gpt-6-luna").provider, "byok:openai");
  }
});

function chatWithFallback(h, { enabled = true, settings = {}, provider = "claude", modelId = option.model, credential = "fixture-direct" } = {}) {
  const credentialPicks = [], events = [];
  const selectors = moduleWithStubs("src/lib/ai/chatStream/models.ts", {
    "@/lib/aiModelOptions": catalog, "@/lib/systemModelLadder": ladder,
    "@/app/api/ai/_lib/providerGate": {}, "@/app/api/ai/_lib/modelProvider": h.api,
    "@/lib/ai/chatStream/prompt": { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES: ["claude-haiku-5"] },
    "@/lib/ai/tools/constants": load(path.join(root, "src/lib/ai/tools/constants.ts")),
  });
  const reply = moduleWithStubs("src/lib/ai/chatStream/modelReply.ts", {
    "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => enabled },
    "@/app/api/ai/_lib/byokKeys": { getByokOrTeamGatewayApiKeyForModelOption: async (entry) => { credentialPicks.push(entry.id); return "fixture-openai"; } },
    "@/app/api/ai/_lib/modelProvider": h.api, "@/lib/aiModelOptions": catalog,
    "@/lib/aiProviders": load(path.join(root, "src/lib/aiProviders.ts")),
    "@/app/api/ai/chat/stream/modelFallback": load(path.join(root, "src/app/api/ai/chat/stream/modelFallback.ts")),
    "@/lib/ai/chatStream/models": selectors,
    "@/lib/ai/chatStream/errors": { userFacingErrorMessage: (error) => error.message, userFacingErrorDetails: () => ({}), reportHandledChatError: async () => {} },
    "@/app/api/ai/_lib/heartbeatExecution": {}, "@/app/api/ai/chat/stream/bulkTools": { hasVisibleCompletion: (chunks) => chunks.length > 0 },
    "@/lib/ai/chatStream/types": {}, "@/lib/ai/tools/constants": { MAX_TOOL_STEPS: 1 },
    "@/lib/ai/chatStream/content": {}, "@/lib/ai/tools/metadata": {},
    ai: { stepCountIs: () => ({}), streamText: ({ model, onError }) => ({ textStream: (async function* () {
      try {
        const result = await model.doStream(params);
        for await (const chunk of result.stream) if (chunk.type === "finish") yield "ok";
      } catch (error) {
        await onError({ error });
        throw error;
      }
    })() }) },
  });
  const state = {
    dbUser: { id: 985 }, gatewayTags: { teamId: "fixture-team" },
    streamCredential: credential, streamModelOption: provider === "claude" ? option : undefined,
    body: {}, selected: { ...selectors.selectModel(provider, modelId, credential, provider === "claude" ? option : undefined), provider },
    providerAbort: new AbortController(), send: (...args) => events.push(args), finish: (...args) => events.push(args),
    recordTurnOutcome: () => {},
  };
  const route = moduleWithStubs("src/app/api/ai/chat/stream/route.ts", {
    "@/lib/ai/chatStream/turnModel": { loadTurnModel: async () => ({ ...state, teamProviderSettings: settings }) },
    "@/lib/ai/chatStream/stream": { createChatStream: (options) => {
      Object.assign(state, options);
      return reply.generateModelReply(state, { instructions: "fixture", messages: [], tools: {}, toolExecutions: [] });
    } },
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => state.dbUser },
    "@/app/api/ai/_lib/cronServiceAuth": {}, "@/lib/nativeAgent/heartbeatTurnEnvelope": {},
    "@/lib/prisma": { user: { findUnique: async () => state.dbUser } },
    "@/lib/flags": { isFeatureEnabled: async () => false }, "@/lib/flags/keys": keys,
    "@/app/api/ai/chat/stream/ensureNativeChatTurn": {},
    "@/app/api/ai/_lib/currentTaskContext": { resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/chat/stream/streamLease": { acquireAiChatStreamLease: async () => ({}) },
    "@/app/api/ai/_lib/heartbeatExecution": {}, "@/lib/ai/chatStream/errors": {},
    "@/lib/ai/chatStream/request": { chatRequestSchema: { parse: (body) => body } },
    "@/lib/ai/tools/constants": {},
  });
  return { state, credentialPicks, events, run: () => route.POST({ json: async () => ({ message: "fixture" }), headers: { get: () => null } }) };
}

test("chat fallback respects team provider settings before resolving credentials", async () => {
  const turnSource = fs.readFileSync(path.join(root, "src/lib/ai/chatStream/turnModel.ts"), "utf8");
  assert.match(turnSource, /teamProviderSettings = chatTeamContext\?\.aiProviderSettings/);
  assert.match(turnSource, /return \{[^}]*\bteamProviderSettings\b[^}]*\}/);
  for (const openai of [false, true, undefined]) {
    for (const credential of ["fixture-direct", "vck_fixture"]) {
      for (const unavailableStatus of [403, 404]) {
        const h = harness({ unavailableHaiku: true, unavailableStatus });
        const chat = chatWithFallback(h, { settings: { providers: { openai } }, credential });
        if (openai === false) {
          await assert.rejects(chat.run(), /model unavailable/);
          assert.equal(h.calls.length, 1);
          assert.equal(chat.credentialPicks.length, 0);
          assert.ok(chat.events.some(([type]) => type === "error"));
        } else {
          await chat.run();
          assert.equal(chat.state.selected.resolvedModelId, "gpt-6-luna");
          assert.equal(h.calls.length, 2);
          assert.deepEqual(chat.credentialPicks, credential.startsWith("vck_") ? [] : ["gpt-6-luna"]);
        }
        await h.flush();
      }
    }
  }
});

test("editor fallback respects team provider settings before resolving credentials", async () => {
  for (const openai of [false, true, undefined]) {
    for (const credential of ["fixture-direct", "vck_fixture"]) {
      for (const method of ["doGenerate", "doStream"]) {
        const h = harness({ unavailableHaiku: true });
        const credentialPicks = [];
        const editor = editorWithFallback(h, credentialPicks, true, credential);
        const selected = await editor.selectTaskWriterModel({ userId: 985, aiFeature: "taskWriter", teamContext: { teamId: "fixture-team", settings: { providers: { openai } } } });
        if (openai === false) {
          await assert.rejects(selected.model[method](params), /model unavailable/);
          assert.equal(h.calls.length, 1);
          assert.deepEqual(credentialPicks, [option.id]);
        } else {
          const result = await selected.model[method](params);
          if (result.stream) for await (const chunk of result.stream) assert.equal(chunk.type, "finish");
          assert.equal(selected.modelId, "gpt-6-luna");
          assert.equal(h.calls.length, 2);
        }
        await h.flush();
      }
    }
  }
});

test("legacy raw effective model drives chat and editor fallback for OpenRouter and custom endpoints", async () => {
  for (const provider of ["openrouter", "custom"]) {
    for (const modelId of ["anthropic/claude-haiku-4.5", "claude-haiku-4-5-20251001"]) {
      for (const enabled of [false, true]) {
        for (const openai of [false, true]) {
          for (const unavailableStatus of [403, 404]) {
            const credential = provider === "custom" ? { apiKey: "fixture", baseUrl: "https://example.test/v1", modelId } : "fixture-direct";
            const settings = { providers: { openai } };
            const h = harness({ enabled, unavailableHaiku: true, unavailableStatus });
            const chat = chatWithFallback(h, { enabled, provider, modelId, credential, settings });
            if (enabled && !openai) await assert.rejects(chat.run(), /model unavailable/);
            else await chat.run();
            assert.equal(h.calls.length, enabled && openai ? 2 : 1);
            assert.equal(chat.credentialPicks.length, enabled && openai ? 1 : 0);
            await h.flush();
            for (const method of ["doGenerate", "doStream"]) {
              const eh = harness({ enabled, unavailableHaiku: true, unavailableStatus });
              const credentialPicks = [];
              const editor = editorWithFallback(eh, credentialPicks, enabled, credential);
              const selected = await editor.selectTaskWriterModel({ userId: 985, sourceSelected: provider, modelSelected: provider === "custom" ? "custom" : modelId, teamContext: { teamId: "fixture-team", settings } });
              eh.api.configureAiModelUsage(selected.model, { userId: 985, feature: "task-writer" });
              if (enabled && !openai) await assert.rejects(selected.model[method](params), /model unavailable/);
              else {
                const result = await selected.model[method](params);
                if (result.stream) for await (const chunk of result.stream) assert.equal(chunk.type, "finish");
              }
              assert.equal(eh.calls.length, enabled && openai ? 2 : 1);
              assert.equal(credentialPicks.includes("gpt-6-luna"), enabled && openai);
              await eh.flush();
            }
          }
        }
      }
    }
  }
});

test("editor request plan-aware defaults route paid and Free BYOK to Haiku and retain Free Luna", async () => {
  for (const enabled of [false, true]) {
    for (const plan of ["Free", "Pro", "AI", "BYOK"]) {
      for (const provider of [null, "claude", "gateway", "openrouter"]) {
        const h = harness({ enabled });
        const credentialPicks = [];
        const credential = provider === "gateway" ? "vck_fixture" : "fixture-direct";
        const editor = editorWithFallback(h, credentialPicks, enabled, credential, plan, provider);
        const selected = await editor.selectTaskWriterModel({ userId: 985, aiFeature: "taskWriter", teamContext: { teamId: "fixture-team", settings: {} } });
        const useHaiku = enabled && (plan !== "Free" || provider);
        assert.equal(catalog.isHaiku55Model(selected.modelId), Boolean(useHaiku));
        if (!useHaiku) assert.equal(selected.modelId, "gpt-6-luna");
        if (useHaiku && provider === "openrouter") assert.equal(selected.provider, "openrouter");
        await selected.model.doGenerate(params);
        assert.equal(catalog.isHaiku55Model(h.calls[0].requestedModelId), Boolean(useHaiku));
        await h.flush();
      }
    }
  }
});

test("chat default sites use plan-aware server context and upgrade saved Haiku on Free too", async () => {
  for (const enabled of [false, true]) {
    for (const plan of ["Free", "Pro", "AI", "BYOK"]) {
      for (const provider of [null, "claude", "gateway", "openrouter"]) {
        const h = harness({ enabled });
        const credential = provider === "gateway" ? "vck_fixture" : "fixture-direct";
        const selectors = moduleWithStubs("src/lib/ai/chatStream/models.ts", {
          "@/lib/aiModelOptions": catalog, "@/lib/systemModelLadder": ladder,
          "@/app/api/ai/_lib/providerGate": { filterModelOptionForTeam: (entry) => entry },
          "@/app/api/ai/_lib/modelProvider": h.api,
          "@/lib/ai/chatStream/prompt": { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES: ["claude-haiku-5"] },
          "@/lib/ai/tools/constants": load(path.join(root, "src/lib/ai/tools/constants.ts")),
        });
        const chat = moduleWithStubs("src/lib/ai/chatStream/turnModel.ts", {
          "next/server": {}, "@/lib/prisma": { userSetting: { findUnique: async () => null } },
          "@/lib/aiModelOptions": catalog, "@/lib/systemModelLadder": ladder,
          "@/lib/aiModelPreferences": load(path.join(root, "src/lib/aiModelPreferences.ts")),
          "@/app/api/ai/_lib/modelProvider": h.api,
          "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => plan, haiku55ModelEnabled: async () => enabled, lunaFreePlanEnabled: async () => true, assertModelAllowedForPlan: async () => {} },
          "@/app/api/ai/_lib/byokKeys": {
            getAiDefaultModelContext: async () => ({ haiku55Enabled: enabled, plan, hasByok: Boolean(provider), byok: enabled && provider ? { provider, credential } : undefined }),
            getByokOrTeamGatewayApiKeyForModelOption: async () => credential,
            getByokOrTeamGatewayApiKeyForProvider: async () => credential,
          },
          "@/app/api/ai/_lib/chatTeamContext": {
            resolveChatTeamContext: async () => ({ teamId: "fixture-team", projectId: 15, aiProviderSettings: {} }),
            buildChatProviderContext: () => ({ planGateProjectId: 15, keyLookupContext: { trustedTeamId: "fixture-team", userId: 985 } }),
          },
          "@/lib/nativeAgent/modelPin": load(path.join(root, "src/lib/nativeAgent/modelPin.ts")),
          "@/app/api/ai/_lib/providerGate": { filterModelOptionForTeam: (entry) => entry },
          "@/lib/ai/chatStream/errors": { reportHandledChatError: async () => {}, errorMessage: (error) => error.message, createSseErrorResponse: (error) => { throw new Error(error); } },
          "@/lib/ai/tools/helpers": { loadActingAgent: async () => null },
          "@/lib/ai/chatStream/models": selectors,
        });
        const turn = await chat.loadTurnModel({ aiFeature: "aiChat" }, { id: 985 });
        const useHaiku = enabled && (plan !== "Free" || provider);
        assert.equal(catalog.isHaiku55Model(turn.selected.modelId), Boolean(useHaiku));
        if (!useHaiku) assert.equal(turn.selected.modelId, "gpt-6-luna");
        if (useHaiku && provider === "openrouter") assert.equal(turn.selected.provider, "openrouter");
        const savedTurn = await chat.loadTurnModel({ aiFeature: "aiChat", modelOptionId: "claude-haiku-4.5" }, { id: 985 });
        assert.equal(catalog.isHaiku55Model(savedTurn.selected.modelId), enabled);
        await h.flush();
      }
    }
  }
});
