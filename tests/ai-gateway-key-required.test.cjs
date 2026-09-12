const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");

function loadModelProvider() {
  const jiti = require("jiti")(
    path.join(root, "tests/jiti-gateway-key-required.cjs"),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    },
  );
  return jiti(path.join(root, "src/app/api/ai/_lib/modelProvider.ts"));
}

test("Vertex-only Grok Fast falls back to grok-4.20 on the Gateway", () => {
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_ENABLED;
  const {
    grokFastGatewayFallbackModels,
    gatewayProviderOptionsForModel,
    resolveGatewayModel,
  } = loadModelProvider();

  assert.deepEqual(
    grokFastGatewayFallbackModels("xai/grok-4.1-fast-non-reasoning"),
    [
      "spacexai/grok-4.1-fast-non-reasoning",
      "spacexai/grok-4.20-non-reasoning",
    ],
  );
  assert.deepEqual(
    grokFastGatewayFallbackModels("xai/grok-4.1-fast-reasoning"),
    ["spacexai/grok-4.1-fast-reasoning", "spacexai/grok-4.20-reasoning"],
  );
  assert.equal(
    grokFastGatewayFallbackModels("xai/grok-4.20-non-reasoning"),
    undefined,
  );

  const model = resolveGatewayModel(
    "xai/grok-4.1-fast-non-reasoning",
    "vck_team_inference",
  );
  const options = gatewayProviderOptionsForModel(model, "chat", {
    teamId: "team-1",
  });
  assert.deepEqual(options.gateway.models, [
    "spacexai/grok-4.1-fast-non-reasoning",
    "spacexai/grok-4.20-non-reasoning",
  ]);
  assert.ok(options.gateway.tags.includes("chat"));
  assert.ok(options.gateway.tags.includes("team:team-1"));
  console.log("grok fast gateway fallback verification passed");
});

test("gateway inference uses the spacexai Grok catalog slug", () => {
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_ENABLED;
  const { resolveGatewayModel } = loadModelProvider();
  const model = resolveGatewayModel(
    "xai/grok-4.1-fast-non-reasoning",
    "vck_team_inference",
  );
  assert.equal(model.modelId, "spacexai/grok-4.1-fast-non-reasoning");
});

test("missing team gateway key is an expected access error", () => {
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_ENABLED;
  const { resolveAiModel, resolveGatewayImageModel, resolveGatewayModel } =
    loadModelProvider();

  assert.throws(
    () => resolveGatewayModel("xai/grok-4.1-fast-non-reasoning"),
    (error) =>
      error?.name === "AiGatewayKeyRequiredError" &&
      /dedicated team AI Gateway key/.test(error.message),
  );
  assert.throws(
    () => resolveGatewayImageModel("openai/gpt-image-1"),
    (error) =>
      error?.name === "AiGatewayKeyRequiredError" &&
      /dedicated team AI Gateway key/.test(error.message),
  );
  assert.throws(
    () => resolveAiModel("openai", "gpt-5.4-mini"),
    (error) =>
      error?.name === "AiGatewayKeyRequiredError" &&
      /dedicated team AI Gateway key or direct BYOK key/.test(error.message),
  );
});
