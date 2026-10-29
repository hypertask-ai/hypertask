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

test("failed recording or index never changes final refusal", async () => {
  await fresh(); redis.failRecording = true;
  await assert.rejects(plan(), (error) => error.reason === "month");
  assert.equal(await redis.get(`${PREFIX}:committed`), "5000000");
  redis.failIndex = true;
  await assert.rejects(plan(), (error) => error.reason === "month");
  assert.equal((await refusalEvents()).length, 0);
});

test("under-cap admission survives failed observation indexing and still takes the same hold", async () => {
  await fresh(0); redis.failIndex = true;
  const reservation = await plan();
  assert.ok((await redis.zrange(`${PREFIX}:reservations`, 0, -1)).includes(reservation.id));
  assert.equal((await refusalEvents()).length, 0);
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
