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
