const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const oauth = jiti(path.join(root, "src/lib/figma/oauth.ts"));
const config = { clientId: "figma-client", clientSecret: "figma-secret" };

test("OAuth attempt binds random state, PKCE, user, expiry, and safe return path", () => {
  const attempt = oauth.createFigmaOAuthAttempt(
    42,
    "/detail/project-15/6136?view=design#comment-1",
    config.clientSecret,
    1_000,
  );
  const verified = oauth.verifyFigmaOAuthAttempt(
    attempt.cookieValue,
    attempt.state,
    config.clientSecret,
    2_000,
  );
  assert.equal(verified.userId, 42);
  assert.equal(
    verified.returnTo,
    "/detail/project-15/6136?view=design#comment-1",
  );
  assert.equal(
    attempt.codeChallenge,
    createHash("sha256")
      .update(verified.codeVerifier, "utf8")
      .digest("base64url"),
  );

  assert.equal(
    oauth.verifyFigmaOAuthAttempt(
      `${attempt.cookieValue}x`,
      attempt.state,
      config.clientSecret,
      2_000,
    ),
    null,
  );
  assert.equal(
    oauth.verifyFigmaOAuthAttempt(
      attempt.cookieValue,
      `${attempt.state}x`,
      config.clientSecret,
      2_000,
    ),
    null,
  );
  assert.equal(
    oauth.verifyFigmaOAuthAttempt(
      attempt.cookieValue,
      attempt.state,
      config.clientSecret,
      10 * 60 * 1000 + 1_001,
    ),
    null,
  );
});

test("OAuth return paths reject external, API, and ambiguous destinations", () => {
  for (const value of [
    "https://evil.example/task",
    "//evil.example/task",
    "/\\evil.example/task",
    "/api",
    "/api/figma/disconnect",
    "/%61pi/figma/disconnect",
    "/api%2Ffigma%2Fdisconnect",
    "/_next",
    "/_next/data/build/page.json",
    `/${"a".repeat(2001)}`,
  ]) {
    assert.equal(oauth.safeFigmaReturnTo(value), "/settings/accounts");
  }
  assert.equal(oauth.safeFigmaReturnTo("/project?id=15"), "/project?id=15");
});

test("code exchange uses Basic authentication and the PKCE verifier", async () => {
  let request;
  const token = await oauth.exchangeFigmaCode(
    {
      code: "authorization-code",
      codeVerifier: "v".repeat(43),
      redirectUri: "https://app.hypertask.ai/api/figma/oauth/callback",
    },
    config,
    10_000,
    async (url, init) => {
      request = { url, init };
      return Response.json({
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        token_type: "bearer",
        user_id: 42,
        user_id_string: "90071992547409931234",
      });
    },
  );

  assert.equal(request.url, "https://api.figma.com/v1/oauth/token");
  assert.equal(
    request.init.headers.Authorization,
    `Basic ${Buffer.from("figma-client:figma-secret").toString("base64")}`,
  );
  assert.equal(request.init.body.get("code_verifier"), "v".repeat(43));
  assert.equal(request.init.body.get("grant_type"), "authorization_code");
  assert.equal(token.accessToken, "access-token");
  assert.equal(token.refreshToken, "refresh-token");
  assert.equal(token.userId, "90071992547409931234");
  assert.equal(token.expiresAt.getTime(), 3_610_000);
});

test("refresh uses Figma's refresh endpoint and rejects failed credentials", async () => {
  const refreshed = await oauth.refreshFigmaToken(
    "refresh-token",
    config,
    0,
    async (url, init) => {
      assert.equal(url, "https://api.figma.com/v1/oauth/refresh");
      assert.equal(init.body.get("refresh_token"), "refresh-token");
      return Response.json({ access_token: "next-token", expires_in: 90 });
    },
  );
  assert.equal(refreshed.accessToken, "next-token");

  await assert.rejects(
    oauth.refreshFigmaToken(
      "invalid",
      config,
      0,
      async () =>
        Response.json({ error: "invalid_client" }, { status: 401 }),
    ),
    (error) =>
      error instanceof oauth.FigmaOAuthRequestError &&
      error.status === 401 &&
      error.oauthError === "invalid_client",
  );
});
