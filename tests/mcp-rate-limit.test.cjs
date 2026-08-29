const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/mcp-rate-limit.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { decideMcpRateLimit, MCP_RATE_LIMIT_WINDOW_SECONDS } = jiti(
  path.join(root, "src/lib/mcp/rateLimitDecision.ts")
);

test("under the limit is not limited", () => {
  const result = decideMcpRateLimit(50, 120, 1000, 1010);
  assert.equal(result.limited, false);
  assert.equal(result.retryAfterSeconds, 0);
});

test("exactly at the limit is not limited (limit is inclusive)", () => {
  const result = decideMcpRateLimit(120, 120, 1000, 1010);
  assert.equal(result.limited, false);
});

test("one over the limit is limited", () => {
  const result = decideMcpRateLimit(121, 120, 1000, 1010);
  assert.equal(result.limited, true);
});

test("retryAfterSeconds counts down to the window boundary", () => {
  const result = decideMcpRateLimit(121, 120, 1000, 1010, MCP_RATE_LIMIT_WINDOW_SECONDS);
  // window covers [1000, 1060); 1010 is 10s in, so 50s remain
  assert.equal(result.retryAfterSeconds, 50);
});

test("retryAfterSeconds never reports zero or negative even at the window edge", () => {
  const result = decideMcpRateLimit(200, 120, 1000, 1060);
  assert.equal(result.limited, true);
  assert.equal(result.retryAfterSeconds, 1);
});
