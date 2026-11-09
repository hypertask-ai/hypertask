const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const auto = load(path.join(root, "src/app/api/ai/_lib/autoModel.ts"));
const effort = load(path.join(root, "src/app/api/ai/_lib/reasoningEffort.ts"));
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const ladder = load(path.join(root, "src/lib/systemModelLadder.ts"));
const { AI_PROVIDERS } = load(path.join(root, "src/lib/aiProviders.ts"));

const only = (...on) => ({ providers: Object.fromEntries(AI_PROVIDERS.map((p) => [p.key, on.includes(p.key)])) });
const def = (option) => catalog.getAiModelDefinition(option.modelKey);
const pick = (feature, extra = {}) => auto.pickAutoModelOption({ feature, settings: {}, plan: "Pro", ...extra });
const features = ["aiChat", "askAi", "taskWriter", "hyperAi", "writeWithAi", "improveWriting", "boardGeneration"];

test("short jobs get the cheap tier and planning gets the strong tier", () => {
  for (const feature of ["taskWriter", "writeWithAi", "improveWriting", "aiChat", "askAi"]) assert.equal(def(pick(feature)).priceTier, 1, feature);
  assert.equal(def(pick("hyperAi")).priceTier, 2);
  assert.equal(def(pick("boardGeneration")).priceTier, 3);
  assert.equal(effort.tierForFeature("taskWriter"), effort.FEATURE_PROFILE["task-writer"].tier);
});

test("the chat steps up on a long thread, a retry or a code block, and stops at the top tier", () => {
  const long = Array.from({ length: auto.AUTO_LONG_THREAD_MESSAGES }, () => ({ role: "human", content: "hi" }));
  assert.equal(auto.chatStepUp({ message: "hello", history: [] }), 0);
  assert.equal(auto.chatStepUp({ message: "hello", history: long }), 1);
  assert.equal(auto.chatStepUp({ message: "again", history: [{ role: "human", content: "again" }] }), 1);
  assert.equal(auto.chatStepUp({ message: "fix ```js\nx\n```", history: null }), 1);
  assert.deepEqual([0, 1, 2, 5].map((stepUp) => def(pick("aiChat", { stepUp })).priceTier), [1, 2, 3, 3]);
});

test("an Anthropic only workspace routes across Haiku, Sonnet and Opus and never leaves Anthropic", () => {
  const settings = only("anthropic");
  assert.deepEqual([0, 1, 2].map((stepUp) => pick("aiChat", { settings, stepUp }).modelKey), ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  for (const key of ["anthropic", "openai", "google", "deepseek"]) {
    for (const feature of features) {
      for (const stepUp of [0, 1, 2]) {
        const option = pick(feature, { settings: only(key), stepUp });
        if (option) assert.equal(def(option).provider, key, `${key} ${feature}`);
      }
    }
  }
  assert.equal(pick("aiChat", { settings: only() }), null);
});

test("BYOK picks only models behind a key the customer enabled", () => {
  for (const stepUp of [0, 1, 2]) {
    assert.equal(pick("aiChat", { plan: "BYOK", stepUp, byokProviderFlags: [{ provider: "claude", enabled: true }] }).source, "claude");
  }
  assert.equal(def(pick("aiChat", { plan: "BYOK", byokProviderFlags: [{ provider: "google", enabled: true }] })).provider, "google");
  assert.equal(pick("aiChat", { plan: "BYOK", byokProviderFlags: [] }), null);
  assert.equal(pick("aiChat", { plan: "BYOK", byokProviderFlags: [{ provider: "claude", enabled: false }] }), null);
});

test("a forced team key limits Auto to that provider", () => {
  const settings = only("anthropic", "openai");
  for (const stepUp of [0, 1, 2]) assert.equal(def(pick("aiChat", { settings, stepUp, forcedProvider: "claude" })).provider, "anthropic");
  assert.equal(pick("aiChat", { settings: only("anthropic"), forcedProvider: "openai" }), null);
});

test("the background ladder returns nothing instead of another provider when Auto is on", () => {
  assert.equal(ladder.resolveSystemModel("summaries", only(), true, { ownModelsOnly: true }), null);
  assert.ok(ladder.resolveSystemModel("summaries", only(), true, {}));
  assert.equal(ladder.resolveSystemModel("summaries", only("anthropic"), true, { ownModelsOnly: true }).provider, "anthropic");
});

test("Auto never picks a fast variant and the free plan stays off premium models", () => {
  const settings = only(...AI_PROVIDERS.map((p) => p.key));
  for (const feature of features) {
    for (const stepUp of [0, 1, 2]) {
      const option = pick(feature, { settings, stepUp, grokGemini4Enabled: true });
      assert.doesNotMatch(`${option.id} ${option.modelKey} ${option.model}`, /-fast/);
    }
  }
  assert.equal(auto.autoModelPool({ settings, plan: "Free" }).some((o) => catalog.isPremiumAiModelDefinition(def(o), true)), false);
});

test("Auto is recognised by the picker id only", () => {
  assert.equal(auto.isAutoRequest(catalog.AUTO_MODEL_OPTION_ID), true);
  assert.equal(auto.isAutoRequest("claude-haiku-5-5"), false);
  assert.equal(catalog.getMobileAiChatModelLabel({ id: catalog.AUTO_MODEL_OPTION_ID }), "Auto");
});
