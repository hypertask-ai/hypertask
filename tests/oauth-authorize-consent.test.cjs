const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const { NextRequest } = require("next/server");

// HTPR-6200: /oauth/authorize used to mint an authorization code on a plain GET, so
// any site could top-level-navigate a signed-in user into handing it board access.
// A GET must now stop at the consent screen, and only an approved POST may mint.

const root = path.resolve(__dirname, "..");
const originalSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "oauth-authorize-consent-test-secret";

function stubModule(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

let requestCookies = {};
let createdCode;
let existingGrant = null;
let upsertedGrant;
let knownAgentIds = [];

const nextHeaders = require("next/headers");
nextHeaders.cookies = async () => ({
  get: (name) =>
    requestCookies[name] === undefined
      ? undefined
      : { name, value: requestCookies[name] },
});

stubModule(path.join(root, "src/lib/prisma.ts"), {
  default: {
    oAuthClient: {
      findUnique: async () => ({
        client_id: "test-client",
        client_name: "Evil Connector",
        redirect_uris: ["https://client.example.test/callback"],
      }),
    },
    user: {
      findUnique: async (args) => ({
        uid: `firebase-${args.where.id}`,
        email: `user-${args.where.id}@example.test`,
      }),
    },
    agent: {
      findFirst: async (args) =>
        knownAgentIds.includes(args.where.id) ? { id: args.where.id } : null,
    },
    oAuthClientGrant: {
      findUnique: async () => existingGrant,
      upsert: async (args) => {
        upsertedGrant = args.create;
        return args.create;
      },
    },
    oAuthAuthorizationCode: {
      create: async (args) => {
        createdCode = args.data;
        return args.data;
      },
    },
  },
});

const jiti = require("jiti")(
  path.join(root, "tests/oauth-authorize-consent-entry.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false },
);
const { signSession } = jiti(path.join(root, "src/lib/auth/session.ts"));
const { signConsentToken } = jiti(path.join(root, "src/lib/oauth/consent.ts"));
const { GET, POST } = jiti(path.join(root, "src/app/oauth/authorize/route.ts"));

const USER_ID = 42;
const REDIRECT_URI = "https://client.example.test/callback";
const PKCE_CHALLENGE = crypto
  .createHash("sha256")
  .update("oauth-authorize-consent-test-verifier")
  .digest("base64url");

function baseParams(overrides = {}) {
  return {
    response_type: "code",
    client_id: "test-client",
    redirect_uri: REDIRECT_URI,
    code_challenge: PKCE_CHALLENGE,
    code_challenge_method: "S256",
    state: "test-state",
    ...overrides,
  };
}

function authorizeGet(params = baseParams()) {
  const url = new URL("https://app.hypertask.ai/oauth/authorize");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

function authorizePost(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, value);
  }
  return new NextRequest("https://app.hypertask.ai/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function consentTokenFor(overrides = {}) {
  return signConsentToken({
    userId: USER_ID,
    clientId: "test-client",
    redirectUri: REDIRECT_URI,
    codeChallenge: PKCE_CHALLENGE,
    agentId: null,
    ...overrides,
  });
}

function assertSentBackToConsent(response) {
  // No approval means no code. The person is on a form, so they land back on the
  // consent screen's expiry state, and the rejected token does not travel with them.
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/oauth/consent");
  assert.equal(location.searchParams.get("consent_token"), null);
  assert.equal(createdCode, undefined);
  assert.equal(upsertedGrant, undefined);
}

function reset() {
  requestCookies = { ht_session: signSession({ id: USER_ID }) };
  createdCode = undefined;
  existingGrant = null;
  upsertedGrant = undefined;
  knownAgentIds = [];
}

test.after(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

test("a signed-in GET stops at the consent screen and mints nothing", async () => {
  reset();

  const response = await GET(authorizeGet());

  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/oauth/consent");
  assert.equal(location.searchParams.get("client_id"), "test-client");
  assert.equal(location.searchParams.get("state"), "test-state");
  assert.ok(location.searchParams.get("consent_token"));
  assert.equal(createdCode, undefined);
});

test("a GET for an already approved connector mints without the screen", async () => {
  reset();
  existingGrant = { id: "grant-1" };

  const response = await GET(authorizeGet());

  assert.equal(response.status, 307);
  assert.equal(
    new URL(response.headers.get("location")).pathname,
    "/oauth/success",
  );
  assert.equal(createdCode.user_id, USER_ID);
});

test("approving with a valid consent token mints the code and remembers the grant", async () => {
  reset();

  const response = await POST(
    authorizePost({ ...baseParams(), consent_token: consentTokenFor() }),
  );

  // 303, not 307: a 307 would re-POST the browser onto the client callback.
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/oauth/success");
  assert.equal(
    new URL(location.searchParams.get("redirect_uri")).origin,
    "https://client.example.test",
  );
  assert.equal(createdCode.user_id, USER_ID);
  assert.equal(createdCode.firebase_uid, `firebase-${USER_ID}`);
  assert.deepEqual(upsertedGrant, { user_id: USER_ID, client_id: "test-client" });
});

test("the token the consent redirect carries is the one approval accepts", async () => {
  reset();

  const consentResponse = await GET(authorizeGet());
  const consentUrl = new URL(consentResponse.headers.get("location"));
  const params = Object.fromEntries(consentUrl.searchParams.entries());

  // Exactly what the consent form posts back, straight from the redirect.
  const response = await POST(authorizePost(params));

  assert.equal(response.status, 303);
  assert.equal(createdCode.user_id, USER_ID);
});

test("a POST without a consent token mints nothing", async () => {
  reset();

  const response = await POST(authorizePost(baseParams()));

  assertSentBackToConsent(response);
});

test("a tampered consent token mints nothing", async () => {
  reset();
  const token = consentTokenFor();

  const response = await POST(
    authorizePost({ ...baseParams(), consent_token: `${token}x` }),
  );

  assertSentBackToConsent(response);
});

test("an expired consent token mints nothing", async () => {
  reset();
  const token = signConsentToken(
    {
      userId: USER_ID,
      clientId: "test-client",
      redirectUri: REDIRECT_URI,
      codeChallenge: PKCE_CHALLENGE,
      agentId: null,
    },
    -1,
  );

  const response = await POST(
    authorizePost({ ...baseParams(), consent_token: token }),
  );

  assertSentBackToConsent(response);
});

test("a consent token for another user mints nothing", async () => {
  reset();

  const response = await POST(
    authorizePost({
      ...baseParams(),
      consent_token: consentTokenFor({ userId: USER_ID + 1 }),
    }),
  );

  assertSentBackToConsent(response);
});

test("a consent token approved for another redirect_uri mints nothing", async () => {
  reset();

  const response = await POST(
    authorizePost({
      ...baseParams(),
      consent_token: consentTokenFor({
        redirectUri: "https://client.example.test/other",
      }),
    }),
  );

  assertSentBackToConsent(response);
});

test("a consent token approved without an agent cannot smuggle one in", async () => {
  reset();
  knownAgentIds = ["agent-1"];

  const response = await POST(
    authorizePost({
      ...baseParams(),
      agent_id: "agent-1",
      consent_token: consentTokenFor(),
    }),
  );

  assertSentBackToConsent(response);
});

test("an agent_id that is not the user's is rejected on approval", async () => {
  reset();
  knownAgentIds = [];

  const response = await POST(
    authorizePost({
      ...baseParams(),
      agent_id: "someone-elses-agent",
      consent_token: consentTokenFor({ agentId: "someone-elses-agent" }),
    }),
  );

  assert.equal(response.status, 400);
  assert.equal(createdCode, undefined);
});

test("an approved agent_id is stored on the code", async () => {
  reset();
  knownAgentIds = ["agent-1"];

  const response = await POST(
    authorizePost({
      ...baseParams(),
      agent_id: "agent-1",
      consent_token: consentTokenFor({ agentId: "agent-1" }),
    }),
  );

  assert.equal(response.status, 303);
  assert.equal(createdCode.agent_id, "agent-1");
});

test("a signed-out POST mints nothing and resumes through login", async () => {
  reset();
  requestCookies = {};

  const response = await POST(
    authorizePost({ ...baseParams(), consent_token: consentTokenFor() }),
  );

  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("client_id"), "test-client");
  // The stale approval must not survive the round trip through login.
  assert.equal(location.searchParams.get("consent_token"), null);
  assert.equal(createdCode, undefined);
});
