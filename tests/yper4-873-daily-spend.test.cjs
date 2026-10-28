const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");
let now, credits, reads, alerts, storage, unavailable;
const nativeDate = Date;
const redis = {
  set: async (key, value, ...options) => {
    const previous = storage.get(key);
    if (previous && previous.expires > now && options.includes("NX")) return null;
    storage.set(key, { value, expires: now + Number(options[options.indexOf("EX") + 1]) * 1000 });
    return "OK";
  },
  get: async key => storage.get(key)?.value ?? null,
};
const { checkDailyGatewaySpend } = loadModule("src/lib/ai/dailyGatewaySpend.ts", {
  "@/lib/redis": { getRedis: async () => redis },
  "@/lib/errors/reportError": { reportError: async report => alerts.push(report) },
});
let authorized = true;
const counts = { checked: 0, inconclusive: 0, unknown: 0, drift: 0, refusalAlerts: 0 };
const { GET } = loadModule("src/app/api/cron/ai-allowance-drift/route.ts", {
  "next/server": { NextResponse: { json: Response.json } },
  "@/lib/ai/allowanceDriftCheck": { checkActiveTeamAllowanceDrift: async () => counts },
  "@/lib/ai/billedAllowanceRefresh": { refreshActiveBilledAllowances: async () => {} },
  "@/lib/ai/dailyGatewaySpend": { checkDailyGatewaySpend },
  "@/lib/ai/gatewayReport": { withBackgroundReportBudget: work => work() },
  "@/lib/cronAuthorization": { hasValidCronAuthorization: () => authorized },
});
const nativeFetch = global.fetch;
const nativeEnv = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV, AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY };
const nativeError = console.error;
test.beforeEach(() => {
  now = nativeDate.parse("2026-10-28T00:00:00Z");
  global.Date = class extends nativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  credits = { balance: "20.00", total_used: "100.00" }; reads = 0; alerts = []; storage = new Map(); unavailable = false; authorized = true;
  process.env.AI_GATEWAY_API_KEY = "fixture-credit-key";
  global.fetch = async (url, options) => {
    reads++;
    assert.equal(url, "https://ai-gateway.vercel.sh/v1/credits");
    assert.equal(options.headers.Authorization, "Bearer fixture-credit-key");
    assert.ok(options.signal instanceof AbortSignal);
    if (unavailable) throw new Error("credits unavailable");
    return Response.json(credits);
  };
  process.env.NODE_ENV = "production"; process.env.VERCEL_ENV = "production"; console.error = () => {};
});
test.afterEach(() => {
  global.Date = nativeDate; global.fetch = nativeFetch; console.error = nativeError;
  for (const [key, value] of Object.entries(nativeEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
const request = () => GET(new Request("https://app.hypertask.ai/api/cron/ai-allowance-drift"));

test("the real cron checks credit metadata hourly even with both allowance checks off", async () => {
  assert.deepEqual(await (await request()).json(), counts);
  await request(); assert.equal(reads, 1); assert.equal(alerts.length, 0);
  now += 3600000; credits = { balance: "15.00", total_used: "105.00" };
  await request(); assert.equal(alerts.length, 0);
  now += 3600000; credits = { balance: "14.99", total_used: "105.01" };
  await request(); assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /exceeded \$5/);
  assert.ok(Math.abs(alerts[0].extra.spentUsd - 5.01) < 0.000001);
  assert.equal(alerts[0].fingerprintKey, "ai-gateway-daily-spend:2026-10-28");
  now += 3600000; credits = { balance: "30.00", total_used: "106.00" };
  await request(); assert.equal(alerts[1].fingerprintKey, alerts[0].fingerprintKey);
});

test("midnight-spanning spend alerts through the real cron", async () => {
  now = nativeDate.parse("2026-10-28T23:30:00Z");
  await request();
  now += 3600000; credits = { balance: "14", total_used: "106" };
  await request();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].extra.spentUsd, 6);
  assert.equal(alerts[0].fingerprintKey, "ai-gateway-daily-spend:2026-10-29");
});

test("new days reset accumulated spend without dropping the crossing interval", async () => {
  await request(); now += 23 * 3600000;
  credits = { balance: "16", total_used: "104" }; await request();
  now += 3600000; credits = { balance: "14", total_used: "106" };
  await request(); assert.equal(alerts.length, 0);
  now += 3600000; credits = { balance: "10", total_used: "110" };
  await request(); assert.equal(alerts[0].extra.spentUsd, 6);
});

test("failed observations remain unavailable throughout the hourly throttle", async () => {
  unavailable = true;
  assert.equal((await request()).status, 503);
  unavailable = false;
  assert.equal((await request()).status, 503);
  assert.equal(reads, 1);
  now += 3600000;
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 200);
  assert.equal(reads, 2);
});

test("failed and malformed credits cannot create a spend alert or suppress drift", async () => {
  unavailable = true;
  assert.deepEqual(await (await request()).json(), { ...counts, unknown: 1 }); assert.equal(alerts.length, 0);
  unavailable = false; now += 3600000; credits = { balance: "secret-not-a-number", total_used: "NaN" };
  assert.deepEqual(await (await request()).json(), { ...counts, unknown: 1 }); assert.equal(alerts.length, 0);
});

test("unauthorized and non-production cron requests never read credits", async () => {
  authorized = false; assert.equal((await request()).status, 401);
  authorized = true; process.env.VERCEL_ENV = "preview";
  assert.deepEqual(await (await request()).json(), counts); assert.equal(reads, 0);
});
