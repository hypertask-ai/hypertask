const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const originalSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "oauth-authorize-session-identity-test-secret";

function stubModule(filename, exports) {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

let requestCookies = {};
let userLookup;
let createdCode;

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
        redirect_uris: ["https://client.example.test/callback"],
      }),
    },
    user: {
      findUnique: async (args) => {
        userLookup = args;
        return { uid: `firebase-${args.where.id}`, email: `user-${args.where.id}@example.test` };
      },
    },
    agent: {
      findFirst: async () => null,
    },
    // HTPR-6200: this user has already approved the client on the consent screen,
    // so the GET still mints and the identity assertions below stay meaningful.
    oAuthClientGrant: {
      findUnique: async () => ({ id: "grant-1" }),
      upsert: async (args) => args.create,
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
  path.join(root, "tests/oauth-authorize-session-identity-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);
const { signSession } = jiti(path.join(root, "src/lib/auth/session.ts"));
const { GET } = jiti(path.join(root, "src/app/oauth/authorize/route.ts"));

const VICTIM_ID = 42;
const ATTACKER_ID = 99;
const PKCE_CHALLENGE = crypto
  .createHash("sha256")
  .update("oauth-authorize-session-identity-test-verifier")
  .digest("base64url");

function authorizeRequest() {
  const url = new URL("https://app.hypertask.ai/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", "test-client");
  url.searchParams.set("redirect_uri", "https://client.example.test/callback");
  url.searchParams.set("code_challenge", PKCE_CHALLENGE);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", "test-state");
  return new NextRequest(url);
}

function forgedProfileCookie(id) {
  return JSON.stringify({
    id,
    displayName: "Victim",
    email: "victim@example.test",
  });
}

function reset() {
  requestCookies = {};
  userLookup = undefined;
  createdCode = undefined;
}

test.after(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

test("an unsigned profile cookie cannot authorize an OAuth code", async () => {
  reset();
  requestCookies.nookies_user = forgedProfileCookie(VICTIM_ID);

  const response = await GET(authorizeRequest());

  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).pathname, "/login");
  assert.equal(userLookup, undefined);
  assert.equal(createdCode, undefined);
});

test("OAuth code identity comes exclusively from the signed session", async () => {
  reset();
  requestCookies.nookies_user = forgedProfileCookie(VICTIM_ID);
  requestCookies.ht_session = signSession({ id: ATTACKER_ID });

  const response = await GET(authorizeRequest());

  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/oauth/success");
  assert.equal(new URL(location.searchParams.get("redirect_uri")).origin, "https://client.example.test");
  assert.deepEqual(userLookup, {
    where: { id: ATTACKER_ID },
    select: { uid: true, email: true },
  });
  assert.equal(createdCode.user_id, ATTACKER_ID);
  assert.equal(createdCode.firebase_uid, `firebase-${ATTACKER_ID}`);
  assert.notEqual(createdCode.user_id, VICTIM_ID);
});
