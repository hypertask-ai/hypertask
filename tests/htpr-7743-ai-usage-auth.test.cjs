const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const flagKey = "htpr-7743-ai-usage-auth";
const credential = "synthetic-gateway-credential";

function fixture(t, options = {}) {
  const requests = [];
  const warnings = [];
  const errors = [];
  const flagCalls = [];
  let statuses = options.statuses ?? [401, 401, 401];
  let flag = options.flag ?? true;
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    if (options.networkError) throw new Error("Synthetic network failure");
    const status = statuses[(requests.length - 1) % 3];
    return Response.json({ results: [] }, { status });
  };
  console.warn = (...args) => warnings.push(args);
  console.error = (...args) => errors.push(args);
  t.after(() => {
    global.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
  });
  const route = load("src/app/api/settings/ai-usage/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/auth/serverUser": { getServerCookieUser: async () => options.anonymous ? null : { id: 6 } },
    "@/lib/prisma": { default: {
      team: { findUnique: async () => ({ googleAccount: { userId: 6 }, googleAccountId: "account" }) },
      aiUsage: { groupBy: async ({ by }) => by[0] === "feature" ? [{ feature: "chat", _sum: { totalTokens: 10 } }] : [] },
      project: { findMany: async () => [] },
      task: { findMany: async () => [] },
      agent: { findMany: async () => [] },
    } },
    "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess": { default: async () => options.access !== false },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => ({ apiKey: credential, source: options.source ?? "managed" }) },
    "@/app/api/ai/_lib/planAllowancePolicy": { resolveTeamAllowancePolicy: async () => ({ mode: "legacy" }) },
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "Pro" },
    "@/app/api/ai/_lib/sharedAllowance": { billedCostEnabled: async () => false },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      if (key === "htpr-8008-gateway-key-errors") return options.customerKeyErrors ?? false;
      flagCalls.push({ key, userId });
      if (flag instanceof Error) throw flag;
      return flag;
    } },
  });
  return {
    requests, warnings, errors, flagCalls,
    setStatuses: (value) => { statuses = value; },
    setFlag: (value) => { flag = value; },
    read: () => route.GET(new Request("https://example.test/api/settings/ai-usage?teamId=team")),
  };
}

for (const statuses of [[401, 401, 401], [403, 403, 403], [200, 401, 200]]) {
  test(`report ${statuses.join("/")} degrades without inventing spend or exposing credentials`, async (t) => {
    const f = fixture(t, { statuses });
    const response = await f.read();
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.configured, true);
    assert.equal(data.fundingSource, "managed");
    assert.equal(data.allowance, null);
    assert.equal(data.includedWithHypertask, null);
    assert.deepEqual(data.models, []);
    assert.deepEqual(data.features, [{ label: "chat", pct: 100 }]);
    assert.equal(data.usageMessage, "AI usage totals are unavailable because the AI service could not authorize usage reporting. Your AI settings may need attention.");
    assert.equal(f.warnings.length, 1);
    assert.match(f.warnings[0][0], /configuration/i);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.flagCalls, [{ key: flagKey, userId: 6 }]);
    assert.equal(f.requests.length, 3);
    for (const { url, init } of f.requests) {
      assert.match(url, /^https:\/\/ai-gateway\.vercel\.sh\/v1\/report\?/);
      assert.equal(new URL(url).searchParams.get("tags"), "team:team");
      assert.equal(init.headers.Authorization, `Bearer ${credential}`);
    }
    assert.ok(!JSON.stringify([data, f.warnings]).includes(credential));
    assert.equal((await f.read()).status, 200);
    assert.equal(f.warnings.length, 1);
  });
}

test("flag off and flag lookup failure retain the legacy 502", async (t) => {
  const f = fixture(t, { flag: false });
  assert.equal((await f.read()).status, 502);
  f.setFlag(new Error("Synthetic flag failure"));
  assert.equal((await f.read()).status, 502);
  assert.equal(f.errors.length, 2);
  assert.deepEqual(f.warnings, []);
});

for (const statuses of [[429, 429, 429], [500, 200, 503], [401, 503, 200], [403, 429, 200]]) {
  test(`transient report ${statuses.join("/")} remains retryable`, async (t) => {
    const f = fixture(t, { statuses });
    const response = await f.read();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { message: "Could not load AI Gateway usage" });
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.warnings, []);
  });
}

test("network failure remains a 502 rather than a configuration warning", async (t) => {
  const f = fixture(t, { networkError: true });
  assert.equal((await f.read()).status, 502);
  assert.equal(f.errors.length, 1);
  assert.deepEqual(f.warnings, []);
});

test("unauthorized callers are still refused before any report access", async (t) => {
  const f = fixture(t, { access: false });
  assert.equal((await f.read()).status, 403);
  assert.deepEqual(f.requests, []);
});

test("authorized callers are still allowed and successful reports recover after auth failure", async (t) => {
  const f = fixture(t);
  assert.equal((await f.read()).status, 200);
  f.setStatuses([200, 200, 200]);
  const response = await f.read();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.allowance.usedUsd, 0);
  assert.equal(data.usageMessage, null);
  assert.equal(f.warnings.length, 1);
  assert.deepEqual(f.errors, []);
});

test("signed-out callers still receive 401", async (t) => {
  const f = fixture(t, { anonymous: true });
  assert.equal((await f.read()).status, 401);
  assert.deepEqual(f.requests, []);
});

test("customer report auth failure never substitutes a platform credential", async (t) => {
  const f = fixture(t, { source: "customer" });
  const response = await f.read();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fundingSource, "customer");
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.every(({ init }) => init.headers.Authorization === `Bearer ${credential}`));
});

test("customer-specific key guidance survives when both fixes are enabled", async (t) => {
  const f = fixture(t, { source: "customer", customerKeyErrors: true });
  const response = await f.read();
  assert.equal(response.status, 502);
  assert.match((await response.json()).usageMessage, /key was rejected/);
  assert.deepEqual(f.warnings, []);
});
