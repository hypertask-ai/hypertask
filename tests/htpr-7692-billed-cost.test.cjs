const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createServer } = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7692-billed-cost";
const TEAM = "billed-team";
const MONTH = "2026-10";
const DAY = "2026-10-24";
const PREFIX = `ai-allowance:${MONTH}:${TEAM}`;
const BILLED = `ai-allowance-billed:v1:month:${MONTH}:${TEAM}`;
const DAILY = `ai-allowance-billed:v1:day:${DAY}:${TEAM}`;
const INDEX = "ai-allowance-billed:v1:scopes";
const NativeDate = Date;
const nativeFetch = global.fetch;
const nativeInfo = console.info;
const nativeDemoKey = process.env.DEMO_AI_GATEWAY_API_KEY;
let now, redis, enabled, restricted, resync, drift, policy, funding, fundingReads;
let reports, failReport, reportHook, evalHook, logs, alerts, flagActors, evals, spend, daySpend, systemSpend, demoSpend;
const stub = (file, exports) => {
  const filename = fs.realpathSync(path.join(root, file));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub("src/lib/redis.ts", { getRedis: async () => redis });
stub("src/lib/flags.ts", { featureFlagCandidateUserIds: async (key) => {
  assert.equal(key, FLAG); return enabled ? restricted ? [6, 985] : null : [];
}, isFeatureEnabled: async (key, actor) => {
  if (key === FLAG) { flagActors.push(actor); return enabled && (!restricted || actor === 985); }
  if (key === "htpr-7687-allowance-resync") return resync;
  if (key === "htpr-7692-allowance-drift-check") return drift;
  return false;
} });
stub("src/app/api/ai/_lib/byokKeys.ts", { getTeamGatewayFunding: async (lookup, options) => {
  assert.equal(typeof lookup.trustedTeamId, "string");
  assert.equal(lookup.teamId, undefined);
  fundingReads.push(options);
  return funding;
} });
stub("src/lib/errors/reportError.ts", { reportError: async (value) => alerts.push(value) });
stub("src/lib/auth/serverUser.ts", { getServerCookieUser: async () => ({ id: 985, accountId: 7 }) });
stub("src/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess.ts", { default: async () => true });
stub("src/app/api/ai/_lib/planAllowancePolicy.ts", { resolveTeamAllowancePolicy: async () => policy });
stub("src/app/api/ai/_lib/planGate.ts", { storePlanIdForProject: async () => "Free" });
stub("src/lib/prisma.ts", { default: {
  team: { findUnique: async () => ({ title: "Billed team", googleAccount: { userId: 985 }, googleAccountId: 7 }) },
  aiUsage: { groupBy: async () => [] },
  project: { findMany: async () => [] }, task: { findMany: async () => [] }, agent: { findMany: async () => [] },
} });
stub("node_modules/next/server.js", { NextResponse: { json: (body, init) => Response.json(body, init) } });
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const allowance = load(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"));
const { GET: settings } = load(path.join(root, "src/app/api/settings/ai-usage/route.ts"));

function fakeRedis() {
  const values = new Map(), hashes = new Map(), sorted = new Map(), sets = new Map(), expirations = new Map();
  const z = (key) => { if (!sorted.has(key)) sorted.set(key, new Map()); return sorted.get(key); };
  const h = (key) => { if (!hashes.has(key)) hashes.set(key, new Map()); return hashes.get(key); };
  const n = (key) => Number(values.get(key) ?? 0);
  const amount = (member, key) => {
    const encoded = /^[^|]+\|(.+)\|\d+$/.exec(member);
    return encoded ? Number(JSON.parse(encoded[1]).find((scope) => scope[1] === key)?.[3] ?? member.split("|").at(-1)) : Number(member.split("|").at(-1));
  };
  const held = (key) => [...z(key).keys()].reduce((sum, member) => sum + amount(member, key), 0);
  const remember = (committedKey, member, cost, ttl) => {
    values.set(committedKey, String(n(committedKey) + cost));
    expirations.set(committedKey, now + Number(ttl) * 1000);
    if (/^ai-allowance:\d{4}-\d{2}:.+:committed$/.test(committedKey)) {
      const journal = committedKey.replace(/:committed$/, ":recent-settled");
      z(journal).set(`${member}|${cost}`, now);
      if (!values.has(`${journal}-since`)) values.set(`${journal}-since`, String(now));
    }
  };
  const expire = (key, expired) => {
    for (const [member, score] of [...z(key)]) {
      if (score > now) continue;
      const encoded = /^[^|]+\|(.+)\|\d+$/.exec(member);
      assert.ok(encoded, "fixtures requiring expiry encode original scopes");
      const scopes = JSON.parse(encoded[1]);
      let removed = false;
      for (const scope of scopes) if (z(scope[1]).delete(member)) {
        remember(scope[0], member, scope[3] ?? Number(member.split("|").at(-1)), scope[2]); removed = true;
      }
      if (removed && scopes[0][4]) expired.push(scopes[0][4]);
    }
  };
  const client = {
    values, hashes, sorted, sets,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value, ...opts) => {
      if (opts.includes("NX") && values.has(key)) return null;
      values.set(key, String(value));
      if (opts.includes("EX")) expirations.set(key, now + Number(opts[opts.indexOf("EX") + 1]) * 1000);
      return "OK";
    },
    exists: async (key) => Number(values.has(key) || hashes.has(key) || sorted.has(key)),
    del: async (...keys) => keys.reduce((sum, key) => sum + Number(values.delete(key) || hashes.delete(key) || sorted.delete(key)), 0),
    hgetall: async (key) => Object.fromEntries(hashes.get(key) ?? []),
    hget: async (key, field) => hashes.get(key)?.get(field) ?? null,
    hset: async (key, ...pairs) => { for (let i = 0; i < pairs.length; i += 2) h(key).set(pairs[i], String(pairs[i + 1])); return pairs.length / 2; },
    hvals: async (key) => [...(hashes.get(key)?.values() ?? [])],
    ttl: async (key) => expirations.has(key) ? Math.ceil((expirations.get(key) - now) / 1000) : -1,
    zadd: async (key, score, member) => { z(key).set(member, Number(score)); return 1; },
    zrange: async (key, start = 0, end = -1) => {
      const members = [...(sorted.get(key) ?? [])].sort(([a, x], [b, y]) => x - y || a.localeCompare(b)).map(([member]) => member);
      return members.slice(Number(start), Number(end) === -1 ? undefined : Number(end) + 1);
    },
    zrem: async (key, member) => Number(z(key).delete(member)),
    sadd: async (key, member) => { if (!sets.has(key)) sets.set(key, new Set()); sets.get(key).add(member); return 1; },
    sscan: async (key) => ["0", [...(sets.get(key) ?? [])]],
    keys: async () => [...new Set([...values.keys(), ...hashes.keys(), ...sorted.keys(), ...sets.keys()])],
    type: async (key) => values.has(key) ? "string" : hashes.has(key) ? "hash" : sorted.has(key) ? "zset" : sets.has(key) ? "set" : "none",
    smembers: async (key) => [...(sets.get(key) ?? [])],
    eval: async (script, count, ...all) => {
      const keys = all.slice(0, count), args = all.slice(count).map(String);
      if (script.includes('local funding = redis.call("HGET"')) {
        if (values.get(keys[1]) !== args[0] || (h(keys[0]).get("revision") ?? "0") !== args[1]) return 0;
        const saved = h(keys[0]);
        if (saved.get("unusable") === "1") return -1;
        if (saved.has("funding") && saved.get("funding") !== args[2]) { saved.set("unusable", "1"); return -1; }
        await client.hset(keys[0], "funding", args[2], "visible", args[3], "system", args[4], "total", args[5], "fetchedAt", args[6], "revision", Number(args[1]) + 1);
        expirations.set(keys[0], now + Number(args[7]) * 1000); return 1;
      }
      if (script.includes("local details = {}")) {
        const scopes = JSON.parse(args[0]), details = [], expired = [];
        let refused = 0;
        for (const scope of scopes) {
          if (now >= scope.endsAt) return "period-rolled";
          const saved = await client.hgetall(scope.source.key);
          const billed = scope.source.mode === "billed" && saved.funding === scope.source.funding && saved.unusable !== "1" && now - Number(saved.fetchedAt ?? 0) <= 15 * 60_000 && saved[scope.field] !== undefined;
          if ((!billed || scope.reason !== "month") && !values.has(scope.seedKey)) return "shadow-uninitialized";
        }
        for (const [i, scope] of scopes.entries()) {
          let total = scope.pending ? n(keys[scope.pending - 1]) : 0, holds = 0;
          for (const [c, r] of scope.pairs) { expire(keys[r - 1], expired); total += n(keys[c - 1]); holds += held(keys[r - 1]); }
          const saved = await client.hgetall(scope.source.key);
          let mode = "v1";
          if (scope.source.mode === "billed" && saved.funding === scope.source.funding && saved.unusable !== "1" && now - Number(saved.fetchedAt ?? 0) <= 15 * 60_000 && saved[scope.field] !== undefined) {
            total = Number(saved[scope.field]); mode = "billed";
          }
          details.push({ scope: scope.source.key, mode, billed: total, holds, requested: Number(args[2]), cap: scope.cap });
          if (total + holds + Number(args[2]) > scope.cap && !refused) refused = -i - 1;
        }
        if (!refused) for (const scope of scopes) z(keys[scope.pairs[scope.writeIndex - 1][1] - 1]).set(args[4], Number(args[3]));
        for (const scope of scopes) {
          await client.set(`${scope.source.key}:actor`, args[7], "EX", scope.billedTtlSeconds);
          if (scope.reason === "demo") z(args[5]).set(args[8], now);
        }
        z(args[5]).set(args[6], now);
        return [refused || 1, JSON.stringify(details), JSON.stringify(expired)];
      }
      if (script.includes('local scopes = cjson.decode(ARGV[1])')) {
        const scopes = JSON.parse(args[0]);
        if (script.includes("local amount =")) {
          const expired = [];
          for (const [i, scope] of scopes.entries()) {
            for (const [, r] of scope.pairs) expire(keys[r - 1], expired);
            const total = scope.pairs.reduce((sum, [c]) => sum + n(keys[c - 1]), scope.pending ? n(keys[scope.pending - 1]) : 0);
            const holds = scope.pairs.reduce((sum, [, r]) => sum + held(keys[r - 1]), 0);
            if (total + holds + Number(args[2]) > scope.cap) return expired.length ? [-i - 1, total, holds, JSON.stringify(expired)] : args[5] === "1" ? [-i - 1, total, holds] : -i - 1;
          }
          for (const scope of scopes) z(keys[scope.pairs[scope.writeIndex - 1][1] - 1]).set(args[4], Number(args[3]));
          return expired.length ? [1, 0, 0, JSON.stringify(expired)] : 1;
        }
        let removed = 0;
        for (const [c, r, ttl] of scopes) if (z(keys[r - 1]).delete(args[1])) { remember(keys[c - 1], args[1], Number(args[2]), ttl); removed++; }
        return removed;
      }
      if (script.includes("local remaining =")) {
        const expired = [];
        if (script.includes('redis.call("ZRANGEBYSCORE", KEYS[2]')) expire(keys[1], expired);
        let committed = n(keys[0]), mode = "v1";
        if (keys.length === 3 && h(keys[2]).get("funding") === args[2] && h(keys[2]).get("unusable") !== "1" && now - Number(h(keys[2]).get("fetchedAt") ?? 0) <= 15 * 60_000 && h(keys[2]).has("total")) {
          committed = Number(h(keys[2]).get("total")); mode = "billed";
        }
        if (script.includes('return "shadow-uninitialized"') && mode === "v1" && !values.has(keys[0].replace(/:committed$/, ":seeded"))) return "shadow-uninitialized";
        const remaining = Number(args[0]) - committed - held(keys[1]);
        if (script.includes(", mode,")) return [remaining, committed, held(keys[1]), mode, JSON.stringify(expired)];
        return args[1] === "1" ? [remaining, committed, held(keys[1])] : remaining;
      }
      if (script.includes("local requested =")) {
        const expired = []; expire(keys[1], expired);
        const total = n(keys[0]) + (args[6] === "1" ? n(keys[2]) : 0), holds = held(keys[1]);
        if (total + holds + Number(args[1]) > Number(args[2])) return expired.length ? [0, total, holds, JSON.stringify(expired)] : args[7] === "1" ? [0, total, holds] : 0;
        z(keys[1]).set(args[4], Number(args[3])); return expired.length ? [1, total, holds, JSON.stringify(expired)] : 1;
      }
      if (script.includes("local removed =")) {
        if (!z(keys[1]).delete(args[0])) return 0;
        remember(keys[0], args[0], Number(args[1]), args[2]); return 1;
      }
      if (script.includes("local resynced =")) {
        const committed = n(keys[0]), observed = Math.max(Number(args[0]) - (keys[3] ? n(keys[3]) : 0), 0);
        if (!values.has(keys[2])) values.set(keys[2], args[4]);
        let recent = 0;
        for (const [member, score] of [...z(keys[1])]) if (score < Number(args[1])) z(keys[1]).delete(member); else recent += Number(member.split("|").at(-1));
        const next = n(keys[2]) <= Number(args[2]) ? Math.max(observed, Math.min(committed, observed + recent)) : Math.max(observed, committed);
        values.set(keys[0], String(next)); return committed - next;
      }
      if (script.includes("local initialized =")) {
        if (values.has(keys[2])) return 0;
        values.set(keys[2], args[4]); values.set(keys[3], String(Math.max(n(keys[0]) - Number(args[0]), 0)));
        values.set(keys[0], args[1]); values.set(keys[1], args[2]); values.set(keys[4], args[3]); return 1;
      }
      if (script.includes('if not redis.call("SET", KEYS[2]')) {
        if (values.has(keys[1])) return 0;
        values.set(keys[1], "1");
        if (args[2] !== "1" || !values.has(keys[0])) values.set(keys[0], String((args[2] === "1" ? 0 : n(keys[0])) + Number(args[0])));
        return 1;
      }
      if (script.includes("local visible =")) {
        if (script.includes('redis.call("EXISTS", KEYS[4])') && (!values.has(keys[3]) || !values.has(keys[0]) || !values.has(keys[1]))) return null;
        if (script.includes('redis.call("EXISTS", KEYS[3])') && (!values.has(keys[2]) || !values.has(keys[0]))) return null;
        if (!values.has(keys[0]) && !values.has(keys[1])) return null;
        return script.includes("return {visible") ? keys.map((key) => values.get(key) ?? "0") : keys.slice(0, script.includes("local system =") ? 3 : 2).reduce((sum, key) => sum + n(key), 0);
      }
      if (script.trim().startsWith('return tonumber(redis.call("GET"')) return keys.reduce((sum, key) => sum + n(key), 0);
      if (script.includes('~= ARGV[1]')) {
        if (values.get(keys[0]) !== args[0]) return 0;
        values.set(keys[1], args[1]); return 1;
      }
      if (script.includes('== ARGV[1]')) return values.get(keys[0]) === args[0] ? Number(values.delete(keys[0])) : 0;
      throw new Error(`Unsupported fake Redis script: ${script.slice(0, 100)}`);
    },
  };
  return client;
}

function fetchFixture() {
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "test/model", pricing: { input: "0", output: "0.000032916666625" } }] });
    const params = new URL(String(url)).searchParams;
    reports.push({ start: params.get("start_date"), end: params.get("end_date"), tags: params.get("tags"), signal: options.signal });
    if (reportHook) await reportHook(url, options);
    if (failReport) throw new Error("PRIVATE provider failure must not escape into telemetry");
    const total = params.get("start_date") === params.get("end_date") ? daySpend : spend;
    if (!params.has("tags")) return Response.json({ results: [{ total_cost: demoSpend / 1e6 }] });
    if (params.get("group_by") === "model") return Response.json({ results: [] });
    if (params.get("group_by") === "day") return Response.json({ results: [{ total_cost: total / 1e6 }] });
    return Response.json({ results: [{ tag: params.get("tags"), total_cost: total / 1e6 }, { tag: "included-with-hypertask", total_cost: systemSpend / 1e6 }] });
  };
}
const plan = (amountMicroUsd = 20_000, overrides = {}) => allowance.reservePlanAllowance({ teamId: TEAM,
  gatewayApiKey: funding.apiKey, fundingSource: funding.source, userId: 985, policy, amountUsd: amountMicroUsd / 1e6, amountMicroUsd, ...overrides });
const effective = async (kind = "month", period = kind === "month" ? MONTH : DAY) => allowance.effectiveAccountingSource({ teamId: TEAM,
  kind, period, funding: await allowance.resolveBilledFunding({ teamId: TEAM, gatewayApiKey: funding.apiKey, fundingSource: funding.source }) });
const params = (signal, user = 985) => ({ prompt: [], maxOutputTokens: 16_000, abortSignal: signal,
  providerOptions: { gateway: { tags: [`team:${TEAM}`, ...(user === null ? [] : [`user:${user}`])] } } });
const middleware = (withPolicy = false) => allowance.createSharedAllowanceMiddleware({ allowanceUsd: 1, gatewayApiKey: funding.apiKey,
  fundingSource: funding.source, modelSlug: "test/model", ...(withPolicy ? { resolvePolicy: async () => policy } : {}) });
const decisions = () => logs.filter((entry) => entry.event === "ai-allowance-billed-decision");
const releases = () => logs.filter((entry) => entry.event === "ai-allowance-billed-release");
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function warm(team = TEAM, month = MONTH, committed = 900_000) {
  const prefix = `ai-allowance:${month}:${team}`;
  await redis.set(`${prefix}:system-split-v1`, String(now));
  await redis.set(`${prefix}:legacy-reconcile-complete`, "1");
  await redis.set(`${prefix}:committed`, String(committed));
  await redis.set(`${prefix}:system:committed`, "0");
  await redis.set(`ai-allowance:day:${new Date(now).toISOString().slice(0, 10)}:${team}:seeded`, "1");
}
async function settingsUsed() {
  const response = await settings(new Request(`https://app.hypertask.ai/api/settings/ai-usage?teamId=${TEAM}`));
  assert.equal(response.status, 200);
  return Math.round((await response.json()).allowance.usedUsd * 1e6);
}

for (const backend of ["fake", "real Redis"]) {
  test.describe(backend, { skip: backend === "real Redis" && spawnSync("redis-server", ["--version"]).status !== 0 }, () => {
    let connection, server;
    test.before(async () => {
      if (backend === "fake") return;
      const port = await new Promise((resolve) => {
        const probe = createServer();
        probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
      });
      server = spawn("redis-server", ["--bind", "127.0.0.1", "--port", String(port), "--save", "", "--appendonly", "no"]);
      await new Promise((resolve, reject) => {
        let output = "";
        server.stdout.on("data", (chunk) => { output += chunk; if (output.includes("Ready to accept connections")) resolve(); });
        server.once("error", reject); server.once("exit", (code) => reject(new Error(`Redis exited ${code}`)));
      });
      const Redis = require("ioredis");
      connection = new Redis({ host: "127.0.0.1", port });
    });
    test.after(() => { connection?.disconnect(); server?.kill("SIGTERM"); });
    test.beforeEach(async () => {
      now = new NativeDate("2026-10-24T12:00:00Z").getTime();
      global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
      redis = backend === "fake" ? fakeRedis() : connection;
      if (connection) await connection.flushall();
      enabled = true; restricted = false; resync = false; drift = false;
      policy = { mode: "plan", monthlyUsd: 1, dailyUsd: null, demoGlobal: false };
      funding = { source: "managed", apiKey: "fixture-private-gateway-credential", managedKeyId: "managed-row-7", managedKeyUpdatedAt: "2026-10-01T00:00:00Z" };
      fundingReads = []; reports = []; logs = []; alerts = []; flagActors = []; evals = [];
      spend = 100_000; daySpend = 10_000; systemSpend = 0; demoSpend = 100_000;
      failReport = false; reportHook = null; evalHook = null;
      console.info = (line) => logs.push(JSON.parse(line));
      process.env.DEMO_AI_GATEWAY_API_KEY = "fixture-private-demo-credential";
      const originalEval = backend === "fake" ? redis.eval.bind(redis) : Object.getPrototypeOf(connection).eval.bind(redis);
      redis.eval = async (script, ...args) => {
        const entry = { script, args }; evals.push(entry);
        if (evalHook) await evalHook(script, ...args);
        const fixtureClock = `{${Math.floor(now / 1000)}, ${(now % 1000) * 1000}}`;
        entry.result = await originalEval(script.replace('redis.call("TIME")', fixtureClock), ...args);
        return entry.result;
      };
      allowance.resetGatewayPricingCacheForTests();
      fetchFixture();
      await warm();
    });
    test.afterEach(() => {
      global.Date = NativeDate; global.fetch = nativeFetch; console.info = nativeInfo;
      if (nativeDemoKey === undefined) delete process.env.DEMO_AI_GATEWAY_API_KEY; else process.env.DEMO_AI_GATEWAY_API_KEY = nativeDemoKey;
    });

    for (const rollover of ["month", "day", "legacy month"]) {
      test(`F2: ${rollover} rollover after JS check inserts no old hold and retries current scopes`, async () => {
        now = new NativeDate(rollover === "day" ? "2026-10-24T23:59:59Z" : "2026-10-31T23:59:59Z").getTime();
        if (rollover === "day") policy.dailyUsd = 1;
        let crossed = false;
        evalHook = (script) => {
          if (!crossed && script.includes("local details = {}")) { now += 2000; crossed = true; }
        };
        if (rollover === "legacy month") {
          await middleware().wrapGenerate({ params: params(), model: {}, doGenerate: async () => ({}) });
        } else {
          const reservation = await plan(800_000);
          assert.ok(reservation.id.includes(rollover === "day" ? "ai-allowance:day:2026-10-25:" : "ai-allowance:2026-11:"));
          await allowance.settlePlanAllowance(reservation, 0);
        }
        const reservations = evals.filter(({ script }) => script.includes("local details = {}"));
        assert.equal(reservations.length, 2);
        assert.equal(reservations[0].result, "period-rolled");
        assert.match(reservations[0].script, /redis.call\("TIME"\)/);
        const oldKeys = JSON.parse(reservations[0].args[reservations[0].args[0] + 1]).flatMap((scope) => scope.pairs.map(([, r]) => reservations[0].args[r]));
        for (const key of oldKeys) assert.deepEqual(await redis.zrange(key, 0, -1), []);
        assert.equal(decisions().at(-1).decision, "allow");
        assert.ok(!decisions().some((entry) => entry.scope === (rollover === "day" ? DAILY : BILLED)));
      });
    }

    test("F2: a second Lua rollover fails closed after exactly one retry", async () => {
      evalHook = (script, count, ...args) => {
        if (script.includes("local details = {}")) now = JSON.parse(args[count])[0].endsAt + 1;
      };
      await assert.rejects(plan(), /AI allowance unavailable: period-rolled/);
      assert.equal(evals.filter(({ result }) => result === "period-rolled").length, 2);
      for (const key of (await redis.keys("*")).filter((key) => key.endsWith(":reservations"))) assert.deepEqual(await redis.zrange(key, 0, -1), []);
    });

    for (const scope of ["day", "demo"]) {
      test(`F3: ${scope} shadow seeds before admission and $0.10 settlement plus late seed stays $0.10`, async () => {
        const prefix = scope === "day" ? `ai-allowance:day:${DAY}:${TEAM}` : `ai-allowance:demo:${MONTH}`;
        await redis.del(`${prefix}:seeded`, `${prefix}:committed`);
        daySpend = 0; demoSpend = 0;
        const overrides = { policy: { ...policy, dailyUsd: scope === "day" ? 1 : null, demoGlobal: scope === "demo" } };
        let matchingReports = 0;
        reportHook = (url) => {
          const query = new URL(String(url)).searchParams;
          if (scope === "day" ? query.get("start_date") === query.get("end_date") : !query.has("tags")) {
            if (++matchingReports > 1) throw new Error("fixture redundant seed report failure");
          }
        };
        const first = await plan(100_000, overrides);
        assert.equal(await redis.get(`${prefix}:seeded`), "1");
        await allowance.settlePlanAllowance(first, 0.1);
        assert.equal(await redis.get(`${prefix}:committed`), "100000");
        reportHook = null; daySpend = 100_000; demoSpend = 100_000; now += 60_001;
        await redis.del(`${prefix}:seeded`);
        const next = await plan(0, overrides);
        assert.equal(await redis.get(`${prefix}:committed`), "100000");
        assert.equal(await redis.get(`${prefix}:seeded`), "1");
        await allowance.settlePlanAllowance(next, 0);
      });

      test(`F3: ${scope} failed shadow seed cannot admit a billed call`, async () => {
        const prefix = scope === "day" ? `ai-allowance:day:${DAY}:${TEAM}` : `ai-allowance:demo:${MONTH}`;
        await redis.del(`${prefix}:seeded`, `${prefix}:committed`);
        evalHook = (script, _count, key) => {
          if (script.includes('if not redis.call("SET", KEYS[2]') && key === `${prefix}:committed`) throw new Error("fixture seed unavailable");
        };
        await assert.rejects(plan(100_000, { policy: { ...policy, dailyUsd: scope === "day" ? 1 : null, demoGlobal: scope === "demo" } }), /fixture seed unavailable/);
        assert.deepEqual(await redis.zrange(`${prefix}:reservations`, 0, -1), []);
        assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
      });
    }

    for (const scope of ["month", "day", "demo", "legacy month"]) {
      test(`F4: ${scope} billed invalidation before Lua requires atomic v1 seed and recovers fail-closed`, async () => {
        const prefix = scope === "day" ? `ai-allowance:day:${DAY}:${TEAM}` : scope === "demo" ? `ai-allowance:demo:${MONTH}` : PREFIX;
        const snapshot = scope === "day" ? DAILY : scope === "demo" ? `ai-allowance-billed:v1:month:${MONTH}:demo` : BILLED;
        const marker = scope.includes("month") ? `${prefix}:system-split-v1` : `${prefix}:seeded`;
        const overrides = { policy: { ...policy, dailyUsd: scope === "day" ? 1 : null, demoGlobal: scope === "demo" } };
        let invalidated = false;
        evalHook = async (script) => {
          if (!invalidated && script.includes("local details = {}")) {
            invalidated = true;
            await redis.del(marker, `${prefix}:committed`, `${prefix}:system:committed`);
            await redis.hset(snapshot, "unusable", "1");
            failReport = true;
          }
        };
        const invoke = () => scope === "legacy month"
          ? middleware().wrapGenerate({ params: params(), model: {}, doGenerate: async () => ({}) })
          : plan(20_000, overrides);
        await assert.rejects(invoke(), (error) => !(error instanceof allowance.SharedAiAllowanceExceededError));
        assert.equal(evals.find(({ script }) => script.includes("local details = {}")).result, "shadow-uninitialized");
        assert.deepEqual(await redis.zrange(`${prefix}:reservations`, 0, -1), []);
        assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
        assert.equal(decisions().length, 0);
        evalHook = null; failReport = false;
        const recovered = await invoke();
        assert.equal(await redis.exists(marker), 1);
        const decision = decisions().findLast((entry) => entry.scope === snapshot);
        assert.equal(decision.mode, "v1"); assert.equal(decision.billed, scope === "day" ? daySpend : scope === "demo" ? demoSpend : spend);
        if (scope !== "legacy month") await allowance.settlePlanAllowance(recovered, 0);
      });
    }

    test("F4: prolonged report outage expires billed snapshots and enforces settled v1 spend", async () => {
      const first = await plan(100_000);
      await allowance.settlePlanAllowance(first, 0.1);
      failReport = true;
      now += 60_001;
      assert.equal((await effective()).mode, "billed");
      now += 15 * 60_000;
      assert.equal((await effective()).mode, "v1");
      await assert.rejects(plan(1), (error) => error.reason === "month");
      assert.equal(decisions().at(-1).mode, "v1");
      assert.equal(decisions().at(-1).billed, 1_000_000);
      assert.equal(await redis.hget(BILLED, "total"), "100000");
    });

    test("F4: snapshot aging after source selection atomically falls back before inserting a hold", async () => {
      let aged = false;
      evalHook = (script) => {
        if (!aged && script.includes("local details = {}")) { now += 15 * 60_000 + 1; aged = true; failReport = true; }
      };
      await assert.rejects(plan(200_000), (error) => error.reason === "month");
      assert.equal(decisions().at(-1).mode, "v1");
      assert.equal(decisions().at(-1).billed, 900_000);
      assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
    });

    for (const mode of ["plan", "legacy"]) {
      test(`F5: ${mode} cold and Redis-lost Settings equals initialized admission when billed refresh fails`, async () => {
        policy = { ...policy, mode }; systemSpend = 20_000;
        reportHook = (_url, options) => { if (options.signal) throw new Error("fixture bounded refresh unavailable"); };
        for (const state of ["cold", "Redis loss"]) {
          const keys = (await redis.keys("*")).filter((key) => key.startsWith("ai-allowance:") || key.startsWith("ai-allowance-billed:"));
          if (keys.length) await redis.del(...keys);
          const used = await settingsUsed();
          assert.equal(used, mode === "plan" ? 100_000 : 80_000, state);
          if (mode === "plan") await plan();
          else await middleware().wrapGenerate({ params: { ...params(), maxOutputTokens: 256 }, model: {}, doGenerate: async () => ({}) });
          assert.equal(decisions().at(-1).mode, "v1");
          assert.equal(used, decisions().at(-1).billed, state);
        }
      });

      test(`F5: ${mode} Settings retains fetched Gateway spend when cold shadow initialization also fails`, async () => {
        policy = { ...policy, mode }; systemSpend = 20_000;
        const keys = (await redis.keys("*")).filter((key) => key.startsWith("ai-allowance:"));
        if (keys.length) await redis.del(...keys);
        let reads = 0;
        reportHook = () => { if (++reads > 3) throw new Error("fixture reports unavailable after Settings fetch"); };
        const used = await settingsUsed();
        assert.equal(used, mode === "plan" ? 100_000 : 80_000);
        assert.equal(await redis.get(`${PREFIX}:system-split-v1`), null);
        if (mode === "plan") await assert.rejects(plan());
        else await assert.rejects(middleware().wrapGenerate({ params: params(), model: {}, doGenerate: async () => { throw new Error("must not infer"); } }));
        assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
        reportHook = (_url, options) => { if (options.signal) throw new Error("fixture bounded refresh unavailable"); };
        if (mode === "plan") await plan();
        else await middleware().wrapGenerate({ params: { ...params(), maxOutputTokens: 256 }, model: {}, doGenerate: async () => ({}) });
        assert.equal(used, decisions().at(-1).billed);
      });
    }

    test("T1: abort releases exactly 800000 live hold; only report adds 13000; next admission uses 113000", async () => {
      const abort = new AbortController();
      let source;
      const result = await middleware().wrapStream({ params: params(abort.signal), model: {}, doStream: async () => ({ stream: new ReadableStream({ start(controller) { source = controller; } }) }) });
      const members = await redis.zrange(`${PREFIX}:reservations`, 0, -1);
      assert.equal(members.length, 1); assert.equal(Number(members[0].split("|").at(-1)), 800_000);
      enabled = false; abort.abort("PRIVATE stop reason"); await turn(); enabled = true;
      assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
      assert.equal((await effective()).total, 100_000);
      assert.equal(releases().length, 1); assert.equal(releases()[0].reason, "stop");
      assert.equal(releases()[0].userId, 985); assert.equal(releases()[0].reservationId, members[0].split("|")[0]);
      spend = 113_000; now += 60_001;
      assert.equal((await effective()).total, 113_000);
      await assert.rejects(plan(890_000), (error) => error.reason === "month");
      const next = await plan(887_000); assert.ok(next.id);
      assert.equal(decisions().at(-1).billed, 113_000);
      source.close(); await result.stream.cancel();
      assert.equal(releases().length, 1);
    });

    test("T2: finishing 60000 estimate changes shadow only; report contributes exactly 21000", async () => {
      const reservation = await plan(60_000);
      await allowance.settlePlanAllowance(reservation, 0.06);
      assert.equal(await redis.get(`${PREFIX}:committed`), "960000");
      assert.equal((await effective()).total, 100_000);
      assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
      spend = 121_000; now += 60_001;
      assert.equal((await effective()).total, 121_000);
      await plan(879_000); assert.equal(decisions().at(-1).billed, 121_000);
      assert.equal(releases()[0].reason, "finish");
    });

    test("T3: two refreshes without late bill admit under-cap calls; third includes it once", async () => {
      await effective();
      for (let i = 0; i < 2; i++) {
        now += 60_001; assert.equal((await effective()).total, 100_000);
        const reservation = await plan(850_000); await allowance.settlePlanAllowance(reservation, 0.2);
      }
      spend = 113_000; now += 60_001; assert.equal((await effective()).total, 113_000);
      now += 60_001; assert.equal((await effective()).total, 113_000);
      assert.equal(await redis.hget(BILLED, "total"), "113000");
    });

    test("T5/V3: outage retains valid snapshot; missing/Redis-lost snapshot selects v1, not holds-only, with deduped alert", async () => {
      await effective(); failReport = true; now += 60_001;
      assert.equal((await effective()).total, 100_000);
      const retained = await plan(200_000); await allowance.settlePlanAllowance(retained, 0);
      assert.equal(await redis.get(`${BILLED}:lease`), null);
      await redis.del(BILLED);
      await assert.rejects(plan(200_000), (error) => error.reason === "month");
      await assert.rejects(plan(200_000), (error) => error.reason === "month");
      assert.equal(decisions().at(-1).mode, "v1"); assert.equal(decisions().at(-1).billed, 900_000);
      assert.equal(alerts.filter((entry) => entry.message.includes("snapshot-unavailable")).length, 0);
      assert.equal(alerts.filter((entry) => entry.message.includes("report-failed")).length, 1);
      assert.equal(await redis.get(`${PREFIX}:committed`), "900000");
      await redis.del(`${PREFIX}:system-split-v1`);
      await assert.rejects(plan(20_000), (error) => !(error instanceof allowance.SharedAiAllowanceExceededError));
      failReport = false;
      assert.equal((await effective()).total, 100_000);
    });

    test("T6/V6: Free 250000 daily cap reads billed plus live holds; output clamp ignores inflated daily shadow", async () => {
      policy.dailyUsd = 0.25;
      await redis.set(`ai-allowance:day:${DAY}:${TEAM}:committed`, "900000");
      const exact = await plan(240_000); assert.equal(decisions().at(-1).cap, 250_000);
      assert.equal(decisions().at(-1).billed, 10_000);
      await assert.rejects(plan(1), (error) => error.reason === "day");
      await allowance.settlePlanAllowance(exact, 0.06);
      const callParams = params(); let seen;
      await middleware(true).wrapGenerate({ params: callParams, model: {}, doGenerate: async () => { seen = callParams.maxOutputTokens; return {}; } });
      assert.equal(seen, 4658);
      const daily = decisions().findLast((entry) => entry.scope === DAILY);
      assert.equal(daily.billed, 10_000); assert.equal(daily.requested, 239_989); assert.equal(daily.cap, 250_000);
      daySpend = 230_000; now += 60_001;
      await assert.rejects(middleware(true).wrapGenerate({ params: params(), model: {}, doGenerate: async () => { throw new Error("must not infer"); } }), (error) => error.reason === "day");
      assert.equal(decisions().at(-1).billed, 230_000); assert.equal(decisions().at(-1).requested, 22_640);
    });

    test("T7/V6/V10: actual Settings route equals admission for billed, missing and funding-pinned v1 sources", async () => {
      await plan(); assert.equal(await settingsUsed(), decisions().at(-1).billed);
      assert.equal(await settingsUsed(), 100_000);
      await redis.del(BILLED);
      reportHook = (_url, options) => { if (options.signal) throw new Error("fixture bounded report failure"); };
      await plan(); assert.equal(decisions().at(-1).mode, "v1");
      assert.equal(await settingsUsed(), decisions().at(-1).billed); assert.equal(await settingsUsed(), 900_000);
      reportHook = null; await effective();
      funding = { ...funding, managedKeyUpdatedAt: "2026-10-24T12:00:01Z" };
      await plan(); assert.equal(decisions().at(-1).mode, "v1");
      assert.equal(await settingsUsed(), 900_000);
      policy = { ...policy, mode: "legacy" };
      await redis.set(`${PREFIX}:legacy-pending`, "12345");
      await middleware().wrapGenerate({ params: { ...params(), maxOutputTokens: 256 }, model: {}, doGenerate: async () => ({ usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } }) });
      assert.equal(await settingsUsed(), 912_345); assert.equal(decisions().at(-1).billed, 912_345);
    });

    test("T8/V5: flag Off retains estimate/plan/demo semantics and writes no billed keys; QA/system actor policy matches resync", async () => {
      enabled = false;
      await assert.rejects(plan(200_000), (error) => error.reason === "month");
      const reservation = await plan(20_000); await allowance.settlePlanAllowance(reservation, 0.01);
      assert.equal(await redis.get(`${PREFIX}:committed`), "910000");
      await redis.set(`ai-allowance:demo:${MONTH}:seeded`, "1");
      const demo = await plan(10_000, { teamId: undefined, policy: { ...policy, demoGlobal: true } });
      await allowance.settlePlanAllowance(demo, 0.02);
      assert.equal(await redis.get(`ai-allowance:demo:${MONTH}:committed`), "20000");
      assert.deepEqual((await redis.keys("*")).filter((key) => key.startsWith("ai-allowance-billed:")), []);
      assert.equal(fundingReads.length, 0); assert.equal(releases().length, 0); assert.equal(decisions().length, 0);
      enabled = true; restricted = true;
      const system = await plan(20_000, { userId: undefined });
      assert.equal(system.billedCall, undefined); assert.ok(flagActors.includes(0));
      const qa = await plan(20_000); assert.ok(qa.billedCall); assert.ok(flagActors.includes(985));
      enabled = false; await allowance.settlePlanAllowance(qa, 0.01);
      assert.ok(releases().some((entry) => entry.reservationId === qa.billedCall.reservationId));
    });

    test("T9/V4: source, managed row and updatedAt changes pin original period to v1; never overwrite retained billed baseline", async () => {
      await effective();
      const original = await redis.hgetall(BILLED);
      funding = { ...funding, managedKeyUpdatedAt: "2026-10-24T12:01:00Z" }; spend = 1;
      assert.equal((await effective()).mode, "v1");
      assert.equal(await redis.hget(BILLED, "total"), "100000"); assert.equal(await redis.hget(BILLED, "funding"), original.funding);
      assert.equal(await redis.hget(BILLED, "unusable"), "1");
      funding = { ...funding, managedKeyUpdatedAt: "2026-10-01T00:00:00Z" };
      assert.equal((await effective()).mode, "v1");
      await effective(); assert.equal(alerts.filter((entry) => entry.message.includes("funding-changed")).length, 1);
      for (const change of [{ managedKeyId: "managed-row-8" }, { source: "shared" }]) {
        await redis.del(BILLED); await effective(); funding = { ...funding, ...change };
        assert.equal((await effective()).mode, "v1"); assert.equal(await redis.hget(BILLED, "unusable"), "1");
      }
      const stored = [];
      for (const key of await redis.keys("*")) {
        const type = await redis.type(key);
        stored.push(key, type === "string" ? await redis.get(key) : type === "hash" ? JSON.stringify(await redis.hgetall(key)) : type === "zset" ? JSON.stringify(await redis.zrange(key, 0, -1)) : JSON.stringify(await redis.smembers(key)));
      }
      const output = JSON.stringify([stored, logs, alerts]);
      assert.ok(!output.includes(funding.apiKey)); assert.ok(!output.includes(process.env.DEMO_AI_GATEWAY_API_KEY));
      assert.ok(!output.includes("PRIVATE")); assert.ok(!output.includes("Authorization"));
      assert.ok(fundingReads.some((value) => value?.includeProvenance));
    });

    test("T10/V8: disconnect continues inference with hold; explicit stop before doStream resolves releases immediately and once", { timeout: 5000 }, async () => {
      let source;
      const result = await middleware().wrapStream({ params: params(), model: {}, doStream: async () => ({ stream: new ReadableStream({ start(controller) { source = controller; } }) }) });
      const reader = result.stream.getReader();
      source.enqueue({ type: "text-delta", delta: "fixture" }); await reader.read();
      assert.equal((await redis.zrange(`${PREFIX}:reservations`, 0, -1)).length, 1);
      assert.equal(releases().length, 0);
      source.enqueue({ type: "finish", usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } });
      await reader.read(); source.close(); await reader.read();
      assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
      assert.equal(releases().length, 1); assert.equal(releases()[0].reason, "finish");
      const abort = new AbortController(); let complete, started;
      const ready = new Promise((resolve) => { started = resolve; });
      const pending = middleware().wrapStream({ params: params(abort.signal, 986), model: {}, doStream: () => new Promise((resolve) => { complete = resolve; started(); }) });
      await ready;
      const member = (await redis.zrange(`${PREFIX}:reservations`, 0, -1))[0];
      const released = new Promise((resolve) => {
        console.info = (line) => {
          const entry = JSON.parse(line);
          logs.push(entry);
          if (entry.event === "ai-allowance-billed-release" && entry.reason === "stop") resolve();
        };
      });
      abort.abort("PRIVATE before first token"); await released;
      assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
      assert.ok(releases().some((entry) => entry.reservationId === member.split("|")[0] && entry.userId === 986 && entry.reason === "stop"));
      complete({ stream: new ReadableStream({ start(controller) { controller.close(); } }) });
      const stopped = await pending; await stopped.stream.getReader().read();
      assert.equal(releases().length, 2);
      assert.ok(!JSON.stringify(logs).includes("PRIVATE"));
    });

    test("V7: report owns 3000ms signal, keeps retained snapshot on timeout, releases lease, and cannot commit with stale lease/revision", async () => {
      const timeout = AbortSignal.timeout;
      const durations = [];
      AbortSignal.timeout = (ms) => { durations.push(ms); return timeout(ms); };
      try {
        await effective(); now += 60_001;
        reportHook = async (_url, options) => { assert.ok(options.signal instanceof AbortSignal); throw new Error("fixture timeout"); };
        assert.equal((await effective()).total, 100_000);
        assert.ok(durations.every((ms) => ms === 3000)); assert.equal(await redis.get(`${BILLED}:lease`), null);
        assert.equal(logs.at(-1).outcome, "failed");
        reportHook = null; await effective();
        const call = evals.find(({ script }) => script.includes('local funding = redis.call("HGET"'));
        const [, key, lease, token, revision, ...rest] = call.args;
        await redis.set(lease, "new-owner");
        assert.equal(await redis.eval(call.script, 2, key, lease, token, revision, ...rest), 0);
        await redis.set(lease, token);
        assert.equal(await redis.eval(call.script, 2, key, lease, token, revision, ...rest), 0);
        assert.equal(await redis.hget(BILLED, "total"), "100000");
        await redis.del(lease); now += 60_001;
        reportHook = async () => { await redis.set(lease, "replacement-owner"); };
        assert.equal((await effective()).total, 100_000);
        assert.equal(await redis.get(lease), "replacement-owner");
      } finally { AbortSignal.timeout = timeout; }
    });

    test("V8: expiry settles shadow only and emits one correlated expiry; finish/error/EOF/cancel release once", async () => {
      const old = await plan(800_000); now += 600_001;
      const next = await plan(20_000);
      assert.equal(await redis.get(`${PREFIX}:committed`), "1700000");
      assert.equal(decisions().at(-1).billed, 100_000); assert.equal(decisions().at(-1).holds, 0);
      assert.equal(releases().filter((entry) => entry.reason === "expiry").length, 1);
      assert.equal(releases()[0].reservationId, old.billedCall.reservationId);
      await allowance.settlePlanAllowance(old, 0.06); assert.equal(releases().length, 1);
      await allowance.settlePlanAllowance(next, 0);
      for (const reason of ["eof", "error", "cancel"]) {
        let controller;
        const result = await middleware().wrapStream({ params: params(), model: {}, doStream: async () => ({ stream: new ReadableStream({ start(value) { controller = value; } }) }) });
        if (reason === "cancel") await result.stream.cancel();
        else {
          if (reason === "error") controller.error(new Error("fixture provider error")); else controller.close();
          const read = result.stream.getReader().read();
          if (reason === "error") await assert.rejects(read); else await read;
        }
        assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
        assert.equal(releases().at(-1).reason, reason === "cancel" ? "stop" : reason);
      }
    });

    test("V5/V10: Everyone system calls use the existing actor-0 policy and numeric audit identity", async () => {
      const reservation = await plan(20_000, { userId: null });
      assert.equal(reservation.billedCall.userId, 0); assert.equal(decisions().at(-1).userId, 0);
      assert.ok(flagActors.includes(0));
      await allowance.settlePlanAllowance(reservation, 0);
      assert.equal(releases().at(-1).userId, 0);
    });

    test("image and legacy lane admission use the same billed authority and trusted actor", async () => {
      const image = allowance.createImageAllowanceMiddleware({ allowanceUsd: 1, gatewayApiKey: funding.apiKey,
        fundingSource: funding.source, modelSlug: "test/model" });
      await image.wrapGenerate({ params: { prompt: [], n: 1, providerOptions: params().providerOptions }, model: {}, doGenerate: async () => ({}) });
      assert.equal(decisions().at(-1).billed, 100_000); assert.equal(decisions().at(-1).requested, 800_000);
      assert.equal(releases().at(-1).reason, "finish");
      assert.equal(await redis.get(`${PREFIX}:committed`), "1700000");
      now += 60_001; spend = 9_400_000; systemSpend = 9_300_000;
      const small = { ...params(), maxOutputTokens: 256 };
      await middleware().wrapGenerate({ params: small, model: {}, doGenerate: async () => ({ usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } }) });
      assert.equal(decisions().at(-1).billed, 100_000);
      const systemParams = params(); systemParams.providerOptions.gateway.tags.push("included-with-hypertask");
      await assert.rejects(middleware().wrapGenerate({ params: systemParams, model: {}, doGenerate: async () => { throw new Error("must not infer"); } }), (error) => error.reason === "month");
      assert.equal(decisions().at(-1).billed, 9_300_000); assert.equal(decisions().at(-1).cap, 10_000_000);
      await assert.rejects(plan(1, { lane: "system" }), (error) => error.reason === "month");
      assert.equal(decisions().at(-1).billed, 9_400_000); assert.equal(decisions().at(-1).cap, 1_000_000);
    });

    test("V2: report crossing UTC month/day boundary rebuilds admission against only the new period", async () => {
      now = new NativeDate("2026-10-31T23:59:59Z").getTime();
      let crossed = false;
      reportHook = () => { if (!crossed) { now += 2000; crossed = true; } };
      const reservation = await plan(800_000);
      assert.ok(reservation.id.includes("ai-allowance:2026-11:"));
      assert.equal(decisions().at(-1).scope, `ai-allowance-billed:v1:month:2026-11:${TEAM}`);
      assert.deepEqual(await redis.zrange(`${PREFIX}:reservations`, 0, -1), []);
      assert.equal(await redis.hget(BILLED, "total"), "100000");
      assert.equal(await redis.hget(`ai-allowance-billed:v1:month:2026-11:${TEAM}`, "total"), "10000");
    });

    test("V8: an On hold that expires after flag Off still cleans up and logs its original actor/id", async () => {
      const reservation = await plan(20_000);
      enabled = false; now += 600_001;
      await plan(20_000);
      assert.equal(releases().length, 1); assert.equal(releases()[0].reason, "expiry");
      assert.equal(releases()[0].userId, 985); assert.equal(releases()[0].reservationId, reservation.billedCall.reservationId);
      assert.equal(await redis.get(`${PREFIX}:committed`), "920000");
    });
  });
}

test("flag registry is file-local, money-gated, and dated 2026-10-24", () => {
  const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7692-billed-cost.ts"));
  const flag = definition.default ?? definition;
  assert.equal(flag.key, FLAG); assert.equal(flag.kind, "bugfix"); assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small"); assert.equal(flag.releaseRisk.highRisk, "money"); assert.equal(flag.shippedOn, "2026-10-24");
});
