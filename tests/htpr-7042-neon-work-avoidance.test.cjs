const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flag = "htpr-7042-neon-work-avoidance", target = "htpr-6136-figma-connect";
function load(file, mocks = {}, modules = new Map()) {
  if (modules.has(file)) return modules.get(file).exports;
  const javascript = ts.transpileModule(read(file), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module_ = { exports: {} };
  modules.set(file, module_);
  const importModule = (name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
    const base = name.startsWith("@/") ? `src/${name.slice(2)}` : path.join(path.dirname(file), name);
    const resolved = [base, `${base}.ts`, `${base}.tsx`].find((item) => fs.existsSync(path.join(root, item)) && fs.statSync(path.join(root, item)).isFile());
    assert.ok(resolved, `Missing import ${name}`);
    return load(resolved, mocks, modules);
  };
  new Function("require", "module", "exports", javascript)(importModule, module_, module_.exports);
  return module_.exports;
}
const invalidationScript = `
          redis.call('SET', KEYS[1], '1', 'EX', 5)
          redis.call('INCR', KEYS[2])
          return redis.call('DEL', KEYS[3])
        `;
const fillScript = `
        if (redis.call('GET', KEYS[1]) or '0') == '0'
          and (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then
          return redis.call('SET', KEYS[3], ARGV[2], 'EX', 30)
        end
        return 0
      `;
class MemoryRedis {
  constructor(clock) { this.clock = clock; this.values = new Map(); }
  entry(key) {
    const row = this.values.get(key);
    if (row?.until !== undefined && row.until <= this.clock()) { this.values.delete(key); return undefined; }
    return row;
  }
  async get(key) { return this.entry(key)?.value ?? null; }
  async mget(...keys) { return keys.map((key) => this.entry(key)?.value ?? null); }
  async set(key, value, ...options) {
    if (options.includes("NX") && this.entry(key)) return null;
    let until;
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      assert.ok(["NX", "EX", "PX"].includes(option), `Unsupported SET option ${option}`);
      if (option !== "NX") {
        const duration = Number(options[++i]);
        assert.ok(Number.isInteger(duration) && duration > 0);
        until = this.clock() + duration * (option === "EX" ? 1000 : 1);
      }
    }
    this.values.set(key, { value: String(value), until }); return "OK";
  }
  async del(...keys) {
    let count = 0;
    for (const key of keys) { if (this.entry(key)) { this.values.delete(key); count++; } }
    return count;
  }
  async incr(key) {
    const row = this.entry(key), value = Number(row?.value ?? 0);
    assert.ok(Number.isSafeInteger(value), "INCR requires an integer");
    this.values.set(key, { value: String(value + 1), until: row?.until }); return value + 1;
  }
  async expire(key, seconds) {
    const row = this.entry(key); if (!row) return 0;
    if (seconds <= 0) this.values.delete(key); else row.until = this.clock() + seconds * 1000;
    return 1;
  }
  async ttl(key) {
    const row = this.entry(key); if (!row) return -2;
    return row.until === undefined ? -1 : Math.round((row.until - this.clock()) / 1000);
  }
  async eval(script, keyCount, ...args) {
    assert.equal(keyCount, 3);
    const [writers, generation, cache, expectedGeneration, modes] = args;
    // No awaits: each script must observe and mutate the store atomically.
    if (script === invalidationScript) {
      this.set(writers, "1", "EX", 5);
      this.incr(generation);
      return this.del(cache);
    }
    if (script === fillScript) {
      if ((this.entry(writers)?.value ?? "0") === "0" && (this.entry(generation)?.value ?? "0") === expectedGeneration) {
        return this.set(cache, modes, "EX", 30);
      }
      return 0;
    }
    assert.fail("Unknown Lua script: update the pinned source and MemoryRedis semantics");
  }
}
let redis, now;
const originalRedisUrl = process.env.REDIS_URL;
test.before(() => { process.env.REDIS_URL = "redis://in-memory-test-only"; });
test.beforeEach(() => { now = 0; redis = new MemoryRedis(() => now); });
test.after(() => {
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = originalRedisUrl;
});
test("fake Lua semantics are pinned to the exact production script source", () => {
  for (const [file, script] of [["src/lib/flags/modeCache.ts", invalidationScript], ["src/lib/flags.ts", fillScript]]) {
    const scripts = [...read(file).matchAll(/redis\.eval\(`([\s\S]*?)`,/g)].map((match) => match[1]);
    assert.deepEqual(scripts, [script], `${file}: update MemoryRedis when changing Lua`);
  }
});
test("in-memory Redis preserves NX, EX, PX, deletion, counters and expiry at exact clock boundaries", async () => {
  assert.equal(await redis.get("missing"), null); assert.equal(await redis.ttl("missing"), -2);
  assert.equal(await redis.expire("missing", 1), 0);
  assert.equal(await redis.set("key", 1), "OK"); assert.equal(await redis.ttl("key"), -1);
  assert.equal(await redis.set("key", 2, "NX", "EX", 10), null); assert.equal(await redis.get("key"), "1");
  assert.equal(await redis.expire("key", 1), 1); assert.equal(await redis.incr("key"), 2);
  assert.equal(await redis.ttl("key"), 1);
  now = 999; assert.equal(await redis.get("key"), "2");
  now = 1000; assert.equal(await redis.get("key"), null); assert.equal(await redis.ttl("key"), -2);
  assert.equal(await redis.set("key", "fresh", "PX", 5, "NX"), "OK");
  now = 1004; assert.equal(await redis.get("key"), "fresh");
  now = 1005; assert.equal(await redis.del("key"), 0);
  assert.equal(await redis.incr("counter"), 1); assert.equal(await redis.incr("counter"), 2);
  assert.equal(await redis.ttl("counter"), -1);
  await redis.set("key", "value", "EX", 30); await redis.set("key", "replacement");
  assert.equal(await redis.ttl("key"), -1);
  assert.deepEqual(await redis.mget("key", "counter", "missing"), ["replacement", "2", null]);
  assert.equal(await redis.del("key", "counter", "missing"), 2);
  await redis.set("key", "value"); assert.equal(await redis.expire("key", 0), 1);
  assert.equal(await redis.get("key"), null);
  await assert.rejects(redis.eval("unknown", 3, "a", "b", "c"), /Unknown Lua script/);
});
test("fake Lua cache fill honors the writer fence and generation even after fence expiry", async () => {
  const keys = ["writers", "generation", "cache"];
  assert.equal(await redis.eval(fillScript, 3, ...keys, "0", "initial"), "OK");
  assert.equal(await redis.ttl("cache"), 30);
  assert.equal(await redis.eval(invalidationScript, 3, ...keys), 1);
  assert.deepEqual(await redis.mget(...keys), ["1", "1", null]);
  assert.equal(await redis.ttl("writers"), 5); assert.equal(await redis.ttl("generation"), -1);
  assert.equal(await redis.eval(fillScript, 3, ...keys, "1", "blocked"), 0);
  now = 5000;
  assert.equal(await redis.eval(fillScript, 3, ...keys, "0", "stale"), 0);
  assert.equal(await redis.get("cache"), null);
  assert.equal(await redis.eval(fillScript, 3, ...keys, "1", "fresh"), "OK");
  assert.equal(await redis.get("cache"), "fresh");
  assert.equal(await redis.eval(invalidationScript, 3, ...keys), 1);
  assert.equal(await redis.eval(invalidationScript, 3, ...keys), 0);
  assert.equal(await redis.get("generation"), "3");
});
function flagHarness() {
  const rows = new Map([[flag, { key: flag, mode: "EVERYONE" }], [target, { key: target, mode: "EVERYONE" }]]);
  const h = { tables: 0, single: 0, users: 0, failRedis: false, rows };
  const db = {
    featureFlag: {
      findUnique: async ({ where }) => { h.single++; return rows.get(where.key) ?? null; },
      findMany: async () => { h.tables++; const copy = [...rows.values()].map((row) => ({ ...row })); if (h.readDelay) await h.readDelay(); return copy; },
      upsert: async ({ where, create, update }) => { const row = { ...(rows.get(where.key) ?? create), ...update }; rows.set(where.key, row); return row; },
    },
    user: { findUnique: async ({ where }) => { h.users++; return { email: where.id === 6 ? "valentin.yeo@gmail.com" : "valentin@hypertask.ai" }; } },
    task: { findMany: async () => [] },
    $executeRaw: async () => 0,
    $transaction: async (run) => run(db),
  };
  h.flags = load("src/lib/flags.ts", {
    "@/lib/prisma": { default: db }, "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
    "@/lib/redis": { getRedis: async () => { if (h.failRedis) throw new Error("Redis unavailable"); if (h.redisDelay) await h.redisDelay(); return h.redis ?? redis; } },
  });
  h.db = db;
  h.read = (key = target, userId = 7) => h.flags.withFeatureFlagSnapshot(() => h.flags.isFeatureEnabled(key, userId));
  return h;
}
test("registry and uncached flag reads and writes do not load optional cache plumbing", async () => {
  const previousRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const row = { key: target, mode: "EVERYONE" };
    const db = {
      featureFlag: {
        findUnique: async () => row,
        upsert: async ({ update }) => Object.assign(row, update),
      },
      task: { findMany: async () => [] },
      $executeRaw: async () => 0,
      $transaction: async run => run(db),
    };
    const mocks = {
      "@/lib/prisma": { __esModule: true, default: db },
      "@/lib/auth/getSessionUser": {},
      "@/lib/agentRuns/model": {},
      "@/lib/flags/keys": load("src/lib/flags/keys.ts"),
      "@/lib/flags/parked": load("src/lib/flags/parked.ts"),
      react: require("react"),
    };
    mocks["@/lib/flags/definitions"] = load("src/lib/flags/definitions.ts", mocks);
    const imported = [];
    const module_ = { exports: {} };
    const javascript = ts.transpileModule(read("src/lib/flags.ts"), {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function("require", "module", "exports", javascript)(name => {
      imported.push(name);
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import ${name}`);
      return mocks[name];
    }, module_, module_.exports);
    const flags = module_.exports;
    assert.equal(flags.defaultFeatureFlagMode(flag), "EVERYONE");
    assert.equal(await flags.isFeatureEnabled(target, 7), true);
    assert.equal(await flags.featureFlagCandidateUserIds(target), null);
    assert.equal((await flags.setFeatureFlagKeep(target, true)).keep, true);
    assert.equal((await flags.setFeatureFlagMode(target, "OFF")).mode, "OFF");
    assert.equal(await flags.isFeatureEnabled(target, 7), false);
    assert.ok(!imported.includes("@/lib/flags/modeCache"));
  } finally {
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previousRedisUrl;
  }
});
test("flag cache miss, hit, TTL and per-tick single-flight preserve raw modes and authorization", async () => {
  const h = flagHarness();
  assert.equal(h.flags.defaultFeatureFlagMode(flag), "EVERYONE");
  assert.equal((await h.flags.listFeatureFlagModes()).find((row) => row.key === flag).kind, "bugfix");
  h.tables = 0;
  await h.flags.withFeatureFlagSnapshot(async () => { assert.deepEqual(await Promise.all([h.flags.isFeatureEnabled(target, 7), h.flags.isFeatureEnabled(flag, 0)]), [true, true]); });
  assert.equal(h.tables, 1); assert.equal(h.single, 0);
  assert.equal(await h.read(), true); assert.equal(h.tables, 1);
  const ttl = await redis.ttl("flags:raw-modes:7042"); assert.ok(ttl > 0 && ttl <= 30);
  now += 29999; assert.notEqual(await redis.get("flags:raw-modes:7042"), null);
  now += 1;
  assert.equal(await redis.get("flags:raw-modes:7042"), null);
  assert.equal(await h.read(), true); assert.equal(h.tables, 2);
  await h.flags.setFeatureFlagMode(target, "OWNER_AND_QA");
  assert.equal(await h.read(target, 7), false); assert.equal(await h.read(target, 6), true);
  assert.equal(await h.read(target, 985), true); assert.equal(h.users, 2);
  assert.equal(await h.read("undeclared-key"), false);
});
test("flag off uses original single-key reads and Redis errors fall back to DB", async () => {
  const h = flagHarness(); h.rows.get(flag).mode = "OFF";
  await h.flags.withFeatureFlagSnapshot(async () => { await h.flags.isFeatureEnabled(target, 7); await h.flags.isFeatureEnabled(target, 7); });
  assert.equal(h.single, 2); assert.equal(await redis.get("flags:raw-modes:7042"), null);
  h.failRedis = true; assert.equal(await h.read(), true); assert.equal(h.single, 3);
  h.rows.get(target).mode = "OFF"; assert.equal(await h.read(), false);
});
test("admin mode and Keep writes invalidate before returning, including the optimization flag itself", async () => {
  const h = flagHarness(); await h.read();
  const admin = load("src/app/api/admin/flags/route.ts", { "@/lib/flags": h.flags, "@/lib/realtime/server": { broadcastFeatureFlagsChange: async () => { assert.equal(await redis.get("flags:raw-modes:7042"), null); } } });
  const req = new (require("next/server").NextRequest)("https://app.hypertask.ai/api/admin/flags", { method: "PATCH", headers: { origin: "https://app.hypertask.ai", host: "app.hypertask.ai", "content-type": "application/json" }, body: JSON.stringify({ key: target, mode: "OFF" }) });
  assert.equal((await admin.PATCH(req)).status, 200); assert.equal(await h.read(), false);
  await h.flags.setFeatureFlagKeep(target, true); assert.equal(await redis.get("flags:raw-modes:7042"), null);
  await h.flags.setFeatureFlagMode(flag, "OFF"); assert.equal(await h.read(flag), false);
  await h.flags.setFeatureFlagMode(flag, "EVERYONE"); assert.equal(await h.read(flag), true);
});
test("flag cache generation prevents an in-flight stale refill after an admin write", async () => {
  const h = flagHarness(); let release, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  h.readDelay = () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const stale = h.read(); await waiting;
  await h.flags.setFeatureFlagMode(target, "OFF"); h.readDelay = null; release(); await stale;
  assert.equal(await redis.get("flags:raw-modes:7042"), null); assert.equal(await h.read(), false);
});
test("Redis down during admin mode and Keep writes returns success and logs invalidation errors", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const failure of ["connection", "command"]) {
    const h = flagHarness(); await h.read();
    h.failRedis = failure === "connection";
    h.redis = { eval: async () => { assert.equal(h.rows.get(target).mode, "OFF"); throw new Error("Redis command failed"); } };
    const admin = load("src/app/api/admin/flags/route.ts", { "@/lib/flags": h.flags, "@/lib/realtime/server": { broadcastFeatureFlagsChange: async () => {} } });
    for (const change of [{ mode: "OFF" }, { keep: true }]) {
      const req = new (require("next/server").NextRequest)("https://app.hypertask.ai/api/admin/flags", { method: "PATCH", headers: { origin: "https://app.hypertask.ai", host: "app.hypertask.ai", "content-type": "application/json" }, body: JSON.stringify({ key: target, ...change }) });
      const response = await admin.PATCH(req); assert.equal(response.status, 200);
      const { flag: updated } = await response.json(); assert.equal(updated.mode, "OFF");
      if (change.keep) assert.equal(updated.keep, true);
      assert.equal(h.rows.get(target).mode, "OFF");
    }
    redis.values.clear();
  }
  assert.equal(warn.mock.callCount(), 4);
  assert.ok(warn.mock.calls.every(({ arguments: args }) => args[0] === "[feature-flags] cache invalidation failed"));
});
test("invalidation timeout bounds Redis acquisition and commands after the DB commit", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const failure of ["connection", "command"]) {
    const h = flagHarness();
    const hung = () => { assert.equal(h.rows.get(target).mode, "OFF"); return new Promise(() => {}); };
    if (failure === "connection") h.redisDelay = hung; else h.redis = { eval: hung };
    const started = performance.now();
    const updated = await h.flags.setFeatureFlagMode(target, "OFF");
    const elapsed = performance.now() - started;
    assert.equal(updated.mode, "OFF"); assert.ok(elapsed >= 450 && elapsed < 900, `Invalidation took ${elapsed} ms`);
  }
  assert.equal(warn.mock.callCount(), 2);
});
test("post-commit writer fence expires without cleanup and caching resumes after a crash", async () => {
  const h = flagHarness(); await h.read(); await h.flags.setFeatureFlagMode(target, "OFF");
  const fence = "flags:raw-modes:7042:writers";
  assert.equal(await redis.get(fence), "1");
  const ttl = await redis.ttl(fence); assert.ok(ttl > 0 && ttl <= 5);
  assert.equal(await h.read(), false);
  assert.equal(h.single, 2); assert.equal(await redis.get("flags:raw-modes:7042"), null);
  now += 4999; assert.equal(await redis.get(fence), "1");
  now += 1;
  assert.equal(await redis.get(fence), null);
  assert.equal(await h.read(), false); const tables = h.tables;
  assert.equal(await h.read(), false); assert.equal(h.tables, tables);
  const cacheTtl = await redis.ttl("flags:raw-modes:7042"); assert.ok(cacheTtl > 0 && cacheTtl <= 30);
});
test("Redis read command errors and corrupt cached data fall back to DB", async () => {
  const h = flagHarness(); h.rows.get(target).mode = "OFF";
  h.redis = { mget: async () => { throw new Error("Read failed"); } };
  assert.equal(await h.read(), false); assert.equal(h.single, 1);
  h.redis = redis; await redis.set("flags:raw-modes:7042", "not JSON", "EX", 30);
  assert.equal(await h.read(), false); assert.equal(h.single, 2);
});
test("failed invalidation leaves only a TTL-bounded stale cache", async (t) => {
  t.mock.method(console, "warn", () => {});
  const h = flagHarness(); await h.read(); h.failRedis = true;
  assert.equal((await h.flags.setFeatureFlagMode(target, "OFF")).mode, "OFF");
  const ttl = await redis.ttl("flags:raw-modes:7042"); assert.ok(ttl > 0 && ttl <= 30);
  h.failRedis = false; assert.equal(await h.read(), true);
  now += 29999; assert.notEqual(await redis.get("flags:raw-modes:7042"), null);
  now += 1;
  assert.equal(await h.read(), false);
});
test("flag Redis read timeout and cache-fill error fall back without delaying through reconnects", async () => {
  const h = flagHarness(); h.redisDelay = () => new Promise(() => {});
  assert.equal(await h.read(), true); assert.equal(h.single, 1);
  h.redisDelay = null; h.redis = { mget: () => new Promise(() => {}) };
  assert.equal(await h.read(), true); assert.equal(h.single, 2);
  h.redis = { mget: (...args) => redis.mget(...args), eval: async () => { throw new Error("Fill failed"); } };
  assert.equal(await h.read(), true); assert.equal(h.tables, 1); assert.equal(h.single, 2);
  assert.equal(await redis.get("flags:raw-modes:7042"), null);
});
test("browser smoke rejects nonlocal Redis before any seed or invalidation writes", () => {
  const source = read("scripts/seed-browser-smoke.mjs");
  const start = source.indexOf("const stateFile ="), end = source.indexOf("const root =");
  assert.ok(start >= 0 && end > start);
  assert.ok(end < source.indexOf("const prisma =") && end < source.indexOf("const { withFlagModeInvalidation }"));
  const guard = source.slice(start, end);
  const env = { DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1/smoke", REDIS_URL: "redis://example.invalid:6379", BROWSER_SMOKE_STATE_FILE: "unused.json", GITHUB_OUTPUT: "unused.env" };
  const run = (url) => vm.runInNewContext(guard, { URL, process: { env: { ...env, REDIS_URL: url } } }, { timeout: 1000 });
  assert.throws(() => run(env.REDIS_URL), /Browser smoke seeding requires an isolated loopback Redis/);
  assert.doesNotThrow(() => run("redis://127.0.0.1:6379"));
});
test("browser smoke reseeding invalidates cached raw modes before publishing all-flags fixtures", async () => {
  const h = flagHarness();
  const key = "htpr-7037-shared-email-layout";
  h.rows.set(key, { key, mode: "OFF" });
  assert.equal((await h.flags.featureFlagsForUser(7))[key], false);
  assert.notEqual(await redis.get("flags:raw-modes:7042"), null);
  const seed = read("scripts/seed-browser-smoke.mjs");
  const write = seed.match(/await withFlagModeInvalidation\(async \(\) => \{[\s\S]*?\n  \}\);/)
    ?? seed.match(/for \(const \[key, mode\] of Object.entries\(modes\)\) \{\n\s+await prisma.featureFlag.upsert[^\n]+\n\s+\}/);
  assert.ok(write, "Seed flag mutation block must be exercised");
  const { withFlagModeInvalidation } = load("src/lib/flags/modeCache.ts", {
    "@/lib/redis": { getRedis: async () => redis },
  });
  await new (Object.getPrototypeOf(async () => {}).constructor)("withFlagModeInvalidation", "prisma", "modes", write[0])(
    withFlagModeInvalidation, h.db, { [flag]: "EVERYONE", [key]: "EVERYONE" },
  );
  assert.equal(await redis.get("flags:raw-modes:7042"), null);
  assert.equal((await h.flags.featureFlagsForUser(7))[key], true);
});
test("flag user snapshots are byte-equivalent and transaction clients bypass the cache", async () => {
  const h = flagHarness();
  const cached = await h.flags.featureFlagsForUser(7);
  h.failRedis = true; const fresh = await h.flags.featureFlagsForUser(7);
  assert.equal(JSON.stringify(cached), JSON.stringify(fresh));
  h.failRedis = false; const tx = { ...h.db, featureFlag: { findUnique: async () => ({ mode: "OFF" }) } };
  assert.equal(await h.flags.isFeatureEnabled(target, 7, tx), false);
});
test("DB commits before invalidation and concurrent writers invalidate their own committed snapshots", async () => {
  const h = flagHarness(); await h.read(); let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  h.db.$transaction = async (run) => { entered(); await new Promise((resolve) => { release = resolve; }); return run(h.db); };
  let returned = false; const write = h.flags.setFeatureFlagMode(target, "OFF").then(() => { returned = true; });
  await waiting; assert.equal(returned, false);
  assert.notEqual(await redis.get("flags:raw-modes:7042"), null);
  assert.equal(await redis.get("flags:raw-modes:7042:writers"), null);
  assert.equal(await h.read(), true); assert.equal(h.single, 0);
  await h.flags.setFeatureFlagKeep(flag, true); assert.equal(await redis.get("flags:raw-modes:7042:writers"), "1");
  assert.equal(await redis.get("flags:raw-modes:7042:generation"), "1");
  release(); await write;
  assert.equal(await redis.get("flags:raw-modes:7042:generation"), "2");
  assert.equal(await redis.get("flags:raw-modes:7042"), null);
  assert.equal(await h.read(), false);
});
test("DB write errors are still thrown without contacting Redis", async () => {
  const h = flagHarness(); h.db.$transaction = async () => { throw new Error("DB failed"); };
  h.redisDelay = () => assert.fail("Redis must not precede the DB commit");
  await assert.rejects(h.flags.setFeatureFlagMode(target, "OFF"), /DB failed/);
  assert.equal(h.rows.get(target).mode, "EVERYONE");
});
function cycleHarness() {
  const calls = [], h = { now: 0, scans: 0, fail: false, dbFail: false, backlog: false };
  const memory = new MemoryRedis(() => h.now * 1000);
  const client = {
    set: async (key, value, ...opts) => { calls.push([key, value, ...opts]); if (h.fail) throw new Error("Redis failed"); return memory.set(key, value, ...opts); },
    get: (key) => memory.get(key),
  };
  const db = { $queryRaw: async () => { h.scans++; if (h.dbFail) throw new Error("DB failed"); return h.backlog ? [{ projectId: 1 }] : []; }, $transaction: async (run) => run({ $executeRaw: async () => 0, project: { findUnique: async () => ({ cyclesEnabled: false }) } }) };
  h.sweep = load("src/lib/cycleService.ts", { "@/lib/prisma": { default: db }, "@/lib/redis": { getRedis: async () => client }, "@/lib/realtime/server": { broadcastBoardChange: async () => {} } }).sweepCycleRollovers;
  h.calls = calls; return h;
}
test("sweep cycle gate skips empty heavy scans for 10 minutes and runs at the exact UTC day boundary", async () => {
  const h = cycleHarness(), day = new Date("2026-10-09T23:59:00Z");
  await h.sweep(day, undefined, true); h.now = 599; await h.sweep(day, undefined, true); assert.equal(h.scans, 1);
  h.now = 600; await h.sweep(day, undefined, true); assert.equal(h.scans, 2);
  await h.sweep(new Date("2026-10-10T00:00:00Z"), undefined, true); assert.equal(h.scans, 3);
  assert.deepEqual(h.calls[0].slice(2), ["EX", 600, "NX"]);
});
test("sweep Redis error, scan failure, backlog and flag off retain the original scan cadence", async () => {
  for (const mode of ["fail", "backlog", "off", "dbFail"]) {
    const h = cycleHarness(); h[mode] = true;
    for (let i = 0; i < 2; i++) { if (mode === "dbFail") await assert.rejects(h.sweep(undefined, undefined, true), /DB failed/); else await h.sweep(undefined, undefined, mode !== "off"); }
    assert.equal(h.scans, 2, mode); if (mode === "off") assert.equal(h.calls.length, 0);
  }
});
test("sweep minute deadlines and timestamp-granularity sources are never gated; flag off has identical work calls", async () => {
  async function tick(enabled) {
    const calls = [], mocks = { "@/lib/flags": { HTPR_7042_NEON_WORK_AVOIDANCE_FLAG: flag, withFeatureFlagSnapshot: (run) => run(), isFeatureEnabled: async () => { calls.push("flag"); return enabled; } }, "@/lib/redis": { getRedis: async () => redis }, "@/lib/qstash": { withQstashSignature: (run) => run }, "@/lib/prisma": { default: { reminder: { findMany: async () => { calls.push("reminders"); return []; } }, chatSession: { findMany: async () => { calls.push("chat-expiry"); return []; } }, $queryRaw: async (sql) => { calls.push(sql.join("").includes("UPDATE") ? "due" : "delete"); return []; } } } };
    for (const [file, name] of [["tasks/sweepAutoArchive", "sweepAutoArchives"], ["tasks/sweepStaleNudges", "sweepStaleNudges"], ["reminders/invokeReminder", "invokeDueReminder"], ["tasks/invokeDueDate", "createDueDateOverdueNotifications"], ["tasks/invokeTaskDelete", "claimAndInvokeTaskDelete"], ["ai-chat/invokeChatSessionExpiry", "recreateSessionIfEmpty"]]) mocks[`@/utils/controllers/${file}`] = { [name]: async () => { calls.push(name); return 0; }, CHAT_SESSION_EXPIRY_DAYS: 30 };
    for (const [file, name] of [["cycleService", "sweepCycleRollovers"], ["agentWebhooks/delivery", "sweepAgentWebhookDeliveries"], ["agentWebhooks/taskCreatedRecovery", "sweepPendingAgentTaskCreatedWebhooks"], ["mcp/webhooks/outboxDelivery", "sweepBoardWebhookDeliveries"], ["agentRuns/service", "sweepExpiredAgentChatTurns"], ["googleCalendar/sync", "sweepGoogleCalendarConnections"]]) mocks[`@/lib/${file}`] = { [name]: async (...args) => { calls.push(name); if (name === "sweepCycleRollovers") assert.equal(args[2] ?? false, enabled); return 0; } };
    const handler = load("src/pages/api/queues/sweep.ts", mocks).default;
    await handler({}, { status: () => ({ json: () => {} }) }); return calls;
  }
  const expected = ["flag", "reminders", "due", "delete", "chat-expiry", "sweepAutoArchives", "sweepStaleNudges", "sweepCycleRollovers", "sweepAgentWebhookDeliveries", "sweepExpiredAgentChatTurns", "sweepPendingAgentTaskCreatedWebhooks", "sweepBoardWebhookDeliveries", "sweepGoogleCalendarConnections"];
  assert.deepEqual(await tick(false), expected); assert.deepEqual(await tick(true), expected);
});
test("granularity and retention exclusions are grounded in exact predicates and visible history", () => {
  assert.match(read("src/utils/controllers/tasks/sweepAutoArchive.ts"), /dueDate.*<= now\(\)/);
  assert.match(read("src/utils/controllers/tasks/sweepStaleNudges.ts"), /now\(\) - COALESCE/);
  assert.match(read("src/prisma/schema.prisma"), /endDate\s+DateTime\s+@db.Date/);
  assert.match(read("src/lib/mcp/webhooks/workspaceManagement.ts"), /where: \{ subscriptionId: selected.id \}/);
  assert.match(read("src/lib/mcp/webhooks/workspaceManagement.ts"), /agentWebhookDelivery.findMany/);
});
test("calendar zero accounts already performs one cheap query and no graph, flags or remote work", async () => {
  let reads = 0;
  const calendar = load("src/lib/googleCalendar/sync.ts", {
    "@/lib/prisma": { default: { googleCalendarConnection: { findMany: async (query) => { reads++; assert.deepEqual(query.select, { userId: true }); assert.ok(query.where.OR.some((item) => item.syncEnabled)); assert.ok(query.where.OR.some((item) => item.disconnectRequestedAt)); return []; } } } },
    "@/lib/flags": { isFeatureEnabled: () => assert.fail("No flag work for zero accounts") },
    "@/lib/crypto/byokCipher": {}, "@/utils/controllers/projects/getAllIncludes": {},
    "./client": {}, "./connection": { withGoogleCalendarUserLock: () => assert.fail("No remote or connection work") },
  });
  assert.equal(await calendar.sweepGoogleCalendarConnections(), 0); assert.equal(reads, 1);
  assert.equal(await calendar.sweepGoogleCalendarConnections({ deadlineAt: Date.now() - 1 }), 0); assert.equal(reads, 1);
});
test("slack where-clause rewrite is excluded: float predicates and the original top-50 window are not interchangeable", () => {
  const { needsSlackThreadSummary } = load("src/lib/slack/idle.ts");
  const unchanged = { lastMessageTs: "1700000000.000001", lastSummarizedTs: "1700000000.0000010" };
  assert.equal(needsSlackThreadSummary(unchanged, 1800000000000), false);
  assert.equal(unchanged.lastMessageTs !== unchanged.lastSummarizedTs, true);
  const rows = [...Array.from({ length: 50 }, () => unchanged), { lastMessageTs: "1700000001.000001", lastSummarizedTs: null }];
  const predicate = (row) => needsSlackThreadSummary(row, 1800000000000);
  assert.equal(rows.slice(0, 50).filter(predicate).length, 0); assert.equal(rows.filter(predicate).slice(0, 50).length, 1);
  const source = read("src/app/api/cron/slack-thread-summaries/route.ts");
  assert.match(source, /take: 50/); assert.match(source, /candidates.filter/);
});
function heartbeatHarness(enabled = true) {
  const agent = { id: "a1", userId: 7, heartbeatAt: new Date("2026-10-09T00:00:00Z"), displayName: "Agent" };
  const claimedAt = new Date("2026-10-09T00:10:00Z"), events = [], updates = [], h = { enabled, visible: false, gone: false, probeError: false, graph: { ok: true, notifications: [] } };
  const controller = load("src/utils/controllers/notifications/getStructuredInboxForAgent.ts", { "@/lib/prisma": {}, "@/utils/helperFunctions/helperFunctions": {}, "@/utils/controllers/notifications/getAll": {} });
  const { GET } = load("src/app/api/cron/native-agent-heartbeat/route.ts", {
    "next/server": { NextResponse: require("next/server").NextResponse, after: () => {} },
    "@/lib/prisma": { default: { agent: { findMany: async () => [agent], findFirst: async (query) => { events.push("probe"); h.query = query; if (h.probeError) throw new Error("Probe failed"); return h.gone ? null : { notificationsToAgent: h.visible ? [{ id: "n1" }] : [] }; }, updateMany: async (query) => { updates.push(query); return { count: 1 }; } }, $queryRaw: async () => { events.push("watermark"); return [{ databaseNow: new Date(claimedAt.getTime() + 1000) }]; }, chatMessage: { findMany: async () => { events.push("recovery-db"); return []; } } } },
    "@/lib/flags": { HTPR_7042_NEON_WORK_AVOIDANCE_FLAG: flag, isFeatureEnabled: async () => { events.push("flag"); return h.enabled; }, withFeatureFlagSnapshot: (run) => run() },
    "@/utils/controllers/notifications/getStructuredInboxForAgent": { agentInboxVisibilityWhere: controller.agentInboxVisibilityWhere, getStructuredInboxForAgent: async (query) => { events.push("graph"); h.graphQuery = query; return h.graph; } },
    "@/app/api/ai/_lib/heartbeatExecution": { heartbeatExecutionIds: () => ({ executionId: "e1" }), getHeartbeatExecution: async () => { events.push("recovery"); return null; }, heartbeatRecoveryAllowsNewClaim: (value) => value === "clear" },
    "@/lib/cronAuthorization": { hasValidCronAuthorization: () => true }, "@/lib/ai/chatAlerts/service": {}, "@/lib/realtime/server": {}, "@/lib/aiAllowancePolicy": {}, "./agentMessageDelivery": {},
  });
  h.run = async () => { const old = process.env.NEXT_PUBLIC_APP_URL; process.env.NEXT_PUBLIC_APP_URL = "https://app.hypertask.ai"; try { return await GET(new Request("https://app.hypertask.ai/api/cron/native-agent-heartbeat")); } finally { if (old === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = old; } };
  return Object.assign(h, { agent, claimedAt, events, updates });
}
test("heartbeat quiet probe skips the graph but preserves recovery, heartbeat update and the cursor fence", async () => {
  const h = heartbeatHarness(); assert.equal((await h.run()).status, 200);
  assert.deepEqual(h.events, ["flag", "recovery", "recovery-db", "watermark", "probe"]);
  assert.deepEqual(h.updates, [{ where: { id: h.agent.id, heartbeatAt: h.agent.heartbeatAt }, data: { heartbeatAt: h.claimedAt } }]);
  assert.deepEqual(h.query.where, { id: "a1", userId: 7, revokedAt: null });
  const probe = h.query.select.notificationsToAgent;
  assert.deepEqual(probe.select, { id: true }); assert.equal(probe.take, 1);
  assert.deepEqual(probe.where.createdAt, { gt: h.agent.heartbeatAt, lte: h.claimedAt });
  assert.deepEqual(probe.where.OR, [{ task: { status: "Normal" } }, { taskId: null }]);
  assert.equal(probe.where.status, "Normal"); assert.equal(probe.where.userId, 7);
});
test("heartbeat visible probe, probe error and flag off load the original graph; missing agents do not advance", async () => {
  for (const mode of ["visible", "probeError", "off", "gone"]) {
    const h = heartbeatHarness(mode !== "off"); h[mode] = true;
    assert.equal((await h.run()).status, mode === "gone" ? 500 : 200);
    assert.equal(h.events.includes("graph"), mode !== "gone"); assert.equal(h.events.includes("probe"), mode !== "off");
    assert.equal(h.updates.length, mode === "gone" ? 0 : 1);
    if (mode !== "gone") assert.deepEqual(h.graphQuery.window, { after: h.agent.heartbeatAt, through: h.claimedAt });
  }
  const h = heartbeatHarness(); h.visible = true; h.graph = { ok: false, kind: "internal" };
  assert.equal((await h.run()).status, 500); assert.equal(h.updates.length, 0);
});
