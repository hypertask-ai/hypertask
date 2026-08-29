const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/mcp-usage-scope.test.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") } },
);
const { aggregateGatewayTeamUsage, gatewayGet } = jiti(
  path.join(root, "src/app/api/settings/ai-usage/gatewayUsage.ts"),
);

const scopeLabels = jiti(
  path.join(root, "src/components/Modals/Settings/managementKeyScope.ts"),
);

test("gateway totals provide the usage counts and spend basis", () => {
  assert.deepEqual(
    aggregateGatewayTeamUsage({
      results: [
        {
          cached_input_tokens: 2,
          input_tokens: 100,
          output_tokens: 20,
          reasoning_tokens: 4,
          request_count: 2,
          total_cost: 0.25,
        },
        {
          cached_input_tokens: 3,
          input_tokens: 40,
          output_tokens: 10,
          reasoning_tokens: 1,
          request_count: 1,
          total_cost: "0.10",
        },
      ],
    }),
    {
      cachedInputTokens: 5,
      inputTokens: 140,
      outputTokens: 30,
      reasoningTokens: 5,
      requestCount: 3,
      totalCost: 0.35,
    },
  );
});

test("gateway totals default omitted fields to zero", () => {
  assert.deepEqual(
    aggregateGatewayTeamUsage({ results: [{}] }),
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      requestCount: 0,
      totalCost: 0,
    },
  );
});

test("gateway totals reject malformed rows and non-finite numbers", () => {
  assert.throws(
    () => aggregateGatewayTeamUsage({}),
    /Invalid AI Gateway report response/,
  );
  assert.throws(
    () => aggregateGatewayTeamUsage({ results: [null] }),
    /Invalid AI Gateway report row/,
  );
  for (const field of [
    "cached_input_tokens",
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "request_count",
    "total_cost",
  ]) {
    for (const value of ["not-a-number", NaN, Infinity, -Infinity, -1]) {
      assert.throws(
        () => aggregateGatewayTeamUsage({ results: [{ [field]: value }] }),
        new RegExp(`Invalid AI Gateway ${field}`),
      );
    }
  }
  assert.throws(
    () => aggregateGatewayTeamUsage({
      results: [
        { total_cost: Number.MAX_VALUE },
        { total_cost: Number.MAX_VALUE },
      ],
    }),
    /Invalid AI Gateway total_cost/,
  );
  const countFields = [
    "cached_input_tokens",
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "request_count",
  ];
  for (const field of countFields) {
    for (const value of [0.5, "0.5", Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => aggregateGatewayTeamUsage({ results: [{ [field]: value }] }),
        new RegExp(`Invalid AI Gateway ${field}`),
      );
    }
    assert.throws(
      () => aggregateGatewayTeamUsage({
        results: [
          { [field]: Number.MAX_SAFE_INTEGER },
          { [field]: 1 },
        ],
      }),
      new RegExp(`Invalid AI Gateway ${field}`),
    );
  }
  assert.deepEqual(
    aggregateGatewayTeamUsage({
      results: [{
        cached_input_tokens: null,
        input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
        request_count: null,
        total_cost: null,
      }],
    }),
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      requestCount: 0,
      totalCost: 0,
    },
  );
});

test("gateway response limits reject unsafe allocations", async () => {
  await assert.rejects(
    () => gatewayGet("/report", "", { maxBytes: Number.MAX_SAFE_INTEGER }),
    /Invalid AI Gateway response size limit/,
  );
});

test("gateway response limits reject oversized bodies", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return new Response("12345");
  };

  try {
    await assert.rejects(
      () => gatewayGet("/report", "", { maxBytes: 4 }),
      /AI Gateway response is too large/,
    );
    assert.equal(fetchCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("gateway response limits count UTF-8 bytes and allow exact limits", async () => {
  const originalFetch = global.fetch;
  const responses = ["1234", "€"];
  global.fetch = async () => new Response(responses.shift());

  try {
    const exactResponse = await gatewayGet("/report", "", { maxBytes: 4 });
    assert.equal(await exactResponse.text(), "1234");

    const utf8Response = await gatewayGet("/report", "", {
      maxBytes: Buffer.byteLength("€"),
    });
    assert.equal(await utf8Response.text(), "€");
  } finally {
    global.fetch = originalFetch;
  }
});

test("credential inventory labels each management-key scope", () => {
  assert.equal(
    scopeLabels.managementKeyScopeLabel({ usage: ["read"] }),
    "Usage only",
  );
  assert.equal(
    scopeLabels.managementKeyScopeLabel({
      data: ["read", "write"],
      management: ["read", "write"],
      usage: ["read"],
    }),
    "Full account access",
  );
  assert.equal(
    scopeLabels.managementKeyScopeLabel({
      data: ["read", "write"],
      management: ["read", "write"],
    }),
    "Full account access",
  );
  assert.equal(
    scopeLabels.managementKeyScopeLabel({
      data: ["read", "write"],
      management: ["read", "write"],
      unknown: ["read"],
    }),
    "Unknown",
  );
  assert.equal(
    scopeLabels.managementKeyScopeLabel({ management: ["read", "write"] }),
    "Management only",
  );
  assert.equal(scopeLabels.managementKeyScopeLabel({}), "Unknown");
  assert.equal(
    scopeLabels.managementKeyScopeLabel({ usage: ["write"] }),
    "Unknown",
  );
  assert.equal(
    scopeLabels.managementKeyScopeLabel({ usage: "read" }),
    "Unknown",
  );
  assert.equal(
    scopeLabels.managementKeyScopeLabel({
      data: ["read"],
      management: ["write"],
    }),
    "Unknown",
  );
  assert.equal(
    scopeLabels.managementKeyScopeLabel({ unknown: ["read"] }),
    "Unknown",
  );
});
