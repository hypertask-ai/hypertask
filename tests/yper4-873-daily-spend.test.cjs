const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");

const NativeDate = Date;
const nativeFetch = global.fetch;
const originalEnv = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV, CRON_SECRET: process.env.CRON_SECRET };
let now, cost, previousCost, queries, alerts, unavailable, requests;
const { GET } = loadModule("src/app/api/cron/ai-spend/route.ts", {
  "next/server": { NextResponse: { json: Response.json } },
  "@/lib/prisma": { default: { aiUsage: { aggregate: async query => {
    queries.push(query);
    if (unavailable) throw new Error("private database failure");
    return { _sum: { costUsd: query.where.createdAt.gte.toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? cost : previousCost } };
  } } } },
  "@/lib/errors/reportError": { reportError: async report => alerts.push(report) },
});
const request = (authorization = "Bearer fixture-cron-authority") => GET(new Request("https://app.hypertask.ai/api/cron/ai-spend", {
  headers: authorization ? { authorization } : {},
}));

test.beforeEach(() => {
  now = NativeDate.parse("2026-10-29T10:15:00Z");
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  cost = null; previousCost = null; queries = []; alerts = []; unavailable = false; requests = 0;
  global.fetch = async () => { requests++; throw new Error("No provider requests allowed"); };
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";
  process.env.CRON_SECRET = "fixture-cron-authority";
});
test.afterEach(() => {
  global.Date = NativeDate; global.fetch = nativeFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  assert.equal(requests, 0);
});

test("real authenticated cron totals saved usage for the UTC day without buying reports", async () => {
  cost = 4.25;
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { checked: 1, recordedUsd: 4.25 });
  assert.equal(queries.length, 2);
  assert.equal(queries[0].where.createdAt.gte.toISOString(), "2026-10-28T00:00:00.000Z");
  assert.deepEqual(queries[1], { where: {
    createdAt: { gte: new Date("2026-10-29T00:00:00Z"), lt: new Date("2026-10-30T00:00:00Z") },
    provider: { not: { startsWith: "byok:" } }, costUsd: { gte: 0 },
  }, _sum: { costUsd: true } });
  assert.equal(alerts.length, 0);
});

test("empty saved usage is zero and exactly five dollars does not alert", async () => {
  assert.deepEqual(await (await request()).json(), { checked: 1, recordedUsd: 0 });
  cost = 5;
  assert.deepEqual(await (await request()).json(), { checked: 1, recordedUsd: 5 });
  assert.equal(alerts.length, 0);
});

test("above five dollars raises the daily estimate alarm with the existing fingerprint", async () => {
  cost = 5.01;
  assert.equal((await request()).status, 200);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].fingerprintKey, "ai-gateway-daily-spend:2026-10-29");
  assert.match(alerts[0].message, /estimate exceeded \$5 on 2026-10-29: \$5.01/);
  assert.match(alerts[0].message, /not provider invoices/);
  assert.deepEqual(alerts[0].extra, { route: "/api/cron/ai-spend", stage: "daily-spend", spentUsd: 5.01 });
});

test("UTC midnight changes both query bounds and daily alarm identity", async () => {
  cost = 6; await request();
  now = NativeDate.parse("2026-10-30T00:01:00Z");
  await request();
  assert.equal(queries[3].where.createdAt.gte.toISOString(), "2026-10-30T00:00:00.000Z");
  assert.equal(queries[3].where.createdAt.lt.toISOString(), "2026-10-31T00:00:00.000Z");
  assert.equal(alerts[1].fingerprintKey, "ai-gateway-daily-spend:2026-10-30");
});

test("late previous-day usage is still checked after midnight or a missed hourly run", async () => {
  previousCost = 6.25; cost = 0.5;
  now = NativeDate.parse("2026-10-29T02:07:00Z");
  assert.deepEqual(await (await request()).json(), { checked: 1, recordedUsd: 0.5 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].fingerprintKey, "ai-gateway-daily-spend:2026-10-28");
  assert.equal(alerts[0].extra.spentUsd, 6.25);
});

test("database or malformed cost failures cannot report a clean observation", async () => {
  unavailable = true;
  assert.equal((await request()).status, 503);
  unavailable = false; cost = NaN;
  const response = await request();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "AI usage check unavailable" });
  assert.equal(alerts.length, 0);
});

test("missing or wrong authority is refused before reading usage; preview does no work", async () => {
  assert.equal((await request(null)).status, 401);
  assert.equal((await request("Bearer wrong")).status, 401);
  process.env.CRON_SECRET = "";
  assert.equal((await request("Bearer ")).status, 401);
  assert.equal(queries.length, 0);
  process.env.CRON_SECRET = "fixture-cron-authority";
  process.env.VERCEL_ENV = "preview";
  assert.deepEqual(await (await request()).json(), { checked: 0 });
  assert.equal(queries.length, 0);
});

test("paid observer and refresh implementations retire; only local hourly spending remains scheduled", () => {
  const root = path.resolve(__dirname, "..");
  for (const file of ["src/lib/ai/allowanceDriftCheck.ts", "src/lib/ai/billedAllowanceRefresh.ts", "src/app/api/cron/ai-allowance-drift/route.ts"]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
  const { crons } = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(crons.filter(entry => ["/api/cron/ai-spend", "/api/cron/ai-allowance-drift"].includes(entry.path)), [
    { path: "/api/cron/ai-spend", schedule: "7 * * * *" },
  ]);
});
