const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers/agent-connection.cjs");
let now, expires, requests, failRedis, failure;
const redis = { set: async (key, value, ...options) => {
  if (key !== "ai-gateway-report:v1:hourly-budget") return "OK";
  assert.deepEqual(options, ["EX", 3600, "NX"]);
  if (failRedis) throw new Error("Redis unavailable");
  if (expires > now) return null;
  expires = now + 3600000;
  return "OK";
}, hgetall: async () => ({}), eval: async () => 0 };
const { gatewayReport, withBackgroundReportBudget } = load("src/lib/ai/gatewayReport.ts", { "@/lib/redis": { getRedis: async () => redis } });
const classification = load("src/lib/aiUsageClassification.ts");
const billed = load("src/app/api/ai/_lib/billedAllowance.ts", {
  "@/lib/ai/gatewayReport": { gatewayReport },
  "@/lib/redis": { getRedis: async () => redis },
  "@/lib/flags": { isFeatureEnabled: async () => false },
  "@/lib/flags/definitions/htpr-7692-billed-cost": { HTPR_7692_BILLED_COST_FLAG: "htpr-7692-billed-cost" },
  "@/lib/aiUsageClassification": classification,
  "@/lib/errors/reportError": { reportError: async () => {} },
});
const shared = load("src/app/api/ai/_lib/sharedAllowance.ts", {
  "@/lib/ai/gatewayReport": { gatewayReport },
  "@/app/api/ai/_lib/allowanceError": {},
  "@/lib/redis": { getRedis: async () => redis },
  "@/lib/flags": { isFeatureEnabled: async () => false },
  "@/lib/flags/definitions/htpr-7079-failed-ai-allowance": {},
  "@/lib/flags/definitions/htpr-7692-allowance-drift-check": {},
  "@/lib/flags/definitions/htpr-7687-allowance-resync": {},
  "@/lib/aiModelOptions": {},
  "@/app/api/ai/chat/stream/modelFallback": {},
  "@/lib/aiAllowancePolicy": {},
  "@/lib/aiUsageClassification": classification,
  "./billedAllowance": billed,
});
const nativeFetch = global.fetch;
test.beforeEach(() => {
  now = 1000; expires = 0; requests = []; failRedis = false; failure = null;
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (failure) throw failure;
    return Response.json({ results: [] });
  };
});
test.afterEach(() => { global.fetch = nativeFetch; });
const period = { startDate: "2026-10-01", endDate: "2026-10-28" };
const breakdown = () => withBackgroundReportBudget(() => billed.gatewaySpendBreakdownMicroUsd("fixture-key", "team", period.startDate, period.endDate));
const hourly = () => withBackgroundReportBudget(() => shared.gatewayHourlySpend("other-fixture-key", "other-team", period.startDate, period.endDate));
const demo = () => withBackgroundReportBudget(() => billed.demoGatewaySpendMicroUsd("demo-fixture-key", period));

test("the three automated report entry points share one rolling hourly budget", async () => {
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => [breakdown, hourly, demo][i % 3]()));
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(results.filter(row => row.status === "rejected" && /hourly budget exhausted/.test(row.reason.message)).length, 29);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, "/v1/report");
  assert.equal(requests[0].options.headers.Authorization, "Bearer fixture-key");
  assert.deepEqual(await results[0].value, { legacySystemMicroUsd: 0, systemMicroUsd: 0, totalMicroUsd: 0, visibleMicroUsd: 0 });
  now += 3599999;
  await assert.rejects(hourly, /hourly budget exhausted/);
  now++;
  assert.equal(await hourly(), null);
  assert.equal(requests.length, 2);
});

test("network failure consumes the budget rather than causing paid retries", async () => {
  failure = new Error("upstream unavailable");
  await assert.rejects(breakdown, /upstream unavailable/);
  await assert.rejects(demo, /hourly budget exhausted/);
  assert.equal(requests.length, 1);
});

test("a Redis outage refuses network access", async () => {
  failRedis = true;
  await assert.rejects(breakdown, /Redis unavailable/);
  assert.equal(requests.length, 0);
});

test("a cancelled report neither fetches nor consumes the budget", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => gatewayReport("fixture-key", new URLSearchParams(), controller.signal), { name: "AbortError" });
  assert.equal(requests.length, 0);
  assert.equal(await demo(), 0);
  assert.equal(requests.length, 1);
});


test("exhausted report budget preserves the real billed-admission estimate fallback", async () => {
  await breakdown();
  const period = new Date().toISOString().slice(0, 7);
  const result = await withBackgroundReportBudget(() => billed.effectiveAccountingSource({ teamId: "team", kind: "month", period,
    funding: { apiKey: "fixture-key", provenance: "managed-fixture" } }));
  assert.deepEqual(result, { mode: "v1", key: `ai-allowance-billed:v1:month:${period}:team` });
  assert.equal(requests.length, 1);
});


test("foreground month, day, demo and other teams remain usable after a background report", async () => {
  await breakdown();
  assert.deepEqual(await billed.gatewaySpendBreakdownMicroUsd("fixture-key", "team", "2026-10-28", "2026-10-28"),
    { legacySystemMicroUsd: 0, systemMicroUsd: 0, totalMicroUsd: 0, visibleMicroUsd: 0 });
  assert.equal(await billed.demoGatewaySpendMicroUsd("demo-fixture-key", period), 0);
  assert.equal(await shared.gatewayHourlySpend("fixture-key", "other-team", period.startDate, period.endDate), null);
  await assert.rejects(hourly, /hourly budget exhausted/);
  assert.equal(requests.length, 4);
});

test("the authenticated cron enforces the budget through its real dispatch wrapper", async () => {
  const { GET } = load("src/app/api/cron/ai-allowance-drift/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/ai/gatewayReport": { withBackgroundReportBudget },
    "@/lib/ai/dailyGatewaySpend": { checkDailyGatewaySpend: async () => {} },
    "@/lib/ai/billedAllowanceRefresh": { refreshActiveBilledAllowances: () => billed.gatewaySpendBreakdownMicroUsd("fixture-key", "team", period.startDate, period.endDate) },
    "@/lib/ai/allowanceDriftCheck": { checkActiveTeamAllowanceDrift: () => shared.gatewayHourlySpend("fixture-key", "team", period.startDate, period.endDate) },
    "@/lib/cronAuthorization": { hasValidCronAuthorization: () => true },
  });
  const previous = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV };
  try {
    process.env.NODE_ENV = "production"; process.env.VERCEL_ENV = "production";
    const response = await GET(new Request("https://app.hypertask.ai/api/cron/ai-allowance-drift"));
    assert.equal(response.status, 503);
    assert.equal(requests.length, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
