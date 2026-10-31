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
const COOKIE = "ht_github_install_attempt";
const USER_TOKEN = "ghu_fake_user_token_for_tests";
const APP_ID = "424242";
const INSTALLATION_ID = "555";
const APP_ENV = {
  GITHUB_APP_ID: APP_ID,
  GITHUB_APP_SLUG: "hypertask-test",
  GITHUB_APP_CLIENT_ID: "Iv1.testclient",
  GITHUB_APP_CLIENT_SECRET: "test-client-value",
  GITHUB_APP_STATE_SECRET: "test-state-signing-value-at-least-32-chars",
};

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

const world = {};

function resetWorld() {
  world.session = { userId: 10, source: "legacy" };
  world.flagOn = true;
  world.flagKeys = [];
  world.redis = new Map();
  world.redisDown = false;
  world.rateLimited = false;
  world.boards = {
    7: {
      id: 7,
      status: "Normal",
      teamId: "team-a",
      ownerId: 10,
      members: [
        { userId: 11, status: "Accepted", role: "Admin", agentId: null },
        { userId: 12, status: "Accepted", role: "Member", agentId: null },
        { userId: 13, status: "Accepted", role: "Admin", agentId: null },
      ],
    },
  };
  world.teams = {
    "team-a": {
      googleAccountId: "ga-1",
      ownerUserId: 1,
      members: [
        { userId: 10, status: "Accepted" },
        { userId: 11, status: "Accepted" },
        { userId: 12, status: "Accepted" },
      ],
    },
  };
  world.installations = new Map();
  world.writes = [];
  world.github = {
    user: { id: 9001, login: "octo-owner" },
    installationPages: [[orgInstallation()]],
    membership: { status: 200, body: { state: "active", role: "admin", organization: { id: 7001, login: "acme" } } },
    tokenResponse: { access_token: USER_TOKEN, token_type: "bearer", scope: "" },
  };
  world.fetches = [];
  world.challenges = new Set();
}

function orgInstallation(overrides = {}) {
  return {
    id: Number(INSTALLATION_ID),
    app_id: Number(APP_ID),
    suspended_at: null,
    account: { id: 7001, login: "acme", type: "Organization" },
    ...overrides,
  };
}

const prisma = {
  project: {
    findFirst: async ({ where, select }) => {
      const board = world.boards[where.id];
      if (!board) return null;
      if (where.OR) {
        const userId = where.OR[0].ownerId;
        const admin = board.ownerId === userId || board.members.some(
          (m) => m.userId === userId && m.status === "Accepted" && !m.agentId && m.role === "Admin",
        );
        return admin ? { id: board.id } : null;
      }
      if (where.status && board.status !== where.status) return null;
      if (!board.teamId) return null;
      const team = world.teams[board.teamId];
      const memberWhere = select.team.select.members.where;
      return {
        teamId: board.teamId,
        team: {
          googleAccountId: team.googleAccountId,
          googleAccount: { userId: team.ownerUserId },
          members: team.members
            .filter((m) => m.userId === memberWhere.userId && m.status === memberWhere.status)
            .map((m) => ({ id: `mt-${m.userId}` })),
        },
      };
    },
    findUnique: async ({ where }) => {
      const board = world.boards[where.id];
      return board ? { teamId: board.teamId } : null;
    },
  },
  githubInstallation: {
    findUnique: async ({ where }) => {
      const row = world.installations.get(where.id);
      return row ? { teamId: row.teamId } : null;
    },
    create: async ({ data }) => {
      world.writes.push({ op: "create", data });
      world.installations.set(data.id, { ...data });
      return data;
    },
    update: async ({ where, data }) => {
      world.writes.push({ op: "update", where, data });
      world.installations.set(where.id, { ...world.installations.get(where.id), ...data });
      return data;
    },
  },
  $transaction: async (fn) => fn(prisma),
};

class PrismaClientKnownRequestError extends Error {}

const redis = {
  getRedis: async () => {
    if (world.redisDown) throw new Error("redis offline");
    return {
      set: async (key, value, ex, ttl, nx) => {
        assert.equal(ex, "EX");
        assert.equal(nx, "NX");
        assert.ok(ttl > 0);
        if (world.redis.has(key)) return null;
        world.redis.set(key, value);
        return "OK";
      },
    };
  },
};

const response = load("src/lib/googleCalendar/response.ts", {});
const appConfig = load("src/lib/github/appConfig.ts", {});
const oauthState = load("src/lib/github/oauthState.ts", { "@/lib/redis": redis });
const userApi = load("src/lib/github/userApi.ts", { "@/lib/googleCalendar/response": response });
const isProjectAdmin = load("src/utils/controllers/projects/isProjectAdmin.ts", { "@/lib/prisma": prisma });
const teamOwnerOrAdmin = load("src/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess.ts", {
  "@/lib/prisma": prisma,
  "@/utils/controllers/projects/isProjectAdmin": isProjectAdmin,
});
const installAuthority = load("src/lib/github/installAuthority.ts", {
  "@/lib/prisma": prisma,
  "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess": teamOwnerOrAdmin,
  "./userApi": userApi,
});
const adoptInstallation = load("src/lib/github/adoptInstallation.ts", {
  "@prisma/client": { Prisma: { PrismaClientKnownRequestError } },
  "@/lib/prisma": prisma,
  "./installAuthority": installAuthority,
});
const flagDefinition = load("src/lib/flags/definitions/htpr-7515-connect-github-per-board.ts", {});
const routeLib = load("src/app/api/github/_lib.ts", {
  "next/server": nextServer,
  "@/lib/auth/getSessionUser": { getSessionUser: async () => world.session },
  "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => ORIGIN },
  "@/lib/flags": {
    isFeatureEnabled: async (key, userId) => {
      world.flagKeys.push({ key, userId });
      return world.flagOn;
    },
  },
  "@/lib/flags/definitions/htpr-7515-connect-github-per-board": flagDefinition,
  "@/lib/github/oauthState": oauthState,
});
const shared = {
  "next/server": nextServer,
  "@/app/api/github/_lib": routeLib,
  "@/lib/github/appConfig": appConfig,
  "@/lib/github/installAuthority": installAuthority,
  "@/lib/github/oauthState": oauthState,
};
const installRoute = load("src/app/api/github/install/route.ts", {
  ...shared,
  "@/lib/api/rateLimit": {
    checkRestRateLimit: async () => (world.rateLimited ? nextServer.NextResponse.json({}, { status: 429 }) : null),
  },
});
const setupRoute = load("src/app/api/github/setup/route.ts", shared);
const callbackRoute = load("src/app/api/github/oauth/callback/route.ts", {
  ...shared,
  "@/lib/github/adoptInstallation": adoptInstallation,
  "@/lib/github/userApi": userApi,
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeGithub(input, init = {}) {
  const url = new URL(String(input));
  const authorization = new Headers(init.headers).get("authorization");
  world.fetches.push({ url: url.toString(), method: init.method ?? "GET", authorization });
  if (url.toString() === "https://github.com/login/oauth/access_token") {
    assert.equal(init.method, "POST");
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get("client_id"), APP_ENV.GITHUB_APP_CLIENT_ID);
    assert.equal(body.get("redirect_uri"), `${ORIGIN}/api/github/oauth/callback`);
    const verifier = body.get("code_verifier");
    assert.ok(world.challenges.has(crypto.createHash("sha256").update(verifier).digest("base64url")), "PKCE verifier matches an issued challenge");
    return json(world.github.tokenResponse);
  }
  assert.equal(url.origin, "https://api.github.com");
  assert.equal(authorization, `Bearer ${USER_TOKEN}`);
  if (url.pathname === "/user") return json(world.github.user);
  if (url.pathname === "/user/installations") {
    const page = Number(url.searchParams.get("page"));
    return json({ installations: world.github.installationPages[page - 1] ?? [] });
  }
  if (url.pathname.startsWith("/user/memberships/orgs/")) {
    const { status, body } = world.github.membership;
    return json(body ?? { message: "refused" }, status);
  }
  throw new Error(`Unexpected GitHub request ${url}`);
}

function scenario(fn, env = APP_ENV) {
  return async () => {
    resetWorld();
    const saved = { fetch: global.fetch, env: {} };
    for (const name of Object.keys(APP_ENV)) {
      saved.env[name] = process.env[name];
      if (env[name] === undefined) delete process.env[name];
      else process.env[name] = env[name];
    }
    global.fetch = fakeGithub;
    try {
      await fn();
    } finally {
      global.fetch = saved.fetch;
      for (const [name, value] of Object.entries(saved.env)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };
}

function startRequest(projectId = 7, origin = ORIGIN) {
  return new nextServer.NextRequest(`${ORIGIN}/api/github/install`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ projectId }),
  });
}

async function start(projectId = 7) {
  const res = await installRoute.POST(startRequest(projectId));
  assert.equal(res.status, 303);
  const location = new URL(res.headers.get("location"));
  return { res, location, state: location.searchParams.get("state"), nonce: res.cookies.get(COOKIE)?.value };
}

function getRequest(pathname, query, nonce) {
  const url = new URL(pathname, ORIGIN);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new nextServer.NextRequest(url, { headers: nonce ? { cookie: `${COOKIE}=${nonce}` } : {} });
}

async function setup(state, nonce, query = { installation_id: INSTALLATION_ID, setup_action: "install" }) {
  const res = await setupRoute.GET(getRequest("/api/github/setup", { state, ...query }, nonce));
  const location = res.headers.get("location");
  const challenge = location && new URL(location).searchParams.get("code_challenge");
  if (challenge) world.challenges.add(challenge);
  return res;
}

function callback(state, nonce, query = { code: "gh-code" }) {
  return callbackRoute.GET(getRequest("/api/github/oauth/callback", { state, ...query }, nonce));
}

async function reachCallback() {
  const first = await start();
  const res = await setup(first.state, first.nonce);
  const location = new URL(res.headers.get("location"));
  assert.equal(location.origin + location.pathname, "https://github.com/login/oauth/authorize");
  return { state: location.searchParams.get("state"), nonce: res.cookies.get(COOKIE)?.value, location };
}

const outcome = (res) => new URL(res.headers.get("location")).searchParams;
const tokenExchanges = () => world.fetches.filter((f) => f.url.startsWith("https://github.com/login/oauth/access_token"));

function assertNoAdoption() {
  assert.deepEqual(world.writes, []);
  assert.equal(world.installations.size, 0);
}

test("flag Off: start, setup and callback all answer 404 with no GitHub call or write", scenario(async () => {
  const live = await reachCallback();
  world.fetches = [];
  world.flagOn = false;
  assert.equal((await installRoute.POST(startRequest())).status, 404);
  assert.equal((await setup("x", "y")).status, 404);
  assert.equal((await callback(live.state, live.nonce)).status, 404);
  assert.deepEqual(world.fetches, []);
  assertNoAdoption();
  assert.ok(world.flagKeys.every(({ key }) => key === FLAG));
}));

test("flag On: still allowed, start redirects 303 to the configured App install page with a bound cookie", scenario(async () => {
  const { location, state, nonce, res } = await start();
  assert.equal(location.toString().split("?")[0], "https://github.com/apps/hypertask-test/installations/new");
  const cookie = res.cookies.get(COOKIE);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.path, "/api/github");
  const parsed = oauthState.verifyGithubInstallState(state, nonce, "install", APP_ENV.GITHUB_APP_STATE_SECRET);
  assert.deepEqual(
    { userId: parsed.userId, projectId: parsed.projectId, teamId: parsed.teamId, phase: parsed.phase },
    { userId: 10, projectId: 7, teamId: "team-a", phase: "install" },
  );
  assert.deepEqual(world.flagKeys.at(-1), { key: FLAG, userId: 10 });
}));

test("signed-out and agent sessions are refused; a signed-in human is still allowed", scenario(async () => {
  world.session = null;
  assert.equal((await installRoute.POST(startRequest())).status, 401);
  world.session = { userId: 10, agentId: "agent-1", source: "legacy" };
  assert.equal((await installRoute.POST(startRequest())).status, 401);
  world.session = { userId: 10, source: "better-auth" };
  assert.equal((await installRoute.POST(startRequest())).status, 303);
}));

test("cross-origin start is refused; same-origin start is still allowed", scenario(async () => {
  assert.equal((await installRoute.POST(startRequest(7, "https://evil.example"))).status, 403);
  assert.equal((await installRoute.POST(startRequest(7, ORIGIN))).status, 303);
}));

test("non-member, board-only admin and plain team member are refused; board owner, board admin and team owner are still allowed", scenario(async () => {
  for (const userId of [99, 13, 12]) {
    world.session = { userId, source: "legacy" };
    assert.equal((await installRoute.POST(startRequest())).status, 403, `user ${userId} refused`);
  }
  for (const userId of [10, 11, 1]) {
    world.session = { userId, source: "legacy" };
    assert.equal((await installRoute.POST(startRequest())).status, 303, `user ${userId} allowed`);
  }
}));

test("archived and teamless boards are refused; a normal team board is still allowed", scenario(async () => {
  world.boards[8] = { ...world.boards[7], id: 8, status: "Archived" };
  world.boards[9] = { ...world.boards[7], id: 9, teamId: null };
  assert.equal((await installRoute.POST(startRequest(8))).status, 403);
  assert.equal((await installRoute.POST(startRequest(9))).status, 403);
  assert.equal((await installRoute.POST(startRequest(7))).status, 303);
}));

test("missing GitHub App env fails closed on every route; full env is still allowed", scenario(async () => {
  const live = await reachCallback();
  world.fetches = [];
  for (const name of Object.keys(APP_ENV)) {
    const saved = process.env[name];
    delete process.env[name];
    assert.equal((await installRoute.POST(startRequest())).status, 503, `${name} missing`);
    assert.equal(outcome(await setup("x", "y")).get("github_error"), "not_configured");
    assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), "not_configured");
    process.env[name] = saved;
  }
  assert.deepEqual(world.fetches, []);
  assertNoAdoption();
  assert.equal((await installRoute.POST(startRequest())).status, 303);
}));

test("tampered, expired, missing-cookie and other-user state are refused at setup; the valid state is still allowed", scenario(async () => {
  const { state, nonce } = await start();
  const [payload, signature] = state.split(".");
  const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  assert.equal(outcome(await setup(tampered, nonce)).get("github_error"), "invalid_state");

  const forgedPayload = Buffer.from(JSON.stringify({
    ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    projectId: 8,
  })).toString("base64url");
  assert.equal(outcome(await setup(`${forgedPayload}.${signature}`, nonce)).get("github_error"), "invalid_state");

  const expired = oauthState.createGithubInstallAttempt(
    { installationId: null, phase: "install", projectId: 7, teamId: "team-a", userId: 10 },
    APP_ENV.GITHUB_APP_STATE_SECRET,
    Date.now() - 11 * 60 * 1000,
  );
  assert.equal(outcome(await setup(expired.state, expired.nonce)).get("github_error"), "invalid_state");
  assert.equal(outcome(await setup(state, null)).get("github_error"), "invalid_state");

  world.session = { userId: 11, source: "legacy" };
  assert.equal(outcome(await setup(state, nonce)).get("github_error"), "user_mismatch");
  world.session = { userId: 10, source: "legacy" };

  const res = await setup(state, nonce);
  const location = new URL(res.headers.get("location"));
  assert.equal(location.origin + location.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), APP_ENV.GITHUB_APP_CLIENT_ID);
  assert.equal(location.searchParams.get("redirect_uri"), `${ORIGIN}/api/github/oauth/callback`);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    location.searchParams.get("code_challenge"),
    oauthState.githubPkceChallenge(oauthState.githubPkceVerifier(res.cookies.get(COOKIE).value, APP_ENV.GITHUB_APP_STATE_SECRET)),
  );
  assert.ok(!location.toString().includes(oauthState.githubPkceVerifier(res.cookies.get(COOKIE).value, APP_ENV.GITHUB_APP_STATE_SECRET)));
  const next = oauthState.verifyGithubInstallState(
    location.searchParams.get("state"),
    res.cookies.get(COOKIE).value,
    "authorize",
    APP_ENV.GITHUB_APP_STATE_SECRET,
  );
  assert.equal(next.installationId, INSTALLATION_ID);
  assert.deepEqual(world.fetches, []);
  assertNoAdoption();
}));

test("a reused setup or callback state is refused; the first use is still allowed", scenario(async () => {
  const first = await start();
  const allowed = await setup(first.state, first.nonce);
  assert.equal(new URL(allowed.headers.get("location")).hostname, "github.com");
  assert.equal(outcome(await setup(first.state, first.nonce)).get("github_error"), "attempt_reused");

  const live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_status"), "connected");
  world.fetches = [];
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), "attempt_reused");
  assert.deepEqual(tokenExchanges(), []);
}));

test("the single-use store being down refuses the attempt; with the store up it is still allowed", scenario(async () => {
  const first = await start();
  world.redisDown = true;
  assert.equal(outcome(await setup(first.state, first.nonce)).get("github_error"), "unavailable");
  world.redisDown = false;
  const second = await start();
  assert.equal(new URL((await setup(second.state, second.nonce)).headers.get("location")).hostname, "github.com");
}));

test("an install-phase state is refused at the OAuth callback; the authorize-phase state is still allowed", scenario(async () => {
  const first = await start();
  const res = await callback(first.state, first.nonce);
  assert.equal(outcome(res).get("github_error"), "invalid_state");
  assert.deepEqual(tokenExchanges(), []);
  assertNoAdoption();

  const live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_status"), "connected");
}));

test("org member without owner role, pending membership and blocked membership are refused; an active org admin is still allowed", scenario(async () => {
  const cases = [
    [{ status: 200, body: { state: "active", role: "member", organization: { id: 7001 } } }, "org_owner_required"],
    [{ status: 200, body: { state: "active", role: "billing_manager", organization: { id: 7001 } } }, "org_owner_required"],
    [{ status: 200, body: { state: "pending", role: "admin", organization: { id: 7001 } } }, "org_membership_pending"],
    [{ status: 200, body: { state: "active", role: "admin", organization: { id: 1 } } }, "org_owner_required"],
    [{ status: 403 }, "org_verification_blocked"],
    [{ status: 404 }, "org_owner_required"],
    [{ status: 502 }, "github_unavailable"],
  ];
  for (const [membership, error] of cases) {
    world.github.membership = membership;
    const live = await reachCallback();
    assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), error);
    assertNoAdoption();
  }
  world.github.membership = { status: 200, body: { state: "active", role: "admin", organization: { id: 7001 } } };
  const live = await reachCallback();
  const res = await callback(live.state, live.nonce);
  assert.equal(outcome(res).get("github_status"), "connected");
  assert.equal(outcome(res).get("projectId"), "7");
  assert.equal(new URL(res.headers.get("location")).pathname, "/settings/github");
  assert.equal(res.cookies.get(COOKIE).value, "");
  assert.deepEqual(world.writes, [{
    op: "create",
    data: { id: INSTALLATION_ID, teamId: "team-a", accountId: "7001", accountLogin: "acme", accountType: "Organization", installedByUserId: 10 },
  }]);
  assert.ok(world.fetches.some((f) => f.url === "https://api.github.com/user/memberships/orgs/acme"));
}));

test("a personal installation of another GitHub account is refused; the installer's own account is still allowed", scenario(async () => {
  world.github.installationPages = [[orgInstallation({ account: { id: 1234, login: "someone-else", type: "User" } })]];
  let live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), "account_mismatch");
  assertNoAdoption();

  world.github.installationPages = [[orgInstallation({ account: { id: 9001, login: "octo-owner", type: "User" } })]];
  live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_status"), "connected");
  assert.equal(world.installations.get(INSTALLATION_ID).accountType, "User");
  assert.ok(!world.fetches.some((f) => f.url.includes("/memberships/")));
}));

test("another App's installation and a suspended installation are refused; this App's active installation is still allowed", scenario(async () => {
  world.github.installationPages = [[orgInstallation({ app_id: 1 })]];
  let live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), "wrong_app");
  world.github.installationPages = [[orgInstallation({ suspended_at: "2026-10-01T00:00:00Z" })]];
  live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), "installation_suspended");
  assertNoAdoption();

  const filler = Array.from({ length: 100 }, (_, index) => orgInstallation({ id: 10_000 + index }));
  world.github.installationPages = [filler, [orgInstallation()]];
  live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_status"), "connected");
}));

test("GitHub pending approval and an installation not visible to the user stay pending with no write", scenario(async () => {
  const first = await start();
  const requested = await setup(first.state, first.nonce, { setup_action: "request" });
  assert.equal(outcome(requested).get("github_status"), "pending");
  assert.equal(new URL(requested.headers.get("location")).pathname, "/settings/github");
  const noId = await start();
  assert.equal(outcome(await setup(noId.state, noId.nonce, { setup_action: "install" })).get("github_status"), "pending");

  world.github.installationPages = [[]];
  const live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_status"), "pending");
  assertNoAdoption();
}));

test("GitHub authorization denied is refused before any token exchange; an approved authorization is still allowed", scenario(async () => {
  let live = await reachCallback();
  const denied = await callback(live.state, live.nonce, { error: "access_denied" });
  assert.equal(outcome(denied).get("github_error"), "access_denied");
  assert.deepEqual(tokenExchanges(), []);
  assertNoAdoption();

  world.github.tokenResponse = { error: "bad_verification_code" };
  live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), "github_unavailable");
  assertNoAdoption();

  world.github.tokenResponse = { access_token: USER_TOKEN, token_type: "bearer" };
  live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_status"), "connected");
}));

test("losing board admin rights between start and callback is refused; keeping them is still allowed", scenario(async () => {
  world.session = { userId: 11, source: "legacy" };
  let live = await reachCallback();
  world.boards[7].members[0].role = "Member";
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), "board_access_denied");
  assert.deepEqual(tokenExchanges(), []);
  assertNoAdoption();

  world.boards[7].members[0].role = "Admin";
  live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_status"), "connected");
}));

test("an installation already bound to another team is refused; re-adopting by the same team is still allowed", scenario(async () => {
  world.installations.set(INSTALLATION_ID, { id: INSTALLATION_ID, teamId: "team-b", revokedAt: null });
  let live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_error"), "installation_bound_elsewhere");
  assert.deepEqual(world.writes, []);
  assert.equal(world.installations.get(INSTALLATION_ID).teamId, "team-b");

  world.installations.set(INSTALLATION_ID, { id: INSTALLATION_ID, teamId: "team-a", installedByUserId: 11, revokedAt: new Date("2026-10-01") });
  live = await reachCallback();
  assert.equal(outcome(await callback(live.state, live.nonce)).get("github_status"), "connected");
  assert.deepEqual(world.writes, [{
    op: "update",
    where: { id: INSTALLATION_ID },
    data: { accountId: "7001", accountLogin: "acme", accountType: "Organization", installedByUserId: 10, revokedAt: null },
  }]);
}));

test("the GitHub user token is used only toward GitHub and never stored or redirected", scenario(async () => {
  const live = await reachCallback();
  const res = await callback(live.state, live.nonce);
  assert.equal(outcome(res).get("github_status"), "connected");
  assert.ok(!JSON.stringify(world.writes).includes(USER_TOKEN));
  assert.ok(!JSON.stringify([...world.redis.entries()]).includes(USER_TOKEN));
  assert.ok(!res.headers.get("location").includes(USER_TOKEN));
  for (const call of world.fetches.filter((f) => f.authorization)) {
    assert.equal(new URL(call.url).origin, "https://api.github.com");
  }
}));
