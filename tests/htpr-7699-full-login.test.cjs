const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { load } = require("./task-route-loader.cjs");
const { access, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

const key = ["full", "login", "7699", "local", "signing", "fixture"].join("-");
process.env.JWT_SECRET = key;
process.env.SESSION_SECRET = key;
process.env.JWT_ISSUER = "hypertask";
process.env.AUTH_LEGACY_FAST_PATH = "1";
process.env.BETTER_AUTH_ENABLED = "0";
const FLAG = "htpr-7699-desktop-cli-token";
const human = { id: 985, email: "member@example.test", displayName: "Member", mcpTokensRevokedAt: null };
const other = { id: 77, email: "other@example.test", displayName: "Other", mcpTokensRevokedAt: null };

function fixture() {
  const state = { enabled: true, flagError: false, revokedCookie: false, revoked: false, headers: new Headers(), cookies: {}, writes: [], sessions: [], flags: [], origins: [] };
  const users = [{ ...human }, { ...other }];
  const boards = [15, 99].map(id => ({ id, status: "Normal", ownerId: id === 15 ? human.id : other.id, members: [] }));
  const prisma = {
    user: { findUnique: async ({ where }) => users.find(user => user.id === where.id) ?? null },
    revokedToken: { findFirst: async () => state.revoked ? { jti: "revoked" } : null },
    project: { findFirst: async args => hydrate(boards.find(row => matches(row, args.where)), args) },
    drafts: { updateMany: async ({ where, data }) => { state.writes.push({ where, data }); return { count: where.id === 1 && where.userId === human.id ? 1 : 0 }; } },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/agentScope": { prepareAgentScope: async (...args) => state.sessions.push(args), withAgentScopeRequest: (_request, action) => action(), recordAgentBoardScopeMiss() {} },
    "@/lib/auth/agentTeamScope": {},
    "@/lib/auth/sessionRevocation": { isSessionTokenRevoked: async () => state.revokedCookie },
    "@/lib/flags": {
      HTPR_7699_DESKTOP_CLI_TOKEN_FLAG: FLAG,
      isFeatureEnabled: async (flag, id) => {
        if (flag !== FLAG) return true;
        state.flags.push(id);
        if (state.flagError) throw new Error("flag store unavailable");
        return state.enabled && id === human.id;
      },
    },
    "@/utils/controllers/logs/createLog": { default: async () => null },
    "@/lib/mcp/managementKeyTeamScope": {},
    "@/utils/controllers/projects/getAllIncludes": access,
    "next/headers": { headers: async () => state.headers, cookies: async () => ({ get: name => state.cookies[name] ? { value: state.cookies[name] } : undefined }) },
    "@/utils/edgeHelpers": { isValidUser: value => { try { return { isValid: true, user: JSON.parse(value) }; } catch { return { isValid: false }; } } },
    "@/lib/auth/sessionUserRecord": {},
    "@/lib/net/downloadWithoutBrotli": {},
    "@/lib/media/inlineAgentImages.server": {},
    "@/utils/controllers/tasks/parentTaskAccess": {},
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": {},
    "@/lib/mcp/webhooks/taskEvents": {},
    "@/lib/mcp/webhooks/outbox": {},
    "@/lib/agentWebhooks/outbox": {},
    "@/lib/telemetry/savedWork": {},
    "./create-global-effects": {},
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => false },
  };
  const resolver = load("src/lib/auth/desktopCliTokenUser.ts", mocks);
  mocks["@/lib/auth/desktopCliTokenUser"] = resolver;
  const session = load("src/lib/auth/getSessionUser.ts", mocks);
  mocks["@/lib/auth/getSessionUser"] = session;
  const signed = load("src/lib/auth/session.ts", mocks);
  const headers = claims => new Headers({ authorization: `Bearer ${jwt.sign({ userId: human.id, sub: human.email, jti: "fixture", mcpIssuedAtMs: Date.now(), ...claims }, key, { issuer: "hypertask", ...(claims?.aud ? {} : { audience: "mcp-api" }), expiresIn: "1h" })}` });
  async function call(file, { method = "POST", body = {}, query = {}, requestHeaders = headers() } = {}) {
    state.headers = requestHeaders;
    const req = { method, headers: Object.fromEntries(requestHeaders), cookies: Object.fromEntries((requestHeaders.get("cookie") ?? "").split(";").filter(Boolean).map(part => { const [name, ...value] = part.trim().split("="); return [name, value.join("=")]; })), body, query, url: file.replace("src/pages", "").replace(/\.ts$/, "") };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, setHeader() {}, once(_event, callback) { this.finish = callback; } };
    await load(file, mocks).default(req, res);
    res.finish?.();
    return res;
  }
  return { state, users, mocks, session, signed, headers, call, prisma };
}

const originalInfo = console.info;
const originalLog = console.log;
const logs = [];
test.before(() => { console.info = (...args) => logs.push(args); console.log = (...args) => logs.push(args); });
test.after(() => { console.info = originalInfo; console.log = originalLog; });
test.beforeEach(() => { logs.length = 0; });

test("shared login accepts the flagged human and prepares its principal", async () => {
  const h = fixture();
  const user = await h.session.getSessionUser(h.headers());
  assert.equal(user.userId, human.id);
  assert.equal(user.source, "cli-bearer");
  assert.equal(user.teamScope, null);
  assert.equal(user.agentId, undefined);
  assert.deepEqual(h.state.sessions, [[human.id, undefined]]);
  assert.ok(logs.some(([label, event]) => label === "[desktop/cli-bearer]" && event.endpoint === "shared-session" && event.userId === human.id));
});

for (const refusal of ["flag off", "flag failure", "agent", "foreign audience", "revoked token", "revoked user", "other human", "invalid signature"]) {
  test(`shared login refuses ${refusal} before preparing scope`, async () => {
    const h = fixture();
    let headers = h.headers();
    if (refusal === "flag off") h.state.enabled = false;
    if (refusal === "flag failure") h.state.flagError = true;
    if (refusal === "agent") headers = h.headers({ agentId: "44444444-4444-4444-8444-444444444444" });
    if (refusal === "foreign audience") headers = h.headers({ aud: ["mcp-api", "elsewhere"] });
    if (refusal === "revoked token") h.state.revoked = true;
    if (refusal === "revoked user") h.users[0].mcpTokensRevokedAt = new Date(Date.now() + 1000);
    if (refusal === "other human") headers = h.headers({ userId: other.id });
    if (refusal === "invalid signature") headers.set("authorization", headers.get("authorization").slice(0, -20) + "invalid-signature");
    assert.equal(await h.session.getSessionUser(headers), null);
    assert.deepEqual(h.state.sessions, []);
  });
}

test("a real cookie wins against valid and invalid conflicting bearer, even with the flag off", async () => {
  for (const invalid of [false, true]) {
    const h = fixture();
    h.state.enabled = false;
    const headers = h.headers();
    headers.set("cookie", `ht_session=${h.signed.signSession({ id: other.id })}`);
    if (invalid) headers.set("authorization", "Bearer invalid");
    const user = await h.session.getSessionUser(headers);
    assert.equal(user.userId, other.id);
    assert.equal(user.source, "legacy");
    assert.deepEqual(h.state.flags, []);
  }
});

test("a revoked signed cookie cannot borrow a valid desktop token", async () => {
  const h = fixture();
  const headers = h.headers();
  headers.set("cookie", `ht_session=${h.signed.signSession({ id: other.id })}`);
  h.state.revokedCookie = true;
  assert.equal(await h.session.getSessionUser(headers), null);
  assert.deepEqual(h.state.flags, []);
});

for (const file of ["src/pages/api/tasks/createGlobally.ts", "src/pages/api/drafts/archiveDraft.ts", "src/pages/api/members/getAllTeamMembers.ts"]) {
  test(`${file}: real shared login reaches validation; missing and agent credentials stay refused`, async () => {
    const method = file.includes("getAllTeamMembers") ? "GET" : "POST";
    const h = fixture();
    assert.equal((await h.call(file, { method, body: { projectId: null } })).statusCode, 400);
    assert.equal((await h.call(file, { method, requestHeaders: new Headers() })).statusCode, 401);
    assert.equal((await h.call(file, { method, requestHeaders: h.headers({ agentId: "44444444-4444-4444-8444-444444444444" }) })).statusCode, 401);
    const cookie = new Headers({ cookie: `ht_session=${h.signed.signSession({ id: human.id })}` });
    assert.equal((await h.call(file, { method, body: { projectId: null }, requestHeaders: cookie })).statusCode, 400);
  });
}

test("createGlobally refuses foreign board and forged actor through the actual Pages adapter", async () => {
  const h = fixture();
  const file = "src/pages/api/tasks/createGlobally.ts";
  assert.equal((await h.call(file, { body: { projectId: 99 } })).statusCode, 403);
  assert.equal((await h.call(file, { body: { projectId: 15, userId: other.id } })).statusCode, 403);
  assert.ok(logs.some(([label, event]) => label === "[desktop/cli-authorization]" && event.endpoint === "task-write" && event.path === "/api/tasks/createGlobally" && event.method === "POST" && event.status === 403 && event.userId === human.id));
  assert.deepEqual(h.state.writes, []);
});

test("draft save uses authenticated ownership, never body identity", async () => {
  const h = fixture();
  const file = "src/pages/api/drafts/archiveDraft.ts";
  assert.equal((await h.call(file, { body: { draftId: 1, userId: other.id } })).statusCode, 200);
  assert.deepEqual(h.state.writes[0].where, { id: 1, userId: human.id, type: "Comment" });
  assert.equal((await h.call(file, { body: { draftId: 2, userId: human.id } })).statusCode, 404);
  assert.deepEqual(logs.filter(([label]) => label === "[desktop/cli-authorization]").map(([, event]) => ({ path: event.path, method: event.method, status: event.status, userId: event.userId })), [
    { path: "/api/drafts/archiveDraft", method: "POST", status: 200, userId: human.id },
    { path: "/api/drafts/archiveDraft", method: "POST", status: 404, userId: human.id },
  ]);
});

test("profile helpers load the verified desktop user, retaining their cookie-only refusal", async () => {
  const h = fixture();
  h.state.headers = h.headers();
  const server = load("src/lib/auth/serverUser.ts", h.mocks);
  const current = load("src/lib/auth/currentUser.ts", h.mocks);
  assert.equal((await server.getServerCookieUser()).id, human.id);
  assert.equal((await current.loadCurrentUser(h.state.headers, true)).userId, human.id);
  h.state.headers = new Headers();
  assert.equal(await server.getServerCookieUser(), null);
  h.state.cookies.nookies_user = JSON.stringify({ id: other.id });
  h.state.headers = h.headers();
  assert.equal(await server.getServerCookieUser(), null);
});

test("workspace mutation needs browser origin unless the selected credential is desktop CLI", async () => {
  const h = fixture();
  class WorkspaceWebhookError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  h.mocks["@/lib/mcp/webhooks/workspaceManagement"] = { WorkspaceWebhookError, createWorkspaceWebhook: async ({ userId }) => ({ userId }) };
  const route = load("src/app/api/settings/webhooks/route.ts", h.mocks);
  const { NextRequest } = require("next/server");
  const request = headers => new NextRequest("https://app.example.test/api/settings/webhooks", { method: "POST", headers, body: JSON.stringify({ teamId: "fixture-team", url: "https://receiver.example.test" }) });
  const desktop = await route.POST(request(h.headers()));
  assert.equal(desktop.status, 201);
  assert.equal((await desktop.json()).userId, human.id);
  const mixed = h.headers();
  mixed.set("cookie", `ht_session=${h.signed.signSession({ id: other.id })}`);
  assert.equal((await route.POST(request(mixed))).status, 403);
  mixed.set("origin", "https://evil.example.test");
  assert.equal((await route.POST(request(mixed))).status, 403);
  mixed.set("origin", "https://app.example.test");
  mixed.set("host", "app.example.test");
  const cookie = await route.POST(request(mixed));
  assert.equal(cookie.status, 201);
  assert.equal((await cookie.json()).userId, other.id);
});

test("better-auth remains first, including legacy-cookie disagreement and bearer fallback on outage", async () => {
  const h = fixture();
  const previous = process.env.BETTER_AUTH_ENABLED;
  const fast = process.env.AUTH_LEGACY_FAST_PATH;
  let fail = false;
  h.mocks["@/lib/auth/betterAuth"] = { auth: { api: { getSession: async () => {
    if (fail) throw new Error("auth service unavailable");
    return { user: { id: String(other.id) } };
  } } } };
  process.env.BETTER_AUTH_ENABLED = "1";
  process.env.AUTH_LEGACY_FAST_PATH = "0";
  try {
    const headers = h.headers();
    assert.equal((await h.session.getSessionUser(headers)).source, "better-auth");
    assert.equal((await h.session.getSessionUser(headers)).userId, other.id);
    assert.deepEqual(h.state.flags, []);
    headers.set("cookie", `ht_session=${h.signed.signSession({ id: human.id })}`);
    const mismatch = await h.session.getSessionUser(headers);
    assert.equal(mismatch.userId, human.id);
    assert.equal(mismatch.source, "legacy");
    fail = true;
    const fallback = await h.session.getSessionUser(h.headers());
    assert.equal(fallback.userId, human.id);
    assert.equal(fallback.source, "cli-bearer");
  } finally {
    process.env.BETTER_AUTH_ENABLED = previous;
    process.env.AUTH_LEGACY_FAST_PATH = fast;
  }
});

test("draft response logging covers unexpected failures without leaking their details", async () => {
  const h = fixture();
  h.prisma.drafts.updateMany = async () => { throw new Error("private-repository-detail"); };
  const response = await h.call("src/pages/api/drafts/archiveDraft.ts", { body: { draftId: 1 } });
  assert.equal(response.statusCode, 500);
  const events = logs.filter(([label]) => label === "[desktop/cli-authorization]").map(([, event]) => event);
  assert.deepEqual(events.map(event => ({ path: event.path, method: event.method, userId: event.userId, status: event.status })), [
    { path: "/api/drafts/archiveDraft", method: "POST", userId: human.id, status: 500 },
  ]);
  assert.equal(JSON.stringify(events).includes("private-repository-detail"), false);
});
