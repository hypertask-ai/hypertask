const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const nextServer = require("next/server");

const root = path.resolve(__dirname, "..");
const ORIGIN = "https://app.hypertask.ai";
const FLAG = "htpr-7515-connect-github-per-board";
const COOKIE = "ht_github_app_manifest";
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" });
const SECRET = "test-cipher-secret-at-least-32-characters";
const APP_ENV = {
  GITHUB_APP_ID: "424242",
  GITHUB_APP_SLUG: "env-hypertask",
  GITHUB_APP_CLIENT_ID: "Iv1.envclient",
  GITHUB_APP_CLIENT_SECRET: "env-client-value",
  GITHUB_APP_STATE_SECRET: "env-state-secret-at-least-32-characters",
};
const ENV_NAMES = [...Object.keys(APP_ENV), "BYOK_CIPHER_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"];
const world = {};

function load(file, stubs = {}) {
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (name) => {
    if (name in stubs) return stubs[name];
    if (name.startsWith("node:")) return require(name);
    throw new Error(`Unexpected import in ${file}: ${name}`);
  });
  return mod.exports;
}

const prisma = {
  githubAppCredential: {
    findFirst: async ({ where }) => {
      assert.deepEqual(where, { revokedAt: null });
      world.reads += 1;
      if (world.dbDown) throw new Error("SECRET database failure");
      return world.rows.find((row) => row.revokedAt === null) ?? null;
    },
    create: async ({ data }) => {
      if (world.createError) throw Object.assign(new Error("SECRET database failure"), { code: world.createError });
      if (world.rows.some((row) => row.revokedAt === null)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
      assert.equal(data.createdByUserId, 6);
      const row = { id: "credential-1", createdAt: new Date(), revokedAt: null, ...data };
      world.rows.push(row);
      world.writes.push(data);
      return row;
    },
  },
};
const cipher = load("src/lib/github/appCredentialCipher.ts");
const appConfig = load("src/lib/github/appConfig.ts", {
  "@/lib/prisma": prisma,
  "./appCredentialCipher": cipher,
});
const responseReader = load("src/lib/googleCalendar/response.ts");
const manifest = load("src/lib/github/appManifest.ts", {
  "@/lib/googleCalendar/response": responseReader,
  "./appCredentialCipher": cipher,
  "@/lib/redis": {
    getRedis: async () => {
      if (world.redisDown) throw new Error("SECRET redis failure");
      return { set: async (key, value, ex, ttl, nx) => {
        assert.match(key, /^github-app-manifest:htpr-7515:nonce:[0-9a-f]{64}$/);
        assert.equal(value, "1");
        assert.equal(ex, "EX");
        assert.ok(ttl >= 600);
        assert.equal(nx, "NX");
        if (world.nonces.has(key)) return null;
        world.nonces.add(key);
        return "OK";
      } };
    },
  },
});
const routeLib = load("src/app/api/github/_lib.ts", {
  "next/server": nextServer,
  "@/lib/auth/getSessionUser": { getSessionUser: async () => {
    if (world.sessionError) throw new Error("session unavailable");
    return world.session;
  } },
  "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => ORIGIN },
  "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
    world.flagCalls.push({ key, userId });
    return world.flagOn;
  } },
  "@/lib/flags/definitions/htpr-7515-connect-github-per-board": { HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG: FLAG },
  "@/lib/github/oauthState": {},
});
const manifestLib = load("src/app/api/github/app-manifest/_lib.ts", {
  "next/server": nextServer,
  "@/app/api/github/_lib": routeLib,
  "@/lib/auth/ownerOrQaIds": load("src/lib/auth/ownerOrQaIds.ts"),
  "@/lib/github/appManifest": manifest,
});
const shared = {
  "next/server": nextServer,
  "@/app/api/github/_lib": routeLib,
  "@/app/api/github/app-manifest/_lib": manifestLib,
  "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => ORIGIN },
  "@/lib/github/appConfig": appConfig,
  "@/lib/github/appManifest": manifest,
};
const startRoute = load("src/app/api/github/app-manifest/start/route.ts", {
  ...shared,
  "@/lib/api/rateLimit": { checkRestRateLimit: async () => world.rateLimited ? nextServer.NextResponse.json({ error: "limited" }, { status: 429 }) : null },
});
const callbackRoute = load("src/app/api/github/app-manifest/callback/route.ts", { ...shared, "@/lib/prisma": prisma });
const userApi = load("src/lib/github/userApi.ts", { "@/lib/googleCalendar/response": responseReader });
const appApi = load("src/lib/github/appApi.ts", {
  "@/lib/googleCalendar/response": responseReader,
  "./appConfig": appConfig,
  "./userApi": userApi,
});

function conversion(overrides = {}) {
  return {
    id: 123456, slug: "hypertask-test", client_id: "Iv1.dbclient", client_secret: "db-client-value",
    pem: privateKey, webhook_secret: "db-webhook-value", html_url: "https://github.com/apps/hypertask-test",
    owner: { login: "hypertask-ai", type: "Organization" }, ...overrides,
  };
}
function reset() {
  appConfig.clearGithubAppConfigCache();
  Object.assign(world, {
    session: { userId: 6, source: "better-auth" }, flagOn: true, flagCalls: [], sessionError: false,
    rows: [], writes: [], reads: 0, nonces: new Set(), fetches: [], redisDown: false, dbDown: false,
    conversion: conversion(), upstreamStatus: 201, upstreamError: false, rawBody: null,
    createError: null, rateLimited: false, afterFetch: null,
  });
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function fakeGithub(input, init) {
  const url = String(input);
  world.fetches.push(url);
  assert.match(url, /^https:\/\/api\.github\.com\/app-manifests\/[A-Za-z0-9_-]+\/conversions$/);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.ok(init.signal instanceof AbortSignal);
  if (world.upstreamError) throw new Error("SECRET transport failure");
  if (world.afterFetch) await world.afterFetch();
  return world.rawBody !== null
    ? new Response(world.rawBody, { status: world.upstreamStatus })
    : json(world.conversion, world.upstreamStatus);
}
function scenario(fn) {
  return async () => {
    const saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
    const previousFetch = global.fetch;
    for (const name of ENV_NAMES) delete process.env[name];
    process.env.BYOK_CIPHER_SECRET = SECRET;
    reset();
    global.fetch = fakeGithub;
    try { await fn(); } finally {
      global.fetch = previousFetch;
      appConfig.clearGithubAppConfigCache();
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };
}
function request(pathname, query = {}, nonce) {
  const url = new URL(pathname, ORIGIN);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  return new nextServer.NextRequest(url, { headers: nonce ? { cookie: `${COOKIE}=${nonce}` } : {} });
}
async function start() {
  const response = await startRoute.GET(request("/api/github/app-manifest/start"));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response;
}
const unescapeAttribute = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
async function begin() {
  const response = await start();
  assert.equal(response.status, 200);
  const html = await response.text();
  const action = new URL(unescapeAttribute(html.match(/action="([^"]+)"/)[1]));
  return { response, html, action, state: action.searchParams.get("state"), nonce: response.cookies.get(COOKIE).value };
}
async function callback(attempt, query = { code: "one-time-code" }) {
  const response = await callbackRoute.GET(request("/api/github/app-manifest/callback", { state: attempt.state, ...query }, attempt.nonce));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response;
}
async function errorIs(response, status, error) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
}
function assertNoWrites() { assert.deepEqual(world.writes, []); }

test("owner with flag on gets an auto-submit manifest with sourced URLs, permissions and inactive webhook", scenario(async () => {
  const attempt = await begin();
  assert.equal(attempt.action.origin + attempt.action.pathname, "https://github.com/organizations/hypertask-ai/settings/apps/new");
  assert.match(attempt.html, /method="post"/);
  assert.match(attempt.html, /<button type="submit">Create Hypertask GitHub App<\/button>/);
  assert.match(attempt.html, /document.forms\[0\].submit\(\)/);
  const parsed = JSON.parse(unescapeAttribute(attempt.html.match(/name="manifest" value="([^"]+)"/)[1]));
  assert.deepEqual(parsed, {
    name: "Hypertask", url: ORIGIN, redirect_url: `${ORIGIN}/api/github/app-manifest/callback`,
    setup_url: `${ORIGIN}/api/github/setup`, callback_urls: [`${ORIGIN}/api/github/oauth/callback`],
    request_oauth_on_install: false, setup_on_update: true, public: true,
    default_permissions: { pull_requests: "read", metadata: "read", checks: "read", members: "read" },
    default_events: ["pull_request", "check_suite"],
    hook_attributes: { url: `${ORIGIN}/api/webhooks/github-app`, active: false },
  });
  const cookie = attempt.response.cookies.get(COOKIE);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.path, "/api/github/app-manifest");
  assert.equal(cookie.maxAge, 600);
  assert.equal(attempt.response.headers.get("referrer-policy"), "no-referrer");
  const nonce = attempt.html.match(/<script nonce="([^"]+)"/)[1];
  assert.ok(attempt.response.headers.get("content-security-policy").includes(`'nonce-${nonce}'`));
  assert.deepEqual(world.flagCalls, [{ key: FLAG, userId: 6 }]);
  assert.equal(manifest.verifyGithubAppManifestState(attempt.state, attempt.nonce, 6).userId, 6);
  assert.deepEqual(world.fetches, []);
  assertNoWrites();
}));

test("valid callback stores only encrypted secrets, clears cache, loads DB config and signs installation requests", scenario(async () => {
  assert.equal(await appConfig.getGithubAppConfig(), null);
  const attempt = await begin();
  const response = await callback(attempt);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${ORIGIN}/settings/github?github_app=registered`);
  assert.equal(response.cookies.get(COOKIE).maxAge, 0);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(world.writes.length, 1);
  const row = world.rows[0];
  assert.equal(row.appId, "123456");
  assert.equal(row.ownerLogin, "hypertask-ai");
  assert.equal(row.clientId, "Iv1.dbclient");
  assert.equal(row.htmlUrl, "https://github.com/apps/hypertask-test");
  assert.equal(row.createdByUserId, 6);
  assert.equal("code" in row, false);
  for (const [field, raw] of Object.entries({ clientSecret: "db-client-value", privateKey, webhookSecret: "db-webhook-value" })) {
    assert.notEqual(row[field], raw);
    assert.equal(cipher.decryptGithubAppCredential(field, row[field]), raw);
  }
  const stateSecret = cipher.decryptGithubAppCredential("stateSecret", row.stateSecret);
  assert.equal(Buffer.from(stateSecret, "base64url").length, 32);
  assert.deepEqual(await appConfig.getGithubAppConfig(), {
    appId: "123456", slug: "hypertask-test", clientId: "Iv1.dbclient", clientSecret: "db-client-value", stateSecret,
  });
  assert.equal(await appConfig.getGithubAppPrivateKey(), privateKey);
  assert.equal(await appConfig.getGithubAppWebhookSecret(), "db-webhook-value");
  const reads = world.reads;
  await appConfig.getGithubAppConfig();
  await appConfig.getGithubAppPrivateKey();
  assert.equal(world.reads, reads);
  const installationToken = await appApi.fetchInstallationToken("555", async (url, init) => {
    assert.equal(url, "https://api.github.com/app/installations/555/access_tokens");
    const jwt = new Headers(init.headers).get("authorization").slice("Bearer ".length);
    const [header, payload, signature] = jwt.split(".");
    assert.equal(JSON.parse(Buffer.from(payload, "base64url")).iss, "123456");
    assert.equal(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, "base64url")), true);
    return json({ token: "installation-token" }, 201);
  });
  assert.equal(installationToken, "installation-token");
  assert.equal(world.fetches.length, 1);
}));

test("full valid env configuration and separate key/webhook getters still win over DB", scenario(async () => {
  await callback(await begin());
  Object.assign(process.env, APP_ENV, { GITHUB_APP_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"), GITHUB_APP_WEBHOOK_SECRET: "env-webhook-value" });
  assert.deepEqual(await appConfig.getGithubAppConfig(), {
    appId: "424242", slug: "env-hypertask", clientId: "Iv1.envclient", clientSecret: "env-client-value", stateSecret: APP_ENV.GITHUB_APP_STATE_SECRET,
  });
  assert.equal(await appConfig.getGithubAppPrivateKey(), privateKey);
  assert.equal(await appConfig.getGithubAppWebhookSecret(), "env-webhook-value");
  const reads = world.reads;
  delete process.env.BYOK_CIPHER_SECRET;
  world.dbDown = true;
  appConfig.clearGithubAppConfigCache();
  assert.equal((await appConfig.getGithubAppConfig()).appId, "424242");
  assert.equal(await appConfig.getGithubAppPrivateKey(), privateKey);
  assert.equal(await appConfig.getGithubAppWebhookSecret(), "env-webhook-value");
  assert.equal(world.reads, reads);
  world.dbDown = false;
  process.env.BYOK_CIPHER_SECRET = SECRET;
  delete process.env.GITHUB_APP_CLIENT_ID;
  assert.equal((await appConfig.getGithubAppConfig()).appId, "123456");
  process.env.GITHUB_APP_CLIENT_ID = APP_ENV.GITHUB_APP_CLIENT_ID;
  for (const [name, value] of [["GITHUB_APP_ID", "0"], ["GITHUB_APP_SLUG", "bad/slug"], ["GITHUB_APP_STATE_SECRET", "short"]]) {
    const saved = process.env[name];
    process.env[name] = value;
    assert.equal((await appConfig.getGithubAppConfig()).appId, "123456");
    process.env[name] = saved;
  }
}));

test("signed-out users and agents get 401; non-owner including QA and flag Off get 404 on both routes", scenario(async () => {
  const attempt = await begin();
  for (const [session, enabled, status, error] of [
    [null, true, 401, "unauthorized"],
    [{ userId: 6, agentId: "agent-1" }, true, 401, "unauthorized"],
    [{ userId: 7 }, true, 404, "not_found"],
    [{ userId: 985 }, true, 404, "not_found"],
    [{ userId: 6 }, false, 404, "not_found"],
  ]) {
    world.session = session;
    world.flagOn = enabled;
    await errorIs(await start(), status, error);
    await errorIs(await callback(attempt), status, error);
  }
  assert.deepEqual(world.fetches, []);
  assertNoWrites();
  world.session = { userId: 6, source: "legacy" };
  world.flagOn = true;
  assert.equal((await callback(attempt)).status, 303);
}));

test("bad signature, expiry, wrong user, missing/wrong cookie and malformed state store nothing", scenario(async () => {
  const attempt = await begin();
  const expired = manifest.createGithubAppManifestState(6, Date.now() - 601_000);
  const otherUser = manifest.createGithubAppManifestState(7);
  for (const invalid of [
    { ...attempt, state: `${attempt.state}x` }, { ...attempt, state: "bad" },
    { ...attempt, state: "x".repeat(2049) }, { ...attempt, state: undefined },
    { ...attempt, nonce: undefined }, { ...attempt, nonce: "wrong" }, expired, otherUser,
  ]) await errorIs(await callback(invalid), 400, "invalid_state");
  assertNoWrites();
  assert.deepEqual(world.fetches, []);
  assert.equal((await callback(attempt)).status, 303);
  await errorIs(await callback(attempt), 400, "reused_state");
  assert.equal(world.writes.length, 1);
  assert.equal(world.fetches.length, 1);
}));

test("concurrent callbacks consume a state only once", scenario(async () => {
  const attempt = await begin();
  const results = await Promise.all([callback(attempt), callback(attempt)]);
  assert.deepEqual(results.map((response) => response.status).sort(), [303, 400]);
  assert.equal(world.fetches.length, 1);
  assert.equal(world.writes.length, 1);
}));

test("already registered env or DB rejects start and a fresh callback with 409", scenario(async () => {
  const attempt = await begin();
  Object.assign(process.env, APP_ENV);
  await errorIs(await start(), 409, "already_registered");
  await errorIs(await callback(attempt), 409, "already_registered");
  assert.deepEqual(world.fetches, []);
  assertNoWrites();
  for (const name of Object.keys(APP_ENV)) delete process.env[name];
  await callback(await begin());
  await errorIs(await start(), 409, "already_registered");
  const fresh = manifest.createGithubAppManifestState(6);
  await errorIs(await callback(fresh), 409, "already_registered");
  assert.equal(world.writes.length, 1);
  world.rows[0].clientSecret = "unreadable";
  await errorIs(await start(), 409, "already_registered");
}));

test("GitHub conversion, transport, malformed/oversized bodies and wrong owner failures are sanitized and store nothing", scenario(async () => {
  for (const options of [
    { upstreamStatus: 400 }, { upstreamError: true }, { rawBody: "not json" },
    { rawBody: "[]" }, { rawBody: "x".repeat(64 * 1024 + 1) },
    { conversion: conversion({ owner: { login: "other-org", type: "Organization" } }) },
    { conversion: conversion({ owner: { login: "hypertask-ai", type: "User" } }) },
    { conversion: conversion({ id: 0 }) }, { conversion: conversion({ slug: "bad/slug" }) },
    { conversion: conversion({ html_url: "https://evil.example/apps/hypertask-test" }) },
    { conversion: conversion({ client_secret: "" }) }, { conversion: conversion({ webhook_secret: "" }) },
    { conversion: conversion({ pem: "invalid-key" }) },
  ]) {
    reset();
    Object.assign(world, options);
    await errorIs(await callback(await begin()), 502, "registration_failed");
    assertNoWrites();
  }
}));

test("missing or short cipher secret fails closed before conversion; decrypt rejects plaintext, corruption and field swaps", scenario(async () => {
  const attempt = await begin();
  for (const value of [undefined, "short"]) {
    if (value === undefined) delete process.env.BYOK_CIPHER_SECRET;
    else process.env.BYOK_CIPHER_SECRET = value;
    await errorIs(await start(), 503, "unavailable");
    await errorIs(await callback(attempt), 400, "invalid_state");
    assert.throws(() => cipher.encryptGithubAppCredential("clientSecret", "raw"), /credential_encode_failed/);
  }
  assert.deepEqual(world.fetches, []);
  assertNoWrites();
  process.env.BYOK_CIPHER_SECRET = SECRET;
  const encrypted = cipher.encryptGithubAppCredential("clientSecret", "raw");
  assert.equal(cipher.decryptGithubAppCredential("clientSecret", encrypted), "raw");
  assert.notEqual(cipher.encryptGithubAppCredential("clientSecret", "raw"), encrypted);
  assert.throws(() => cipher.decryptGithubAppCredential("privateKey", encrypted), /credential_decode_failed/);
  for (const value of ["raw", encrypted + "!", "ht-github-app:v2:AAAA", "ht-github-app:v1:AAAA"]) {
    assert.throws(() => cipher.decryptGithubAppCredential("clientSecret", value), /credential_decode_failed/);
  }
  const bytes = Buffer.from(encrypted.split(":")[2], "base64");
  bytes[28] ^= 1;
  assert.throws(() => cipher.decryptGithubAppCredential("clientSecret", "ht-github-app:v1:" + bytes.toString("base64")), /credential_decode_failed/);
  process.env.BYOK_CIPHER_SECRET = "different-cipher-secret-at-least-32-chars";
  assert.throws(() => cipher.decryptGithubAppCredential("clientSecret", encrypted), /credential_decode_failed/);
}));

test("missing code consumes the attempt, unavailable replay store refuses conversion, and a new attempt still succeeds", scenario(async () => {
  const attempt = await begin();
  await errorIs(await callback(attempt, {}), 400, "invalid_code");
  await errorIs(await callback(attempt), 400, "reused_state");
  const next = await begin();
  world.redisDown = true;
  await errorIs(await callback(next), 502, "registration_failed");
  assert.deepEqual(world.fetches, []);
  assertNoWrites();
  world.redisDown = false;
  assert.equal((await callback(next)).status, 303);
}));

test("revoked rows do not block registration; DB errors and unique-index races fail closed", scenario(async () => {
  world.rows.push({ revokedAt: new Date() });
  const attempt = await begin();
  world.dbDown = true;
  await errorIs(await start(), 503, "unavailable");
  await errorIs(await callback(attempt), 502, "registration_failed");
  assertNoWrites();
  world.dbDown = false;
  world.createError = "P2002";
  await errorIs(await callback(await begin()), 409, "already_registered");
  assertNoWrites();
  world.createError = null;
  assert.equal((await callback(await begin())).status, 303);
}));

test("callback rechecks current owner and flag after GitHub exchange before writing", scenario(async () => {
  for (const change of [() => { world.flagOn = false; }, () => { world.session = null; }]) {
    reset();
    world.afterFetch = change;
    const response = await callback(await begin());
    assert.ok([401, 404].includes(response.status));
    assertNoWrites();
  }
}));

test("DB cipher failures return no usable config or key and cache expires or clears explicitly", scenario(async () => {
  await callback(await begin());
  assert.equal((await appConfig.getGithubAppConfig()).appId, "123456");
  const reads = world.reads;
  const oldNow = Date.now;
  Date.now = () => oldNow() + 61_000;
  try { assert.equal((await appConfig.getGithubAppConfig()).appId, "123456"); } finally { Date.now = oldNow; }
  assert.equal(world.reads, reads + 1);
  world.rows[0].privateKey = "plaintext";
  appConfig.clearGithubAppConfigCache();
  assert.equal(await appConfig.getGithubAppConfig(), null);
  assert.equal(await appConfig.getGithubAppPrivateKey(), null);
  assert.equal(await appConfig.getGithubAppWebhookSecret(), null);
  world.rows[0].privateKey = cipher.encryptGithubAppCredential("privateKey", privateKey);
  delete process.env.BYOK_CIPHER_SECRET;
  appConfig.clearGithubAppConfigCache();
  assert.equal(await appConfig.getGithubAppConfig(), null);
}));

test("start rate limiting is private and non-cacheable", scenario(async () => {
  world.rateLimited = true;
  await errorIs(await start(), 429, "limited");
  assertNoWrites();
}));

test("credential migration is additive, follows its baseline, and enforces a single active row", () => {
  const names = fs.readdirSync(path.join(root, "src/prisma/migrations")).filter((name) => /^\d{14}_/.test(name)).sort();
  const name = names.find((name) => name.endsWith("_github_app_credential"));
  assert.ok(name);
  assert.ok(name > "20261023030214_github_installation_installed_by");
  const sql = fs.readFileSync(path.join(root, "src/prisma/migrations", name, "migration.sql"), "utf8");
  assert.match(sql, /CREATE TABLE "GithubAppCredential"/);
  assert.match(sql, /CREATE UNIQUE INDEX "GithubAppCredential_single_active_key" ON "GithubAppCredential"\(\(true\)\) WHERE "revokedAt" IS NULL/);
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|UPDATE|TRUNCATE|ALTER)\b/);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  const schema = fs.readFileSync(path.join(root, "src/prisma/schema.prisma"), "utf8");
  const model = schema.match(/model GithubAppCredential \{([\s\S]*?)\n\}/)[1];
  for (const field of ["id", "appId", "slug", "clientId", "ownerLogin", "htmlUrl", "clientSecret", "privateKey", "webhookSecret", "stateSecret", "createdByUserId", "createdAt", "revokedAt"]) {
    assert.match(model, new RegExp(`\\b${field}\\s+`));
  }
});
