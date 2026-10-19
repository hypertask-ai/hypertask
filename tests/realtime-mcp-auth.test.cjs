const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { randomBytes } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const signingKey = randomBytes(32).toString("hex");
process.env.JWT_SECRET = signingKey;
process.env.JWT_ISSUER = "hypertask";

const user = {
  id: 985,
  email: "realtime@example.test",
  displayName: "Realtime user",
  mcpTokensRevokedAt: null,
};
const state = { session: null, revoked: new Set(), authorize: [], projectAccess: [], tokenAuthFlagOn: true };

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule("src/lib/prisma.ts", {
  default: {
    user: { findUnique: async ({ where }) => where.id === user.id ? user : null },
    revokedToken: {
      findFirst: async ({ where }) => {
        assert.equal(where.user_id, user.id);
        const jti = where.jti.in.find((id) => state.revoked.has(id));
        return jti ? { jti } : null;
      },
    },
    task: { findUnique: async ({ where }) => where.id === 42 ? { projectId: 15 } : null },
  },
});
stubModule("src/utils/controllers/logs/createLog.ts", { default: async () => null });
const REALTIME_TOKEN_AUTH_FLAG = "htpr-7381-realtime-token-auth";
stubModule("src/lib/flags.ts", {
  HTPR_7381_REALTIME_TOKEN_AUTH_FLAG: REALTIME_TOKEN_AUTH_FLAG,
  isFeatureEnabled: async (key) => key === REALTIME_TOKEN_AUTH_FLAG && state.tokenAuthFlagOn,
});
stubModule("src/lib/telemetry/analyticsIntents.ts", {});
stubModule("src/lib/telemetry/activationOccurrences.ts", {});
stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => state.session,
});
stubModule("src/lib/mcp/tasks/services.ts", {
  validateProjectAccess: async (projectId, userId, token) => {
    state.projectAccess.push([projectId, userId, token]);
    return { error: projectId === 15 && userId === user.id ? null : "No access" };
  },
});
stubModule("src/lib/realtime/server.ts", {
  getRealtimeServer: () => ({
    authorizeChannel(socketId, channel) {
      state.authorize.push([socketId, channel]);
      return { auth: `signed:${channel}` };
    },
  }),
});

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  cache: false,
  alias: { "@": path.join(root, "src") },
});
const { default: handler } = jiti(path.join(root, "src/pages/api/pusher/auth.ts"));

function tokenFor(payload = {}, options = {}, key = signingKey) {
  return jwt.sign({ userId: user.id, jti: "realtime-token", ...payload }, key, {
    issuer: "hypertask",
    audience: "mcp-api",
    expiresIn: "15m",
    ...options,
  });
}

async function invoke(channel, authorization) {
  const result = { status: null, body: null };
  const response = {
    status(code) {
      result.status = code;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
  };
  await handler({
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
    body: { socket_id: "123.456", channel_name: channel },
  }, response);
  return result;
}

test.beforeEach((t) => {
  state.session = null;
  state.tokenAuthFlagOn = true;
  state.revoked.clear();
  state.authorize.length = 0;
  state.projectAccess.length = 0;
  user.mcpTokensRevokedAt = null;
  t.mock.method(console, "log", () => {});
});

test("session users still access their project, task and user channels even with an invalid bearer", async () => {
  state.session = { userId: user.id };
  for (const channel of ["private-project-15", "private-task-42", `private-user-${user.id}`]) {
    const result = await invoke(channel, "Bearer invalid");
    assert.equal(result.status, 200, channel);
    assert.deepEqual(result.body, { auth: `signed:${channel}` });
  }
  assert.deepEqual(state.projectAccess, [[15, user.id, null], [15, user.id, null]]);
});

test("MCP bearer users access their own project, task and user channels without cookies", async () => {
  for (const channel of [
    "private-project-15", "private-time-project-15", "private-task-42",
    "private-time-task-42", `private-user-${user.id}`,
  ]) {
    const result = await invoke(channel, `Bearer ${tokenFor()}`);
    assert.equal(result.status, 200, channel);
    assert.deepEqual(result.body, { auth: `signed:${channel}` });
  }
  assert.deepEqual(state.projectAccess, Array(4).fill([15, user.id, null]));
});

test("a valid MCP bearer cannot subscribe to another user's channel or an inaccessible board or task", async () => {
  for (const channel of ["private-user-986", "private-project-999", "private-task-404"]) {
    const result = await invoke(channel, `Bearer ${tokenFor()}`);
    assert.equal(result.status, 403, channel);
    assert.deepEqual(result.body, { error: "No access to this channel" });
  }
  assert.deepEqual(state.authorize, []);
  assert.deepEqual(state.projectAccess, [[999, user.id, null]]);
});

test("missing, malformed, invalid, forged, expired and wrong-audience credentials are refused", async () => {
  for (const authorization of [
    undefined, "", "Basic credentials", "Bearer", "Bearer invalid",
    `Bearer ${tokenFor({}, {}, randomBytes(32).toString("hex"))}`,
    `Bearer ${tokenFor({}, { expiresIn: -1 })}`,
    `Bearer ${tokenFor({}, { audience: "email-verification" })}`,
  ]) {
    const result = await invoke(`private-user-${user.id}`, authorization);
    assert.equal(result.status, 403, authorization);
    assert.deepEqual(result.body, { error: "Not authenticated" });
  }
  assert.deepEqual(state.authorize, []);
  assert.deepEqual(state.projectAccess, []);
});

test("revoked MCP tokens are refused while a different token for the same user still works", async () => {
  state.revoked.add("realtime-token");
  const refused = await invoke("private-project-15", `Bearer ${tokenFor()}`);
  assert.equal(refused.status, 403);
  assert.deepEqual(state.authorize, []);
  assert.deepEqual(state.projectAccess, []);

  const allowed = await invoke("private-project-15", `Bearer ${tokenFor({ jti: "still-active" })}`);
  assert.equal(allowed.status, 200);
});

test("account-wide token revocation refuses old tokens but still allows newer ones", async () => {
  const now = Math.floor(Date.now() / 1000);
  user.mcpTokensRevokedAt = new Date((now - 30) * 1000);
  const refused = await invoke("private-project-15", `Bearer ${tokenFor({ iat: now - 60 })}`);
  assert.equal(refused.status, 403);
  assert.deepEqual(state.authorize, []);

  const allowed = await invoke("private-project-15", `Bearer ${tokenFor({ iat: now })}`);
  assert.equal(allowed.status, 200);
});

test("with the flag off, bearer tokens are refused while session users keep access", async () => {
  state.tokenAuthFlagOn = false;
  const refused = await invoke("private-project-15", `Bearer ${tokenFor()}`);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body, { error: "Not authenticated" });
  assert.deepEqual(state.authorize, []);

  state.session = { userId: user.id };
  const allowed = await invoke("private-project-15");
  assert.equal(allowed.status, 200);
});

test("account and team management keys cannot authorize data channels", async () => {
  for (const key of ["htmk_management-key", "httk_team-management-key"]) {
    const result = await invoke("private-project-15", `Bearer ${key}`);
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: "Not authenticated" });
  }
  assert.deepEqual(state.authorize, []);
  assert.deepEqual(state.projectAccess, []);
});
