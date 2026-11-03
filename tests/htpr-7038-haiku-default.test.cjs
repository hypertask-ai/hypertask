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
  stubs = { "@/lib/flags/definitions/htpr-7634-openai-only-default": { HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG: "htpr-7634-openai-only-default" }, ...stubs };
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code + extra, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => stubs[id] ?? (id === "@/lib/ai/htpr7038ModelReset" ? { ensureHtpr7038ModelReset: async () => "disabled" } : id.startsWith("@/") || id.startsWith("./") ? {} : require(id)),
    process: { env: { AI_GATEWAY_API_KEY: "vck_fixture" } },
    performance, setTimeout, clearTimeout, ReadableStream, Response, console,
  }, { filename });
  return loadedModule.exports;
}

function harness(enabled, plan = "Free") {
  const checks = [], calls = [], reservations = [];
  const flags = { isFeatureEnabled: async (key, id) => {
    checks.push([key, id]);
    return false;
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
    "@/app/api/ai/_lib/planGate": gate,
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
  for (const enabled of [true]) {
    for (const plan of ["Free", "Pro", "AI", "BYOK"]) {
      const h = harness(enabled, plan);
      const context = await h.byok.getAiDefaultModelContext({ trustedTeamId: "fixture-team", userId: 7 });
      assert.equal(context.haikuDefaultEnabled, enabled);
      assert.equal(context.haiku55Enabled, true);
      const option = catalog.getDefaultAiModelOptionForPlan(plan, false, context.haiku55Enabled, context.haikuDefaultEnabled);
      assert.equal(option.id, enabled || plan !== "Free" ? "claude-haiku-5-5" : "gpt-6-luna");
      assert.equal(catalog.resolveAiModelOption(["gpt-6-luna"], option, context.haiku55Enabled).id, "gpt-6-luna");
      if (enabled) {
        await h.gate.assertModelAllowedForPlan(null, option, null);
        const mobile = composer.buildComposerConfig({ settings: {}, customEndpointConfigured: false, storePlanId: plan, providersWithByok: new Set(), haiku55Enabled: true, haikuDefaultEnabled: true });
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
        const request = { userId: 7, aiFeature: "writeWithAi", teamContext: { teamId: "fixture-team", settings: {} } };
        const selected = await editor.selectTaskWriterModel(request);
        assert.equal(selected.modelId, enabled || plan !== "Free" ? "claude-haiku-5.5" : "gpt-6-luna");
        if (enabled) {
          storedPreference = { writeWithAi: "gpt-6-luna" };
          const saved = await editor.selectTaskWriterModel(request);
          assert.equal(saved.modelId, "gpt-6-luna");
        }
      }
      for (const feature of ["summaries", "questionSuggestions", "statusUpdates"]) {
        const system = ladder.resolveSystemModel(feature, {}, context.haiku55Enabled, context);
        assert.equal(system.model, enabled || plan !== "Free" ? "anthropic/claude-haiku-5.5" : "google/gemini-3.5-flash-lite");
        const model = h.byok.resolveAutomaticAiModel("gateway", system.model, "vck_fixture", { haiku55Enabled: context.haiku55Enabled, lookup: { trustedTeamId: "fixture-team", userId: 7 }, feature: "summary" });
        h.modelApi.configureAiModelUsage(model, { userId: 7, teamId: "fixture-team", feature: "summary" });
        await model.doGenerate({ prompt: [], maxOutputTokens: 700, responseFormat: { type: "json" }, temperature: 0.4 });
        const call = h.calls.at(-1);
        assert.equal(call.modelId, system.model);
        if (catalog.isHaiku55Model(system.model)) {
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
  const anonymous = harness(true);
  assert.equal(await anonymous.gate.haiku55ModelEnabled(undefined), true);
  const model = anonymous.modelApi.resolveAiModel("gateway", "anthropic/claude-haiku-5.5", "vck_fixture");
  await model.doGenerate({ prompt: [], maxOutputTokens: 500 });
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

  const callers = [
    ["src/app/api/ai/_lib/taskSummaries.ts", "task.userId", 700],
    ["src/app/api/ai/_lib/commentSummaries.ts", "comment.creatorId ?? comment.task.userId", 300],
    ["src/app/api/ai/task-questions/route.ts", "viewer.id", 400],
    ["src/utils/controllers/reports/statusUpdate.ts", "userId", 2800],
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
    assert.ok(budgets.every((value) => value <= 1200) || /Output\.object\(/.test(source), `${file} disables thinking with the existing short-call middleware`);
    assert.ok(budgets.includes(budget) || file.endsWith("commentSummaries.ts") || file.endsWith("task-questions/route.ts"));
  }
  for (const enabled of [true]) {
    const h = harness(enabled);
    let picked;
    const classifier = moduleWithStubs("src/lib/ai/labelClassifier.ts", {
      "@/app/api/ai/_lib/planGate": h.gate,
      "@/app/api/ai/_lib/byokKeys": { ...h.byok, getTeamGatewayApiKey: async () => "vck_fixture" },
      "@/app/api/ai/_lib/modelProvider": { ...h.modelApi, gatewayProviderOptionsForModel: () => undefined },
      "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (value) => value },
      "@/lib/configs/general.config": { generalConfig: { hyperAiId: 100 } },
      "@/lib/ai/labelClassifierOutput": { parseMatchingLabelIds: () => [], labelClassifierPrompt: () => "", LABEL_CLASSIFIER_INSTRUCTIONS: "", LABEL_CLASSIFIER_MAX_OUTPUT_TOKENS: 500 },
      "@/lib/ai/teamAiFunding": { resolveTeamAiFunding: async () => ({ mode: "unrestricted" }) },
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
