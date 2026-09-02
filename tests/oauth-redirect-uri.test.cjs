const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const { isValidRedirectUri } = jiti(
  path.join(root, "src/lib/oauth/redirect-uri.ts"),
);

test("redirect URI validation accepts supported public-client targets", () => {
  for (const uri of [
    "https://claude.ai/api/mcp/callback",
    "http://localhost:3000/callback",
    "http://127.0.0.1/callback",
    "cursor://oauth/callback",
    "hypertask-native://oauth/callback",
  ]) {
    assert.equal(isValidRedirectUri(uri), true, uri);
  }
});

test("redirect URI validation rejects unsafe or malformed targets", () => {
  for (const uri of [
    "http://example.com/callback",
    "https://example.com/callback#fragment",
    "https://user:password@example.com/callback",
    "https://",
    "cursor://",
    "javascript://callback",
  ]) {
    assert.equal(isValidRedirectUri(uri), false, uri);
  }
});
