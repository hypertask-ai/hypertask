const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
function load(relativePath, aliases = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module_ = { exports: {} };
  new Function("require", "module", "exports", javascript)(
    (specifier) => aliases[specifier] ?? require(specifier), module_, module_.exports,
  );
  return module_.exports;
}

const ids = load("src/lib/auth/ownerOrQaIds.ts");
const users = [
  { id: 6, email: "valentin.yeo@gmail.com" },
  { id: 985, email: "valentin@hypertask.ai" },
  { id: 2343, email: "customer@example.test" },
];
let principal = null;
let storedUsers = users;
let seeded = [];
let configured = true;
let loginUser = users[1];
const db = {
  user: {
    findUnique: async ({ where }) => storedUsers.find((user) => user.id === where.id) ?? null,
    findFirst: async () => loginUser,
  },
  featureFlag: { findUnique: async () => ({ mode: "OWNER_AND_QA" }) },
  agent: { findMany: async () => [] },
  project: { findFirst: async () => ({ id: 15 }) },
  $queryRaw: async () => [],
};
const flags = load("src/lib/flags.ts", {
  "@/lib/prisma": db,
  "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [] },
  "@/lib/flags/keys": {},
});
const aliases = {
  "@/lib/prisma": db,
  "@/lib/flags": flags,
  "@/lib/auth/getSessionUser": { getSessionUser: async () => principal && ({ userId: principal.id }) },
  "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false },
  "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
  "@/lib/agents/working": { workingOnByAgent: async () => new Map() },
  "@/lib/agents/ownedSlugs": { ownedAgentSlugs: async () => new Map() },
  "@/lib/agents/maskAgentProviderKey": {},
  "@/lib/aiAllowancePolicy": {},
  "@/app/api/ai/_lib/heartbeatExecution": {},
  "@/lib/nativeAgent/agentMessageEnvelope": {},
  "@/lib/aiModelOptions": {},
  "@/lib/flags/keys": {},
  "@/utils/controllers/agents/ensureDefaultTeamAgent": {
    ensureDefaultAgentsOnAccessibleTeams: async (id) => seeded.push(id),
    ensureDefaultTeamAgent: async (id) => seeded.push(id),
  },
  "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
  "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({}) },
  "@/lib/mcp/auth": {},
  "@/utils/controllers/agents/boardMembers": {},
  "@/utils/controllers/agents/teamScope": { getAgentTeamId: () => "test-team" },
  "@/lib/mcpClientEval/latest.json": { rows: [], summary: {} },
};

const owned = load("src/app/api/agents/owned/route.ts", aliases);
const team = load("src/app/api/agents/route.ts", aliases);
const evalRoute = load("src/app/api/agents/mcp-client-eval/route.ts", aliases);
const loginAliases = {
  ...aliases,
  "@/lib/auth/slimUserCookie": { slimUserForCookie: (user) => user },
  "@/lib/auth/themeCookie": { seedResponseThemeCookie: () => {} },
  "@/lib/auth/session": {
    SESSION_COOKIE: "test-session", SESSION_TTL_SECONDS: 60,
    sessionCookieOptions: () => ({}), signSession: () => "test-session",
    clearBetterAuthSessionCookies: () => {},
  },
  "@/lib/auth/qaLogin": {
    QA_LOGIN_USER_ID: 985,
    isQaLoginConfigured: () => configured,
    getQaLoginConfig: () => configured ? { email: users[1].email, password: "test-only-password" } : null,
    normalizeQaLoginEmail: (email) => email.trim().toLowerCase(),
    qaLoginCredentialsMatch: async (email, password) => email === users[1].email && password === "test-only-password",
  },
  "@/lib/auth/qaLoginRateLimit": {
    getQaLoginClientIp: () => "192.0.2.1",
    claimQaLoginAttempt: async () => ({ allowed: true }),
  },
};
const login = load("src/app/api/auth/qa-login/route.ts", loginAliases);
const page = load("src/app/qa/login/page.tsx", {
  ...loginAliases,
  "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
  "@/components/Global/mobileShellVisibility": { shouldShowMobileTabBar: () => false },
  "./QaLoginForm": { QaLoginForm: () => null },
});
const request = () => new NextRequest("https://example.test/api/agents?teamId=test-team");
const loginRequest = (email, password = "test-only-password") => new NextRequest("https://example.test/api/auth/qa-login", {
  method: "POST", body: JSON.stringify({ email, password }),
});

test.beforeEach(() => {
  principal = null;
  storedUsers = users;
  seeded = [];
  configured = true;
  loginUser = users[1];
});

test("permanent and OWNER_AND_QA checks still allow the exact owner and QA identities", async () => {
  for (const user of users.slice(0, 2)) {
    storedUsers = [{ ...user, email: ` ${user.email.toUpperCase()} ` }];
    assert.equal(ids.hasOwnerOrQaUserId(user), true);
    assert.equal(await flags.isOwnerOrQaUserId(user.id), true);
    assert.equal(await flags.isFeatureEnabled("test-stored-mode", user.id), true);
  }
});

test("permanent and OWNER_AND_QA checks still refuse customers, mismatched IDs/emails and absent users", async () => {
  for (const user of [users[2], { ...users[0], email: users[1].email }, { ...users[1], email: users[0].email }, { id: 2343, email: users[0].email }]) {
    storedUsers = [user];
    assert.equal(await flags.isOwnerOrQaUserId(user.id), false);
    assert.equal(await flags.isFeatureEnabled("test-stored-mode", user.id), false);
  }
  storedUsers = [];
  assert.equal(await flags.isOwnerOrQaUserId(6), false);
  assert.equal(ids.hasOwnerOrQaUserId(null), false);
  assert.equal(ids.hasOwnerOrQaUserId(users[2]), false);
});

for (const [name, route] of [["owned", owned], ["team", team]]) {
  test(`${name} agent list still seeds for both owner and QA`, async () => {
    for (const user of users.slice(0, 2)) {
      principal = user;
      const response = await route.GET(request());
      assert.equal(response.status, 200);
      assert.equal(await response.text(), '{"success":true,"agents":[]}');
    }
    assert.deepEqual(seeded, [6, 985]);
  });

  test(`${name} agent list still refuses customer seeding without changing their list response`, async () => {
    principal = users[2];
    const response = await route.GET(request());
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"success":true,"agents":[]}');
    assert.deepEqual(seeded, []);
    principal = null;
    const anonymous = await route.GET(request());
    assert.equal(anonymous.status, 401);
    assert.equal(await anonymous.text(), '{"success":false,"error":"Unauthorized"}');
    assert.deepEqual(seeded, []);
  });
}

test("MCP eval still allows owner and QA and the client renders their panel", async (t) => {
  t.mock.method(global, "fetch", async () => ({ ok: true, json: async () => ({ rows: [], summary: {} }) }));
  for (const user of users.slice(0, 2)) {
    principal = user;
    const response = await evalRoute.GET(request());
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"success":true,"report":{"rows":[],"summary":{}}}');
    assert.notEqual(renderPanel(user), null);
  }
});

test("MCP eval still refuses customers and anonymous callers with identical bodies and no client fetch", async (t) => {
  const fetch = t.mock.method(global, "fetch", () => { throw new Error("must not fetch"); });
  principal = users[2];
  const response = await evalRoute.GET(request());
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '{"success":false,"error":"Not found"}');
  principal = null;
  const anonymous = await evalRoute.GET(request());
  assert.equal(anonymous.status, 401);
  assert.equal(await anonymous.text(), '{"success":false,"error":"Unauthorized"}');
  assert.equal(renderPanel(users[2]), null);
  assert.equal(fetch.mock.callCount(), 0);
});

function renderPanel(currentUser) {
  const panel = load("src/app/agents/McpClientEvalPanel.tsx", {
    "@/lib/auth/ownerOrQaIds": ids,
    react: { useState: () => [{ rows: [], summary: {} }, () => {}], useEffect: () => {} },
  });
  return panel.default({ currentUser });
}

test("owner and QA callers can still sign in using the fixed QA credentials; public login page stays reachable", async () => {
  for (const user of users.slice(0, 2)) {
    principal = user;
    const response = await login.POST(loginRequest(users[1].email));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"success":true,"redirectUrl":"/project?id=15"}');
    assert.ok(response.cookies.get("test-session"));
  }
  principal = null;
  assert.ok(await page.default());
});

test("normal and logged-out callers still cannot sign in with normal credentials or an incorrect QA password", async () => {
  for (const caller of [users[2], null]) {
    principal = caller;
    for (const [email, password] of [[users[2].email, "test-only-password"], [users[1].email, "wrong-password"], [users[0].email, "test-only-password"]]) {
      const response = await login.POST(loginRequest(email, password));
      assert.equal(response.status, 401);
      assert.equal(await response.text(), '{"success":false,"error":"Invalid email or password"}');
      assert.equal(response.cookies.get("test-session"), undefined);
    }
  }
});

test("QA login still fails closed with an empty 404 if configuration or the fixed QA identity is unavailable", async () => {
  for (const setup of [() => { configured = false; }, () => { storedUsers = [{ ...users[1], email: "changed@example.test" }]; }]) {
    setup();
    const response = await login.POST(loginRequest(users[1].email));
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
    await assert.rejects(page.default(), /NOT_FOUND/);
  }
});

test("QA login never issues a session for a different database account", async () => {
  loginUser = users[2];
  const response = await login.POST(loginRequest(users[1].email));
  assert.equal(response.status, 401);
  assert.equal(await response.text(), '{"success":false,"error":"Invalid email or password"}');
  assert.equal(response.cookies.get("test-session"), undefined);
});

test("the browser panel decides by user id only, so owner and QA emails stay out of client code", () => {
  assert.equal(ids.FEATURE_FLAG_OWNER_USER_ID, flags.FEATURE_FLAG_OWNER_USER_ID);
  assert.equal(ids.FEATURE_FLAG_QA_USER_ID, flags.FEATURE_FLAG_QA_USER_ID);
  for (const file of ["src/app/agents/McpClientEvalPanel.tsx", "src/lib/auth/ownerOrQaIds.ts"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /@\/lib\/flags"/, `${file} must not import the server email allowlist`);
    assert.doesNotMatch(source, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, `${file} must not contain an email address`);
  }
});
