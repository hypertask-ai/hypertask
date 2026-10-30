const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const root = path.resolve(__dirname, "..");
const SECRET = "htpr-6519-token-shape-secret-long-enough-for-hs256";

function sourceConstant(relativePath, constantName) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const match = source.match(
    new RegExp(`${constantName}\\s*=\\s*(?:process\\.env\\.\\w+\\s*\\|\\|\\s*)?['"]([^'"]+)['"]`),
  );
  assert.ok(
    match,
    `${constantName} is no longer a string literal in ${relativePath}; this test is describing a token shape that no longer exists.`,
  );
  return match[1];
}

const ISSUER = sourceConstant("src/lib/mcp/auth/verifyJwt.ts", "const JWT_ISSUER");
const MCP_AUDIENCE = sourceConstant("src/lib/mcp/auth/verifyJwt.ts", "JWT_MCP_AUDIENCE");
const LEGACY_MCP_AUDIENCE = sourceConstant("src/lib/mcp/auth/verifyJwt.ts", "JWT_LEGACY_MCP_AUDIENCE");
const CALENDAR_AUDIENCE = sourceConstant("src/app/api/calendar/feed/route.ts", "const CALENDAR_AUDIENCE");
const VERIFICATION_AUDIENCE = sourceConstant(
  "src/app/api/auth/instant-signup/route.ts",
  "const JWT_VERIFICATION_AUDIENCE",
);

const TOKEN_SHAPES = [
  {
    name: "MCP token (createMcpToken, 30 day default)",
    payload: { sub: "user@example.com", userId: 1, jti: "mcp-jti" },
    options: { issuer: ISSUER, audience: MCP_AUDIENCE, expiresIn: "30d" },
  },
  {
    name: "managed agent token (createMcpToken with agentId, no expiry)",
    payload: { sub: "agent@example.com", userId: 1, jti: "agent-jti", agentId: "agent-uuid" },
    options: { issuer: ISSUER, audience: MCP_AUDIENCE },
  },
  {
    name: "legacy MCP token (hypertasks-mcp audience)",
    payload: { sub: "user@example.com", userId: 1, jti: "legacy-jti" },
    options: { issuer: "hypertasks", audience: LEGACY_MCP_AUDIENCE, expiresIn: "30d" },
  },
  {
    name: "OAuth access token (createOAuthToken, 90 days as a number)",
    payload: { sub: "firebase-uid", userId: 1, email: "user@example.com", jti: "oauth-jti" },
    options: { issuer: "hypertask-oauth", audience: "hypertask-mcp", expiresIn: 90 * 24 * 60 * 60 },
  },
  {
    name: "calendar feed URL token (365d, travels in a query string)",
    payload: { userId: 7 },
    options: { issuer: ISSUER, audience: CALENDAR_AUDIENCE, expiresIn: "365d" },
  },
  {
    name: "email verification link (30m)",
    payload: { sub: "user@example.com" },
    options: { issuer: ISSUER, audience: VERIFICATION_AUDIENCE, expiresIn: "30m" },
  },
];

test("the installed jsonwebtoken is 9.x, and nothing pulls 8.x back in", () => {
  const installed = require("jsonwebtoken/package.json").version;
  assert.equal(
    Number(installed.split(".")[0]) >= 9,
    true,
    `jsonwebtoken ${installed} is installed; 8.x carries the advisories this bump exists to clear.`,
  );

  const declared = require(path.join(root, "package.json")).dependencies.jsonwebtoken;
  assert.match(
    declared,
    /^\^?9\./,
    `package.json asks for jsonwebtoken "${declared}"; a range that still admits 8.x defeats the upgrade.`,
  );

  const lock = require(path.join(root, "package-lock.json"));
  const stale = Object.entries(lock.packages || {})
    .filter(([name, meta]) => /(^|\/)jsonwebtoken$/.test(name) && String(meta.version).startsWith("8."))
    .map(([name, meta]) => `${name}@${meta.version}`);
  assert.deepEqual(stale, [], "package-lock.json still resolves jsonwebtoken 8.x somewhere");
});

for (const shape of TOKEN_SHAPES) {
  test(`${shape.name} still round-trips`, () => {
    const token = jwt.sign(shape.payload, SECRET, shape.options);
    const decoded = jwt.verify(token, SECRET, {
      issuer: shape.options.issuer,
      audience: shape.options.audience,
    });

    for (const [claim, value] of Object.entries(shape.payload)) {
      assert.equal(decoded[claim], value);
    }
    assert.equal(decoded.iss, shape.options.issuer);
    assert.equal(decoded.aud, shape.options.audience);
    assert.equal("exp" in decoded, shape.options.expiresIn !== undefined);
  });
}

test("the audience-free fallback in validateJwtToken still accepts an issuer list", () => {
  const token = jwt.sign({ jti: "fallback" }, SECRET, {
    issuer: ISSUER,
    audience: MCP_AUDIENCE,
    expiresIn: "30d",
  });

  const decoded = jwt.verify(token, SECRET, {
    issuer: ["hypertasks", ISSUER, "hypertask-oauth"],
  });
  assert.equal(decoded.jti, "fallback");
});

test("forged and stale tokens are still rejected", () => {
  const token = jwt.sign({ jti: "real" }, SECRET, {
    issuer: ISSUER,
    audience: MCP_AUDIENCE,
    expiresIn: "30d",
  });

  const unsigned = [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ jti: "forged", userId: 6, iss: ISSUER, aud: MCP_AUDIENCE })).toString("base64url"),
    "",
  ].join(".");

  assert.throws(() => jwt.verify(unsigned, SECRET, { issuer: ISSUER, audience: MCP_AUDIENCE }), jwt.JsonWebTokenError);
  assert.throws(() => jwt.verify(token, "a-different-secret", { issuer: ISSUER }), jwt.JsonWebTokenError);
  assert.throws(() => jwt.verify(token, SECRET, { issuer: ISSUER, audience: CALENDAR_AUDIENCE }), jwt.JsonWebTokenError);
  assert.throws(
    () => jwt.verify(jwt.sign({ jti: "old" }, SECRET, { expiresIn: -60 }), SECRET),
    jwt.TokenExpiredError,
  );
});
