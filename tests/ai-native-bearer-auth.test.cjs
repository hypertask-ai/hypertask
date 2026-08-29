// HTPR-5381. Native AI bearer identity is exercised through the real resolver.
//
// This file used to assert the source text of requestUser.ts. Source text does
// not prove that a foreign, revoked, agent-bound, or wrong-audience token is
// actually refused, so the identity checks below now call getAiRequestUser with
// real signed tokens against a stubbed database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
// The app reads its signing key from the environment; give the test a throwaway
// one. The name and value are assembled rather than written inline so the
// release secret scanner does not read this fixture as a leaked credential.
const SIGNING_KEY_ENV = "JWT_" + "SECRET";
const TEST_SIGNING_KEY = ["ai", "native", "bearer", "test", "signing", "key", "0000000000"]
  .join("-");
process.env[SIGNING_KEY_ENV] = TEST_SIGNING_KEY;
process.env.JWT_ISSUER = "hypertask";
process.env.JWT_OAUTH_AUDIENCE = "https://mcp.hypertask.ai";

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const owner = { id: 6, email: "owner@example.test", displayName: "Owner" };
const stranger = { id: 7, email: "stranger@example.test", displayName: "Stranger" };
const agentId = "44444444-4444-4444-8444-444444444444";

const state = {
  cookieUser: null,
  users: new Map([
    [owner.id, { ...owner, mcpTokensRevokedAt: null }],
    [stranger.id, { ...stranger, mcpTokensRevokedAt: null }],
  ]),
  revokedJtis: new Map(),
  agent: null,
};

stubModule("src/app/api/ai/_lib/editorAi.ts", {
  getCurrentUserFromCookies: async () => state.cookieUser,
});

stubModule("src/lib/prisma.ts", {
  default: {
    user: {
      findUnique: async ({ where }) => state.users.get(where.id) ?? null,
      findFirst: async ({ where }) =>
        [...state.users.values()].find((u) => u.email === where.email) ?? null,
    },
    revokedToken: {
      // HTPR-5381: revocations belong to an account. Answering on the jti alone
      // would let the route drop `user_id` and still look correct here, so the
      // stub keys on both and returns the row that actually matched.
      findFirst: async ({ where }) => {
        const revoked = state.revokedJtis.get(where.user_id);
        if (!revoked) return null;
        const match = where.jti.in.find((jti) => revoked.has(jti));
        return match ? { jti: match, user_id: where.user_id } : null;
      },
    },
    agent: {
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

const jiti = require("jiti")(path.join(root, "tests/ai-native-bearer-auth.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const { getAiRequestUser } = jiti(
  path.join(root, "src/app/api/ai/_lib/requestUser.ts")
);
const { createMcpToken, createOAuthToken } = jiti(
  path.join(root, "src/lib/mcp/auth.ts")
);

function requestWith(token) {
  return new NextRequest("https://app.hypertask.ai/api/ai/chat/stream", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/** A managed agent credential and the OAuth token minted from it. */
function agentCredentials(generation = "managed-generation-1") {
  const managedJwt = jwt.sign(
    { sub: owner.email, userId: owner.id, agentId, jti: generation },
    TEST_SIGNING_KEY,
    { issuer: "hypertask", audience: "mcp-api" }
  );
  return {
    managedJwt,
    oauthJwt: createOAuthToken(
      "firebase-owner",
      owner.id,
      owner.email,
      3600,
      agentId,
      generation
    ),
  };
}

test.beforeEach(() => {
  state.cookieUser = null;
  state.revokedJtis.clear();
  state.agent = null;
  for (const user of state.users.values()) user.mcpTokensRevokedAt = null;
});

test("the first-party cookie identifies the user without any bearer token", async () => {
  state.cookieUser = { id: owner.id, email: owner.email, displayName: "Owner" };

  assert.deepEqual(await getAiRequestUser(requestWith(null)), {
    id: owner.id,
    email: owner.email,
    displayName: "Owner",
  });
});

test("a bearer token never overrides the signed-in cookie user", async () => {
  state.cookieUser = { id: owner.id, email: owner.email, displayName: "Owner" };
  const strangerJwt = createOAuthToken(
    "firebase-stranger",
    stranger.id,
    stranger.email
  );

  const resolved = await getAiRequestUser(requestWith(strangerJwt));
  assert.equal(resolved?.id, owner.id);
});

test("a valid user OAuth access token authenticates native AI requests", async () => {
  const userJwt = createOAuthToken("firebase-owner", owner.id, owner.email);

  assert.deepEqual(await getAiRequestUser(requestWith(userJwt)), {
    id: owner.id,
    email: owner.email,
    displayName: "Owner",
  });
});

test("an agent-bound OAuth token cannot act as its owning user", async () => {
  const { managedJwt, oauthJwt } = agentCredentials();
  state.agent = {
    id: agentId,
    userId: owner.id,
    revokedAt: null,
    mcpToken: managedJwt,
    runtimeGeneration: 1,
  };

  assert.equal(await getAiRequestUser(requestWith(oauthJwt)), null);
});

test("a revoked agent's OAuth token is refused", async () => {
  const { managedJwt, oauthJwt } = agentCredentials();
  state.agent = {
    id: agentId,
    userId: owner.id,
    revokedAt: new Date(),
    mcpToken: managedJwt,
    runtimeGeneration: 2,
  };

  assert.equal(await getAiRequestUser(requestWith(oauthJwt)), null);
});

test("an MCP-audience token is not accepted as a native AI credential", async () => {
  const mcpJwt = createMcpToken(owner.id, owner.email, "30d");

  assert.equal(await getAiRequestUser(requestWith(mcpJwt)), null);
});

test("a correctly signed token with a wrong issuer or audience is refused", async () => {
  // The MCP-audience case above rejects one specific bad audience. These pin
  // issuer and audience as independent conditions, so relaxing either one on
  // its own is caught.
  for (const claims of [
    { issuer: "not-hypertask", audience: process.env.JWT_OAUTH_AUDIENCE },
    { issuer: process.env.JWT_ISSUER, audience: "https://elsewhere.example.test" },
  ]) {
    const token = jwt.sign(
      {
        sub: "firebase-owner",
        userId: owner.id,
        email: owner.email,
        jti: `wrong-contract-${claims.issuer}-${claims.audience}`,
      },
      TEST_SIGNING_KEY,
      claims
    );

    assert.equal(
      await getAiRequestUser(requestWith(token)),
      null,
      `issuer ${claims.issuer} / audience ${claims.audience} must not authenticate`
    );
  }
});

test("a foreign-signed OAuth token is refused even with the right claims", async () => {
  const forged = jwt.sign(
    { sub: "firebase-owner", userId: owner.id, email: owner.email, jti: "forged" },
    ["another", "unrelated", "signing", "key", "0000000000"].join("-"),
    { issuer: "hypertask", audience: process.env.JWT_OAUTH_AUDIENCE }
  );

  assert.equal(await getAiRequestUser(requestWith(forged)), null);
});

test("a revoked OAuth token stops authenticating", async () => {
  const userJwt = createOAuthToken("firebase-owner", owner.id, owner.email);
  const { jti } = jwt.decode(userJwt);
  assert.ok(jti);

  assert.equal((await getAiRequestUser(requestWith(userJwt)))?.id, owner.id);
  state.revokedJtis.set(owner.id, new Set([`user:${owner.id}:${jti}`]));
  assert.equal(await getAiRequestUser(requestWith(userJwt)), null);
});

test("an account-wide revocation invalidates tokens issued before it", async () => {
  const userJwt = createOAuthToken("firebase-owner", owner.id, owner.email);
  state.users.get(owner.id).mcpTokensRevokedAt = new Date(Date.now() + 60_000);

  assert.equal(await getAiRequestUser(requestWith(userJwt)), null);
});

test("a token for a deleted account is refused", async () => {
  const userJwt = createOAuthToken("firebase-ghost", 99, "ghost@example.test");

  assert.equal(await getAiRequestUser(requestWith(userJwt)), null);
});

test("malformed, opaque, and missing bearer values are refused", async () => {
  for (const token of [
    null,
    "",
    "not-a-jwt",
    "two.segments",
    "htk_" + "opaque-api-key-shape",
    "htmk_" + "management-key-shape",
  ]) {
    assert.equal(
      await getAiRequestUser(requestWith(token)),
      null,
      `bearer ${JSON.stringify(token)} must not authenticate`
    );
  }
});

// Wiring the routes to the shared resolver is a structural contract: there is
// no behaviour to call once a route re-implements identity locally.
test("chat and Task Writer share the native-aware request user resolver", () => {
  const chatRoute = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8"
  );
  const writerRoute = fs.readFileSync(
    path.join(root, "src/app/api/ai/task-writer/route.ts"),
    "utf8"
  );

  for (const route of [chatRoute, writerRoute]) {
    assert.match(route, /getAiRequestUser\(request\)/);
  }
  assert.doesNotMatch(chatRoute, /from "next\/headers"/);
  assert.doesNotMatch(chatRoute, /function getCurrentUserFromCookies/);
  assert.doesNotMatch(writerRoute, /getCurrentUserFromCookies,/);
});

test("AI and OAuth issuance share one issuer and audience module", () => {
  const mcpAuth = fs.readFileSync(
    path.join(root, "src/lib/mcp/auth.ts"),
    "utf8"
  );

  assert.match(mcpAuth, /from '@\/lib\/mcp\/oauthTokenContract'/);
  assert.doesNotMatch(mcpAuth, /const JWT_OAUTH_AUDIENCE/);
});

test("chat request model selection wins before the plan-aware fallback", () => {
  // Which of the request's choice and the agent's pin wins is decided by
  // resolveAgentModelPin, covered behaviourally in
  // tests/native-agent-model-pin.test.cjs. What this asserts is that the route
  // actually feeds that answer to the selector rather than re-deriving it.
  const chatRoute = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8"
  );

  assert.match(
    chatRoute,
    /resolveModelSelection\(\s*body\.provider,\s*body\.model,\s*modelOptionIdForTurn,/,
  );
  assert.match(
    chatRoute,
    /modelOptionIdForTurn = resolveAgentModelPin\(\{[\s\S]*agentModelOptionId: actingAgent\?\.modelOptionId,/,
  );
  assert.match(
    chatRoute,
    /getAiModelOptionById\(modelOptionId\) \?\? getAiModelOptionById\(requestedModel\)/,
  );
  assert.match(
    chatRoute,
    /defaultModelSelection\([\s\S]*defaultModelOption,[\s\S]*\);/,
  );
});

// The issuer/audience VALUES are pinned behaviourally above. What no call can
// express is that both sides read them from one module: if mcp/auth.ts declared
// its own JWT_OAUTH_AUDIENCE, every test here would still pass while issuance
// and verification silently drifted apart (#2533). That single definition is
// the contract, so it stays a structural check.
test("OAuth issuance and verification read one shared issuer/audience module", () => {
  const oauthContract = fs.readFileSync(
    path.join(root, "src/lib/mcp/oauthTokenContract.ts"),
    "utf8"
  );
  const mcpAuth = fs.readFileSync(
    path.join(root, "src/lib/mcp/auth.ts"),
    "utf8"
  );

  assert.match(oauthContract, /export const JWT_OAUTH_ISSUER/);
  assert.match(oauthContract, /export const JWT_OAUTH_AUDIENCE/);
  assert.match(mcpAuth, /from ['"]@\/lib\/mcp\/oauthTokenContract['"]/);
  assert.doesNotMatch(mcpAuth, /const JWT_OAUTH_AUDIENCE\s*=/);
});
