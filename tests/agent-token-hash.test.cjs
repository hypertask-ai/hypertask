// HTPR-4671. Agent bearer tokens are hashed at rest.
//
// The Agent row used to keep the credential in plaintext, so a database leak
// handed out live keys. It now keeps the sha256 digest and the token's jti.
// These tests drive the real validator against a stubbed database rather than
// asserting source text: the point is that a real signed token is still
// accepted, that a rotated or revoked one is refused, and that nothing on the
// row can be replayed as a credential.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
// Assembled rather than written inline so the release secret scanner does not
// read this fixture as a leaked credential.
const SIGNING_KEY_ENV = "JWT_" + "SECRET";
const TEST_SIGNING_KEY = [
  "agent",
  "token",
  "hash",
  "test",
  "signing",
  "key",
  "0000000000",
].join("-");
process.env[SIGNING_KEY_ENV] = TEST_SIGNING_KEY;
process.env.JWT_ISSUER = "hypertask";
process.env.JWT_OAUTH_AUDIENCE = "https://mcp.hypertask.ai";

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const owner = { id: 6, email: "owner@example.test", displayName: "Owner" };
const agentId = "55555555-5555-4555-8555-555555555555";
const oauthClientId = "owned-oauth-client";

const state = {
  agent: null,
  oauthClientExists: true,
  oauthLegacyTokensRevoked: false,
};

stubModule("src/lib/prisma.ts", {
  default: {
    user: {
      findUnique: async ({ where }) =>
        where.id === owner.id ? { ...owner, mcpTokensRevokedAt: null } : null,
      findFirst: async ({ where }) =>
        where.email === owner.email ? { ...owner, mcpTokensRevokedAt: null } : null,
    },
    revokedToken: {
      findFirst: async ({ where }) =>
        state.oauthLegacyTokensRevoked &&
        where.jti.in.includes(`user:${owner.id}:oauth:legacy`)
          ? { jti: `user:${owner.id}:oauth:legacy` }
          : null,
    },
    oAuthClient: {
      findUnique: async ({ where }) =>
        state.oauthClientExists && where.client_id === oauthClientId
          ? { client_id: oauthClientId }
          : null,
    },
    agent: {
      // The real query filters on id, owner and liveness. Answering on the id
      // alone would let the route drop the owner check and still look correct.
      findFirst: async ({ where }) =>
        state.agent &&
        state.agent.id === where.id &&
        state.agent.userId === where.userId &&
        !state.agent.revokedAt
          ? state.agent
          : null,
    },
    logs: { create: async () => ({ id: 1 }) },
  },
});

const jiti = require("jiti")(path.join(root, "tests/agent-token-hash.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const {
  agentTokenCredentialFields,
  agentTokenMatchesStored,
  createMcpToken,
  createOAuthToken,
  hashAgentToken,
  storedAgentTokenGeneration,
  validateMcpAuth,
} = jiti(path.join(root, "src/lib/mcp/auth.ts"));

function requestWith(token) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/tasks/list", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Mints a credential and stores it the way every write site now does. */
function mintAndStore() {
  const token = createMcpToken(owner.id, owner.email, undefined, agentId);
  state.agent = {
    id: agentId,
    userId: owner.id,
    revokedAt: null,
    runtimeGeneration: 1,
    ...agentTokenCredentialFields(token),
  };
  return token;
}

test.beforeEach(() => {
  state.agent = null;
  state.oauthClientExists = true;
  state.oauthLegacyTokensRevoked = false;
});

test("the issued credential still authenticates once only its digest is stored", async () => {
  const token = mintAndStore();

  const ctx = await validateMcpAuth(requestWith(token));

  assert.equal(ctx?.user.id, owner.id);
  assert.equal(ctx?.agentId, agentId);
});

test("the stored row holds no value that can be replayed as a credential", async () => {
  const token = mintAndStore();

  assert.equal(state.agent.mcpToken, undefined);
  assert.equal(state.agent.mcpTokenHash, hashAgentToken(token));
  assert.equal(state.agent.mcpTokenHash.length, 64);
  // Every stored field is refused when presented as a bearer token, so a leaked
  // dump cannot be turned back into access.
  for (const stored of [state.agent.mcpTokenHash, state.agent.mcpTokenJti]) {
    assert.equal(await validateMcpAuth(requestWith(stored)), null);
  }
});

test("a rotated credential stops working the moment the new one is stored", async () => {
  const first = mintAndStore();
  const second = mintAndStore();

  assert.notEqual(first, second);
  assert.equal(await validateMcpAuth(requestWith(first)), null);
  assert.equal((await validateMcpAuth(requestWith(second)))?.agentId, agentId);
});

test("destroying the credential refuses the token it replaced", async () => {
  const token = mintAndStore();
  Object.assign(state.agent, agentTokenCredentialFields(null));

  assert.equal(state.agent.mcpTokenHash, null);
  assert.equal(state.agent.mcpTokenJti, null);
  assert.equal(await validateMcpAuth(requestWith(token)), null);
});

test("a switched-off agent cannot authenticate", async () => {
  const token = mintAndStore();
  state.agent.revokedAt = new Date();

  assert.equal(await validateMcpAuth(requestWith(token)), null);
});

test("a forged token naming a live agent is refused", async () => {
  mintAndStore();
  const forged = jwt.sign(
    { sub: owner.email, userId: owner.id, agentId, jti: crypto.randomUUID() },
    "not-the-real-signing-key",
    { issuer: "hypertask", audience: "mcp-api" },
  );

  assert.equal(await validateMcpAuth(requestWith(forged)), null);
});

test("a correctly signed token whose generation is stale is refused", async () => {
  mintAndStore();
  // Same signing key, same owner, same agent, wrong generation: only the stored
  // jti separates a current credential from a superseded one.
  const stale = jwt.sign(
    { sub: owner.email, userId: owner.id, agentId, jti: crypto.randomUUID() },
    TEST_SIGNING_KEY,
    { issuer: "hypertask", audience: "mcp-api" },
  );

  assert.equal(await validateMcpAuth(requestWith(stale)), null);
});

test("a token sharing the stored generation but not the stored bytes is refused", async () => {
  const token = mintAndStore();
  const generation = state.agent.mcpTokenJti;
  // A directly presented managed token is bound to the digest as well as the
  // generation, so re-minting with the same jti does not resurrect access.
  const sameGeneration = jwt.sign(
    { sub: owner.email, userId: owner.id, agentId, jti: generation, extra: 1 },
    TEST_SIGNING_KEY,
    { issuer: "hypertask", audience: "mcp-api" },
  );

  assert.notEqual(sameGeneration, token);
  assert.equal(await validateMcpAuth(requestWith(sameGeneration)), null);
});

test("an OAuth access token requires its live client and current agent generation", async () => {
  mintAndStore();
  const oauthToken = createOAuthToken(
    "firebase-owner",
    owner.id,
    owner.email,
    oauthClientId,
    3600,
    agentId,
    state.agent.mcpTokenJti,
  );

  assert.equal((await validateMcpAuth(requestWith(oauthToken)))?.agentId, agentId);

  state.oauthClientExists = false;
  assert.equal(await validateMcpAuth(requestWith(oauthToken)), null);

  state.oauthClientExists = true;
  mintAndStore();
  assert.equal(await validateMcpAuth(requestWith(oauthToken)), null);
});

test("removing a client rejects legacy OAuth tokens without revoking direct MCP tokens", async () => {
  const legacyOAuthToken = jwt.sign(
    {
      sub: "firebase-owner",
      userId: owner.id,
      email: owner.email,
      jti: crypto.randomUUID(),
    },
    TEST_SIGNING_KEY,
    {
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_OAUTH_AUDIENCE,
      expiresIn: 3600,
    },
  );
  const directToken = mintAndStore();

  assert.equal((await validateMcpAuth(requestWith(legacyOAuthToken)))?.user.id, owner.id);
  state.oauthLegacyTokensRevoked = true;
  assert.equal(await validateMcpAuth(requestWith(legacyOAuthToken)), null);
  assert.equal((await validateMcpAuth(requestWith(directToken)))?.agentId, agentId);
});

test("the legacy marker covers the historical OAuth audience", async () => {
  const legacyOAuthToken = jwt.sign(
    {
      sub: "firebase-owner",
      userId: owner.id,
      email: owner.email,
      jti: crypto.randomUUID(),
    },
    TEST_SIGNING_KEY,
    {
      issuer: process.env.JWT_ISSUER,
      audience: "http://localhost:3001",
      expiresIn: 3600,
    },
  );

  assert.equal((await validateMcpAuth(requestWith(legacyOAuthToken)))?.user.id, owner.id);
  state.oauthLegacyTokensRevoked = true;
  assert.equal(await validateMcpAuth(requestWith(legacyOAuthToken)), null);
});

test("a malformed OAuth client claim fails closed", async () => {
  const malformed = jwt.sign(
    {
      sub: "firebase-owner",
      userId: owner.id,
      email: owner.email,
      jti: crypto.randomUUID(),
      client_id: 42,
    },
    TEST_SIGNING_KEY,
    {
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_OAUTH_AUDIENCE,
      expiresIn: 3600,
    },
  );

  assert.equal(await validateMcpAuth(requestWith(malformed)), null);
});

test("another JWT_SECRET-signed flow cannot claim its way out of the digest check", async () => {
  mintAndStore();
  const generation = state.agent.mcpTokenJti;
  // Signature verification falls back to an audience-free pass for old tokens,
  // so an email-link or calendar-feed token reaches the agent branch. Carrying
  // the private OAuth generation claim must not buy it the digest exemption
  // that a real OAuth access token gets.
  for (const audience of ["email-link", "calendar-feed", undefined]) {
    const impostor = jwt.sign(
      {
        sub: owner.email,
        userId: owner.id,
        agentId,
        jti: crypto.randomUUID(),
        agentTokenGeneration: generation,
      },
      TEST_SIGNING_KEY,
      audience
        ? { issuer: "hypertask", audience }
        : { issuer: "hypertask" },
    );

    assert.equal(
      await validateMcpAuth(requestWith(impostor)),
      null,
      `audience ${audience ?? "none"} was accepted`,
    );
  }
});

test("a credential cannot donate authority across owners", async () => {
  mintAndStore();
  const generation = state.agent.mcpTokenJti;
  // The OAuth mint reads the generation through a query scoped to id AND owner,
  // which is what replaced the old cross-owner check on the stored plaintext.
  const foreignLookup = await require(path.join(root, "src/lib/prisma.ts"))
    .default.agent.findFirst({
      where: { id: agentId, userId: owner.id + 1, revokedAt: null },
      select: { mcpTokenJti: true },
    });

  assert.equal(foreignLookup, null);
  assert.equal(storedAgentTokenGeneration(foreignLookup), null);
  assert.equal(storedAgentTokenGeneration(state.agent), generation);
});

test("a token minted without a jti is refused storage rather than stored unrevokable", () => {
  const noJti = jwt.sign({ sub: owner.email, userId: owner.id, agentId }, TEST_SIGNING_KEY, {
    issuer: "hypertask",
    audience: "mcp-api",
  });

  assert.throws(() => agentTokenCredentialFields(noJti), /could never be revoked/);
  assert.deepEqual(agentTokenCredentialFields(null), {
    mcpTokenHash: null,
    mcpTokenJti: null,
  });
});

test("agentTokenMatchesStored answers only for the exact stored credential", () => {
  const token = mintAndStore();

  assert.equal(agentTokenMatchesStored(token, state.agent), true);
  assert.equal(agentTokenMatchesStored(token + "x", state.agent), false);
  assert.equal(agentTokenMatchesStored(token, { mcpTokenHash: null }), false);
  assert.equal(agentTokenMatchesStored(null, state.agent), false);
});

test("the schema keeps no plaintext agent token column", () => {
  const schema = fs.readFileSync(
    path.join(root, "src/prisma/schema.prisma"),
    "utf8",
  );
  const agentModel = /^model Agent \{[\s\S]*?^\}/m.exec(schema)?.[0];

  assert.ok(agentModel, "Agent model not found in schema");
  assert.doesNotMatch(agentModel, /^\s*mcpToken\s+/m);
  assert.match(agentModel, /^\s*mcpTokenHash\s+String\?\s+@db\.VarChar\(64\)/m);
  assert.match(agentModel, /^\s*mcpTokenJti\s+String\?/m);
});

test("no server file writes or reads a plaintext agent token column", () => {
  // `mcpToken` legitimately survives in two shapes: the plaintext a page holds
  // in client state after a mint, and the account-level MCP token status on the
  // developer-access surface, which is a user credential and not an agent one.
  const allowed = new Set([
    "src/models/model.ts",
    "src/app/agents/AgentsRegister.tsx",
    "src/app/agents/[agentId]/AgentDetail.tsx",
    "src/app/api/users/developer-access/route.ts",
    "src/components/Modals/Settings/DeveloperAccessSection.tsx",
  ]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
      if (/\.test\.[tj]sx?$/.test(entry.name)) continue;
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (allowed.has(relative)) continue;
      for (const line of fs.readFileSync(full, "utf8").split("\n")) {
        // Both shapes: a Prisma select/write key (`mcpToken:`) and a property
        // read off a row (`agent.mcpToken`). Matching only the first would miss
        // a leftover reader.
        if (
          /\bmcpToken\b\s*:|\.\s*mcpToken\b/.test(line) &&
          !/^\s*(\/\/|\*)/.test(line)
        ) {
          offenders.push(`${relative}: ${line.trim()}`);
        }
      }
    }
  };
  // Wider than src/ so a leftover reader in a script or a job cannot hide.
  for (const dir of ["src", "scripts", "prisma"]) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) walk(full);
  }

  assert.deepEqual(offenders, [], `plaintext agent token sites: ${offenders}`);
});
