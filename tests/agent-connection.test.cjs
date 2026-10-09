const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, root } = require("./helpers/agent-connection.cjs");
const FLAG = "htpr-7026-agent-connect-check";
const enums = { LogType: { Signup: "Signup" }, Status: { Normal: "Normal" } };

function harness({ rows = [], enabled = true, qaEnabled = true, armed = false, redisFailure = false, redisInitFailure = false, email = "fixture@example.test", fail = false } = {}) {
  const flagReads = [];
  const redisReads = [];
  const claims = new Set();
  const sends = [];
  const queries = [];
  const updates = [];
  const prisma = {
    logs: {
      findFirst: async (query) => {
        queries.push(query);
        const { where } = query;
        const matches = rows.filter((row) => row.LoggedById === where.LoggedById &&
          (where.OR ? row.log === "cli_token_exchange" || row.log.startsWith("mcp_connected") :
            typeof where.log === "string" ? row.log === where.log : row.log.startsWith(where.log.startsWith)) &&
          (!where.createdAt?.gt || row.createdAt > where.createdAt.gt) &&
          (!where.createdAt?.lte || row.createdAt <= where.createdAt.lte));
        matches.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
        return (query.orderBy?.[0]?.createdAt === "desc" ? matches.at(-1) : matches[0]) ?? null;
      },
      create: async ({ data }) => { const row = { ...data, id: rows.length + 1, createdAt: new Date() }; rows.push(row); return row; },
    },
    user: { findUnique: async (query) => { assert.deepEqual(query, { where: { id: 42 }, select: { email: true } }); return email === null ? null : { email }; } },
    project: { findFirst: async (query) => { assert.deepEqual(query.where, { ownerId: 42, status: "Normal" }); return { id: 7 }; } },
    webhookEvent: {
      create: async ({ data }) => {
        const key = `${data.userId}:${data.eventType}`;
        if (claims.has(key)) throw Object.assign(new Error("Duplicate"), { code: "P2002" });
        claims.add(key);
      },
      update: async (query) => { updates.push(query); },
    },
  };
  const mocks = {
    "@prisma/client": enums,
    "@/lib/prisma": prisma,
    "@/lib/flags": { FEATURE_FLAG_QA_USER_ID: 985, HTPR_7026_AGENT_CONNECT_CHECK_FLAG: FLAG, isFeatureEnabled: async (key, id) => { assert.equal(key, FLAG); assert.ok([42, 985].includes(id)); flagReads.push([key, id]); return id === 985 ? qaEnabled : enabled; } },
    "@/lib/redis": { getRedis: async () => { if (redisInitFailure) throw new Error("Redis unavailable"); return { get: async (key) => { redisReads.push(key); if (redisFailure) throw new Error("Redis read failed"); return armed ? "1" : null; } }; } },
    "@/lib/onboarding/qaArm": load("src/lib/onboarding/qaArm.ts"),
    "@/lib/email/sendEmail": { sendEmail: async (email) => { sends.push(email); if (fail) throw new Error("Delivery failed"); } },
    "@/utils/controllers/notifications/emailTemplates": { renderAgentConnectedEmail: (client, boardId) => ({ subject: "Your agent is connected", html: `${client}:${boardId}` }) },
  };
  return { module: load("src/lib/onboarding/agentConnection.ts", mocks), prisma, rows, sends, claims, queries, updates, flagReads, redisReads };
}
const row = (id, log, at = id) => ({ id, log, LoggedById: 42, createdAt: new Date(at * 1000) });

test("first connection includes CLI and every MCP suffix, scopes user and orders ties", async () => {
  for (const log of ["cli_token_exchange", "mcp_connected", "mcp_connected:codex", "mcp_connected_cursor"]) {
    const h = harness({ rows: [row(1, "onboarding_ai_choice:claude-code"), row(3, log, 2), row(2, log, 2), row(4, "cli_token_exchange")] });
    assert.deepEqual(await h.module.getFirstAgentConnection(42), { at: new Date(2000), client: log === "mcp_connected:codex" ? "Codex" : "Claude Code" });
    assert.equal(h.queries[0].where.LoggedById, 42);
    assert.equal(h.queries[0].where.createdAt, undefined);
    assert.deepEqual(h.queries[0].orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  }
});

test("no connection and another user's connection return null; later choices cannot rename first client", async () => {
  assert.equal(await harness().module.getFirstAgentConnection(42), null);
  assert.equal(await harness({ rows: [{ ...row(1, "mcp_connected"), LoggedById: 99 }] }).module.getFirstAgentConnection(42), null);
  const h = harness({ rows: [row(1, "onboarding_ai_choice:cursor"), row(2, "mcp_connected"), row(3, "onboarding_ai_choice:codex")] });
  assert.equal((await h.module.getFirstAgentConnection(42)).client, "Cursor");
  assert.equal(await h.module.getFirstAgentConnection(42, new Date(3000)), null);
});

test("email sends only once for first row, even concurrent first-row callbacks and later connects", async () => {
  const h = harness({ rows: [row(1, "onboarding_ai_choice:codex"), row(2, "mcp_connected"), row(3, "cli_token_exchange")] });
  await Promise.all(Array.from({ length: 20 }, () => h.module.sendFirstAgentConnectedEmail(42, 2)));
  await h.module.sendFirstAgentConnectedEmail(42, 3);
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].subject, "Your agent is connected");
  assert.equal(h.sends[0].html, "Codex:7");
  assert.equal(h.claims.size, 1);
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].data.success, true);
  const schema = fs.readFileSync(path.join(root, "src/prisma/schema.prisma"), "utf8");
  assert.match(schema.match(/model WebhookEvent \{[\s\S]*?\n\}/)[0], /@@unique\(\[userId, eventType\]\)/);
});

test("flag off does not claim or send; an old connection cannot email on a later connect", async () => {
  const h = harness({ enabled: false, rows: [row(1, "cli_token_exchange")] });
  await h.module.sendFirstAgentConnectedEmail(42, 1);
  assert.equal(h.sends.length, 0);
  assert.equal(h.claims.size, 0);
  assert.equal(h.queries.length, 0);
  const old = harness({ rows: [row(1, "mcp_connected"), row(2, "cli_token_exchange")] });
  await old.module.sendFirstAgentConnectedEmail(42, 2);
  assert.equal(old.sends.length, 0);
});

test("armed signup uses normalized welcome marker and QA eligibility for card and one-time email", async () => {
  const h = harness({ enabled: false, armed: true, email: " Fresh@MAIL.TM " });
  assert.equal((await h.module.getAgentConnectCardState(42)).eligible, true);
  assert.equal((await h.module.getAgentConnectCardState(42)).boardId, 7);
  h.rows.push(row(1, "mcp_connected:codex"));
  await h.module.sendFirstAgentConnectedEmail(42, 1);
  await h.module.sendFirstAgentConnectedEmail(42, 1);
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].html, "Codex:7");
  assert.ok(h.redisReads.every((key) => key === "onboarding:qa-armed:fresh@mail.tm"));
  assert.ok(h.flagReads.every(([key, id]) => key === FLAG && id === 985));
});

for (const options of [
  { armed: false },
  { armed: true, qaEnabled: false },
  { armed: true, redisFailure: true },
  { armed: true, redisInitFailure: true },
  { armed: true, email: null },
  { armed: true, email: "" },
]) {
  test(`disabled signup gets no card or email: ${JSON.stringify(options)}`, async () => {
    const h = harness({ enabled: false, rows: [row(1, "cli_token_exchange")], ...options });
    assert.deepEqual(await h.module.getAgentConnectCardState(42), { eligible: false, connected: false, dismissed: false });
    await h.module.sendFirstAgentConnectedEmail(42, 1);
    assert.equal(h.sends.length, 0);
    assert.equal(h.claims.size, 0);
    assert.equal(h.queries.length, 0);
    assert.ok(h.flagReads.every(([, id]) => id === (options.armed && options.qaEnabled === false ? 985 : 42)));
  });
}

for (const failure of ["redisFailure", "redisInitFailure"]) {
  test(`${failure} preserves the user's own enabled flag`, async () => {
    const h = harness({ armed: true, [failure]: true, rows: [row(1, "cli_token_exchange")] });
    assert.equal((await h.module.getAgentConnectCardState(42)).eligible, true);
    await h.module.sendFirstAgentConnectedEmail(42, 1);
    assert.equal(h.sends.length, 1);
    assert.ok(h.flagReads.every(([, id]) => id === 42));
  });
}

for (const options of [
  { armed: true, expected: true },
  { armed: false, expected: false },
  { armed: true, redisFailure: true, expected: false },
]) {
  test(`status route applies shared eligibility to first state, client label and dismissal: ${JSON.stringify(options)}`, async () => {
    const h = harness({ enabled: false, rows: [row(1, "mcp_connected:codex")], ...options });
    const route = routeHarness().common;
    route["@/lib/onboarding/agentConnection"] = h.module;
    const api = load("src/app/api/users/ai-connection-status/route.ts", route);
    const status = await api.GET({ nextUrl: new URL("https://fixture.test/api?since=1970-01-01T00:00:00Z") });
    assert.equal(status.status, 200);
    assert.equal(Object.hasOwn(status.body, "client"), options.expected);
    if (options.expected) assert.equal(status.body.client, "Codex");
    const first = await api.GET({ nextUrl: new URL("https://fixture.test/api?mode=first") });
    assert.equal(first.status, options.expected ? 200 : 404);
    if (options.expected) assert.equal(first.body.eligible, true);
    assert.equal((await api.POST()).status, options.expected ? 200 : 404);
    assert.equal(h.rows.some((item) => item.log === "agent_connect_dismissed"), options.expected);
  });
}

test("email failures do not throw, and keep the durable claim against uncertain delivery duplicates", async () => {
  const h = harness({ fail: true, rows: [row(1, "cli_token_exchange")] });
  await assert.doesNotReject(h.module.sendFirstAgentConnectedEmail(42, 1));
  await assert.doesNotReject(h.module.sendFirstAgentConnectedEmail(42, 1));
  assert.equal(h.sends.length, 1);
  assert.equal(h.claims.size, 1);
  assert.equal(h.updates.length, 0);
});

test("dismissal is server persisted and already-connected state survives reload", async () => {
  const h = harness();
  assert.equal((await h.module.getAgentConnectCardState(42)).dismissed, false);
  await h.module.dismissAgentConnectCard(42);
  assert.equal((await h.module.getAgentConnectCardState(42)).dismissed, true);
  h.rows.push(row(2, "cli_token_exchange"));
  assert.equal((await h.module.getAgentConnectCardState(42)).connected, true);
});

test("every writer uses createLog, which schedules only successful connection writes without awaiting email", async () => {
  for (const file of ["src/app/api/cli/token-exchange/route.ts", "src/lib/mcp/auth/verifyJwt.ts"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /createLog\(\{\s*log: '(cli_token_exchange|mcp_connected)'/);
  }
  const scheduled = [];
  const emailed = [];
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const createLog = load("src/utils/controllers/logs/createLog.ts", {
    "@vercel/functions": { waitUntil: (work) => scheduled.push(work) },
    "@prisma/client": enums,
    "@/lib/prisma": { logs: { create: async ({ data }) => ({ ...data, id: 19 }) } },
    "@/lib/onboarding/agentConnection": { sendFirstAgentConnectedEmail: async (...args) => { emailed.push(args); await pending; } },
  }).default;
  for (const log of ["cli_token_exchange", "mcp_connected", "mcp_connected:cursor", "unrelated"]) {
    assert.equal((await createLog({ log, type: "Signup", status: "Normal", LoggedById: 42 })).status, 200);
  }
  assert.equal(scheduled.length, 3);
  release();
  await Promise.all(scheduled);
  assert.deepEqual(emailed, [[42, 19], [42, 19], [42, 19]]);
  const failed = load("src/utils/controllers/logs/createLog.ts", {
    "@vercel/functions": { waitUntil: () => assert.fail("failed write cannot schedule") },
    "@prisma/client": enums,
    "@/lib/prisma": { logs: { create: async () => { throw new Error("Fixture write failure"); } } },
  }).default;
  assert.equal((await failed({ log: "cli_token_exchange", LoggedById: 42 })).status, 500);
});

function routeHarness(enabled = true, user = { id: 42 }) {
  const calls = [];
  const responses = { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) };
  const common = {
    "next/server": { NextResponse: responses },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => user },
    "@/lib/onboarding/agentConnection": { isAgentConnectCheckEnabledFor: async (id) => { assert.equal(id, 42); return enabled; }, getFirstAgentConnection: async () => null, getAgentConnectCardState: async (id) => { calls.push(id); return { eligible: enabled, connected: false }; }, dismissAgentConnectCard: async (id) => { calls.push(id); } },
    "@prisma/client": enums,
    "@/utils/controllers/logs/createLog": async (data) => calls.push(data),
  };
  return { common, calls };
}

test("Codex is accepted without a flag; malformed choices and anonymous users remain rejected", async () => {
  const h = routeHarness(false);
  const api = load("src/app/api/users/onboarding-ai-choice/route.ts", h.common);
  assert.equal((await api.POST({ json: async () => ({ tool: "codex" }) })).status, 200);
  assert.equal(h.calls[0].log, "onboarding_ai_choice:codex");
  for (const tool of [null, 42, "unknown"]) assert.equal((await api.POST({ json: async () => ({ tool }) })).status, 400);
  assert.equal((await api.POST({ json: async () => { throw new Error(); } })).status, 400);
  const anonymous = load("src/app/api/users/onboarding-ai-choice/route.ts", routeHarness(true, null).common);
  assert.equal((await anonymous.POST({})).status, 401);
});

test("legacy status omits client with flag off and includes it only with flag on", async () => {
  for (const enabled of [false, true]) {
    for (const match of [null, { at: new Date(2000), client: "Cursor" }]) {
      for (const query of ["", "?since=1970-01-01T00:00:01.000Z"]) {
        const h = routeHarness(enabled);
        h.common["@/lib/onboarding/agentConnection"].isAgentConnectCheckEnabledFor = async (id) => {
          assert.equal(id, 42);
          return enabled;
        };
        h.common["@/lib/onboarding/agentConnection"].getFirstAgentConnection = async (id, since) => {
          assert.equal(id, 42);
          assert.ok(since instanceof Date);
          if (query) assert.equal(since.getTime(), 1000);
          return match;
        };
        const api = load("src/app/api/users/ai-connection-status/route.ts", h.common);
        const response = await api.GET({ nextUrl: new URL(`https://fixture.test/api${query}`) });
        assert.equal(response.status, 200);
        const legacy = { connected: !!match, at: match?.at };
        assert.deepEqual(response.body, enabled ? { ...legacy, client: match?.client } : legacy);
        assert.equal(Object.hasOwn(response.body, "client"), enabled);
      }
    }
  }
});

test("new first-state reads and dismissal require the server flag and authenticated identity", async () => {
  for (const enabled of [true, false]) {
    const h = routeHarness(enabled);
    const api = load("src/app/api/users/ai-connection-status/route.ts", h.common);
    assert.equal((await api.GET({ nextUrl: new URL("https://fixture.test/api?mode=first") })).status, enabled ? 200 : 404);
    assert.equal((await api.POST()).status, enabled ? 200 : 404);
    assert.equal(h.calls.length, enabled ? 2 : 1);
    assert.equal((await api.GET({ nextUrl: new URL("https://fixture.test/api?since=invalid") })).status, 400);
  }
  const api = load("src/app/api/users/ai-connection-status/route.ts", routeHarness(true, null).common);
  assert.equal((await api.POST()).status, 401);
  assert.equal((await api.GET({})).status, 401);
});
