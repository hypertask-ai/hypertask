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
  resolveAiModelOption,
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

test("disabling Google resolves to GPT 6 Luna", () => {
  assert.deepEqual(
    resolveSystemModel("summaries", { providers: { google: false } }),
    {
      provider: "openai",
      model: "openai/gpt-6-luna",
    },
  );
});

test("disabling Google and xAI resolves to GPT 6 Luna", () => {
  assert.deepEqual(
    resolveSystemModel("summaries", {
      providers: { google: false, xai: false },
    }),
    {
      provider: "openai",
      model: "openai/gpt-6-luna",
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
    { provider: "zhipu", model: "zai/glm-5.3-flash" },
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
      featureModels: { summaries: "openai/gpt-6-luna" },
    }),
    { provider: "openai", model: "openai/gpt-6-luna" },
  );
});

test("team default beats the user-facing product default", () => {
  assert.equal(
    resolveUserFacingModelOption("aiChat", {
      featureModels: { aiChat: "claude-sonnet-5-5-instant" },
    }).id,
    "claude-sonnet-5-5-instant",
  );
});

test("Luna is the paid default; Free gets it only with the htpr-6722 flag", () => {
  assert.equal(preferredAiModelOption.id, "gpt-6-luna");
  assert.equal(preferredAiModelOption.effort, "standard");
  assert.equal(defaultAiModelOption.id, "gemini-3.5-flash-lite");
  assert.equal(getDefaultAiModelOptionForPlan("Pro").id, "gpt-6-luna");
  assert.equal(getDefaultAiModelOptionForPlan("AI").id, "gpt-6-luna");
  assert.equal(getDefaultAiModelOptionForPlan("Free").id, "gemini-3.5-flash-lite");
  assert.equal(getDefaultAiModelOptionForPlan("Free", false, true).id, "gpt-6-luna");
  assert.equal(getDefaultAiModelOptionForPlan("BYOK").id, "gemini-3.5-flash-lite");
  assert.equal(
    getDefaultAiModelOptionForPlan("BYOK", true).id,
    "gpt-6-luna",
  );
});

test("saved legacy personal and board choices resolve to their new variants", () => {
  assert.equal(
    resolveUserFacingModelOption("aiChat", {}, "gpt-5.6-luna-high").id,
    "gpt-6-luna-high",
  );
  assert.equal(
    resolveUserFacingModelOption("aiChat", {
      featureModels: { aiChat: "claude-opus-5-thinking" },
    }).id,
    "claude-opus-5-5-thinking",
  );
});

test("personal default beats the user-facing team default", () => {
  assert.equal(
    resolveUserFacingModelOption(
      "taskWriter",
      { featureModels: { taskWriter: "claude-sonnet-5-5-instant" } },
      "gpt-6-luna-high",
    ).id,
    "gpt-6-luna-high",
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
    "gemini-3.5-flash-lite",
  );
});

test("disabled providers invalidate personal and team defaults", () => {
  assert.equal(
    resolveUserFacingModelOption(
      "writeWithAi",
      {
        providers: { anthropic: false },
        featureModels: { writeWithAi: "claude-sonnet-5-5-instant" },
      },
      "claude-opus-5-5-thinking",
    ).id,
    "gemini-3.5-flash-lite",
  );
});

test("trusted billing context can supply Luna as the user-facing fallback", () => {
  assert.equal(
    resolveUserFacingModelOption("aiChat", {}, null, {
      defaultModelOption: preferredAiModelOption,
    }).id,
    "gpt-6-luna",
  );
});

test("GDPR safe mode hides China-hosted feature overrides", () => {
  assert.equal(
    isAiFeatureModelEnabled("aiChat", "deepseek-v4.1-flash", {
      gdprSafeMode: true,
      providers: { deepseek: true },
    }),
    false,
  );
  assert.equal(
    isAiFeatureModelEnabled("summaries", "deepseek/deepseek-v4.1-flash", {
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
      featureModels: { summaries: "openai/gpt-6-luna" },
    }),
    { provider: "google", model: "google/gemini-3.5-flash-lite" },
  );
});

test("saved overrides naming retired fast-ladder slugs upgrade to their successors", () => {
  for (const [old, next, provider] of [
    ["openai/gpt-5.4-mini", "openai/gpt-6-luna", "openai"],
    ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4.1-flash", "deepseek"],
    ["zai/glm-5.2", "zai/glm-5.3-flash", "zhipu"],
  ]) {
    assert.deepEqual(
      resolveSystemModel("summaries", {
        providers: { openai: true, deepseek: true, zhipu: true },
        featureModels: { summaries: old },
      }),
      { provider, model: next },
    );
  }
});

test("feature override is ignored when its model is outside the ladder", () => {
  assert.deepEqual(
    resolveSystemModel("questionSuggestions", {
      featureModels: { questionSuggestions: "openai/gpt-6.1-sol" },
    }),
    { provider: "google", model: "google/gemini-3.5-flash-lite" },
  );
});

test("clearing an override returns the feature to Auto", () => {
  const settings = updateSystemFeatureModelSettings(
    {
      providers: { google: true, openai: true },
      featureModels: { summaries: "openai/gpt-6-luna" },
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
    "openai/gpt-6-luna",
  );

  assert.deepEqual(settings.providers, providers);
  assert.equal(settings.anotherSetting, "preserved");
  assert.equal(
    settings.featureModels.questionSuggestions,
    "openai/gpt-6-luna",
  );
});

test("model, toggle, and reset writes never clobber provider settings", () => {
  const providers = { google: false, openai: true, anthropic: true };
  const original = {
    providers,
    anotherSetting: "preserved",
    featureModels: { aiChat: "claude-sonnet-5-5-instant" },
    featureToggles: { summaries: false },
  };

  const withModel = updateAiFeatureModelSettings(
    original,
    "hyperAi",
    "gpt-6-luna",
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
    aiChat: "claude-sonnet-5-5-instant",
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
    { provider: "openai", model: "openai/gpt-6-luna" },
  );
});

test("model picker: Free with no saved choice gets Luna only when the flag is on; saved choice wins", () => {
  const pick = (saved, lunaFree) =>
    resolveAiModelOption(saved, getDefaultAiModelOptionForPlan("Free", false, lunaFree)).id;
  assert.equal(pick([undefined, null], true), "gpt-6-luna");
  assert.equal(pick([undefined, null], false), "gemini-3.5-flash-lite");
  assert.equal(pick(["gemini-3.5-flash-lite"], true), "gemini-3.5-flash-lite");
  assert.equal(pick([null, "gpt-6-luna"], false), "gpt-6-luna");
  assert.equal(pick(["not-a-model"], true), "gpt-6-luna");
});

test("useAiModelPreference passes the htpr-6722 flag into the plan default", () => {
  const src = require("node:fs").readFileSync(
    path.join(root, "src/hooks/General/useAiModelPreference.ts"),
    "utf8",
  );
  assert.match(src, /useFlag\(LUNA_FREE_PLAN_FLAG\)/);
  assert.match(src, /getDefaultAiModelOptionForPlan\([\s\S]*?lunaFree,\s*\)/);
});
