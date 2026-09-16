const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

// Keep this in sync with src/lib/mcp/bearerAuth.ts (CI runs Node 20; no strip-types).
const MCP_TOKEN_MASK = "***";
function isUsableMcpBearerToken(token) {
  return Boolean(token) && token !== MCP_TOKEN_MASK;
}
function mcpAuthorizationHeaders(token) {
  return isUsableMcpBearerToken(token)
    ? { Authorization: `Bearer ${token}` }
    : {};
}
function readMcpTokenCookieValue(cookieHeader) {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("mcp_token=")) continue;
    const value = trimmed.slice("mcp_token=".length);
    return value || null;
  }
  return null;
}

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

test("useMcpToken reads cookies through readMcpTokenCookieValue", () => {
  const hook = fs.readFileSync(
    path.join(root, "src/components/Modals/McpToken/hooks/useMcpToken.ts"),
    "utf8",
  );
  const source = fs.readFileSync(
    path.join(root, "src/lib/mcp/bearerAuth.ts"),
    "utf8",
  );
  assert.match(hook, /readMcpTokenCookieValue\(document\.cookie\)/);
  assert.doesNotMatch(hook, /tokenCookie\.split\("="\)\[1\]/);
  assert.match(hook, /MCP_TOKEN_MASK/);
  assert.match(source, /export function isUsableMcpBearerToken/);
  assert.match(source, /export function mcpAuthorizationHeaders/);
  assert.match(source, /export function readMcpTokenCookieValue/);
});
