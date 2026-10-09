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
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const providers = load(path.join(root, "src/lib/aiProviders.ts"));
const fallback = load(path.join(root, "src/app/api/ai/chat/stream/modelFallback.ts"));
const composer = load(path.join(root, "src/app/api/android/ai/composer/config.ts"));
const policy = load(path.join(root, "src/lib/aiAllowancePolicy.ts"));

function moduleWithStubs(file, stubs, extra = "") {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code + extra, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => stubs[id] ?? (id.startsWith("@/") || id.startsWith("./") ? {} : require(id)),
    process: { env: { AI_GATEWAY_API_KEY: "vck_fixture" } },
    performance, setTimeout, clearTimeout, ReadableStream, Response, console,
  }, { filename });
  return loadedModule.exports;
}

function harness(enabled, plan = "Free", legacyHaiku = false) {
  const checks = [], calls = [], reservations = [];
  const flags = { isFeatureEnabled: async (key, id) => {
    checks.push([key, id]);
    return key === keys.HTPR_7038_HAIKU_DEFAULT_FLAG ? enabled
      : key === keys.HTPR_7010_HAIKU_5_5_FLAG ? legacyHaiku : false;
  } };
  const gate = moduleWithStubs("src/app/api/ai/_lib/planGate.ts", {
    "@/lib/flags": flags, "@/lib/flags/keys": keys,
    "@/lib/aiModelOptions": catalog,
    "@/lib/prisma": { __esModule: true, default: { team: { findUnique: async () => ({ subscriptionPlan: [{ priceId: plan, subscriptionStatus: "active" }] }) } } },
    "@/lib/internalCompTeams": { isInternalCompTeam: () => false },
    "@/lib/teamComp": { applyTeamComp: (_team, value) => value },
    "@/lib/subscriptionAccess": { pickEntitlingSubscriptionRow: (rows) => rows[0], subscriptionStatusGrantsAccess: () => true },
    "@/lib/planFromStripePriceId": { planKindFromStripePriceId: (priceId) => ({ storePlanId: priceId }) },
  });
  const factory = (provider) => (modelId) => ({
    specificationVersion: "v4", provider, modelId, supportedUrls: {},
    doGenerate: async (params) => {
      calls.push({ modelId, params });
      return { content: [{ type: "text", text: "[]" }], usage: { inputTokens: { total: 10 }, outputTokens: { total: 2 } }, finishReason: { unified: "stop" } };
    },
  });
  const modelApi = moduleWithStubs("src/app/api/ai/_lib/modelProvider.ts", {
    "@/lib/flags": flags, "@/lib/flags/keys": keys,
    "@/lib/aiModelOptions": catalog, "@/lib/aiProviders": providers,
    "@vercel/functions": { waitUntil: () => {} },
    "./aiUsage": { logAiUsage: async () => {} },
    "@/lib/ai/prompts/registry": { identifyPrompt: () => ({ promptId: "fixture", promptVersion: "1" }) },
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => {} },
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@ai-sdk/anthropic": { createAnthropic: () => Object.assign(factory("anthropic"), { tools: {} }) },
    "@ai-sdk/openai": { createOpenAI: () => Object.assign(factory("openai"), { tools: {} }) },
    "@openrouter/ai-sdk-provider": { createOpenRouter: () => factory("openrouter") },
    ai: { ...ai, createGateway: () => factory("gateway") },
    "@/lib/aiAllowancePolicy": policy,
    "@/lib/aiUsageClassification": load(path.join(root, "src/lib/aiUsageClassification.ts")),
    "@/lib/ai/customEndpoint": load(path.join(root, "src/lib/ai/customEndpoint.ts")),
    "@/app/api/ai/_lib/sharedAllowance": {
      gatewayCatalogModelSlug: (id) => catalog.isHaiku55Model(id) ? "anthropic/claude-haiku-5.5" : id,
      createSharedAllowanceMiddleware: (args) => {
        reservations.push({ allowanceUsd: args.allowanceUsd, modelSlug: args.modelSlug });
        return { specificationVersion: "v4" };
      },
    },
  });
  const byok = moduleWithStubs("src/app/api/ai/_lib/byokKeys.ts", {
    ai, "@/lib/prisma": { __esModule: true, default: { teamByokApiKey: { findUnique: async () => null } } },
    "@/lib/aiModelOptions": catalog, "@/lib/aiProviders": providers,
    "@/app/api/ai/_lib/modelProvider": modelApi,
    "@/app/api/ai/_lib/planGate": { ...gate, storePlanIdForProject: async () => plan },
    "@/app/api/ai/chat/stream/modelFallback": fallback,
  });
  return { gate, byok, modelApi, checks, calls, reservations };
}

async function main() {
  for (const enabled of [false, true]) {
    for (const plan of ["Free", "Pro", "AI", "BYOK"]) {
      const h = harness(enabled, plan);
      const context = await h.byok.getAiDefaultModelContext({ trustedTeamId: "fixture-team", userId: 7 });
      assert.equal(context.haikuDefaultEnabled, enabled);
      assert.equal(context.haiku55Enabled, enabled);
      const option = catalog.getDefaultAiModelOptionForPlan(plan, false, true, context.haiku55Enabled, context.haikuDefaultEnabled);
      assert.equal(option.id, enabled ? "claude-haiku-5-5" : plan === "BYOK" ? "gemini-3.5-flash-lite" : "gpt-6-luna");
      assert.equal(catalog.resolveAiModelOption(["gpt-6-luna"], option, context.haiku55Enabled).id, "gpt-6-luna");
      if (enabled) {
        assert.equal(await h.gate.lunaFreePlanEnabled(7), true);
        await h.gate.assertModelAllowedForPlan(null, option, null);
        const mobile = composer.buildComposerConfig({ settings: {}, customEndpointConfigured: false, storePlanId: plan, providersWithByok: new Set(), haiku55Enabled: true, haikuDefaultEnabled: true, lunaFree: true });
        assert.equal(mobile.selectedModelId, "claude-haiku-5-5");
        assert.ok(mobile.models.some((model) => model.id === "gpt-6-luna") || plan === "BYOK");
        assert.ok(catalog.isAiModelOptionVisible(option, context.haiku55Enabled));
      }
      let storedPreference = null;
      const editor = moduleWithStubs("src/app/api/ai/_lib/editorAi.ts", {
        "@/lib/aiModelOptions": catalog, "@/lib/aiProviders": providers,
        "@/lib/systemModelLadder": ladder,
        "@/lib/aiModelPreferences": load(path.join(root, "src/lib/aiModelPreferences.ts")),
        "@/lib/prisma": { __esModule: true, default: { userSetting: { findUnique: async () => ({ aiModelPreferences: storedPreference }) } } },
        "@/app/api/ai/_lib/planGate": { ...h.gate, storePlanIdForProject: async () => plan },
        "@/app/api/ai/_lib/modelProvider": h.modelApi,
        "@/app/api/ai/chat/stream/modelFallback": fallback,
        "@/app/api/ai/_lib/providerGate": { filterModelOptionForTeam: (value) => value },
        "@/app/api/ai/_lib/byokKeys": {
          ...h.byok,
          getTeamGatewayApiKey: async () => "vck_fixture",
          getByokOrTeamGatewayApiKeyForModelOption: async () => "vck_fixture",
        },
      });
      if (plan !== "BYOK") {
        const request = { userId: 7, aiFeature: "taskWriter", teamContext: { teamId: "fixture-team", settings: {} } };
        const selected = await editor.selectTaskWriterModel(request);
        assert.equal(selected.modelId, enabled ? "claude-haiku-5.5" : plan === "Free" ? "google/gemini-3.5-flash-lite" : "gpt-6-luna");
        if (enabled) {
          storedPreference = { taskWriter: "gpt-6-luna" };
          const saved = await editor.selectTaskWriterModel(request);
          assert.equal(saved.modelId, "gpt-6-luna");
        }
      }
      for (const feature of ["summaries", "questionSuggestions", "statusUpdates"]) {
        const system = ladder.resolveSystemModel(feature, {}, context.haiku55Enabled, context);
        assert.equal(system.model, enabled ? "anthropic/claude-haiku-5.5" : "google/gemini-3.5-flash-lite");
        const model = h.byok.resolveAutomaticAiModel("gateway", system.model, "vck_fixture", { haiku55Enabled: context.haiku55Enabled, lookup: { trustedTeamId: "fixture-team", userId: 7 }, feature: "summary" });
        h.modelApi.configureAiModelUsage(model, { userId: 7, teamId: "fixture-team", feature: "summary" });
        await model.doGenerate({ prompt: [], maxOutputTokens: 700, responseFormat: { type: "json" }, temperature: 0.4 });
        const call = h.calls.at(-1);
        assert.equal(call.modelId, system.model);
        if (enabled) {
          assert.equal(call.params.providerOptions.anthropic.thinking.type, "disabled");
          assert.equal(call.params.temperature, undefined);
        } else {
          assert.equal(call.params.providerOptions?.anthropic, undefined);
          assert.equal(call.params.temperature, 0.4);
        }
        assert.equal(h.reservations.at(-1).allowanceUsd, policy.FREE_TEAM_AI_ALLOWANCE_USD);
      }
    }
  }
  // HTPR-7010 alone retains the old Free default and paid Haiku behaviour.
  const legacy = harness(false, "Free", true);
  const legacyContext = await legacy.byok.getAiDefaultModelContext({ userId: 7 });
  assert.equal(catalog.defaultModelKeyFor(legacyContext), "gpt-6-luna");
  assert.equal(catalog.defaultModelKeyFor({ ...legacyContext, plan: "Pro" }), "claude-haiku-5-5");
  assert.equal(ladder.resolveSystemModel("summaries", {}, true, legacyContext).model, "google/gemini-3.5-flash-lite");
  const anonymous = harness(true);
  assert.equal(await anonymous.gate.haiku55ModelEnabled(undefined), true);
  assert.deepEqual(anonymous.checks[0], [keys.HTPR_7038_HAIKU_DEFAULT_FLAG, 0]);
  const model = anonymous.modelApi.resolveAiModel("gateway", "anthropic/claude-haiku-5.5", "vck_fixture");
  await model.doGenerate({ prompt: [], maxOutputTokens: 500 });
  assert.ok(anonymous.checks.some(([key, id]) => key === keys.HTPR_7038_HAIKU_DEFAULT_FLAG && id === 0));
  const off = harness(false);
  assert.equal(await off.gate.haiku55ModelEnabled(7), false);
  await assert.rejects(off.modelApi.resolveAiModel("claude", "claude-haiku-5-5", "fixture-direct").doGenerate({ prompt: [] }), /unavailable/);
  for (const provider of ["claude", "openrouter"]) {
    const h = harness(true);
    const model = h.modelApi.resolveAiModel(provider, provider === "claude" ? "claude-haiku-5-5" : "anthropic/claude-haiku-5.5", "fixture-direct");
    h.modelApi.configureAiModelUsage(model, { userId: 7 });
    await model.doGenerate({ prompt: [], maxOutputTokens: 1200, responseFormat: { type: "json" } });
    assert.equal(h.calls[0].params.providerOptions.anthropic.thinking.type, "disabled");
    if (provider === "openrouter") assert.equal(h.calls[0].params.providerOptions.openrouter.reasoning.enabled, false);
  }
  assert.equal(fallback.previousModelForFailedStream("claude-haiku-5-5", { status: 404 }, false, false, true).model, "gpt-6-luna");
  assert.equal(fallback.previousModelForFailedStream("claude-haiku-5-5", { status: 404 }, true, false, true), null);

  // Audit each caller's real model-construction block against the shared resolver.
  const callers = [
    ["src/app/api/ai/_lib/taskSummaries.ts", "task.userId", 700],
    ["src/app/api/ai/_lib/commentSummaries.ts", "comment.creatorId ?? comment.task.userId", 300],
    ["src/app/api/ai/task-questions/route.ts", "viewer.id", 400],
    ["src/app/api/reports/status-update/route.ts", "session.userId", 900],
    ["src/lib/slack/threadSummary.ts", "context.installedByUserId", 400],
    ["src/lib/slack/taskCreate.ts", "input.actorUserId", 1200],
    ["src/lib/slack/chat.ts", "actor.user.id", 600],
  ];
  for (const [file, identity, budget] of callers) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(source.includes(`userId: ${identity}`), `${file} uses caller identity`);
    assert.match(source, /getAiDefaultModelContext\(/);
    assert.match(source, /resolveSystemModel\(/);
    assert.match(source, /resolveAutomaticAiModel\(/);
    assert.match(source, /resolveLegacyAiModel\(/);
    const budgets = [...source.matchAll(/maxOutputTokens:\s*([\d_]+)/g)].map((match) => Number(match[1].replaceAll("_", "")));
    assert.ok(budgets.every((value) => value <= 1200), `${file} disables thinking with the existing short-call middleware`);
    assert.ok(budgets.includes(budget) || file.endsWith("commentSummaries.ts") || file.endsWith("task-questions/route.ts"));
  }
  for (const enabled of [false, true]) {
    const h = harness(enabled);
    let picked;
    const classifier = moduleWithStubs("src/lib/ai/labelClassifier.ts", {
      "@/app/api/ai/_lib/planGate": h.gate,
      "@/app/api/ai/_lib/byokKeys": { ...h.byok, getTeamGatewayApiKey: async () => "vck_fixture" },
      "@/app/api/ai/_lib/modelProvider": { ...h.modelApi, gatewayProviderOptionsForModel: () => undefined },
      "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (value) => value },
      "@/lib/configs/general.config": { generalConfig: { hyperAiId: 100 } },
      "@/lib/ai/labelClassifierOutput": { parseMatchingLabelIds: () => [] },
      ai: { generateText: async (args) => {
        picked = args.model.modelId;
        await args.model.doGenerate({ prompt: [], maxOutputTokens: args.maxOutputTokens });
        return { text: "[]" };
      } },
    });
    await classifier.classifyTaskAgainstLabels({ title: "Fixture", description: "Fixture" }, [{ labelId: "fixture", prompt: "Fixture" }], { teamId: "fixture-team", userId: 7 });
    assert.equal(picked, enabled ? "anthropic/claude-haiku-5.5" : "google/gemini-3.1-flash-lite");
    if (enabled) assert.equal(h.calls.at(-1).params.providerOptions.anthropic.thinking.type, "disabled");
  }
  console.log("HTPR-7038 checks passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
