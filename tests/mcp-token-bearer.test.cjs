const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
require("tsx/cjs");

const {
  MCP_TOKEN_MASK,
  isUsableMcpBearerToken,
  mcpAuthorizationHeaders,
  readMcpTokenCookieValue,
} = require(path.join(root, "src/lib/mcp/bearerAuth.ts"));

test("masked MCP token is not a usable Authorization bearer", () => {
  assert.equal(isUsableMcpBearerToken(null), false);
  assert.equal(isUsableMcpBearerToken(""), false);
  assert.equal(isUsableMcpBearerToken(MCP_TOKEN_MASK), false);
  assert.equal(isUsableMcpBearerToken("***"), false);
  assert.equal(isUsableMcpBearerToken("header.payload.signature"), true);
  assert.deepEqual(mcpAuthorizationHeaders("***"), {});
  const headers = mcpAuthorizationHeaders("header.payload.signature");
  assert.equal(Object.keys(headers).join(","), "Authorization");
  assert.equal(headers.Authorization.startsWith("Bearer "), true);
  assert.equal(
    headers.Authorization.slice("Bearer ".length),
    "header.payload.signature",
  );
});

test("mcp_token cookie parse keeps JWT padding after equals signs", () => {
  assert.equal(
    readMcpTokenCookieValue("mcp_token=aaa.bbb.ccc=; path=/"),
    "aaa.bbb.ccc=",
  );
  assert.equal(
    readMcpTokenCookieValue("foo=1; mcp_token=aaa.bbb.ccc=; bar=2"),
    "aaa.bbb.ccc=",
  );
  assert.equal(readMcpTokenCookieValue("session=abc"), null);
});
