const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-byok-provider-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    },
  );
  return jiti(path.join(root, relativePath));
}

test("BYOK test requests use one-token provider calls without exposing keys in URLs", () => {
  const { buildByokTestRequest } = loadTs(
    "src/app/api/settings/byok-test/providerTest.ts",
  );
  const secret = "sk-test-secret-value";
  const expected = {
    gateway: ["https://ai-gateway.vercel.sh/v1/chat/completions", "openai/gpt-5.4-mini"],
    openai: ["https://api.openai.com/v1/chat/completions", "gpt-5.4-mini"],
    claude: ["https://api.anthropic.com/v1/messages", "claude-haiku-4.5"],
    google: ["https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-3.5-flash-lite"],
    xai: ["https://api.x.ai/v1/chat/completions", "grok-4-1-fast-non-reasoning"],
    deepseek: ["https://api.deepseek.com/chat/completions", "deepseek-v4-flash"],
    moonshot: ["https://api.moonshot.ai/v1/chat/completions", "kimi-k2.5"],
    zhipu: ["https://api.z.ai/api/paas/v4/chat/completions", "glm-5.2"],
    alibaba: ["https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", "qwen3.7-plus"],
    openrouter: ["https://openrouter.ai/api/v1/chat/completions", "openai/gpt-5.4-mini"],
  };

  for (const [provider, [url, model]] of Object.entries(expected)) {
    const request = buildByokTestRequest(provider, secret);
    assert.ok(request, `${provider} should have a test request`);
    assert.equal(request.url, url);
    assert.equal(request.url.includes(secret), false);
    const body = JSON.parse(request.init.body);
    assert.equal(body.model, model);
    assert.equal(body.max_tokens ?? body.max_completion_tokens, 1);
  }

  const custom = buildByokTestRequest("custom", secret, {
    baseUrl: "https://gateway.example.com/openai/v1/",
    modelId: "llama-4-70b",
  });
  assert.equal(
    custom.url,
    "https://gateway.example.com/openai/v1/chat/completions",
  );
  assert.equal(custom.url.includes(secret), false);
  assert.equal(JSON.parse(custom.init.body).model, "llama-4-70b");
});

test("BYOK test response classification separates auth and credit failures", () => {
  const { classifyByokTestResponse } = loadTs(
    "src/app/api/settings/byok-test/providerTest.ts",
  );

  assert.equal(classifyByokTestResponse(200, ""), "works");
  assert.equal(classifyByokTestResponse(401, "invalid_api_key"), "invalid");
  assert.equal(classifyByokTestResponse(402, ""), "no_credit");
  assert.equal(
    classifyByokTestResponse(429, "insufficient credit balance"),
    "no_credit",
  );
  assert.equal(classifyByokTestResponse(429, "rate limit"), "error");
});

test("saved BYOK keys expose a constant mask with only the last four characters", () => {
  const { maskByokSecret } = loadTs("src/lib/crypto/maskByokSecret.ts");
  const masked = maskByokSecret("vck_private-team-secret-4kLm");

  assert.equal(masked, "••••••••4kLm");
  assert.equal(masked.includes("private"), false);
  assert.equal(masked.includes("vck_"), false);
});

test("custom endpoint metadata shares one versioned secret payload", () => {
  const {
    normalizeCustomEndpointBaseUrl,
    parseCustomEndpointConfig,
    serializeCustomEndpointConfig,
  } = loadTs("src/lib/ai/customEndpoint.ts");
  const config = {
    apiKey: "custom-secret",
    baseUrl: "https://gateway.example.com/v1/",
    gdprCompliant: true,
    modelId: "model-id",
  };

  const serialized = serializeCustomEndpointConfig(config);
  assert.deepEqual(parseCustomEndpointConfig(serialized), {
    ...config,
    baseUrl: "https://gateway.example.com/v1",
  });
  assert.equal(parseCustomEndpointConfig("custom-secret"), null);
  assert.equal(
    parseCustomEndpointConfig(
      JSON.stringify({
        kind: "openai-compatible",
        version: 1,
        apiKey: "legacy-secret",
        baseUrl: "https://legacy.example.com/v1",
        modelId: "legacy-model",
      }),
    ).gdprCompliant,
    false,
  );
  assert.throws(
    () => normalizeCustomEndpointBaseUrl("http://127.0.0.1:3000/v1"),
    /public HTTP\(S\) host/,
  );
});
