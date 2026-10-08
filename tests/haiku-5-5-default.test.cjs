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
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: (id) => stubs[id] ?? require(id), process, console }, { filename });
  return loaded.exports;
}

test("flag-on default is Haiku on every plan, independently of the Luna Free flag or BYOK", () => {
  for (const plan of ["Free", "Pro", "AI", "BYOK", null, undefined]) {
    for (const lunaFree of [false, true]) {
      for (const customerCredential of [false, true]) {
        assert.equal(catalog.getDefaultAiModelOptionForPlan(plan, customerCredential, lunaFree, true).id, haiku.id);
      }
    }
  }
  const visible = catalog.aiModelOptions.filter((option) => catalog.isAiModelOptionVisible(option, true));
  assert.equal(visible.some((option) => option.modelKey === "claude-haiku-4.5"), false);
  assert.ok(visible.includes(haiku));
  assert.ok(visible.some((option) => option.modelKey === "gpt-6-luna"));
  assert.equal(catalog.pickAutoAiModelOption(visible, true).id, haiku.id);
  assert.equal(catalog.pickReplacementAiModelOption("claude-haiku-4.5", visible, true).id, haiku.id);
  assert.equal(catalog.isPremiumAiModelDefinition(catalog.getAiModelDefinition(haiku.modelKey)), false);
});

test("flag-off plan defaults and display catalog retain production behavior", () => {
  for (const plan of ["Free", "Pro", "AI", "BYOK", null]) {
    const expected = plan === "Pro" || plan === "AI" ? "gpt-6-luna" : "gemini-3.5-flash-lite";
    assert.equal(catalog.getDefaultAiModelOptionForPlan(plan, false, false, false).id, expected);
  }
  assert.equal(catalog.getDefaultAiModelOptionForPlan("Free", false, true, false).id, "gpt-6-luna");
  const visible = catalog.aiModelOptions.filter((option) => catalog.isAiModelOptionVisible(option, false));
  assert.ok(visible.some((option) => option.modelKey === "claude-haiku-4.5"));
  assert.equal(visible.includes(haiku), false);
  assert.equal(catalog.getAiModelOptionById("claude-haiku-4.5", false).id, "claude-haiku-4.5");
  assert.equal(ladder.getSystemModelsForFeature("summaries", false)[0].model, "google/gemini-3.5-flash-lite");
});

test("personal, team, board, agent and raw saved Haiku aliases resolve at read time", () => {
  const planDefault = catalog.getDefaultAiModelOptionForPlan("Free", false, true, true);
  for (const saved of aliases) {
    assert.equal(catalog.getAiModelOptionById(saved, true).id, haiku.id);
    assert.equal(catalog.resolveAiModelOption([saved], planDefault, true).id, haiku.id);
    assert.equal(ladder.resolveUserFacingModelOption("aiChat", {}, saved, { haiku55Enabled: true }).id, haiku.id);
    const settings = { featureModels: { aiChat: saved } };
    const original = JSON.stringify(settings);
    assert.equal(ladder.resolveUserFacingModelOption("aiChat", settings, null, { haiku55Enabled: true }).id, haiku.id);
    assert.equal(JSON.stringify(settings), original);
    assert.equal(catalog.resolveHaikuModelId(saved, false), saved);
  }
  assert.equal(catalog.resolveAiModelMention("Haiku 4.5", true).modelOption.id, haiku.id);
  assert.equal(catalog.resolveAiModelMention("Haiku 4.5", false).modelOption.id, "claude-haiku-4.5");
  assert.equal(catalog.resolveAiModelOption(["gpt-6-luna"], planDefault, true).id, "gpt-6-luna");
});

test("Android config offers and defaults to Haiku on Free and paid and maps saved team choices", () => {
  for (const storePlanId of ["Free", "Pro", "AI", "BYOK"]) {
    for (const settings of [{}, { featureModels: { aiChat: "claude-haiku-4.5" } }]) {
      const input = { settings, storePlanId, providersWithByok: new Set(), customEndpointConfigured: false, lunaFree: true };
      const on = composer.buildComposerConfig({ ...input, haiku55Enabled: true });
      assert.equal(on.selectedModelId, haiku.id);
      assert.ok(on.models.some((option) => option.id === haiku.id));
      assert.equal(on.models.some((option) => option.id === "claude-haiku-4.5"), false);
      const off = composer.buildComposerConfig({ ...input, haiku55Enabled: false });
      assert.equal(off.models.some((option) => option.id === haiku.id), false);
      assert.ok(off.models.some((option) => option.id === "claude-haiku-4.5"));
    }
  }
});

test("flag-aware ladder replaces saved Haiku slugs and defaults without modifying context-free ladder", () => {
  for (const feature of ["summaries", "questionSuggestions", "statusUpdates"]) {
    const settings = { featureModels: { [feature]: "anthropic/claude-haiku-4.5" } };
    assert.equal(ladder.resolveSystemModel(feature, settings, true).model, "anthropic/claude-haiku-5.5");
    assert.equal(ladder.resolveSystemModel(feature, {}, true).model, "anthropic/claude-haiku-5.5");
    assert.equal(ladder.resolveSystemModel(feature, settings, false).model, "anthropic/claude-haiku-4.5");
    assert.ok(ladder.isAiFeatureModelAllowed(feature, "anthropic/claude-haiku-5.5", true));
    assert.ok(ladder.isAiFeatureModelEnabled(feature, "anthropic/claude-haiku-5.5", {}, true, true));
    assert.equal(ladder.isAiFeatureModelAllowed(feature, "anthropic/claude-haiku-5.5", false), false);
  }
  assert.ok(ladder.SYSTEM_MODEL_LADDERS.fast.some((option) => option.model === "anthropic/claude-haiku-4.5"));
  const onlyOpenAi = { providers: { anthropic: false } };
  assert.notEqual(ladder.resolveUserFacingModelOption("aiChat", onlyOpenAi, null, { haiku55Enabled: true })?.id, "claude-haiku-4.5");
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

test("Free plan gate admits Haiku and server flag evaluation uses the user and fails closed", async () => {
  const checks = [];
  let enabled = true;
  let fail = false;
  const api = stubbedModule("src/app/api/ai/_lib/planGate.ts", {
    "@/lib/prisma": {}, "@/lib/planFromStripePriceId": {}, "@/lib/internalCompTeams": {},
    "@/lib/teamComp": {}, "@/lib/subscriptionAccess": {},
    "@/lib/aiModelOptions": catalog,
    "@/lib/flags/keys": load(path.join(root, "src/lib/flags/keys.ts")),
    "@/lib/flags": { isFeatureEnabled: async (name, id) => { checks.push([name, id]); if (fail) throw new Error("flag unavailable"); return enabled; } },
  });
  await api.assertModelAllowedForPlan(null, haiku, null, undefined, false);
  assert.equal(await api.haiku55ModelEnabled(985), true);
  assert.deepEqual(checks, [["htpr-7010-haiku-5-5", 985]]);
  enabled = false;
  assert.equal(await api.haiku55ModelEnabled(985), false);
  fail = true;
  assert.equal(await api.haiku55ModelEnabled(985), false);
  assert.equal(await api.haiku55ModelEnabled(null), false);
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
    assert.equal(catalog.isHaiku55Model(JSON.parse(off.init.body).model), false);
  }
  assert.equal(JSON.parse(probe.buildByokTestRequest("openai", "fixture", undefined, true).init.body).model, "gpt-6-luna");
});
