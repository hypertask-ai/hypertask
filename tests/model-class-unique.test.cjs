const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  fsCache: false,
});
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const { buildComposerConfig } = load(path.join(root, "src/app/api/android/ai/composer/config.ts"));
const { HTPR_7010_HAIKU_5_5_FLAG, LUNA_FREE_PLAN_FLAG } = load(path.join(root, "src/lib/flags/keys.ts"));

function assertUniqueModelClasses(options, isVisible = () => true) {
  const keysByClass = new Map();
  for (const option of options.filter(isVisible)) {
    const definition = catalog.getAiModelDefinition(option.modelKey);
    assert.ok(definition, `Missing definition for ${option.modelKey}`);
    assert.equal(typeof definition.modelClass, "string", `Missing modelClass for ${option.modelKey}`);
    assert.ok(definition.modelClass.trim(), `Empty modelClass for ${option.modelKey}`);
    const keys = keysByClass.get(definition.modelClass) ?? new Set();
    keys.add(option.modelKey);
    keysByClass.set(definition.modelClass, keys);
  }
  for (const [modelClass, keys] of keysByClass) {
    assert.ok(
      keys.size <= 1,
      `One AI model per class violated: ${modelClass} has visible model keys ${[...keys].join(", ")}`,
    );
  }
}

test("every model definition has a non-empty modelClass, including hidden models", () => {
  for (const definition of catalog.aiModelDefinitions) {
    assert.equal(typeof definition.modelClass, "string", `Missing modelClass for ${definition.key}`);
    assert.ok(definition.modelClass.trim(), `Empty modelClass for ${definition.key}`);
  }
  assert.equal(catalog.getAiModelDefinition("claude-haiku-4.5").modelClass, "claude-haiku");
  assert.equal(catalog.getAiModelDefinition("claude-haiku-5-5").modelClass, "claude-haiku");
  assert.equal(catalog.getAiModelDefinition("kimi-k2.5").modelClass, "kimi-k2.5-free");
  assert.equal(catalog.getAiModelDefinition("kimi-k3").modelClass, "kimi-k3");
});

for (const haiku55Enabled of [false, true]) {
  for (const lunaFree of [false, true]) {
    const state = `${HTPR_7010_HAIKU_5_5_FLAG}=${haiku55Enabled}, ${LUNA_FREE_PLAN_FLAG}=${lunaFree}`;
    test(`one model per class in every picker with ${state}`, () => {
      const isVisible = (option) => catalog.isAiModelOptionVisible(option, haiku55Enabled);
      const visibleOptions = catalog.aiModelOptions.filter(isVisible);
      // Web pickers can show locked rows. Providers, guest access, caller lists,
      // and custom endpoint setup only restrict this maximum visible catalog.
      assertUniqueModelClasses(catalog.aiModelOptions, isVisible);
      assert.equal(visibleOptions.some((option) => option.modelKey === "claude-haiku-4.5"), !haiku55Enabled);
      assert.equal(visibleOptions.some((option) => option.modelKey === "claude-haiku-5-5"), haiku55Enabled);
      const quickIds = haiku55Enabled
        ? ["claude-haiku-5-5", ...catalog.MOBILE_AI_CHAT_QUICK_MODEL_IDS]
        : catalog.MOBILE_AI_CHAT_QUICK_MODEL_IDS;
      assertUniqueModelClasses(visibleOptions.filter((option) => quickIds.includes(option.id)));

      // Luna's flag changes access rather than hiding locked web rows. Android
      // actually hides plan-locked models, so exercise its real filtering too.
      for (const storePlanId of ["Free", "Pro", "AI", "BYOK"]) {
        for (const customEndpointConfigured of [false, true]) {
          for (const hasByok of [false, true]) {
            const providersWithByok = new Set(hasByok
              ? catalog.aiModelDefinitions.map((definition) => definition.provider)
              : []);
            const config = buildComposerConfig({
              settings: {}, storePlanId, customEndpointConfigured,
              providersWithByok, haiku55Enabled, lunaFree,
            });
            const options = config.models.map((model) => {
              const option = catalog.aiModelOptions.find((candidate) => candidate.id === model.id);
              assert.ok(option, `Unknown picker model ${model.id}`);
              return option;
            });
            assertUniqueModelClasses(options);
            if (storePlanId === "Free") {
              assert.equal(options.some((option) => option.modelKey === "gpt-6-luna"), lunaFree);
            }
          }
        }
      }
    });
  }
}

test("reasoning and effort variants sharing a modelKey are not separate models", () => {
  for (const definition of catalog.aiModelDefinitions) {
    const variants = catalog.aiModelOptions.filter((option) => option.modelKey === definition.key);
    assert.ok(variants.length, `No options for ${definition.key}`);
    assertUniqueModelClasses(variants);
  }
});

test("the same checker rejects Haiku 4.5 and 5.5 when both are visible", () => {
  assert.throws(
    () => assertUniqueModelClasses(catalog.aiModelOptions, () => true),
    {
      name: "AssertionError",
      message: "One AI model per class violated: claude-haiku has visible model keys claude-haiku-4.5, claude-haiku-5-5",
    },
  );
});
