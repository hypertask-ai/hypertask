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

test("gateway tags stay on chat calls without Grok fallbacks", () => {
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_ENABLED;
  const { gatewayProviderOptionsForModel, resolveGatewayModel } =
    loadModelProvider();

  const model = resolveGatewayModel(
    "google/gemini-3.5-flash-lite",
    "vck_team_inference",
  );
  const options = gatewayProviderOptionsForModel(model, "chat", {
    teamId: "team-1",
  });
  assert.equal(options.gateway.models, undefined);
  assert.ok(options.gateway.tags.includes("chat"));
  assert.ok(options.gateway.tags.includes("team:team-1"));
});

test("missing team gateway key is an expected access error", () => {
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_ENABLED;
  const { resolveAiModel, resolveGatewayImageModel, resolveGatewayModel } =
    loadModelProvider();

  assert.throws(
    () => resolveGatewayModel("google/gemini-3.5-flash-lite"),
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
