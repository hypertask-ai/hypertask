const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  fsCache: false,
});
const { aiModelDefinitions, aiModelOptions } = load(path.join(root, "src/lib/aiModelOptions.ts"));
const { buildByokTestRequest } = load(path.join(root, "src/app/api/settings/byok-test/providerTest.ts"));

const models = [
  ["gpt-6-luna", "Luna 6"],
  ["gpt-5.6-terra", "Terra 5.6"],
  ["gpt-6.1-sol", "Sol 6.1"],
];

test("every GPT definition keeps its key and displays name before version", () => {
  assert.deepEqual(
    aiModelDefinitions.filter((model) => model.provider === "openai")
      .map(({ key, label }) => [key, label]),
    models,
  );
});

test("every GPT title displays name before version without changing ids, keys or provider model strings", () => {
  const variants = [["", ""], ["-light", " Light"], ["-high", " High"]];
  assert.deepEqual(
    aiModelOptions.filter((option) => option.source === "openai")
      .map(({ id, modelKey, model, directModel, title }) => ({ id, modelKey, model, directModel, title })),
    models.flatMap(([key, label]) => variants.map(([idSuffix, titleSuffix]) => ({
      id: `${key}${idSuffix}`,
      modelKey: key,
      model: key,
      directModel: undefined,
      title: `GPT ${label}${titleSuffix}`,
    }))),
  );
});

test("BYOK OpenAI model labels use name before version without changing request model ids", () => {
  for (const [provider, modelId, label] of [
    ["openai", "gpt-6-luna", "Luna 6"],
    ["gateway", "openai/gpt-6-luna", "GPT Luna 6"],
    ["openrouter", "openai/gpt-6-luna", "GPT Luna 6"],
  ]) {
    const request = buildByokTestRequest(provider, "synthetic-test-key");
    assert.equal(request.modelLabel, label, provider);
    assert.equal(JSON.parse(request.init.body).model, modelId, provider);
  }
});
