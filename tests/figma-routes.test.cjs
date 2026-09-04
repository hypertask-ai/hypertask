const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { createJiti } = require("jiti");

const originalFigmaClientId = process.env.FIGMA_CLIENT_ID;
const originalFigmaClientSecret = process.env.FIGMA_CLIENT_SECRET;
process.env.FIGMA_CLIENT_ID = "figma-client";
process.env.FIGMA_CLIENT_SECRET = "figma-secret";

const root = path.resolve(__dirname, "..");
const originalFetch = global.fetch;
let sessionUserId;
let sessionError;
let enabled;
let connectedToken;
let connectedUserId;
let connectionSummary;
let connectionUserId;
let disconnectedUserId;
function stub(file, exports) {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => {
    if (sessionError) throw sessionError;
    return sessionUserId ? { userId: sessionUserId, source: "legacy" } : null;
  },
});
stub("src/lib/figma/connection.ts", {
  figmaConnectEnabledFor: async () => enabled,
  connectFigmaUser: async (userId, issueToken) => {
    connectedUserId = userId;
    connectedToken = await issueToken();
    return {
      figmaUserId: connectedToken.userId,
      figmaUserName: connectedToken.figmaUserName,
      updatedAt: new Date(),
    };
  },
  disconnectFigmaUser: async (userId) => {
    disconnectedUserId = userId;
  },
  getFigmaConnection: async (userId) => {
    connectionUserId = userId;
    return connectionSummary;
  },
});
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const oauth = jiti(path.join(root, "src/lib/figma/oauth.ts"));
const figmaPaths = jiti(path.join(root, "src/lib/figma/paths.ts"));
const startRoute = jiti(
  path.join(root, "src/app/api/figma/oauth/start/route.ts"),
);
const callbackRoute = jiti(
  path.join(root, "src/app/api/figma/oauth/callback/route.ts"),
);
const connectionRoute = jiti(
  path.join(root, "src/app/api/figma/connection/route.ts"),
);
const disconnectRoute = jiti(
  path.join(root, "src/app/api/figma/disconnect/route.ts"),
);

const appRequest = (pathname, init) =>
  new NextRequest(`https://app.hypertask.ai${pathname}`, init);

test.beforeEach(() => {
  global.fetch = originalFetch;
  sessionUserId = 6;
  sessionError = null;
  enabled = true;
  connectedToken = null;
  connectedUserId = null;
  connectionSummary = {
    figmaUserId: "figma-user",
    figmaUserName: "Valentin",
  };
  connectionUserId = null;
  disconnectedUserId = null;
});

test.after(() => {
  global.fetch = originalFetch;
  if (originalFigmaClientId === undefined) delete process.env.FIGMA_CLIENT_ID;
  else process.env.FIGMA_CLIENT_ID = originalFigmaClientId;
  if (originalFigmaClientSecret === undefined) delete process.env.FIGMA_CLIENT_SECRET;
  else process.env.FIGMA_CLIENT_SECRET = originalFigmaClientSecret;
});

test("OAuth start requires the signed user and owner-only server flag", async () => {
  sessionUserId = null;
  assert.equal((await startRoute.GET(appRequest("/api/figma/oauth/start"))).status, 401);

  sessionUserId = 6;
  enabled = false;
  assert.equal((await startRoute.GET(appRequest("/api/figma/oauth/start"))).status, 404);
});

test("session lookup failures return a controlled service error", async () => {
  sessionError = new Error("session unavailable");
  assert.equal((await startRoute.GET(appRequest("/api/figma/oauth/start"))).status, 503);
});

test("OAuth start sends minimum scope, PKCE, and a secure HttpOnly attempt cookie", async () => {
  const response = await startRoute.GET(
    appRequest(
      "/api/figma/oauth/start?returnTo=%2Fdetail%2Fproject-15%2F6136",
    ),
  );
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://www.figma.com");
  assert.equal(location.pathname, "/oauth");
  assert.equal(location.searchParams.get("client_id"), "figma-client");
  assert.equal(
    location.searchParams.get("scope"),
    "file_content:read current_user:read",
  );
  assert.equal(location.searchParams.get("response_type"), "code");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.match(location.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, new RegExp(`${oauth.FIGMA_OAUTH_ATTEMPT_COOKIE}=`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=lax/i);
});

async function beginAttempt() {
  const response = await startRoute.GET(
    appRequest(
      "/api/figma/oauth/start?returnTo=%2Fdetail%2Fproject-15%2F6136",
    ),
  );
  const location = new URL(response.headers.get("location"));
  return {
    state: location.searchParams.get("state"),
    codeChallenge: location.searchParams.get("code_challenge"),
    cookie: response.cookies.get(oauth.FIGMA_OAUTH_ATTEMPT_COOKIE).value,
  };
}

const callbackRequest = ({ state, cookie }, code = "code") =>
  appRequest(
    `/api/figma/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    {
      headers: {
        cookie: `${oauth.FIGMA_OAUTH_ATTEMPT_COOKIE}=${cookie}`,
      },
    },
  );

test("callback rejects missing and mismatched state before token exchange", async () => {
  const attempt = await beginAttempt();
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("unexpected token exchange");
  };

  const mismatched = await callbackRoute.GET(
    callbackRequest({ ...attempt, state: `${attempt.state}x` }),
  );
  assert.equal(
    new URL(mismatched.headers.get("location")).searchParams.get("figma_error"),
    "invalid_state",
  );
  const missing = await callbackRoute.GET(
    appRequest("/api/figma/oauth/callback?code=code", {
      headers: {
        cookie: `${oauth.FIGMA_OAUTH_ATTEMPT_COOKIE}=${attempt.cookie}`,
      },
    }),
  );
  assert.equal(
    new URL(missing.headers.get("location")).searchParams.get("figma_error"),
    "invalid_state",
  );
  assert.equal(fetchCalls, 0);
  assert.equal(connectedUserId, null);
});

test("callback rejects a changed Hypertask session and clears one-use state", async () => {
  const attempt = await beginAttempt();
  sessionUserId = 7;
  const response = await callbackRoute.GET(callbackRequest(attempt));
  assert.equal(
    new URL(response.headers.get("location")).searchParams.get("figma_error"),
    "user_mismatch",
  );
  assert.equal(connectedToken, null);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("callback exchanges the code and returns to the initiating screen", async () => {
  const attempt = await beginAttempt();
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    if (String(input).endsWith("/oauth/token")) {
      assert.equal(init.method, "POST");
      assert.equal(
        init.headers.Authorization,
        `Basic ${Buffer.from("figma-client:figma-secret").toString("base64")}`,
      );
      assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.equal(init.body.get("code"), "code");
      assert.equal(init.body.get("grant_type"), "authorization_code");
      assert.equal(
        init.body.get("redirect_uri"),
        "https://app.hypertask.ai/api/figma/oauth/callback",
      );
      const codeVerifier = init.body.get("code_verifier");
      assert.match(codeVerifier, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(
        createHash("sha256").update(codeVerifier).digest("base64url"),
        attempt.codeChallenge,
      );
      return Response.json({
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        token_type: "bearer",
        user_id_string: "90071992547409931234",
      });
    }
    assert.equal(String(input), "https://api.figma.com/v1/me");
    assert.equal(init.headers.Authorization, "Bearer access-token");
    return Response.json({ handle: "Valentin" });
  };

  const response = await callbackRoute.GET(callbackRequest(attempt));
  assert.equal(
    response.headers.get("location"),
    "https://app.hypertask.ai/detail/project-15/6136",
  );
  assert.equal(connectedUserId, 6);
  assert.equal(connectedToken.accessToken, "access-token");
  assert.equal(connectedToken.refreshToken, "refresh-token");
  assert.equal(connectedToken.userId, "90071992547409931234");
  assert.equal(connectedToken.figmaUserName, "Valentin");
  assert.equal(calls.length, 2);
  const setCookie = response.headers.get("set-cookie");
  const connectionCookie = setCookie.slice(
    setCookie.indexOf(`${figmaPaths.FIGMA_CONNECTION_VERSION_COOKIE}=`),
  );
  assert.match(connectionCookie, /Secure/i);
  assert.match(connectionCookie, /SameSite=lax/i);
  assert.doesNotMatch(connectionCookie, /HttpOnly/i);
});

test("connection reads and disconnects only the signed user's row", async () => {
  const readResponse = await connectionRoute.GET(
    appRequest("/api/figma/connection"),
  );
  assert.deepEqual((await readResponse.json()).connection, connectionSummary);
  assert.equal(connectionUserId, 6);
  assert.equal(readResponse.headers.get("cache-control"), "private, no-store");

  const missingOrigin = await disconnectRoute.DELETE(
    appRequest("/api/figma/disconnect", { method: "DELETE" }),
  );
  assert.equal(missingOrigin.status, 403);
  assert.equal(disconnectedUserId, null);

  const foreignOrigin = await disconnectRoute.DELETE(
    appRequest("/api/figma/disconnect", {
      method: "DELETE",
      headers: { origin: "https://evil.example" },
    }),
  );
  assert.equal(foreignOrigin.status, 403);
  assert.equal(disconnectedUserId, null);

  enabled = false;
  const disabledResponse = await disconnectRoute.DELETE(
    appRequest("/api/figma/disconnect", {
      method: "DELETE",
      headers: { origin: "https://app.hypertask.ai" },
    }),
  );
  assert.equal(disabledResponse.status, 404);
  assert.equal(disconnectedUserId, null);

  enabled = true;
  const response = await disconnectRoute.DELETE(
    appRequest("/api/figma/disconnect", {
      method: "DELETE",
      headers: { origin: "https://app.hypertask.ai" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(disconnectedUserId, 6);
  const clearedConnectionCookie = response.headers.get("set-cookie");
  assert.match(clearedConnectionCookie, /Max-Age=0/);
  assert.doesNotMatch(clearedConnectionCookie, /HttpOnly/i);
});

test("disconnect stays gated when the flag is disabled without a connection", async () => {
  enabled = false;
  connectionSummary = null;

  const response = await disconnectRoute.DELETE(
    appRequest("/api/figma/disconnect", {
      method: "DELETE",
      headers: { origin: "https://app.hypertask.ai" },
    }),
  );

  assert.equal(response.status, 404);
  assert.equal(connectionUserId, null);
  assert.equal(disconnectedUserId, null);
});
