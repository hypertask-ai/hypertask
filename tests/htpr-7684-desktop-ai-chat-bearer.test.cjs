const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const SIGNING_KEY_ENV = "JWT_" + "SECRET";
const TEST_SIGNING_KEY = ["desktop", "cli", "bearer", "test", "signing", "key", "0000000000"].join("-");
process.env[SIGNING_KEY_ENV] = TEST_SIGNING_KEY;
process.env.JWT_ISSUER = "hypertask";
process.env.JWT_OAUTH_AUDIENCE = "https://mcp.hypertask.ai";
delete process.env.REDIS_URL;

const FLAG = "htpr-7684-desktop-ai-chat-bearer";
const owner = { id: 6, email: "owner@example.test", displayName: "Owner" };
const agentId = "44444444-4444-4444-8444-444444444444";

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const state = {
  cookieUser: null,
  flagMode: "EVERYONE",
  flagLookupFails: false,
  users: new Map([[owner.id, { ...owner, mcpTokensRevokedAt: null }]]),
  revokedJtis: new Map(),
  agent: null,
};

stubModule("src/lib/telemetry/activationOccurrences.ts", { enqueueAuthenticatedConnection: async () => null });
stubModule("src/app/api/ai/_lib/editorAi.ts", { getCurrentUserFromCookies: async () => state.cookieUser });
stubModule("src/lib/prisma.ts", {
  default: {
    user: {
      findUnique: async ({ where }) => state.users.get(where.id) ?? null,
      findFirst: async ({ where }) => [...state.users.values()].find((u) => u.email === where.email) ?? null,
    },
    oAuthClient: { findUnique: async ({ where }) => (where.client_id === "owner-client" ? { client_id: where.client_id } : null) },
    revokedToken: {
      findFirst: async ({ where }) => {
        const revoked = state.revokedJtis.get(where.user_id);
        const match = revoked && where.jti.in.find((jti) => revoked.has(jti));
        return match ? { jti: match, user_id: where.user_id } : null;
      },
    },
    agent: {
      findFirst: async ({ where }) =>
        state.agent && state.agent.id === where.id && state.agent.userId === where.userId && !state.agent.revokedAt
          ? state.agent
          : null,
    },
    featureFlag: {
      findUnique: async ({ where }) => {
        if (where.key !== FLAG) return null;
        if (state.flagLookupFails) throw new Error("flag store unavailable");
        return { mode: state.flagMode };
      },
    },
    logs: { create: async () => ({ id: 1 }) },
  },
});

const jiti = require("jiti")(path.join(root, "tests/htpr-7684-desktop-ai-chat-bearer.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const { getAiRequestUser, getCliBearerChatUser } = jiti(path.join(root, "src/app/api/ai/_lib/requestUser.ts"));
const { createMcpToken, createOAuthToken } = jiti(path.join(root, "src/lib/mcp/auth.ts"));

function requestWith(token, headers = {}) {
  return new NextRequest("https://app.hypertask.ai/api/ai/chat/stream", {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

const desktopToken = () => createMcpToken(owner.id, owner.email, "30d");
const signed = (claims, options, key = TEST_SIGNING_KEY) =>
  jwt.sign({ sub: owner.email, userId: owner.id, jti: `jti-${Math.random()}`, ...claims }, key, options);

const decisions = [];
const originalInfo = console.info;
console.info = (label, payload) => {
  if (label === "[ai/cli-bearer]") decisions.push(payload);
  else originalInfo(label, payload);
};
test.after(() => { console.info = originalInfo; });

test.beforeEach(() => {
  state.cookieUser = null;
  state.flagMode = "EVERYONE";
  state.flagLookupFails = false;
  state.revokedJtis.clear();
  state.agent = null;
  state.users.get(owner.id).mcpTokensRevokedAt = null;
  decisions.length = 0;
});

for (const endpoint of ["chat-stream", "chat-cancel", "all-sessions"]) {
  test(`a human desktop CLI token is allowed on ${endpoint} and the decision is logged`, async () => {
    const user = await getCliBearerChatUser(requestWith(desktopToken()), endpoint);
    assert.equal(user?.id, owner.id);
    assert.deepEqual(decisions, [{ endpoint, decision: "allow", reason: "human_cli_token", userId: owner.id }]);
  });
}

test("flag off refuses the desktop token; flag on still allows it", async () => {
  const token = desktopToken();
  state.flagMode = "OFF";
  assert.equal(await getCliBearerChatUser(requestWith(token), "chat-stream"), null);
  assert.equal(decisions.at(-1).reason, "flag_off");
  state.flagMode = "EVERYONE";
  assert.equal((await getCliBearerChatUser(requestWith(token), "chat-stream"))?.id, owner.id);
});

test("a failing flag lookup refuses and logs flag_error", async () => {
  state.flagLookupFails = true;
  assert.equal(await getCliBearerChatUser(requestWith(desktopToken()), "chat-stream"), null);
  assert.equal(decisions.at(-1).reason, "flag_error");
});

test("the sidebar board header is refused for the desktop token; without it the token is allowed", async () => {
  const token = desktopToken();
  assert.equal(await getCliBearerChatUser(requestWith(token, { "x-hypertask-sidebar-project": "15" }), "chat-stream"), null);
  assert.deepEqual(decisions.at(-1), { endpoint: "chat-stream", decision: "refuse", reason: "sidebar_not_supported", userId: owner.id });
  assert.equal((await getCliBearerChatUser(requestWith(token), "chat-stream"))?.id, owner.id);
});

test("an agent mcp-api token is refused; the human token is allowed", async () => {
  const managedJwt = signed({ agentId, jti: "managed-generation-1" }, { issuer: "hypertask", audience: "mcp-api" });
  state.agent = { id: agentId, userId: owner.id, revokedAt: null, mcpToken: managedJwt, runtimeGeneration: 1 };
  assert.equal(await getCliBearerChatUser(requestWith(managedJwt), "chat-stream"), null);
  assert.equal(decisions.at(-1).reason, "not_cli_token");
  assert.equal((await getCliBearerChatUser(requestWith(desktopToken()), "chat-stream"))?.id, owner.id);
});

test("a team-bound agent token is refused", async () => {
  const teamBound = createMcpToken(owner.id, owner.email, "30d", agentId, { teamId: 77, accessBinding: "binding-1" });
  assert.equal(await getCliBearerChatUser(requestWith(teamBound), "chat-stream"), null);
});

test("legacy, audience-less and multi-audience tokens are refused even when correctly signed", async () => {
  for (const [name, token] of [
    ["legacy hypertasks-mcp", signed({}, { issuer: "hypertasks", audience: "hypertasks-mcp" })],
    ["audience-less", signed({}, { issuer: "hypertask" })],
    ["extra audience", signed({}, { issuer: "hypertask", audience: ["mcp-api", "https://elsewhere.example.test"] })],
    ["wrong issuer", signed({}, { issuer: "not-hypertask", audience: "mcp-api" })],
  ]) {
    assert.equal(await getCliBearerChatUser(requestWith(token), "chat-stream"), null, name);
  }
  assert.equal((await getCliBearerChatUser(requestWith(desktopToken()), "chat-stream"))?.id, owner.id);
});

test("an OAuth token is refused by the desktop path and still allowed by the browser and app resolver", async () => {
  const oauth = createOAuthToken("firebase-owner", owner.id, owner.email, "owner-client");
  assert.equal(await getCliBearerChatUser(requestWith(oauth), "chat-stream"), null);
  assert.equal((await getAiRequestUser(requestWith(oauth)))?.id, owner.id);
});

test("the desktop token stays refused by the shared resolver Task Writer uses", async () => {
  assert.equal(await getAiRequestUser(requestWith(desktopToken())), null);
});

test("API keys, management keys and malformed values are refused", async () => {
  for (const token of ["htk_" + "opaque-api-key-shape", "htmk_" + "management-key-shape", "not-a-jwt", "two.segments"]) {
    assert.equal(await getCliBearerChatUser(requestWith(token), "chat-stream"), null, token);
  }
  assert.ok(decisions.every((entry) => entry.reason === "not_cli_token" && !("userId" in entry)));
});

test("no bearer means no decision and no log", async () => {
  assert.equal(await getCliBearerChatUser(requestWith(null), "chat-stream"), null);
  assert.deepEqual(decisions, []);
});

test("a revoked desktop token is refused; a fresh one is still allowed", async () => {
  const revoked = desktopToken();
  const fresh = desktopToken();
  state.revokedJtis.set(owner.id, new Set([`user:${owner.id}:${jwt.decode(revoked).jti}`]));
  assert.equal(await getCliBearerChatUser(requestWith(revoked), "chat-stream"), null);
  assert.equal(decisions.at(-1).reason, "invalid_token");
  assert.equal((await getCliBearerChatUser(requestWith(fresh), "chat-stream"))?.id, owner.id);
});

test("revoke-all, an expired token and a foreign signature are refused", async () => {
  const expired = signed({ iat: Math.floor(Date.now() / 1000) - 120, exp: Math.floor(Date.now() / 1000) - 60 }, { issuer: "hypertask", audience: "mcp-api" });
  const forged = signed({}, { issuer: "hypertask", audience: "mcp-api" }, ["another", "signing", "key", "0000000000"].join("-"));
  assert.equal(await getCliBearerChatUser(requestWith(expired), "chat-stream"), null);
  assert.equal(await getCliBearerChatUser(requestWith(forged), "chat-stream"), null);
  const issuedBefore = desktopToken();
  state.users.get(owner.id).mcpTokensRevokedAt = new Date(Date.now() + 60_000);
  assert.equal(await getCliBearerChatUser(requestWith(issuedBefore), "chat-stream"), null);
});

test("no log line carries token material", async () => {
  const token = desktopToken();
  await getCliBearerChatUser(requestWith(token), "chat-stream");
  await getCliBearerChatUser(requestWith(token, { "x-hypertask-sidebar-project": "15" }), "chat-stream");
  assert.ok(!JSON.stringify(decisions).includes(token.split(".")[2]));
});

function sessionList({ sessionUser, cliUser, headers = {} }) {
  const queries = [];
  const cliCalls = [];
  const { GET } = load("src/app/api/ai-chat/all-sessions/route.ts", {
    "@/lib/prisma": { default: { chatSession: {
      findMany: async (args) => { queries.push(args); return [{ id: "s1", userId: args.where.userId, messages: [] }]; },
      findFirst: async (args) => { queries.push(args); return null; },
      create: async (args) => { queries.push(args); return { id: "new", userId: args.data.userId, messages: [] }; },
    } } },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => sessionUser },
    "@/app/api/ai/_lib/requestUser": { getCliBearerChatUser: async (_request, endpoint) => { cliCalls.push(endpoint); return cliUser; } },
    "@/lib/api/rateLimit": { checkRestRateLimit: async () => null },
    "@/lib/redis": { getRedis: async () => ({}) },
    "@/lib/agents/chatAccess": {
      sidebarChatProjectId: (h) => (h.get("x-hypertask-sidebar-project") === null ? undefined : 15),
      loadSidebarChatRequest: async () => ({ ok: false, status: 404, error: "Not found" }),
    },
    "@/lib/api/response": { unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }) },
    "next/server": { NextResponse: Response },
  });
  return { queries, cliCalls, get: () => GET(new Request("https://app.hypertask.ai/api/ai-chat/all-sessions", { headers })) };
}

test("all-sessions lists only the desktop user's own chats; without a valid desktop login it refuses", async () => {
  const allowed = sessionList({ sessionUser: null, cliUser: { id: owner.id }, headers: { Authorization: "Bearer x.y.z" } });
  const response = await allowed.get();
  assert.equal(response.status, 200);
  assert.deepEqual(allowed.cliCalls, ["all-sessions"]);
  assert.equal(allowed.queries[0].where.userId, owner.id);

  const refused = sessionList({ sessionUser: null, cliUser: null, headers: { Authorization: "Bearer x.y.z" } });
  assert.equal((await refused.get()).status, 401);
  assert.deepEqual(refused.queries, []);
});

test("all-sessions keeps the browser session first and never asks the desktop path without a bearer", async () => {
  const browser = sessionList({ sessionUser: { userId: 985, user: { id: 985 } }, cliUser: { id: owner.id }, headers: { Authorization: "Bearer x.y.z" } });
  assert.equal((await browser.get()).status, 200);
  assert.deepEqual(browser.cliCalls, []);
  assert.equal(browser.queries[0].where.userId, 985);

  const anonymous = sessionList({ sessionUser: null, cliUser: { id: owner.id } });
  assert.equal((await anonymous.get()).status, 401);
  assert.deepEqual(anonymous.cliCalls, []);
});
