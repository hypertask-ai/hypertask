const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/system-model-ladder.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  AI_FEATURES,
  isAiFeatureModelEnabled,
  resetAiFeatureSettings,
  resolveSystemModel,
  resolveUserFacingModelOption,
  updateAiFeatureModelSettings,
  updateAiFeatureToggleSettings,
  updateSystemFeatureModelSettings,
} = jiti(
  path.join(root, "src/app/api/ai/_lib/systemModelLadder.ts"),
);
const {
  defaultAiModelOption,
  getDefaultAiModelOptionForPlan,
  preferredAiModelOption,
} = jiti(path.join(root, "src/lib/aiModelOptions.ts"));

test("feature inventory contains the complete AI feature matrix", () => {
  assert.deepEqual(Object.keys(AI_FEATURES), [
    "aiChat",
    "taskWriter",
    "writeWithAi",
    "improveWriting",
    "askAi",
    "boardGeneration",
    "imageGeneration",
    "hyperAi",
    "summaries",
    "questionSuggestions",
    "statusUpdates",
    "dictation",
  ]);
});

test("default settings resolve to Gemini", () => {
  assert.deepEqual(resolveSystemModel("summaries", undefined), {
    provider: "google",
    model: "google/gemini-3.5-flash-lite",
  });
});

test("disabling Google resolves to Grok 4.1 Fast", () => {
  assert.deepEqual(
    resolveSystemModel("summaries", { providers: { google: false } }),
    {
      provider: "xai",
      model: "xai/grok-4.1-fast-non-reasoning",
    },
  );
});

test("disabling Google and xAI resolves to GPT-5.4 Mini", () => {
  assert.deepEqual(
    resolveSystemModel("summaries", {
      providers: { google: false, xai: false },
    }),
    {
      provider: "openai",
      model: "openai/gpt-5.4-mini",
    },
  );
});

test("all providers except Zhipu disabled resolves to GLM", () => {
  assert.deepEqual(
    resolveSystemModel("summaries", {
      providers: {
        google: false,
        xai: false,
        openai: false,
        anthropic: false,
        deepseek: false,
        moonshot: false,
        alibaba: false,
        zhipu: true,
      },
    }),
    { provider: "zhipu", model: "zai/glm-5.2" },
  );
});

test("empty and undefined settings resolve to Gemini", () => {
  const expected = {
    provider: "google",
    model: "google/gemini-3.5-flash-lite",
  };
  assert.deepEqual(resolveSystemModel("summaries", {}), expected);
  assert.deepEqual(resolveSystemModel("summaries", undefined), expected);
});

test("nothing enabled falls back to the first entry", () => {
  assert.doesNotThrow(() =>
    resolveSystemModel("summaries", {
      providers: {
        google: false,
        xai: false,
        openai: false,
        anthropic: false,
        deepseek: false,
        moonshot: false,
        alibaba: false,
        zhipu: false,
      },
    }),
  );
  assert.deepEqual(
    resolveSystemModel("summaries", {
      providers: {
        google: false,
        xai: false,
        openai: false,
        anthropic: false,
        deepseek: false,
        moonshot: false,
        alibaba: false,
        zhipu: false,
      },
    }),
    { provider: "google", model: "google/gemini-3.5-flash-lite" },
  );
});

test("feature override wins over the default ladder order", () => {
  assert.deepEqual(
    resolveSystemModel("summaries", {
      featureModels: { summaries: "openai/gpt-5.4-mini" },
    }),
    { provider: "openai", model: "openai/gpt-5.4-mini" },
  );
});

test("team default beats the user-facing product default", () => {
  assert.equal(
    resolveUserFacingModelOption("aiChat", {
      featureModels: { aiChat: "claude-sonnet-5-instant" },
    }).id,
    "claude-sonnet-5-instant",
  );
});

test("the catalog default is Luna only when billing can use it", () => {
  assert.equal(preferredAiModelOption.id, "gpt-5.6-luna");
  assert.equal(preferredAiModelOption.effort, "standard");
  assert.equal(defaultAiModelOption.id, "gpt-5.4-mini");
  assert.equal(getDefaultAiModelOptionForPlan("Pro").id, "gpt-5.6-luna");
  assert.equal(getDefaultAiModelOptionForPlan("AI").id, "gpt-5.6-luna");
  assert.equal(getDefaultAiModelOptionForPlan("Free").id, "gpt-5.4-mini");
  assert.equal(getDefaultAiModelOptionForPlan("BYOK").id, "gpt-5.4-mini");
  assert.equal(
    getDefaultAiModelOptionForPlan("BYOK", true).id,
    "gpt-5.6-luna",
  );
});

test("personal default beats the user-facing team default", () => {
  assert.equal(
    resolveUserFacingModelOption(
      "taskWriter",
      { featureModels: { taskWriter: "claude-sonnet-5-instant" } },
      "gpt-5.6-luna-high",
    ).id,
    "gpt-5.6-luna-high",
  );
});

test("custom team defaults require a configured endpoint", () => {
  const settings = { featureModels: { aiChat: "custom" } };

  assert.equal(
    resolveUserFacingModelOption("aiChat", settings, null, {
      customEndpointConfigured: true,
    }).id,
    "custom",
  );
  assert.equal(
    resolveUserFacingModelOption("aiChat", settings, null, {
      customEndpointConfigured: false,
    }).id,
    "gpt-5.4-mini",
  );
});

test("disabled providers invalidate personal and team defaults", () => {
  assert.equal(
    resolveUserFacingModelOption(
      "writeWithAi",
      {
        providers: { anthropic: false },
        featureModels: { writeWithAi: "claude-sonnet-5-instant" },
      },
      "claude-opus-5-thinking",
    ).id,
    "gpt-5.4-mini",
  );
});

test("trusted billing context can supply Luna as the user-facing fallback", () => {
  assert.equal(
    resolveUserFacingModelOption("aiChat", {}, null, {
      defaultModelOption: preferredAiModelOption,
    }).id,
    "gpt-5.6-luna",
  );
});

test("GDPR safe mode hides China-hosted feature overrides", () => {
  assert.equal(
    isAiFeatureModelEnabled("aiChat", "deepseek-v4-flash", {
      gdprSafeMode: true,
      providers: { deepseek: true },
    }),
    false,
  );
  assert.equal(
    isAiFeatureModelEnabled("summaries", "deepseek/deepseek-v4-flash", {
      gdprSafeMode: true,
      providers: { deepseek: true },
    }),
    false,
  );
  assert.equal(
    isAiFeatureModelEnabled("aiChat", "custom", { gdprSafeMode: true }),
    true,
  );
  assert.equal(
    isAiFeatureModelEnabled(
      "aiChat",
      "custom",
      { gdprSafeMode: true },
      false,
    ),
    false,
  );
});

test("turning a feature off resolves it as disabled", () => {
  const settings = {
    featureToggles: { aiChat: false, summaries: false },
  };

  assert.equal(resolveUserFacingModelOption("aiChat", settings), null);
  assert.equal(resolveSystemModel("summaries", settings), null);
});

test("feature override is ignored when its provider is disabled", () => {
  assert.deepEqual(
    resolveSystemModel("summaries", {
      providers: { openai: false },
      featureModels: { summaries: "openai/gpt-5.4-mini" },
    }),
    { provider: "google", model: "google/gemini-3.5-flash-lite" },
  );
});

test("feature override is ignored when its model is outside the ladder", () => {
  assert.deepEqual(
    resolveSystemModel("questionSuggestions", {
      featureModels: { questionSuggestions: "openai/gpt-5.5" },
    }),
    { provider: "google", model: "google/gemini-3.5-flash-lite" },
  );
});

test("clearing an override returns the feature to Auto", () => {
  const settings = updateSystemFeatureModelSettings(
    {
      providers: { google: true, openai: true },
      featureModels: { summaries: "openai/gpt-5.4-mini" },
    },
    "summaries",
    null,
  );

  assert.deepEqual(resolveSystemModel("summaries", settings), {
    provider: "google",
    model: "google/gemini-3.5-flash-lite",
  });
  assert.equal(settings.featureModels.summaries, undefined);
});

test("feature model writes leave provider settings untouched", () => {
  const providers = { google: false, openai: true, deepseek: true };
  const settings = updateSystemFeatureModelSettings(
    { providers, anotherSetting: "preserved" },
    "questionSuggestions",
    "openai/gpt-5.4-mini",
  );

  assert.deepEqual(settings.providers, providers);
  assert.equal(settings.anotherSetting, "preserved");
  assert.equal(
    settings.featureModels.questionSuggestions,
    "openai/gpt-5.4-mini",
  );
});

test("model, toggle, and reset writes never clobber provider settings", () => {
  const providers = { google: false, openai: true, anthropic: true };
  const original = {
    providers,
    anotherSetting: "preserved",
    featureModels: { aiChat: "claude-sonnet-5-instant" },
    featureToggles: { summaries: false },
  };

  const withModel = updateAiFeatureModelSettings(
    original,
    "hyperAi",
    "gpt-5.6-luna",
  );
  const withToggle = updateAiFeatureToggleSettings(
    withModel,
    "dictation",
    false,
  );
  const reset = resetAiFeatureSettings(withToggle);

  assert.deepEqual(withModel.providers, providers);
  assert.deepEqual(withToggle.providers, providers);
  assert.deepEqual(reset.providers, providers);
  assert.equal(reset.anotherSetting, "preserved");
  assert.equal(reset.featureModels, undefined);
  assert.equal(reset.featureToggles, undefined);
  assert.deepEqual(original.featureModels, {
    aiChat: "claude-sonnet-5-instant",
  });
  assert.deepEqual(original.featureToggles, { summaries: false });
});

test("legacy flat provider settings still control the ladder", () => {
  assert.deepEqual(
    resolveSystemModel("summaries", {
      google: false,
      xai: false,
      openai: true,
    }),
    { provider: "openai", model: "openai/gpt-5.4-mini" },
  );
});
