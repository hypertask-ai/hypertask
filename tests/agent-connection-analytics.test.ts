import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import jwt from "jsonwebtoken";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const flag = "htpr-7272-payment-login-agent-events";
const connectedAt = new Date("2026-10-16T12:00:00.000Z");

function harness() {
  const h = activationHarness();
  h.mocks["@/lib/flags"].HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG = flag;
  h.setFlagEnabled(flag, true);
  h.mocks["@/lib/telemetry/analyticsOutbox"] = { isAnalyticsOutboxEnabled: async () => false };
  return h;
}

function connectionId(key: string, userId = 123) {
  return createHash("sha256").update(`hypertask:connection:${userId}:${key}`).digest("hex").slice(0, 32);
}

function authenticated(h: ReturnType<typeof harness>) {
  const user = h.users.get(123);
  h.mocks["@/lib/apiKeys"] = { hashApiKey: (token: string) => `hash:${token}` };
  h.mocks["@/lib/mcp/managementPermissions"] = {
    hasDataPermission: () => true,
    parseManagementPermissions: (permissions: unknown) => permissions,
  };
  h.mocks["@/lib/mcp/managementKeyTeamScope"] = {
    ACCOUNT_MANAGEMENT_KEY_PREFIX: "ht_mgmt_", TEAM_MANAGEMENT_KEY_PREFIX: "ht_team_",
  };
  h.mocks["@/lib/mcp/auth/verifyJwt"] = {
    validateJwtToken: async (token: string) => ({ teamScope: null, user, agentId: token.includes("second-agent") ? "second-agent" : "agent-one" }),
  };
  h.mocks["@/lib/mcp/operationContext"] = { getMcpOperationContext: () => null };
  h.mocks["@/lib/auth/betterAuth"] = { auth: { api: { verifyApiKey: async ({ body }: any) => ({
    valid: true, key: { id: body.key.includes("second") ? 8 : 7, referenceId: "123", prefix: "ht_mgmt_", permissions: { data: ["read"] } },
  }) } } };
  h.prisma.apiKey = {
    findFirst: async ({ where }: any) => ({ id: where.keyHash.includes("second") ? 12 : 11, lastUsedAt: new Date(), user }),
    updateMany: async () => ({}),
  };
  return h.load("src/lib/mcp/auth/session.ts").validateMcpAuth;
}

function request(token: string, userAgent = "Claude Code", pathname = "/mcp") {
  return new Request(`http://localhost${pathname}`, { headers: { authorization: `Bearer ${token}`, "user-agent": userAgent } });
}

test("a validated agent's rotated credentials share one durable occurrence and cold-start marker", async () => {
  const h = harness();
  const validate = authenticated(h);
  await validate(request("credential-one"));
  await validate(request("credential-rotated"));
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.connection_id, connectionId("agent:agent-one"));
  assert.equal(h.logs[0].log, `activation:agent_connected:connection:${connectionId("agent:agent-one")}`);
  const cold = harness();
  cold.logs.push(...h.logs);
  await authenticated(cold)(request("credential-cold-start"));
  await cold.drain();
  assert.equal(cold.captures.length, 0);
});

test("a credential counted before the rollout claims its durable connection without a second event", async () => {
  const h = harness();
  const fingerprint = createHash("sha256").update("credential-before-rollout").digest("hex");
  h.logs.push({ log: `activation:agent_connected:${fingerprint}`, LoggedById: 123, createdAt: new Date("2026-10-01T00:00:00Z") });
  const validate = authenticated(h);
  await validate(request("credential-before-rollout"));
  await h.drain();
  assert.equal(h.captures.length, 0);
  assert.ok(h.logs.some(({ log }) => log === `activation:agent_connected:connection:${connectionId("agent:agent-one")}`));
  await validate(request("credential-rotated-after-rollout"));
  await h.drain();
  assert.equal(h.captures.length, 0);
});

test("two different validated agents produce first then non-first connections", async () => {
  const h = harness();
  const validate = authenticated(h);
  await validate(request("credential-one"));
  await validate(request("credential-second-agent"));
  await h.drain();
  assert.deepEqual(h.captures.map(({ properties }) => [properties.connection_id, properties.is_first]), [
    [connectionId("agent:agent-one"), true], [connectionId("agent:second-agent"), false],
  ]);
});

test("OAuth authorization-code reauthorization dedupes by client or bound agent, not access credential", async () => {
  const h = harness();
  const contract = h.load("src/lib/mcp/oauthTokenContract.ts");
  const api = h.load("src/lib/telemetry/activationOccurrences.ts");
  const token = (jti: string, clientId: string, agentId?: string) => jwt.sign({
    iss: contract.JWT_OAUTH_ISSUER, aud: contract.JWT_OAUTH_AUDIENCE,
    [contract.OAUTH_CLIENT_ID_CLAIM]: clientId, jti, agentId,
  }, "mock-local-signing");
  await h.connect(123, token("first", "oauth-client-one"), "mcp", "Cursor");
  await h.connect(123, token("reauthorized", "oauth-client-one"), "mcp", "Cursor");
  await h.connect(123, token("bound", "oauth-client-one", "bound-agent"), "mcp", "Cursor");
  await h.connect(123, token("bound-again", "oauth-client-two", "bound-agent"), "mcp", "Cursor");
  await h.drain();
  assert.deepEqual(h.captures.map(({ properties }) => properties.connection_id), [
    connectionId("oauth_client:oauth-client-one"), connectionId("agent:bound-agent"),
  ]);
  await h.authenticate(request(token("access-use", "unused-client")), 123, token("access-use", "unused-client"));
  await h.drain();
  assert.equal(h.captures.length, 2);
});

test("a second CLI login with a new credential is not a second connection", async () => {
  const h = harness();
  let count = 0;
  h.mocks["@/lib/redis"] = { getRedis: async () => ({
    incr: async () => 1, expire: async () => 1,
    eval: async () => JSON.stringify({ userId: 123, email: "member@example.test" }),
  }) };
  h.mocks["@/lib/mcp/auth"] = { createMcpToken: () => `cli-credential-${++count}` };
  const post = h.load("src/app/api/cli/token-exchange/route.ts").POST;
  const exchange = () => new Request("http://localhost/api/cli/token-exchange", {
    method: "POST", body: JSON.stringify({ code: `login-${count}` }), headers: { "user-agent": "hypertask-cli/0.2.0" },
  });
  assert.equal((await post(exchange())).status, 200);
  await h.drain();
  assert.equal((await post(exchange())).status, 200);
  await h.drain();
  assert.equal(count, 2);
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.connection_id, connectionId("user_token:cli:hypertask_cli"));
  assert.equal(h.captures[0].properties.agent_type, "hypertask_cli");
  assert.equal(h.captures[0].properties.client, "other");
  await h.authenticate(request("cli-credential-3", "hypertask-cli/0.3.0", "/api/mcp/tasks"), 123, "cli-credential-3");
  await h.drain();
  assert.equal(h.captures.length, 1);
});

test("management and API keys use database IDs without changing returned auth context", async () => {
  const h = harness();
  const validate = authenticated(h);
  for (const token of ["ht_mgmt_first", "ht_mgmt_first-rotated", "ht_mgmt_second", "htk_first", "htk_first-rotated", "htk_second"]) {
    const context = await validate(request(token));
    assert.equal(context.user.id, 123);
    assert.equal(context.agentId, null);
    assert.equal("apiKeyId" in context, false);
    assert.equal("keyId" in context, false);
  }
  await h.drain();
  assert.deepEqual(h.captures.map(({ properties }) => properties.connection_id), [
    connectionId("management_key:7"), connectionId("management_key:8"), connectionId("api_key:11"), connectionId("api_key:12"),
  ]);
});

test("connection properties follow the server contract and exclude credentials and free text", async () => {
  const h = harness();
  await h.connect(
    123, "secret-credential-member@example.test", "mcp", "Claude Code private free text", connectedAt, "agent:internal-agent-id",
  );
  await h.drain();
  const id = connectionId("agent:internal-agent-id");
  assert.deepEqual(h.captures[0], {
    distinctId: "123", event: "agent_connected", properties: {
      user_id: "123", workspace_id: null, board_id: null, source: "server", event_id: `agent_connected:${id}`,
      occurred_at: connectedAt.toISOString(), environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      utm_source: null, utm_medium: null, utm_campaign: null, initial_referrer: null,
      is_seeded: null, account_category: null, attribution_status: "unknown",
      connection_id: id, agent_type: "claude_code", client: "claude_code", transport: "mcp", is_first: true,
    },
    timestamp: connectedAt,
  });
  for (const sensitive of ["secret-credential", "member@example.test", "private free text", "internal-agent-id"]) {
    assert.equal(JSON.stringify(h.captures).includes(sensitive), false);
  }
});

for (const [name, agentType] of [["Claude Code", "claude_code"], ["Cursor", "cursor"], ["codex/1", "codex"], ["hypertask-cli/0.2.0", "hypertask_cli"], ["htz/0.1.0", "hypertask_cli"], ["private unknown client", "other"]]) {
  test(`plain user credentials classify ${agentType} and use transport/client identity`, async () => {
    const h = harness();
    const api = h.load("src/lib/telemetry/activationOccurrences.ts");
    await h.authenticate(request("plain-one", name, "/api/mcp/tasks"), 123, "plain-one");
    await h.authenticate(request("plain-two", name, "/api/mcp/tasks"), 123, "plain-two");
    await h.drain();
    const transport = agentType === "hypertask_cli" ? "cli" : "api";
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].properties.agent_type, agentType);
    assert.equal(h.captures[0].properties.connection_id, connectionId(`user_token:${transport}:${agentType}`));
  });
}

test("flag off preserves the exact fingerprint events and properties", async () => {
  const h = harness();
  h.setFlagEnabled(flag, false);
  const api = h.load("src/lib/telemetry/activationOccurrences.ts");
  await h.connect(123, "old-credential-one", "mcp", "Cursor", connectedAt, "agent:same-agent");
  await h.connect(123, "old-credential-two", "mcp", "Cursor", connectedAt, "agent:same-agent");
  await h.connect(123, "old-credential-two", "mcp", "Cursor", connectedAt, "agent:same-agent");
  await h.drain();
  assert.ok(h.captures.every(({ timestamp }) => timestamp instanceof Date));
  assert.deepEqual(h.captures.map(({ timestamp, ...capture }) => capture), [
    { distinctId: "123", event: "agent_connected", properties: { client: "cursor", transport: "mcp", is_first: true } },
    { distinctId: "123", event: "agent_connected", properties: { client: "cursor", transport: "mcp", is_first: false } },
  ]);
  assert.deepEqual(h.logs.map(({ log }) => log), ["old-credential-one", "old-credential-two"].map((token) => `activation:agent_connected:${createHash("sha256").update(token).digest("hex")}`));
});

for (const historical of ["mcp_connected", "cli_token_exchange", "activation:agent_connected:old-fingerprint"]) {
  test(`${historical} prevents a false first durable connection`, async () => {
    const h = harness();
    h.logs.push({ LoggedById: 123, log: historical, createdAt: new Date(connectedAt.getTime() - 1000) });
    await h.connect(123, "new-credential", "mcp", "Cursor", connectedAt, "agent:new-agent");
    await h.drain();
    assert.equal(h.captures[0].properties.is_first, false);
  });
}

test("failed captures retry the same durable event UUID after credential rotation", async () => {
  const h = harness();
  const api = h.load("src/lib/telemetry/activationOccurrences.ts");
  h.setFailure("capture");
  await h.connect(123, "failed-credential", "mcp", "Codex", connectedAt, "agent:retry-agent");
  await h.drain();
  assert.equal(h.captures.length, 0);
  assert.equal(h.logs.length, 0);
  const uuid = h.captureAttempts[0].uuid;
  h.setFailure(null);
  await h.connect(123, "retry-credential", "mcp", "Codex", connectedAt, "agent:retry-agent");
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captureAttempts[1].uuid, uuid);
});

test("real outbox delivery keeps one durable row and the original connection time after rotation", async () => {
  const h = harness();
  delete h.mocks["@/lib/telemetry/analyticsOutbox"];
  const rows: any[] = [];
  h.prisma.analyticsOutbox = {
    findUnique: async ({ where }: any) => rows.find((row) => row.key === where.key) ?? null,
    create: async ({ data }: any) => {
      const row = { id: "connection-outbox", deliveredAt: null, nextAttemptAt: new Date(), attempts: 0, ...data };
      rows.push(row);
      return { ...row };
    },
    findMany: async () => rows.filter((row) => !row.deliveredAt).map((row) => ({ ...row })),
    updateMany: async ({ where, data }: any) => {
      const row = rows.find((row) => row.id === where.id && !row.deliveredAt);
      if (!row) return { count: 0 };
      for (const [key, value] of Object.entries(data) as [string, any][]) {
        row[key] = value?.increment ? row[key] + value.increment : value;
      }
      return { count: 1 };
    },
  };
  const api = h.load("src/lib/telemetry/activationOccurrences.ts");
  h.setFailure("capture");
  await h.connect(123, "outbox-original", "mcp", "Cursor", connectedAt, "agent:outbox");
  await h.drain();
  assert.equal(rows.length, 1);
  assert.equal(h.logs.length, 1);
  assert.equal(h.captures.length, 0);
  await h.connect(123, "outbox-rotated", "mcp", "Cursor", new Date(), "agent:outbox");
  await h.drain();
  assert.equal(rows.length, 1);
  const uuid = h.captureAttempts[0].uuid;
  h.setFailure(null);
  rows[0].nextAttemptAt = new Date(0);
  assert.deepEqual(await h.load("src/lib/telemetry/analyticsOutbox.ts").retryAnalyticsOutbox(), { delivered: 1, failed: 0, skipped: 0 });
  assert.equal(h.captures.length, 1);
  assert.equal(h.captureAttempts[1].uuid, uuid);
  assert.deepEqual(h.captureAttempts[1].timestamp, connectedAt);
  assert.equal(h.captures[0].properties.occurred_at, connectedAt.toISOString());
  assert.equal(h.captures[0].properties.connection_id, connectionId("agent:outbox"));
});

test("the same durable key belongs to separate connections for different users", async () => {
  const h = harness();
  h.users.set(234, { id: 234, uid: "real_234", email: "other@example.test" });
  const api = h.load("src/lib/telemetry/activationOccurrences.ts");
  await h.connect(123, "shared-credential", "mcp", "Cursor", connectedAt, "agent:shared");
  await h.connect(234, "shared-credential", "mcp", "Cursor", connectedAt, "agent:shared");
  await h.drain();
  assert.deepEqual(h.captures.map(({ distinctId, properties }) => [distinctId, properties.connection_id, properties.is_first]), [
    ["123", connectionId("agent:shared"), true], ["234", connectionId("agent:shared", 234), true],
  ]);
});

test("a connection seen while ineligible is not consumed and counts on a later request", async () => {
  const h = harness();
  h.setEnabled(false);
  const api = h.load("src/lib/telemetry/activationOccurrences.ts");
  assert.equal(await api.enqueueAgentConnection(h.prisma, 123, "eligible-later", "mcp", "Cursor", connectedAt, "agent:later"), null);
  assert.equal(h.intentRows.length, 0);
  h.setEnabled(true);
  const key = await api.enqueueAgentConnection(h.prisma, 123, "eligible-later", "mcp", "Cursor", connectedAt, "agent:later");
  assert.equal(await h.load("src/lib/telemetry/analyticsIntents.ts").processAnalyticsIntent(key), "processed");
  assert.equal(h.captures.length, 1);
});
