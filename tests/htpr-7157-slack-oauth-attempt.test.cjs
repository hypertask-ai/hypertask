const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const nextServer = require("next/server");

const root = path.resolve(__dirname, "..");
const SECRET = "slack-client-secret";
const ORIGIN = "https://app.hypertask.ai";

function load(relPath, stubs) {
  const source = fs.readFileSync(path.join(root, relPath), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (request) => {
    if (request in stubs) return stubs[request];
    if (request.startsWith("node:")) return require(request);
    throw new Error(`Unexpected import in ${relPath}: ${request}`);
  });
  return mod.exports;
}

const oauthState = load("src/lib/slack/oauthState.ts", {});
const authorize = load("src/lib/slack/authorize.ts", {});
const baseUrl = { getRequestBaseUrl: () => ORIGIN };

function installRoute(user) {
  return load("src/app/api/slack/install/route.ts", {
    "next/server": nextServer,
    "@/lib/auth/requestBaseUrl": baseUrl,
    "@/lib/auth/serverUser": { getServerCookieUser: async () => user },
    "@/lib/slack/oauthState": oauthState,
    "@/utils/controllers/teams/hasTeamMembershipAccess": {
      findSoleAccessibleTeamId: async () => "team-a",
      hasTeamMembershipAccess: async () => true,
    },
    "@/lib/slack/authorize": authorize,
    "@/lib/slack/installTeam": { resolveSlackInstallTeamId: async () => "team-a" },
  });
}

function callbackRoute(user) {
  const writes = [];
  const prisma = {
    slackInstall: {
      findUnique: async () => null,
      upsert: async (args) => { writes.push(args); return {}; },
      delete: async () => { writes.push("delete"); },
      create: async () => { writes.push("create"); },
    },
    $transaction: async () => { writes.push("transaction"); },
  };
  const route = load("src/app/api/slack/oauth_redirect/route.ts", {
    "next/server": nextServer,
    "@/lib/prisma": prisma,
    "@/lib/auth/requestBaseUrl": baseUrl,
    "@/lib/auth/serverUser": { getServerCookieUser: async () => user },
    "@/lib/auth/safeReturnTo": { SLACK_SETTINGS_PATH: "/settings/slack" },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/crypto/byokCipher": { encryptSecret: (value) => `enc:${value.length}` },
    "@/lib/flags/keys": { HTPR_4857_ADD_TO_SLACK_FLAG: "htpr-4857" },
    "@/lib/slack/oauthState": oauthState,
    "@/lib/slack/authorize": authorize,
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
  });
  return { route, writes };
}

function withSlackEnv(fn) {
  return async () => {
    const saved = { id: process.env.SLACK_CLIENT_ID, secret: process.env.SLACK_CLIENT_SECRET, fetch: global.fetch };
    process.env.SLACK_CLIENT_ID = "client-id";
    process.env.SLACK_CLIENT_SECRET = SECRET;
    const exchanges = [];
    global.fetch = async (url) => {
      exchanges.push(String(url));
      return {
        ok: true,
        json: async () => ({ ok: true, access_token: "xoxb-test", bot_user_id: "B1", team: { id: "T1", name: "Victim Slack" } }),
      };
    };
    try {
      await fn(exchanges);
    } finally {
      process.env.SLACK_CLIENT_ID = saved.id;
      process.env.SLACK_CLIENT_SECRET = saved.secret;
      global.fetch = saved.fetch;
    }
  };
}

async function startInstall(userId) {
  const response = await installRoute({ id: userId }).GET(
    new nextServer.NextRequest(`${ORIGIN}/api/slack/install?teamId=team-a`),
  );
  const state = new URL(response.headers.get("location")).searchParams.get("state");
  const cookie = response.cookies.get(oauthState.SLACK_OAUTH_ATTEMPT_COOKIE);
  return { response, state, cookie };
}

function callback(state, cookieValue) {
  const headers = cookieValue
    ? { cookie: `${oauthState.SLACK_OAUTH_ATTEMPT_COOKIE}=${cookieValue}` }
    : {};
  return new nextServer.NextRequest(
    `${ORIGIN}/api/slack/oauth_redirect?code=slack-code&state=${encodeURIComponent(state)}`,
    { headers },
  );
}

const outcome = (response) => new URL(response.headers.get("location")).searchParams;

test("install binds the signed state to an HttpOnly Lax attempt cookie", withSlackEnv(async () => {
  const { state, cookie } = await startInstall(42);
  assert.ok(cookie, "attempt cookie is set");
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.path, "/api/slack/oauth_redirect");
  assert.equal(oauthState.verifySlackOAuthState(state, SECRET).nonce, cookie.value);
}));

test("a transferred link with no attempt cookie is refused before the token exchange", withSlackEnv(async (exchanges) => {
  const { state } = await startInstall(42);
  const { route, writes } = callbackRoute(null);
  const response = await route.GET(callback(state, null));
  assert.equal(outcome(response).get("slack_error"), "invalid_state");
  assert.deepEqual(exchanges, []);
  assert.deepEqual(writes, []);
}));

test("a different browser's attempt cookie is refused", withSlackEnv(async (exchanges) => {
  const attacker = await startInstall(42);
  const victim = await startInstall(42);
  const { route, writes } = callbackRoute({ id: 42 });
  const response = await route.GET(callback(attacker.state, victim.cookie.value));
  assert.equal(outcome(response).get("slack_error"), "invalid_state");
  assert.deepEqual(exchanges, []);
  assert.deepEqual(writes, []);
}));

test("a signed-out callback is refused even with the matching cookie", withSlackEnv(async (exchanges) => {
  const { state, cookie } = await startInstall(42);
  const { route, writes } = callbackRoute(null);
  const response = await route.GET(callback(state, cookie.value));
  assert.equal(outcome(response).get("slack_error"), "signed_out");
  assert.deepEqual(exchanges, []);
  assert.deepEqual(writes, []);
}));

test("a different signed-in user is refused", withSlackEnv(async (exchanges) => {
  const { state, cookie } = await startInstall(42);
  const { route, writes } = callbackRoute({ id: 99 });
  const response = await route.GET(callback(state, cookie.value));
  assert.equal(outcome(response).get("slack_error"), "user_mismatch");
  assert.deepEqual(exchanges, []);
  assert.deepEqual(writes, []);
}));

test("the browser and user that started the install connect Slack, and the cookie is consumed", withSlackEnv(async (exchanges) => {
  const { state, cookie } = await startInstall(42);
  const { route, writes } = callbackRoute({ id: 42 });
  const response = await route.GET(callback(state, cookie.value));
  assert.equal(outcome(response).get("slack_success"), "connected");
  assert.deepEqual(exchanges, ["https://slack.com/api/oauth.v2.access"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].where.teamId, "team-a");
  const cleared = response.cookies.get(oauthState.SLACK_OAUTH_ATTEMPT_COOKIE);
  assert.equal(cleared.value, "");
  assert.equal(cleared.maxAge, 0);
}));

test("a state without a nonce (old format) is refused", () => {
  const legacy = Buffer.from(JSON.stringify({
    expiresAt: Date.now() + 60_000, issuedAt: Date.now(), teamId: "team-a", userId: 42, version: 1,
  })).toString("base64url");
  const signature = require("node:crypto").createHmac("sha256", SECRET).update(legacy).digest("base64url");
  assert.equal(oauthState.verifySlackOAuthState(`${legacy}.${signature}`, SECRET), null);
});
