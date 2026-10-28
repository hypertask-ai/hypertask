const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const stub = (file, exports) => {
  const filename = fs.realpathSync(path.join(root, file));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const FLAG = "htpr-7692-allowance-drift-check";
const TEAM = "observed-team";
const MONTH = "2026-10";
const PREFIX = `ai-allowance:${MONTH}:${TEAM}`;
const ROOT = `ai-allowance-drift:${MONTH}`;
const OBS = `${ROOT}:${TEAM}`;
const NativeDate = Date;
let now;
let redis;
let enabled;
let flagReads;
let reportFails;
let reporterFails;
let gatewayUsd;
let systemUsd;
let reportCalls;
let reportPeriods;
let duringReport;
let funding;
let alerts;
let deliveries;
let teamTitle;
let resyncEnabled;
let hourlyRows;
let hourlyFails;
let hourlyCalls;
let hourlyParams;

stub("src/lib/ai/gatewayReport.ts", { withBackgroundReportBudget: work => work(), gatewayReport: (apiKey, params, signal) => fetch(`https://ai-gateway.vercel.sh/v1/report?${params}`, { signal, cache: "no-store", headers: { Authorization: `Bearer ${apiKey}` } }) });
stub("src/lib/ai/dailyGatewaySpend.ts", { checkDailyGatewaySpend: async () => {} });
stub("src/lib/redis.ts", { getRedis: async () => redis });
stub("src/lib/flags.ts", { isFeatureEnabled: async (key) => {
  if (key === FLAG) { flagReads++; return enabled; }
  return key === "htpr-7687-allowance-resync" && resyncEnabled;
} });
stub("src/app/api/ai/_lib/byokKeys.ts", { getTeamGatewayFunding: async (lookup) => { assert.equal(typeof lookup.trustedTeamId, "string"); assert.equal(lookup.teamId, undefined); return funding; } });
stub("src/lib/prisma.ts", { default: { team: { findUnique: async () => ({ title: teamTitle }) } } });
stub("src/lib/errors/reportError.ts", { reportError: async (report) => {
  deliveries++;
  if (reporterFails) throw new Error("delivery unavailable");
  alerts.push(report);
} });
stub("node_modules/next/server.js", { NextResponse: { json: (body, init) => Response.json(body, init) } });
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const allowance = load(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"));
const { checkActiveTeamAllowanceDrift: check } = load(path.join(root, "src/lib/ai/allowanceDriftCheck.ts"));
const { GET } = load(path.join(root, "src/app/api/cron/ai-allowance-drift/route.ts"));
const originalFetch = global.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalCronSecret = process.env.CRON_SECRET;

function fakeRedis() {
  const values = new Map();
  const sets = new Map();
  const hashes = new Map();
  const sorted = new Map();
  const ttls = new Map();
  const getNumber = (key) => Number(values.get(key) ?? 0);
  const zset = (key) => {
    if (!sorted.has(key)) sorted.set(key, new Map());
    return sorted.get(key);
  };
  const held = (key) => [...zset(key).keys()].reduce((sum, member) => sum + Number(member.split("|").at(-1)), 0);
  const client = {
    values, sets, hashes, sorted, ttls, snapshotKeys: [], failRecording: false, failIndex: false, calls: 0,
    get: async (key) => { client.calls++; return values.get(key) ?? null; },
    exists: async (key) => Number(values.has(key)),
    set: async (key, value, ...options) => {
      client.calls++;
      if (options.includes("NX") && values.has(key)) return null;
      values.set(key, String(value));
      const ex = options.indexOf("EX");
      if (ex >= 0) ttls.set(key, Number(options[ex + 1]));
      return "OK";
    },
    del: async (key) => Number(values.delete(key)),
    sscan: async (key, cursor, _count, count) => {
      const members = [...(sets.get(key) ?? [])];
      const end = Math.min(Number(cursor) + Number(count), members.length);
      return [end === members.length ? "0" : String(end), members.slice(Number(cursor), end)];
    },
    hvals: async (key) => [...(hashes.get(key)?.values() ?? [])],
    zadd: async (key, score, member) => { zset(key).set(member, Number(score)); return 1; },
    zrange: async (key) => [...zset(key)].sort(([a, sa], [b, sb]) => sa - sb || a.localeCompare(b)).map(([member]) => member),
    eval: async (script, count, ...all) => {
      client.calls++;
      const keys = all.slice(0, count);
      const args = all.slice(count);
      if (script.includes('redis.call("SADD"')) {
        if (script.includes('redis.call("HSET"') ? client.failRecording : client.failIndex) throw new Error("observation storage unavailable");
        if (!sets.has(keys[0])) sets.set(keys[0], new Set());
        if (args[0]) sets.get(keys[0]).add(args[0]);
        ttls.set(keys[0], Number(args[2]));
        ttls.set(keys[1], Number(args[2]));
        if (script.includes('redis.call("HSET"')) {
          if (!sets.has(keys[3])) sets.set(keys[3], new Set());
          if (args[0]) sets.get(keys[3]).add(args[0]);
          ttls.set(keys[2], Number(args[2])); ttls.set(keys[3], Number(args[2]));
          if (!hashes.has(keys[2])) hashes.set(keys[2], new Map());
          const event = JSON.parse(args[1]);
          const saved = hashes.get(keys[2]).get(args[3]);
          const bucket = saved ? JSON.parse(saved) : { count: 0, event };
          bucket.count++;
          const used = (entry) => entry.committed + entry.liveHolds + entry.requestedHold;
          if (used(event) < used(bucket.event) || (used(event) === used(bucket.event) && event.time < bucket.event.time)) bucket.event = event;
          if (bucket.time === undefined || event.time >= bucket.time) { bucket.committed = event.committed; bucket.time = event.time; }
          hashes.get(keys[2]).set(args[3], JSON.stringify(bucket));
          zset(keys[1]).set(args[1], event.time);
          if (zset(keys[1]).size > 500) zset(keys[1]).delete((await client.zrange(keys[1])).at(-1));
        } else {
          const context = JSON.parse(args[1]);
          const previous = values.has(keys[1]) ? JSON.parse(values.get(keys[1])) : null;
          if (previous && (previous.fundingChanged || previous.fundingSource !== context.fundingSource)) context.fundingChanged = true;
          values.set(keys[1], JSON.stringify(context));
        }
        return 1;
      }
      if (script.includes('local visible =')) {
        client.snapshotKeys.push(keys);
        if (!values.has(keys[0]) && !values.has(keys[1])) return null;
        return keys.map((key) => values.get(key) ?? "0");
      }
      if (script.includes('local scopes =')) {
        const scopes = JSON.parse(args[0]);
        for (const [i, scope] of scopes.entries()) {
          let committed = scope.pending ? getNumber(keys[scope.pending - 1]) : 0;
          let holds = 0;
          for (const [c, r] of scope.pairs) { committed += getNumber(keys[c - 1]); holds += held(keys[r - 1]); }
          if (committed + holds + Number(args[2]) > scope.cap) return args[5] === "1" ? [-i - 1, committed, holds] : -i - 1;
        }
        for (const scope of scopes) zset(keys[scope.pairs[scope.writeIndex - 1][1] - 1]).set(args[4], Number(args[3]));
        return 1;
      }
      if (script.includes('local remaining =')) {
        const committed = getNumber(keys[0]);
        const holds = held(keys[1]);
        const remaining = Number(args[0]) - committed - holds;
        return args[1] === "1" ? [remaining, committed, holds] : remaining;
      }
      if (script.includes('local requested =')) {
        const committed = getNumber(keys[0]) + (args[6] === "1" ? getNumber(keys[2]) : 0);
        const holds = held(keys[1]);
        if (committed + holds + Number(args[1]) > Number(args[2])) return args[7] === "1" ? [0, committed, holds] : 0;
        zset(keys[1]).set(args[4], Number(args[3]));
        return 1;
      }
      if (script.includes('local resynced =')) {
        const committed = getNumber(keys[0]);
        const observed = Number(args[0]);
        values.set(keys[0], String(observed));
        return committed - observed;
      }
      if (script.includes('~= ARGV[1]')) {
        if (values.get(keys[0]) !== args[0]) return 0;
        values.set(keys[1], args[1]); return 1;
      }
      if (script.includes('== ARGV[1]')) return values.get(keys[0]) === args[0] ? Number(values.delete(keys[0])) : 0;
      throw new Error(`Unsupported fake Redis script: ${script.slice(0, 50)}`);
    },
  };
  return client;
}

async function fresh(counter = 5_000_000, mode = "plan") {
  await redis.set(`${PREFIX}:system-split-v1`, String(now));
  await redis.set(`${PREFIX}:legacy-reconcile-complete`, "1");
  await redis.set(`${PREFIX}:committed`, String(counter));
  await redis.set(`${PREFIX}:system:committed`, "0");
  const context = { mode, monthlyUsd: 5, fundingSource: funding.source };
  await redis.set(`${OBS}:context`, JSON.stringify(context));
  if (redis.sets) redis.sets.set(`${ROOT}:active`, new Set([TEAM]));
  else await redis.sadd(`${ROOT}:active`, TEAM);
}
const plan = (amountUsd = 0.2, policy = {}) => allowance.reservePlanAllowance({
  teamId: TEAM, gatewayApiKey: funding.apiKey, fundingSource: funding.source, amountUsd,
  policy: { mode: "plan", monthlyUsd: 5, dailyUsd: null, demoGlobal: false, ...policy },
});
const refusalEvents = async () => (await redis.zrange(`${OBS}:refusal-events`, 0, -1)).map(JSON.parse);
const refusalBuckets = async () => (await redis.hvals(`${OBS}:refusal-buckets`)).map(JSON.parse);
const age = () => { now += 31 * 60 * 1000; };

function installFetch() {
  global.fetch = async (url) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "test/model", pricing: { input: "0.000001", output: "0.00005" } }] });
    reportCalls++;
    const params = new URL(String(url)).searchParams;
    if (params.get("date_part") === "hour") {
      hourlyCalls++; hourlyParams.push(params);
      assert.equal(params.get("group_by"), "day");
      assert.equal(params.get("tags"), `team:${TEAM}`);
      if (hourlyFails) throw new Error("hourly report unavailable");
      return Response.json({ results: hourlyRows ?? [{ hour: `${params.get("start_date")}T00:00:00Z`, total_cost: gatewayUsd }] });
    }
    reportPeriods.push([params.get("start_date"), params.get("end_date")]);
    if (duringReport) await duringReport();
    if (reportFails) throw new Error("private provider response must not leak");
    return Response.json({ results: [{ tag: new URL(String(url)).searchParams.get("tags"), total_cost: gatewayUsd }, { tag: "included-with-hypertask", total_cost: systemUsd }] });
  };
}

test.beforeEach(() => {
  now = new NativeDate("2026-10-14T12:00:00.000Z").getTime();
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  redis = fakeRedis(); enabled = true; flagReads = 0; reportFails = false; reporterFails = false;
  gatewayUsd = 2; systemUsd = 0; reportCalls = 0; reportPeriods = []; duringReport = null; resyncEnabled = false;
  funding = { source: "managed", apiKey: "fixture-platform-credential" };
  hourlyRows = null; hourlyFails = false; hourlyCalls = 0; hourlyParams = [];
  alerts = []; deliveries = 0; teamTitle = "Acme <script> token_abcdefghijklmnop";
  process.env.NODE_ENV = "production"; process.env.VERCEL_ENV = "production"; process.env.CRON_SECRET = "fixture-cron-authority";
  allowance.resetGatewayPricingCacheForTests();
  installFetch();
});
test.afterEach(() => {
  global.Date = NativeDate;
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries({ NODE_ENV: originalNodeEnv, VERCEL_ENV: originalVercelEnv, CRON_SECRET: originalCronSecret })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("quiet $5/$2 drift alerts once, exact numbers survive, no credential or raw title leaks", async () => {
  await fresh();
  assert.equal((await check()).inconclusive, 1);
  age();
  assert.equal((await check()).drift, 1);
  await check();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /counter \$5\.000000; gateway \$2\.000000; allowance \$5\.000000/);
  assert.match(alerts[0].message, /Acme script/);
  assert.match(alerts[0].message, /refusals month 0\/day 0\/demo 0/);
  assert.ok(alerts[0].message.includes(alerts[0].fingerprintKey.replace("ai-allowance:", "")));
  assert.ok(!JSON.stringify(alerts).includes(funding.apiKey));
  assert.ok(!JSON.stringify(alerts).includes("abcdefghijklmnop"));
  assert.equal(await redis.get(`${PREFIX}:committed`), "5000000");
  assert.equal(flagReads, 3);
});

test("busy counter or counter changed during report is inconclusive, never confirmed", async () => {
  await fresh(); await check(); age();
  await redis.set(`${PREFIX}:committed`, "6000000");
  assert.equal((await check()).inconclusive, 1);
  age();
  duringReport = () => redis.set(`${PREFIX}:committed`, "7000000");
  assert.equal((await check()).inconclusive, 1);
  assert.equal(alerts.length, 0);
});

test("failed report is unknown, counted, never clean and never alerts", async () => {
  await fresh(); await check(); age(); reportFails = true;
  const result = await check();
  assert.equal(result.checked, 1); assert.equal(result.unknown, 1); assert.equal(result.drift, 0);
  assert.equal(alerts.length, 0);
});

test("real reserve refuses, records atomic holds/request, distinguishes correct capacity refusal from under allowance", async () => {
  await fresh();
  await redis.zadd(`${PREFIX}:reservations`, now + 600_000, "live|2900000");
  await assert.rejects(plan(), (error) => error.reason === "month");
  let events = await refusalEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].liveHolds, 2_900_000); assert.equal(events[0].requestedHold, 200_000);
  assert.equal(events[0].committed, 5_000_000); assert.equal(events[0].cap, 5_000_000);
  age();
  assert.equal((await check()).refusalAlerts, 0);
  redis.sorted.get(`${PREFIX}:reservations`).clear();
  await assert.rejects(plan(), (error) => error.reason === "month");
  events = await refusalEvents(); assert.equal(events.length, 2);
  age();
  assert.equal((await check()).refusalAlerts, 1);
  assert.equal(alerts.filter((entry) => entry.message.includes("refused while under allowance")).length, 1);
});

test("day/demo evidence is labeled, never judged using monthly headroom", async () => {
  await fresh(0);
  const day = `ai-allowance:day:2026-10-14:${TEAM}`;
  await redis.set(`${day}:seeded`, "1"); await redis.set(`${day}:committed`, "250000");
  await assert.rejects(plan(0.2, { dailyUsd: 0.25 }), (error) => error.reason === "day");
  const demo = `ai-allowance:demo:${MONTH}`;
  await redis.set(`${demo}:committed`, "15000000");
  await assert.rejects(plan(0.2, { demoGlobal: true }), (error) => error.reason === "demo");
  age();
  assert.equal((await check()).refusalAlerts, 0);
  assert.deepEqual((await refusalEvents()).map((event) => event.reason).sort(), ["day", "demo"]);
  assert.equal(alerts.length, 0);
});

test("legacy and daily prebound refusals capture one event each without calling inference", async () => {
  await fresh(5_000_000, "legacy");
  let generated = 0;
  const params = { prompt: [], maxOutputTokens: 256, providerOptions: { gateway: { tags: [`team:${TEAM}`] } } };
  const invoke = (resolvePolicy) => allowance.createSharedAllowanceMiddleware({ allowanceUsd: 5, gatewayApiKey: funding.apiKey, fundingSource: funding.source, modelSlug: "test/model", resolvePolicy }).wrapGenerate({
    params, model: {}, doGenerate: async () => { generated++; return {}; }, doStream: async () => { throw new Error("unused"); },
  });
  await assert.rejects(invoke(), /included AI allowance/);
  await redis.set(`${PREFIX}:committed`, "0");
  const day = `ai-allowance:day:2026-10-14:${TEAM}`;
  await redis.set(`${day}:seeded`, "1"); await redis.set(`${day}:committed`, "250000");
  await assert.rejects(invoke(async () => ({ mode: "plan", monthlyUsd: 5, dailyUsd: 0.25, demoGlobal: false })), (error) => error.reason === "day");
  assert.equal(generated, 0);
  assert.deepEqual((await refusalEvents()).map((event) => [event.reason, event.policyMode]).sort(), [["day", "plan"], ["month", "legacy"]]);
});

test("final refusal only: successful resync retry records nothing", async () => {
  await fresh(); resyncEnabled = true;
  await plan();
  assert.equal((await refusalEvents()).length, 0);
  assert.equal(await redis.get(`${PREFIX}:committed`), "2000000");
});

test("recovery then recurrence yields a fresh episode even within the same hour", async () => {
  await fresh(); await check(); age(); await check();
  gatewayUsd = 5; await check(); gatewayUsd = 2; await check();
  assert.equal(alerts.length, 2);
  assert.notEqual(alerts[0].fingerprintKey, alerts[1].fingerprintKey);
  assert.notEqual(alerts[0].message, alerts[1].message);
});

test("rejected reporter remains unnotified and retryable", async () => {
  await fresh(); await check(); age(); reporterFails = true;
  assert.equal((await check()).unknown, 1);
  assert.equal(JSON.parse(await redis.get(`${OBS}:observation`)).drift.notified, false);
  reporterFails = false; await check(); await check();
  assert.equal(alerts.length, 1); assert.equal(deliveries, 2);
});

test("flag Off performs no Redis/report work and no refusal recording", async () => {
  enabled = false;
  assert.deepEqual(await check(), { checked: 0, inconclusive: 0, unknown: 0, drift: 0, refusalAlerts: 0 });
  assert.equal(redis.calls, 0); assert.equal(reportCalls, 0);
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month");
  assert.equal((await refusalEvents()).length, 0);
});

test("failed recording or index never changes final refusal", async () => {
  await fresh(); redis.failRecording = true;
  await assert.rejects(plan(), (error) => error.reason === "month");
  assert.equal(await redis.get(`${PREFIX}:committed`), "5000000");
  redis.failIndex = true;
  await assert.rejects(plan(), (error) => error.reason === "month");
  assert.equal((await refusalEvents()).length, 0);
});

test("customer funding is skipped and changed funding label is inconclusive, neither is queried", async () => {
  await fresh(); funding = { ...funding, source: "customer" };
  assert.equal((await check()).unknown, 1);
  funding = { source: "shared", apiKey: "rotated-fixture-credential" };
  assert.equal((await check()).inconclusive, 1);
  assert.equal(reportCalls, 0); assert.equal(alerts.length, 0);
});

test("legacy lanes plus pending compare separately without summing overlapping report rows", async () => {
  await fresh(1_500_000, "legacy");
  await redis.set(`${PREFIX}:legacy-pending`, "500000");
  await redis.set(`${PREFIX}:system:committed`, "1000000");
  gatewayUsd = 3; systemUsd = 1;
  await check(); age(); assert.equal((await check()).drift, 0);
  await redis.set(`${PREFIX}:committed`, "2500000");
  await redis.set(`${PREFIX}:system:committed`, "0");
  await check(); age(); assert.equal((await check()).drift, 1);
});

test("cron rejects missing authority before work, preview skips, production response contains counts only", async () => {
  const request = (authorization) => ({ headers: new Headers(authorization ? { authorization } : {}) });
  assert.equal((await GET(request())).status, 401); assert.equal(flagReads, 0); assert.equal(redis.calls, 0);
  process.env.CRON_SECRET = "";
  assert.equal((await GET(request("Bearer "))).status, 401);
  process.env.CRON_SECRET = "fixture-cron-authority"; process.env.VERCEL_ENV = "preview";
  await GET(request("Bearer fixture-cron-authority")); assert.equal(flagReads, 0);
  process.env.VERCEL_ENV = "production"; enabled = false;
  const response = await GET(request("Bearer fixture-cron-authority"));
  assert.deepEqual(Object.keys(await response.json()).sort(), ["checked", "drift", "inconclusive", "refusalAlerts", "unknown"]);
});

test("bounded sorted evidence, month-end plus seven days TTL, cursor resumes at most 200 teams, lock excludes another run", async () => {
  await fresh();
  for (let i = 0; i < 505; i++) await assert.rejects(plan(), (error) => error.reason === "month");
  assert.equal((await refusalEvents()).length, 500);
  const expectedTtl = (new NativeDate("2026-11-08T00:00:00Z").getTime() - now) / 1000;
  assert.equal(redis.ttls.get(`${ROOT}:active`), expectedTtl);
  assert.equal(redis.ttls.get(`${OBS}:refusal-events`), expectedTtl);
  assert.equal(redis.ttls.get(`${OBS}:refusal-buckets`), expectedTtl);
  assert.equal((await refusalBuckets())[0].count, 505);
  await redis.set("ai-allowance-drift:lock", "another-owner");
  assert.equal((await check()).checked, 0);
  await redis.del("ai-allowance-drift:lock");
  redis.sets.set(`${ROOT}:active`, new Set(Array.from({ length: 205 }, (_, i) => `team-${i}`)));
  assert.equal((await check()).checked, 200);
  assert.equal((await check()).checked, 5);
});

test("real Redis executes observation/refusal Lua, TTL/sorted-set bounds and consistent snapshot", async (t) => {
  if (spawnSync("redis-server", ["--version"]).status !== 0) { t.skip("redis-server unavailable"); return; }
  const port = await new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  const server = spawn("redis-server", ["--bind", "127.0.0.1", "--port", String(port), "--save", "", "--appendonly", "no"]);
  t.after(() => server.kill("SIGTERM"));
  await new Promise((resolve, reject) => {
    let output = "";
    server.stdout.on("data", (chunk) => { output += chunk; if (output.includes("Ready to accept connections")) resolve(); });
    server.once("error", reject); server.once("exit", (code) => reject(new Error(`Redis exited ${code}`)));
  });
  const Redis = require("ioredis");
  redis = new Redis({ host: "127.0.0.1", port });
  t.after(() => redis.disconnect());
  await fresh();
  const start = now;
  await assert.rejects(plan(), (error) => error.reason === "month");
  const earliest = (await refusalEvents())[0];
  for (let i = 1; i < 1000; i++) {
    now = start + i * 600;
    await assert.rejects(plan(), (error) => error.reason === "month");
  }
  assert.equal((await refusalEvents()).length, 500);
  assert.equal((await refusalEvents())[0].committed, 5_000_000);
  assert.equal((await refusalBuckets()).reduce((sum, bucket) => sum + bucket.count, 0), 1000);
  assert.ok((await refusalBuckets()).some((bucket) => bucket.event.id === earliest.id));
  assert.equal(await redis.sismember(`${ROOT}:active`, TEAM), 1);
  assert.ok(await redis.ttl(`${OBS}:refusal-events`) > 0);
  assert.ok(await redis.ttl(`${OBS}:refusal-buckets`) > 0);
  await check(); age();
  const result = await check();
  assert.equal(result.drift, 1); assert.equal(result.refusalAlerts, 1);
  assert.ok(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen.includes(earliest.id));
  assert.equal(alerts.length, 2);
  await check(); assert.equal(alerts.length, 2);
  assert.equal(await redis.get(`${PREFIX}:committed`), "5000000");
});


test("a later platform attempt after a label change stays inconclusive rather than comparing mixed funding", async () => {
  await fresh();
  funding = { source: "shared", apiKey: "rotated-fixture-credential" };
  await assert.rejects(plan(), (error) => error.reason === "month");
  assert.equal(JSON.parse(await redis.get(`${OBS}:context`)).fundingChanged, true);
  assert.equal((await check()).inconclusive, 1);
  assert.equal(reportCalls, 0);
});

test("under-cap admission survives failed observation indexing and still takes the same hold", async () => {
  await fresh(0); redis.failIndex = true;
  const reservation = await plan();
  assert.ok((await redis.zrange(`${PREFIX}:reservations`, 0, -1)).includes(reservation.id));
  assert.equal((await refusalEvents()).length, 0);
});

test("counter changes just before a report reset the full quiet interval", async () => {
  await fresh(); await check(); age();
  duringReport = async () => { await redis.set(`${PREFIX}:legacy-pending`, "100000"); duringReport = null; };
  assert.equal((await check()).inconclusive, 1);
  now += 29 * 60 * 1000;
  assert.equal((await check()).drift, 0);
  assert.equal(alerts.length, 0);
});


test("teamless demo final refusals retain evidence without inventing an active team", async () => {
  await redis.set(`ai-allowance:demo:${MONTH}:committed`, "15000000");
  await assert.rejects(allowance.reservePlanAllowance({ gatewayApiKey: funding.apiKey, amountUsd: 0.2,
    policy: { mode: "plan", monthlyUsd: 0, dailyUsd: null, demoGlobal: true } }), (error) => error.reason === "demo");
  const events = (await redis.zrange(`${ROOT}:teamless:demo:refusal-events`, 0, -1)).map(JSON.parse);
  assert.equal(events.length, 1); assert.equal(events[0].teamId, null); assert.equal(events[0].reason, "demo");
  assert.equal(events[0].fundingSource, "demo");
  assert.equal(redis.sets.get(`${ROOT}:active`).size, 0);
});


async function indexTeams(count) {
  const context = JSON.stringify({ mode: "plan", monthlyUsd: 5, fundingSource: funding.source });
  const teams = Array.from({ length: count }, (_, i) => `indexed-${i}`);
  for (const team of teams) {
    await redis.set(`ai-allowance:${MONTH}:${team}:committed`, "5000000");
    await redis.set(`${ROOT}:${team}:context`, context);
  }
  redis.sets.set(`${ROOT}:active`, new Set(teams));
}

test("work runs four reports at a time and evaluates the kill switch once", async () => {
  await indexTeams(9);
  let active = 0; let peak = 0;
  duringReport = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
  };
  assert.equal((await check()).checked, 9);
  assert.equal(peak, 4); assert.equal(flagReads, 1);
});

test("time budget persists remaining work for the next run", async () => {
  await indexTeams(9);
  duringReport = () => { now += 230_000; duringReport = null; };
  assert.equal((await check()).checked, 4);
  assert.equal(JSON.parse(await redis.get(`${ROOT}:cursor`)).pending.length, 5);
  assert.equal((await check()).checked, 5);
});

test("an older unalerted refusal is reconsidered when Gateway later corrects its billed total", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  gatewayUsd = 5;
  assert.equal((await check()).refusalAlerts, 0);
  gatewayUsd = 2;
  assert.equal((await check()).refusalAlerts, 1);
});


test("UUID team episodes remain distinct through the real downstream fingerprint sanitizer", async () => {
  const teams = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  for (const team of teams) {
    await redis.set(`ai-allowance:${MONTH}:${team}:committed`, "5000000");
    await redis.set(`${ROOT}:${team}:context`, JSON.stringify({ mode: "plan", monthlyUsd: 5, fundingSource: funding.source }));
  }
  redis.sets.set(`${ROOT}:active`, new Set(teams));
  await check(); age(); await check();
  const { errorFingerprint } = load(path.join(root, "src/lib/errors/errorFingerprint.ts"));
  assert.equal(alerts.length, 2);
  assert.notEqual(errorFingerprint(alerts[0].message), errorFingerprint(alerts[1].message));
  assert.notEqual(errorFingerprint(alerts[0].fingerprintKey), errorFingerprint(alerts[1].fingerprintKey));
  assert.ok(alerts.every((entry) => entry.message.length <= 1000 && entry.message.includes("refusals month 0/day 0/demo 0")));
});

test("manifest registers only this five-minute observer and flag is generated from its definition", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(manifest.crons.filter((entry) => entry.path === "/api/cron/ai-allowance-drift"), [{ path: "/api/cron/ai-allowance-drift", schedule: "*/5 * * * *" }]);
  const flagModule = load(path.join(root, "src/lib/flags/definitions/htpr-7692-allowance-drift-check.ts"));
  const definition = flagModule.default ?? flagModule;
  assert.equal(definition.key, FLAG); assert.equal(definition.defaultMode, "EVERYONE"); assert.equal(definition.releaseRisk.risk, "small");
});


test("stored Redis values and alert text contain neither the test credential nor its SHA-256", async () => {
  await fresh();
  await assert.rejects(plan(), (error) => error.reason === "month");
  assert.equal(JSON.parse(await redis.get(`${OBS}:context`)).fundingSource, "managed");
  assert.equal((await refusalEvents())[0].fundingSource, "managed");
  await check(); age(); await check();
  assert.equal(alerts.length, 2);
  const stored = [
    ...redis.values.values(),
    ...[...redis.sets.values()].flatMap((set) => [...set]),
    ...[...redis.hashes.values()].flatMap((hash) => [...hash.values()]),
    ...[...redis.sorted.values()].flatMap((set) => [...set].flat()),
    ...redis.ttls.values(),
    ...alerts.map((alert) => JSON.stringify(alert)),
  ].map(String);
  for (const value of stored) {
    assert.equal(value.includes(funding.apiKey), false, "credential leaked into stored value or alert");
    assert.doesNotMatch(value, /\b[0-9a-f]{40,}\b/i, "hash-shaped value stored or alerted");
  }
});

test("a caller without funding metadata records unknown and is inconclusive", async () => {
  await fresh();
  await redis.del(`${OBS}:context`);
  await assert.rejects(allowance.reservePlanAllowance({
    teamId: TEAM, gatewayApiKey: funding.apiKey, amountUsd: 0.2,
    policy: { mode: "plan", monthlyUsd: 5, dailyUsd: null, demoGlobal: false },
  }), (error) => error.reason === "month");
  assert.equal(JSON.parse(await redis.get(`${OBS}:context`)).fundingSource, "unknown");
  assert.equal((await refusalEvents())[0].fundingSource, "unknown");
  assert.equal((await check()).inconclusive, 1);
  assert.equal(reportCalls, 0); assert.equal(alerts.length, 0);
});

test("missing or unknown funding labels are inconclusive without querying Gateway", async () => {
  await fresh();
  for (const fundingSource of [undefined, "unknown"]) {
    await redis.set(`${OBS}:context`, JSON.stringify({ mode: "plan", monthlyUsd: 5, fundingSource }));
    assert.equal((await check()).inconclusive, 1);
  }
  assert.equal(reportCalls, 0); assert.equal(alerts.length, 0);
});

test("key rotation within the same funding label does not mark funding changed", async () => {
  await fresh();
  funding = { ...funding, apiKey: "replacement-synthetic-credential" };
  await assert.rejects(plan(), (error) => error.reason === "month");
  const context = JSON.parse(await redis.get(`${OBS}:context`));
  assert.equal(context.fundingSource, "managed"); assert.equal(context.fundingChanged, undefined);
  await check(); age();
  const result = await check();
  assert.equal(result.drift, 1); assert.equal(result.refusalAlerts, 1);
});

test("refusal evidence from an unknown or different funding label is not compared", async () => {
  await fresh();
  await assert.rejects(plan(), (error) => error.reason === "month");
  const event = (await refusalEvents())[0];
  redis.hashes.set(`${OBS}:refusal-buckets`, new Map(["unknown", "shared"].map((fundingSource) => [fundingSource,
    JSON.stringify({ count: 1, event: { ...event, fundingSource }, committed: event.committed, time: event.time })])));
  age();
  assert.equal((await check()).refusalAlerts, 0);
  assert.equal(alerts.length, 0);
});

test("image middleware carries shared funding into reservation and refusal context", async () => {
  funding = { ...funding, source: "shared" };
  await fresh();
  let generated = 0;
  const middleware = allowance.createImageAllowanceMiddleware({
    allowanceUsd: 5, gatewayApiKey: funding.apiKey, fundingSource: funding.source, modelSlug: "test/model",
    resolvePolicy: async () => ({ mode: "plan", monthlyUsd: 5, dailyUsd: null, demoGlobal: false }),
  });
  await assert.rejects(middleware.wrapGenerate({
    params: { prompt: "test", n: 1, providerOptions: { gateway: { tags: [`team:${TEAM}`] } } },
    model: {}, doGenerate: async () => { generated++; return {}; },
  }), (error) => error.reason === "month");
  assert.equal(generated, 0);
  assert.equal(JSON.parse(await redis.get(`${OBS}:context`)).fundingSource, "shared");
  assert.equal((await refusalEvents())[0].fundingSource, "shared");
});


for (const [billedAtRefusal, expectedAlerts] of [[2, 1], [5, 0]]) {
  test(`later $20 spend does not change a refusal judged at $${billedAtRefusal} billed`, async () => {
    await fresh();
    await assert.rejects(plan(), (error) => error.reason === "month");
    age();
    await redis.set(`${PREFIX}:committed`, "25000000");
    gatewayUsd = billedAtRefusal + 20;
    hourlyRows = [{ hour: "2026-10-14T11:00:00Z", total_cost: billedAtRefusal }, { hour: "2026-10-14T13:00:00Z", total_cost: 20 }];
    now = new NativeDate("2026-10-14T14:00:00Z").getTime();
    const result = await check();
    assert.equal(result.unknown, 0);
    assert.equal(result.refusalAlerts, expectedAlerts);
    assert.equal(alerts.length, expectedAlerts);
    assert.equal(await redis.get(`${PREFIX}:committed`), "25000000");
  });
}

test("a repaired counter below refusal commitment cannot override billed over-cap evidence", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  await redis.set(`${PREFIX}:committed`, "4000000");
  gatewayUsd = 5;
  const result = await check();
  assert.ok(result.inconclusive > 0); assert.equal(result.unknown, 0);
  assert.equal(result.refusalAlerts, 0); assert.equal(alerts.length, 0);
  assert.deepEqual(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen, []);
});

test("counter growth exceeding bills never changes independently reported refusal-time billing", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  await redis.set(`${PREFIX}:committed`, "25000000");
  gatewayUsd = 2;
  assert.equal((await check()).refusalAlerts, 1);
});

for (const lane of ["visible", "system"]) {
  test(`legacy ${lane} refusal ignores growth and billing in the other lane`, async () => {
    await fresh(lane === "visible" ? 5_000_000 : 0, "legacy");
    if (lane === "system") await redis.set(`${PREFIX}:system:committed`, "50000000");
    const middleware = allowance.createSharedAllowanceMiddleware({ allowanceUsd: 5, gatewayApiKey: funding.apiKey,
      fundingSource: funding.source, modelSlug: "test/model" });
    await assert.rejects(middleware.wrapGenerate({
      params: { prompt: [], maxOutputTokens: 256, providerOptions: { gateway: { tags: [`team:${TEAM}`, ...(lane === "system" ? ["included-with-hypertask"] : [])] } } },
      model: {}, doGenerate: async () => { throw new Error("must not infer"); },
    }), (error) => error.reason === "month");
    const event = (await refusalEvents())[0];
    assert.equal(event.lane, lane); assert.equal(event.committed, lane === "visible" ? 5_000_000 : 50_000_000);
    age();
    if (lane === "visible") {
      await redis.set(`${PREFIX}:system:committed`, "20000000");
      gatewayUsd = 25; systemUsd = 20;
    } else {
      await redis.set(`${PREFIX}:committed`, "20000000");
      gatewayUsd = 70; systemUsd = 50;
    }
    assert.equal((await check()).refusalAlerts, 0);
    assert.equal(alerts.length, 0);
  });
}

test("plan refusal billing includes both lanes independently of system and pending counter growth", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  await redis.set(`${PREFIX}:system:committed`, "15000000");
  await redis.set(`${PREFIX}:legacy-pending`, "5000000");
  gatewayUsd = 22; systemUsd = 15;
  hourlyRows = [{ hour: "2026-10-14T11:00:00Z", total_cost: 2 }, { hour: "2026-10-14T13:00:00Z", total_cost: 20 }];
  now = new NativeDate("2026-10-14T14:00:00Z").getTime();
  assert.equal((await check()).refusalAlerts, 1);
});

test("1000 retries in ten minutes keep the earliest minimum-headroom refusal judgeable at maturity", async () => {
  await fresh();
  const start = now;
  await assert.rejects(plan(), (error) => error.reason === "month");
  const earliest = (await refusalEvents())[0];
  await redis.set(`${PREFIX}:committed`, "6000000");
  for (let i = 1; i < 1000; i++) {
    now = start + i * 600;
    await assert.rejects(plan(), (error) => error.reason === "month");
  }
  assert.equal((await refusalEvents()).length, 500);
  const buckets = await refusalBuckets();
  assert.equal(buckets.length, 2);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 1000);
  assert.ok(buckets.some((bucket) => bucket.event.id === earliest.id));
  now = start + 30 * 60 * 1000 - 1;
  gatewayUsd = 3;
  assert.equal((await check()).refusalAlerts, 0);
  now++;
  assert.equal((await check()).refusalAlerts, 1);
  assert.ok(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen.includes(earliest.id));
  assert.match(alerts.at(-1).message, /refusals month 1000\/day 0\/demo 0/);
});

test("bucket representative changes to the smallest committed plus holds plus request, not the newest retry", async () => {
  await fresh();
  await redis.zadd(`${PREFIX}:reservations`, now + 600_000, "live|1000000");
  await assert.rejects(plan(), (error) => error.reason === "month");
  const first = (await refusalBuckets())[0].event;
  now++;
  redis.sorted.get(`${PREFIX}:reservations`).clear();
  await assert.rejects(plan(), (error) => error.reason === "month");
  const minimum = (await refusalBuckets())[0].event;
  assert.notEqual(first.id, minimum.id);
  assert.equal(minimum.liveHolds, 0);
  now++;
  await redis.zadd(`${PREFIX}:reservations`, now + 600_000, "live|2000000");
  await assert.rejects(plan(), (error) => error.reason === "month");
  const bucket = (await refusalBuckets())[0];
  assert.equal(bucket.count, 3); assert.equal(bucket.event.id, minimum.id);
});

for (const savedSnapshot of [false, true]) {
  test(`October 31 refusal drains November 1 using hourly bills ${savedSnapshot ? "after an observer snapshot" : "without an observer snapshot"}, without old live counters`, async () => {
    now = new NativeDate("2026-10-31T22:50:00Z").getTime();
    await fresh();
    await assert.rejects(plan(), (error) => error.reason === "month");
    if (savedSnapshot) {
      now = new NativeDate("2026-10-31T22:55:00Z").getTime();
      await redis.set(`${PREFIX}:committed`, "25000000");
      gatewayUsd = 22;
      hourlyRows = [{ hour: "2026-10-31T22:00:00Z", total_cost: 2 }, { hour: "2026-10-31T23:00:00Z", total_cost: 20 }];
      assert.equal((await check()).refusalAlerts, 0);
    }
    for (const suffix of ["committed", "system:committed", "legacy-pending"]) await redis.del(`${PREFIX}:${suffix}`);
    now = new NativeDate("2026-11-01T00:30:00Z").getTime();
    const currentRoot = "ai-allowance-drift:2026-11";
    const currentPrefix = `ai-allowance:2026-11:${TEAM}`;
    await redis.set(`${currentRoot}:${TEAM}:context`, JSON.stringify({ mode: "plan", monthlyUsd: 5, fundingSource: funding.source }));
    await redis.set(`${currentPrefix}:committed`, String(gatewayUsd * 1_000_000));
    redis.sets.set(`${currentRoot}:active`, new Set([TEAM]));
    redis.snapshotKeys.length = 0; reportPeriods.length = 0;
    const result = await check();
    assert.equal(result.checked, 2); assert.equal(result.unknown, 0);
    assert.equal(result.refusalAlerts, 1); assert.equal(result.drift, 0);
    assert.equal(hourlyCalls, 1);
    assert.equal(hourlyParams[0].get("start_date"), "2026-10-01");
    assert.equal(hourlyParams[0].get("end_date"), "2026-11-01");
    assert.deepEqual(reportPeriods, [["2026-10-01", "2026-10-31"], ["2026-11-01", "2026-11-01"]]);
    assert.ok(redis.snapshotKeys.length > 0);
    assert.ok(redis.snapshotKeys.every((keys) => keys.every((key) => key.startsWith(currentPrefix))));
    assert.match(alerts[0].message, /month 2026-10; stored refusal-scope counter/);
    assert.ok(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen.length > 0);
    assert.equal((await check()).refusalAlerts, 0);
    assert.equal(alerts.length, 1);
    now = new NativeDate("2026-11-03T00:00:00Z").getTime();
    await redis.del(`${OBS}:observation`);
    reportPeriods.length = 0;
    assert.equal((await check()).checked, 1);
    assert.deepEqual(reportPeriods, [["2026-11-01", "2026-11-03"]]);
  });
}


test("checker judges a summarized bucket even after its raw event is evicted", async () => {
  await fresh();
  const start = now;
  await redis.zadd(`${PREFIX}:reservations`, now + 600_000, "live|2900000");
  for (let i = 0; i < 500; i++) {
    now = start + i;
    await assert.rejects(plan(), (error) => error.reason === "month");
  }
  now = start + 5 * 60 * 1000;
  redis.sorted.get(`${PREFIX}:reservations`).clear();
  await assert.rejects(plan(), (error) => error.reason === "month");
  const representative = (await refusalBuckets()).find((bucket) => bucket.event.liveHolds === 0).event;
  assert.ok(!(await refusalEvents()).some((event) => event.id === representative.id));
  now += 30 * 60 * 1000;
  assert.equal((await check()).refusalAlerts, 1);
  assert.ok(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen.includes(representative.id));
});


test("second-day drain attributes later-hour bills without old live counters", async () => {
  now = new NativeDate("2026-10-31T22:50:00Z").getTime();
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month");
  const earliest = (await refusalEvents())[0];
  now = new NativeDate("2026-10-31T23:55:00Z").getTime();
  await redis.set(`${PREFIX}:committed`, "25000000");
  await assert.rejects(plan(), (error) => error.reason === "month");
  gatewayUsd = 22;
  hourlyRows = [{ hour: "2026-10-31T22:00:00Z", total_cost: 2 }, { hour: "2026-10-31T23:00:00Z", total_cost: 20 }];
  await redis.del(`${PREFIX}:committed`); await redis.del(`${PREFIX}:system:committed`);
  now = new NativeDate("2026-11-02T00:30:00Z").getTime();
  const result = await check();
  assert.equal(result.unknown, 0); assert.equal(result.drift, 0); assert.equal(result.refusalAlerts, 1);
  assert.equal(redis.snapshotKeys.length, 0);
  assert.deepEqual(reportPeriods, [["2026-10-01", "2026-10-31"]]);
  assert.deepEqual(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen, [earliest.id]);
});


test("later-hour billed spend cannot hide an under-cap refusal even with no counter growth", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month");
  gatewayUsd = 42;
  hourlyRows = [{ hour: "2026-10-14T11:00:00Z", total_cost: 2 }, { hour: "2026-10-14T13:00:00Z", total_cost: 40 }];
  now = new NativeDate("2026-10-14T14:00:00Z").getTime();
  const result = await check();
  assert.equal(result.refusalAlerts, 1); assert.equal(result.unknown, 0);
  assert.equal(hourlyCalls, 1);
  assert.equal(await redis.get(`${PREFIX}:committed`), "5000000");
});

test("a refusal hour whose upper bound exceeds cap is inconclusive, never alerted or marked seen", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  gatewayUsd = 6;
  hourlyRows = [{ hour: "2026-10-14T11:00:00Z", total_cost: 2 }, { hour: "2026-10-14T12:00:00Z", total_cost: 4 }];
  const result = await check();
  assert.equal(result.refusalAlerts, 0); assert.ok(result.inconclusive > 0); assert.equal(result.unknown, 0);
  assert.equal(alerts.length, 0);
  assert.deepEqual(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen, []);
});

test("hourly failure is unknown and retryable, never an under-cap alert", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  hourlyFails = true;
  const result = await check();
  assert.equal(result.unknown, 1); assert.equal(result.refusalAlerts, 0); assert.equal(alerts.length, 0);
  assert.deepEqual(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen, []);
  hourlyFails = false;
  assert.equal((await check()).refusalAlerts, 1);
});

test("hourly cents that add up to the month total keep refusal bounds (0.10 + 0.20 = 0.30)", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month");
  hourlyRows = [{ hour: "2026-10-14T10:00:00Z", total_cost: 0.1 }, { hour: "2026-10-14T11:00:00Z", total_cost: 0.2 }];
  gatewayUsd = 0.3;
  await check(); age();
  const result = await check();
  assert.equal(result.unknown, 0); assert.equal(result.inconclusive, 0); assert.equal(result.refusalAlerts, 1);
  const refusalAlerts = alerts.filter((entry) => entry.extra.stage === "refusal");
  assert.equal(refusalAlerts.length, 1);
  assert.match(refusalAlerts[0].message, /refused while under allowance/);
});

test("hourly report failure still lets the drift check alert", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); await check(); age();
  hourlyFails = true;
  const result = await check();
  assert.deepEqual(result, { checked: 1, inconclusive: 0, unknown: 1, drift: 1, refusalAlerts: 0 });
  assert.equal(alerts.length, 1); assert.equal(alerts[0].extra.stage, "drift");
  assert.match(alerts[0].message, /drift CONFIRMED/);
  assert.match(alerts[0].message, /counter \$5\.000000; gateway \$2\.000000; allowance \$5\.000000/);
});

for (const rows of [[{ day: "2026-10-14", total_cost: 2 }], [{ hour: "2026-10-14", total_cost: 2 }], []]) {
  test(`missing hour granularity or missing billed hours is inconclusive: ${JSON.stringify(rows)}`, async () => {
    await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
    hourlyRows = rows;
    const result = await check();
    assert.ok(result.inconclusive > 0); assert.equal(result.unknown, 0); assert.equal(result.refusalAlerts, 0);
    assert.equal(alerts.length, 0);
  });
}

test("overlapping hourly rows are unknown rather than summed as extra spend", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  hourlyRows = [{ hour: "2026-10-14T11:00:00Z", total_cost: 1 }, { hour: "2026-10-14T11:00:00Z", total_cost: 1 }];
  const result = await check();
  assert.equal(result.unknown, 1); assert.equal(result.refusalAlerts, 0); assert.equal(alerts.length, 0);
});

test("two under-cap refusals twenty minutes apart share one episode; two quiet hours permit a new one", async () => {
  await fresh();
  const start = now;
  await assert.rejects(plan(), (error) => error.reason === "month");
  now = start + 20 * 60 * 1000;
  await assert.rejects(plan(), (error) => error.reason === "month");
  now = start + 31 * 60 * 1000;
  assert.equal((await check()).refusalAlerts, 1);
  const episode = JSON.parse(await redis.get(`${OBS}:observation`)).refusal.id;
  now = start + 51 * 60 * 1000;
  assert.equal((await check()).refusalAlerts, 0);
  assert.equal(hourlyCalls, 2);
  assert.equal(JSON.parse(await redis.get(`${OBS}:observation`)).refusalSeen.length, 2);
  assert.equal(JSON.parse(await redis.get(`${OBS}:observation`)).refusal.id, episode);
  await check();
  assert.equal(JSON.parse(await redis.get(`${OBS}:observation`)).refusal.id, episode);
  assert.equal(alerts.filter((entry) => entry.extra.stage === "refusal").length, 1);
  now = start + 140 * 60 * 1000;
  await check();
  assert.equal(JSON.parse(await redis.get(`${OBS}:observation`)).refusal, undefined);
  now += 60_000;
  await assert.rejects(plan(), (error) => error.reason === "month"); age();
  assert.equal((await check()).refusalAlerts, 1);
  const refusalAlerts = alerts.filter((entry) => entry.extra.stage === "refusal");
  assert.equal(refusalAlerts.length, 2);
  assert.notEqual(refusalAlerts[0].fingerprintKey, refusalAlerts[1].fingerprintKey);
});

test("two quiet hours between observations recover the old refusal episode before new evidence", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  assert.equal((await check()).refusalAlerts, 1);
  now += 2 * 60 * 60 * 1000;
  await assert.rejects(plan(), (error) => error.reason === "month"); age();
  assert.equal((await check()).refusalAlerts, 1);
  assert.equal(alerts.filter((entry) => entry.extra.stage === "refusal").length, 2);
});

test("a full matured window of correctly refused requests recovers a refusal episode", async () => {
  await fresh();
  const start = now;
  await assert.rejects(plan(), (error) => error.reason === "month"); age();
  assert.equal((await check()).refusalAlerts, 1);
  const episode = JSON.parse(await redis.get(`${OBS}:observation`)).refusal.id;
  gatewayUsd = 7;
  hourlyRows = [{ hour: "2026-10-14T11:00:00Z", total_cost: 2 }, { hour: "2026-10-14T12:00:00Z", total_cost: 5 }];
  for (const minute of [61, 101, 141]) {
    now = start + minute * 60 * 1000;
    await assert.rejects(plan(), (error) => error.reason === "month");
    now += 31 * 60 * 1000;
    await check();
    if (minute === 61) assert.equal(JSON.parse(await redis.get(`${OBS}:observation`)).refusal.id, episode);
  }
  assert.equal(JSON.parse(await redis.get(`${OBS}:observation`)).refusal, undefined);
  assert.equal(alerts.filter((entry) => entry.extra.stage === "refusal").length, 1);
});


test("legacy visible billing bounds exclude later system spend without adding overlapping tag totals", async () => {
  await fresh(5_000_000, "legacy");
  const middleware = allowance.createSharedAllowanceMiddleware({ allowanceUsd: 5, gatewayApiKey: funding.apiKey,
    fundingSource: funding.source, modelSlug: "test/model" });
  await assert.rejects(middleware.wrapGenerate({
    params: { prompt: [], maxOutputTokens: 256, providerOptions: { gateway: { tags: [`team:${TEAM}`] } } },
    model: {}, doGenerate: async () => { throw new Error("must not infer"); },
  }), (error) => error.reason === "month");
  gatewayUsd = 42; systemUsd = 40;
  hourlyRows = [{ hour: "2026-10-14T11:00:00Z", total_cost: 2 }, { hour: "2026-10-14T13:00:00Z", total_cost: 40 }];
  now = new NativeDate("2026-10-14T14:00:00Z").getTime();
  const result = await check();
  assert.equal(result.refusalAlerts, 1); assert.equal(result.unknown, 0); assert.equal(hourlyCalls, 1);
});

test("fractional-micro hourly costs round once at cumulative bounds, not once per bucket", async () => {
  await fresh(); await assert.rejects(plan(), (error) => error.reason === "month"); age();
  gatewayUsd = 4.7999996;
  hourlyRows = [{ hour: "2026-10-14T10:00:00Z", total_cost: 2.0000002 }, { hour: "2026-10-14T11:00:00Z", total_cost: 2.7999994 }];
  const result = await check();
  assert.equal(result.refusalAlerts, 1); assert.equal(result.unknown, 0);
});
