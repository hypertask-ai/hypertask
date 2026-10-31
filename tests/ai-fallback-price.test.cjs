const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  aiModelOptions,
  getAiModelDefinition,
  getAiModelOptionById,
  pickReplacementAiModelOption,
} = jiti(path.join(root, "src/lib/aiModelOptions.ts"));

const tierOf = (option) => getAiModelDefinition(option.modelKey)?.priceTier ?? 3;
const enabledExcept = (provider) =>
  aiModelOptions.filter((option) => {
    const definition = getAiModelDefinition(option.modelKey);
    return (
      definition &&
      definition.provider !== "custom" &&
      definition.provider !== provider
    );
  });

test("a tier-1 model is never replaced by a pricier one", () => {
  const haiku = getAiModelOptionById("claude-haiku-5-5");
  assert.ok(haiku, "expected a Haiku 5.5 option to exist");
  assert.equal(tierOf(haiku), 1);

  const fallback = pickReplacementAiModelOption(
    haiku.modelKey,
    enabledExcept("anthropic")
  );

  assert.ok(fallback, "expected a fallback with other providers enabled");
  assert.ok(
    tierOf(fallback) <= tierOf(haiku),
    `fallback ${fallback.modelKey} is tier ${tierOf(fallback)}, pricier than tier ${tierOf(haiku)}`
  );
});

test("every model has a fallback no pricier than itself when one provider goes away", () => {
  for (const option of aiModelOptions) {
    const definition = getAiModelDefinition(option.modelKey);
    if (!definition || definition.provider === "custom") continue;
    const fallback = pickReplacementAiModelOption(
      option.modelKey,
      enabledExcept(definition.provider)
    );
    assert.ok(fallback, `no fallback for ${option.id}`);
    assert.ok(
      tierOf(fallback) <= tierOf(option),
      `${option.id} (tier ${tierOf(option)}) fell back to ${fallback.modelKey} (tier ${tierOf(fallback)})`
    );
  }
});

test("with nothing cheaper available it still returns a model rather than nothing", () => {
  const cheapest = aiModelOptions.find((option) => tierOf(option) === 1);
  const onlyExpensive = aiModelOptions.filter((option) => tierOf(option) === 3);
  assert.ok(cheapest && onlyExpensive.length > 0);
  assert.ok(pickReplacementAiModelOption(cheapest.modelKey, onlyExpensive));
});
