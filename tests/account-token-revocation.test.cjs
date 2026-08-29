const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
process.env.JWT_SECRET = "account-token-revocation-test-secret-32-characters";
process.env.JWT_ISSUER = "hypertask";

const jiti = require("jiti")(
  path.join(root, "tests/account-token-revocation-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);

const { createMcpToken } = jiti(path.join(root, "src/lib/mcp/auth.ts"));
const {
  InvalidAccountMcpTokenError,
  ownedAccountTokenRevocationTarget,
} = jiti(path.join(root, "src/lib/mcp/accountTokens.ts"));

test("account token revocation verifies ownership and retains the signed expiry", () => {
  const token = createMcpToken(6, "owner@example.test", "2d");
  const target = ownedAccountTokenRevocationTarget(token, 6);

  assert.match(target.jti, /^[0-9a-f-]{36}$/);
  assert.ok(target.expiresAt > new Date());
  assert.ok(target.expiresAt < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
});

test("account token revocation rejects arbitrary, cross-owner, and agent tokens", () => {
  const crossOwner = createMcpToken(7, "other@example.test", "2d");
  const agentToken = createMcpToken(
    6,
    "owner@example.test",
    "2d",
    "agent-id",
  );

  for (const token of ["random-jti", crossOwner, agentToken]) {
    assert.throws(
      () => ownedAccountTokenRevocationTarget(token, 6),
      InvalidAccountMcpTokenError,
    );
  }
});
