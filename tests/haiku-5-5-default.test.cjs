const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const ladder = load(path.join(root, "src/lib/systemModelLadder.ts"));
const composer = load(path.join(root, "src/app/api/android/ai/composer/config.ts"));
const fallback = load(path.join(root, "src/app/api/ai/chat/stream/modelFallback.ts"));
const guest = load(path.join(root, "src/lib/demo/guestModels.ts"));
const pricing = load(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"));
const probe = load(path.join(root, "src/app/api/settings/byok-test/providerTest.ts"));
const haiku = catalog.getAiModelOptionById("claude-haiku-5-5");
const aliases = ["claude-haiku-4.5", "claude-haiku-4-5", "anthropic/claude-haiku-4.5", "anthropic/claude-haiku-4-5", "claude-haiku-4-5-20251001"];

function stubbedModule(file, stubs) {
  stubs = { "@/lib/net/downloadWithoutBrotli": { downloadWithoutBrotli: undefined }, "@/lib/flags": { isFeatureEnabled: async () => false }, "@/lib/flags/definitions/htpr-7634-openai-only-default": { HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG: "htpr-7634-openai-only-default" }, "@/lib/flags/definitions/htpr-7732-baseten-byok": { HTPR_7732_BASETEN_BYOK_FLAG: "htpr-7732-baseten-byok" }, "@/lib/flags/definitions/htpr-7844-team-ai-key-only": { HTPR_7844_TEAM_AI_KEY_ONLY_FLAG: "htpr-7844-team-ai-key-only" }, "@/lib/ai/teamAiFunding": { isPlatformAiCredential: () => false, resolveTeamAiFunding: async () => ({ mode: "unrestricted" }), resolveSideCallFunding: async () => ({ mode: "unrestricted" }), TeamKeyOnlyRefusal: class TeamKeyOnlyRefusal extends Error {}, applyKeyOnlyProviderVisibility: (rows) => rows, aiProvidersForSavedByokKeys: () => [], modelOptionsForKeyOnlyTeam: (options) => options }, ...stubs };
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: (id) => stubs[id] ?? require(id), process, console }, { filename });
  return loaded.exports;
}

test("plan-aware defaults keep Luna on Free and choose Haiku for paid or compatible BYOK", () => {
  for (const plan of ["Free", "Pro", "AI", "BYOK", null, undefined]) {
    for (const hasByok of [false, true]) {
      const paidOrByok = (hasByok && plan !== "Free") || ["Pro", "AI", "BYOK"].includes(plan);
      const expected = paidOrByok ? haiku.id : plan === "Free" ? "gpt-6-luna" : "gemini-3.5-flash-lite";
      assert.equal(catalog.getDefaultAiModelOptionForPlan(plan, hasByok, true).id, expected);
      assert.equal(catalog.defaultModelKeyFor({ haiku55Enabled: true, plan, hasByok }), paidOrByok ? haiku.id : "gpt-6-luna");
      assert.equal(catalog.defaultModelKeyFor({ haiku55Enabled: false, plan, hasByok }), "gpt-6-luna");
    }
  }
  for (const provider of ["anthropic", "claude", "gateway", "openrouter"]) assert.equal(catalog.hasHaikuByokProvider(new Set([provider])), true);
  for (const provider of ["openai", "google", "custom", "managed_gateway"]) assert.equal(catalog.hasHaikuByokProvider(new Set([provider])), false);
  const flags = load(path.join(root, "src/lib/byokSelectedProviderGate.ts"));
  for (const provider of ["claude", "gateway", "openrouter"]) {
    assert.equal(flags.hasHaikuByokProviderFlags([{ provider, enabled: true }]), true);
    assert.equal(flags.hasHaikuByokProviderFlags([{ provider, enabled: false }]), false);
  }
  const visible = catalog.aiModelOptions.filter((option) => catalog.isAiModelOptionVisible(option, true));
  assert.equal(visible.some((option) => option.modelKey === "claude-haiku-4.5"), false);
  assert.ok(visible.includes(haiku));
  assert.ok(visible.some((option) => option.modelKey === "gpt-6-luna"));
  assert.equal(catalog.pickAutoAiModelOption(visible, true, { plan: "Pro" }).id, haiku.id);
  assert.equal(catalog.pickAutoAiModelOption(visible, true, { plan: "Free" }).id, catalog.pickAutoAiModelOption(visible, false).id);
  assert.equal(catalog.pickReplacementAiModelOption("claude-haiku-4.5", visible, true).id, haiku.id);
});

test("flag-off plan defaults stay unchanged and the catalog contains only Haiku 5.5", () => {
  for (const plan of ["Free", "Pro", "AI", "BYOK", null]) {
    const expected = ["Free", "Pro", "AI"].includes(plan) ? "gpt-6-luna" : "gemini-3.5-flash-lite";
    assert.equal(catalog.getDefaultAiModelOptionForPlan(plan, false, false).id, expected);
  }
  assert.equal(catalog.getDefaultAiModelOptionForPlan("Free", false, false).id, "gpt-6-luna");
  const visible = catalog.aiModelOptions.filter((option) => catalog.isAiModelOptionVisible(option, false));
  assert.equal(visible.some((option) => option.modelKey === "claude-haiku-4.5"), false);
  assert.ok(visible.includes(haiku));
  assert.equal(catalog.getAiModelOptionById("claude-haiku-4.5", false).id, "claude-haiku-5-5");
  assert.equal(ladder.getSystemModelsForFeature("summaries", false)[0].model, "google/gemini-3.5-flash-lite");
});

test("personal, team, board, agent and raw saved Haiku aliases resolve at read time", () => {
  const planDefault = catalog.getDefaultAiModelOptionForPlan("Free", false, true);
  for (const saved of aliases) {
    assert.equal(catalog.getAiModelOptionById(saved, true).id, haiku.id);
    assert.equal(catalog.resolveAiModelOption([saved], planDefault, true).id, haiku.id);
    assert.equal(ladder.resolveUserFacingModelOption("aiChat", {}, saved, { haiku55Enabled: true }).id, haiku.id);
    const settings = { featureModels: { aiChat: saved } };
    const original = JSON.stringify(settings);
    assert.equal(ladder.resolveUserFacingModelOption("aiChat", settings, null, { haiku55Enabled: true }).id, haiku.id);
    assert.equal(JSON.stringify(settings), original);
    assert.equal(catalog.resolveHaikuModelId(saved, false), saved.includes("/") ? "anthropic/claude-haiku-5.5" : "claude-haiku-5-5");
  }
  assert.equal(catalog.resolveAiModelMention("Haiku 4.5", true), undefined);
  assert.equal(catalog.resolveAiModelMention("Haiku 4.5", false), undefined);
  assert.equal(catalog.resolveAiModelOption(["gpt-6-luna"], planDefault, true).id, "gpt-6-luna");
});

test("Android access and defaults follow plan and BYOK while saved Haiku upgrades", () => {
  for (const storePlanId of ["Free", "Pro", "AI", "BYOK"]) {
    for (const provider of [null, "anthropic", "gateway", "openrouter", "openai"]) {
      for (const settings of [{}, { featureModels: { aiChat: "claude-haiku-4.5" } }]) {
        const providersWithByok = new Set(provider ? [provider] : []);
        const input = { settings, storePlanId, providersWithByok, customEndpointConfigured: false };
        const on = composer.buildComposerConfig({ ...input, haiku55Enabled: true });
        const expected = settings.featureModels || storePlanId !== "Free" ? haiku.id : "gpt-6-luna";
        assert.equal(on.selectedModelId, expected);
        assert.ok(on.models.some((option) => option.id === haiku.id));
        assert.equal(on.models.some((option) => option.id === "claude-haiku-4.5"), false);
        const off = composer.buildComposerConfig({ ...input, haiku55Enabled: false });
        assert.equal(off.models.some((option) => option.id === haiku.id), true);
        assert.equal(off.models.some((option) => option.id === "claude-haiku-4.5"), false);
      }
    }
  }
  const disabled = composer.buildComposerConfig({ settings: { providers: { anthropic: false } }, storePlanId: "Free", providersWithByok: new Set(), customEndpointConfigured: false, haiku55Enabled: true });
  assert.equal(disabled.models.some((option) => option.id === haiku.id), false);
  assert.equal(disabled.selectedModelId, "gpt-6-luna");
});

test("plan-aware ladder upgrades saved Haiku but preserves Free production defaults and ordering", () => {
  for (const feature of ["summaries", "questionSuggestions", "statusUpdates"]) {
    const settings = { featureModels: { [feature]: "anthropic/claude-haiku-4.5" } };
    for (const context of [{ plan: "Free" }, { plan: "Pro" }, { plan: "AI" }, { plan: "BYOK" }, { plan: "Free", hasByok: true }]) {
      assert.equal(ladder.resolveSystemModel(feature, settings, true, context).model, "anthropic/claude-haiku-5.5");
      assert.equal(ladder.resolveSystemModel(feature, {}, true, context).model, context.plan !== "Free" ? "anthropic/claude-haiku-5.5" : "google/gemini-3.5-flash-lite");
      assert.equal(ladder.resolveSystemModel(feature, {}, false, context).model, "google/gemini-3.5-flash-lite");
    }
    assert.deepEqual(ladder.getSystemModelsForFeature(feature, true, { plan: "Free" }).map((entry) => entry.provider), ladder.getSystemModelsForFeature(feature, false).map((entry) => entry.provider));
    assert.equal(ladder.resolveSystemModel(feature, settings, false).model, "anthropic/claude-haiku-5.5");
    assert.ok(ladder.isAiFeatureModelAllowed(feature, "anthropic/claude-haiku-5.5", true));
    assert.ok(ladder.isAiFeatureModelEnabled(feature, "anthropic/claude-haiku-5.5", {}, true, true));
    assert.equal(ladder.isAiFeatureModelAllowed(feature, "anthropic/claude-haiku-5.5", false), true);
  }
  assert.deepEqual(ladder.SYSTEM_MODEL_LADDERS.fast.filter((option) => option.provider === "anthropic").map((option) => option.model), ["anthropic/claude-haiku-5.5"]);
  const onlyOpenAi = { providers: { anthropic: false } };
  assert.notEqual(ladder.resolveUserFacingModelOption("aiChat", onlyOpenAi, null, { haiku55Enabled: true, plan: "Pro" })?.id, "claude-haiku-4.5");
});

test("Haiku fallback is Luna only while enabled and only before content or tools", () => {
  for (const model of [haiku.model, haiku.directModel, `anthropic/${haiku.model}`]) {
    assert.equal(fallback.previousModelForFailedStream(model, { status: 404 }, false, false, true).model, "gpt-6-luna");
    assert.equal(fallback.previousModelForFailedStream(model, { status: 404 }, false, false, false), null);
    assert.equal(fallback.previousModelForFailedStream(model, { status: 404 }, true, false, true), null);
    assert.equal(fallback.previousModelForFailedStream(model, { status: 404 }, false, true, true), null);
    assert.equal(fallback.previousModelForFailedStream(model, { status: 429 }, false, false, true), null);
  }
  assert.equal(fallback.previousModelForFailedStream("gpt-6-luna", { status: 404 }, false, false, false).model, "gpt-5.6-luna");
});

test("Free plan gate admits Haiku and server availability preserves user checks", async () => {
  const checks = [];
  let fail = false;
  const api = stubbedModule("src/app/api/ai/_lib/planGate.ts", {
    "@/lib/prisma": {}, "@/lib/planFromStripePriceId": {}, "@/lib/internalCompTeams": {},
    "@/lib/teamComp": {}, "@/lib/subscriptionAccess": {},
    "@/lib/aiModelOptions": catalog,
    "@/lib/flags/keys": load(path.join(root, "src/lib/flags/keys.ts")),
    "@/lib/flags": { isFeatureEnabled: async (name, id) => { checks.push([name, id]); if (fail) throw new Error("flag unavailable"); return false; } },
  });
  await api.assertModelAllowedForPlan(null, haiku, null, undefined);
  assert.equal(await api.haiku55ModelEnabled(985), true);
  assert.deepEqual(checks, []);
  fail = true;
  assert.equal(await api.haiku55ModelEnabled(985), true);
  assert.equal(await api.haiku55ModelEnabled(null), true);
});

test("Haiku gateway pricing remains included and raw gateway aliases use the catalog slug", async () => {
  for (const model of [haiku.model, haiku.directModel, `anthropic/${haiku.model}`]) {
    assert.equal(pricing.gatewayCatalogModelSlug(model), "anthropic/claude-haiku-5.5");
    const rates = await pricing.modelPricing(model);
    assert.equal(rates.inputUsdPerToken, 0.1 / 1_000_000);
    assert.equal(rates.outputUsdPerToken, 0.5 / 1_000_000);
  }
  assert.equal(guest.isGuestAllowedModelKey("gpt-6-luna"), false);
  assert.equal(guest.isGuestAllowedModelKey(haiku.modelKey), false);
});

test("BYOK probes use Haiku for Anthropic and gateway accounts while retaining OpenAI provider probes", () => {
  for (const provider of ["claude", "gateway", "openrouter"]) {
    const on = probe.buildByokTestRequest(provider, "fixture", undefined, true);
    const off = probe.buildByokTestRequest(provider, "fixture", undefined, false);
    assert.ok(catalog.isHaiku55Model(JSON.parse(on.init.body).model));
    assert.equal(catalog.isHaiku55Model(JSON.parse(off.init.body).model), provider === "claude");
  }
  assert.equal(JSON.parse(probe.buildByokTestRequest("openai", "fixture", undefined, true).init.body).model, "gpt-6-luna");
});

test("Haiku 5.5 keeps the free price tier and stays visible on every plan without its flag", async () => {
  const definition = catalog.getAiModelDefinition(haiku.modelKey);
  assert.equal(definition.priceTier, 1);
  assert.equal(Boolean(definition.premium), false);
  for (const freePlan of [false, true]) assert.equal(catalog.isPremiumAiModelDefinition(definition, freePlan), false);
  for (const plan of ["Free", "BYOK", "Pro", "AI"]) {
    const off = composer.buildComposerConfig({ settings: {}, storePlanId: plan, providersWithByok: new Set(), customEndpointConfigured: false, haiku55Enabled: false });
    const on = composer.buildComposerConfig({ settings: {}, storePlanId: plan, providersWithByok: new Set(), customEndpointConfigured: false, haiku55Enabled: true });
    assert.equal(off.models.some((entry) => entry.id === haiku.id), true);
    assert.equal(on.models.some((entry) => entry.id === haiku.id), true);
  }
});

test("server BYOK eligibility preserves Free-plan BYOK restrictions and skips unknown plans", async () => {
  for (const enabled of [true]) {
    for (const plan of ["Free", undefined, "Pro", "AI", "BYOK"]) {
      for (const provider of [null, "claude", "gateway", "openrouter", "openai", "managed_gateway"]) {
        for (const keyEnabled of [false, true]) {
          const lookedUp = [];
          const api = stubbedModule("src/app/api/ai/_lib/byokKeys.ts", {
            "./planAllowancePolicy": { teamPlanAllowanceEnabled: async () => false },
            "@/lib/prisma": {
              teamByokApiKey: { findUnique: async ({ where }) => {
                const requested = where.teamId_provider.provider;
                lookedUp.push(requested);
                return requested === provider ? { enabled: keyEnabled, ciphertext: "fixture", team: { aiProviderSettings: {} } } : null;
              } },
            },
            "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => value },
            "@/utils/controllers/projects/getAllIncludes": {},
            "@/app/api/ai/_lib/modelProvider": {},
            "@/lib/aiModelOptions": catalog,
            "@/lib/aiProviders": load(path.join(root, "src/lib/aiProviders.ts")),
            "@/lib/ai/customEndpoint": {},
            "@/app/api/ai/_lib/managedGatewayKeys": { MANAGED_TEAM_GATEWAY_PROVIDER: "managed_gateway" },
            "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => enabled, storePlanIdForProject: async () => plan },
            "@/app/api/ai/chat/stream/modelFallback": fallback,
          });
          const context = await api.getAiDefaultModelContext({ userId: 985, trustedTeamId: "fixture-team" });
          const canUseByok = enabled && Boolean(plan) && plan !== "Free";
          const eligible = canUseByok && keyEnabled && ["claude", "gateway", "openrouter"].includes(provider);
          assert.equal(context.hasByok, eligible);
          assert.equal(catalog.defaultModelKeyFor(context), haiku.id);
          assert.equal(context.byok?.provider, eligible ? provider : undefined);
          assert.equal(lookedUp.length > 0, canUseByok);
        }
      }
    }
  }
});

test("server title default sites retain Free Luna and route paid or compatible BYOK to Haiku", async () => {
  for (const haiku55Enabled of [false, true]) {
    for (const plan of ["Free", "Pro", "AI", "BYOK"]) {
      for (const provider of [null, "claude", "gateway", "openrouter"]) {
        const requests = [];
        const api = stubbedModule("src/lib/ai/chatStream/title.ts", {
          "@/lib/aiModelOptions": catalog,
          "@/app/api/ai/_lib/byokKeys": {
            getAiDefaultModelContext: async () => ({ haiku55Enabled, plan, hasByok: plan !== "Free" && Boolean(provider), byok: haiku55Enabled && plan !== "Free" && provider ? { provider, credential: "fixture-byok" } : undefined }),
            getByokOrTeamGatewayApiKeyForProvider: async () => "fixture-team",
            resolveAiFallbackCredential: async (load) => load(),
            resolveAutomaticAiModel: (source, model, credential) => { requests.push({ source, model, credential }); return {}; },
            keyOnlySideCallModel: async () => null,
          },
          "@/lib/ai/teamAiFunding": { TeamKeyOnlyRefusal: class TeamKeyOnlyRefusal extends Error {} },
          "@/app/api/ai/_lib/modelProvider": {
            resolveAiModel: (source, model, credential) => { requests.push({ source, model, credential }); return {}; },
            isAiGatewayEnabled: () => true,
            configureAiModelUsage: () => {}, providerOptionsForAiModel: () => ({}), aiUsageProviderForCredential: (source) => source,
          },
          "@/lib/ai/prompts/registry": { renderPrompt: () => "fixture prompt" },
          ai: { generateText: async () => ({ text: "Fixture title" }) },
        });
        assert.equal(await api.generateConversationTitle("fixture content", "fixture message", "fixture-openai", { teamId: "fixture-team" }, { userId: 985 }), "Fixture title");
        const useHaiku = haiku55Enabled && (plan !== "Free");
        assert.equal(catalog.isHaiku55Model(requests[0].model), Boolean(useHaiku));
        assert.equal(requests[0].source, !useHaiku ? "openai" : provider === "openrouter" ? "openrouter" : "claude");
        assert.equal(requests[0].credential, !useHaiku ? "fixture-openai" : provider ? "fixture-byok" : "fixture-team");
      }
    }
  }
});

test("Android maps BYOK sources to catalog provider keys and preserves Free-plan BYOK restrictions", async () => {
  const providers = load(path.join(root, "src/lib/aiProviders.ts"));
  for (const enabled of [false, true]) {
    for (const plan of ["Free", "Pro", "BYOK"]) {
      for (const provider of ["claude", "gateway", "openrouter"]) {
        let input;
        const api = stubbedModule("src/app/api/android/ai/composer/route.ts", {
          "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope,
          "@/lib/flags/keys": { HTPR_7939_GROK_GEMINI4_MODELS_FLAG: "htpr-7939-grok-gemini4-models" },
          "next/server": { NextResponse: { json: (value) => value } },
          "@/lib/prisma": { project: { findFirst: async () => ({ id: 15, teamId: "fixture-team" }) } },
          "@/lib/mcp/auth": { checkMcpRateLimit: async () => null, validateMcpAuth: async () => ({ user: { id: 985 } }) },
          "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
          "@/utils/controllers/teams/getTeamAiSettingsForViewer": { getTeamAiSettingsForViewer: async () => ({ ok: true, settings: {} }) },
          "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => plan },
          "@/app/api/ai/_lib/byokKeys": {
            resolveTeamCustomEndpoint: async () => undefined,
            resolveTeamByokApiKey: async () => plan === "Free" ? "fixture-saved-but-ineligible" : undefined,
            getAiDefaultModelContext: async () => ({ haiku55Enabled: enabled, plan, hasByok: enabled && plan !== "Free", byok: enabled && plan !== "Free" ? { provider, credential: "fixture" } : undefined }),
          },
          "./config": { ...composer, buildComposerConfig: (value) => { input = value; return composer.buildComposerConfig(value); } },
        });
        const result = await api.GET({ nextUrl: { searchParams: new URLSearchParams({ project_id: "15" }) } });
        assert.equal(result.success, true);
        for (const key of input.providersWithByok) assert.equal(providers.isAiProviderKey(key), true, key);
        if (enabled && plan !== "Free") assert.deepEqual([...input.providersWithByok], [provider === "openrouter" ? "openrouter" : "anthropic"]);
        if (enabled && plan === "Free") assert.equal(input.providersWithByok.size, 0);
        assert.equal(result.selectedModelId, enabled ? plan !== "Free" ? haiku.id : "gpt-6-luna" : plan === "Free" ? "gpt-6-luna" : "gemini-3.5-flash-lite");
        if (!enabled && plan === "Free") assert.ok(input.providersWithByok.size > 0);
      }
    }
  }
});
