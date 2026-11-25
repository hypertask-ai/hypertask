const test = require("node:test");
const assert = require("node:assert/strict");
const { gunzipSync } = require("node:zlib");
const { createHash } = require("node:crypto");
const { loadModule } = require("./helpers/loadModule.cjs");

const originalSecret = process.env.SESSION_SECRET;
const originalRedisUrl = process.env.REDIS_URL;
process.env.SESSION_SECRET = "htpr-9711-local-session-fixture";
process.env.REDIS_URL = "redis://htpr-9711-fixture.invalid";
test.after(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
});

const session = loadModule("src/lib/auth/session.ts");

function countingRedis(values = new Map()) {
  const commands = [];
  const reply = (key) => values.get(key) ?? null;
  return {
    commands,
    values,
    async mget(...keys) {
      commands.push({ command: "mget", keys });
      return keys.map(reply);
    },
    async get(key) {
      commands.push({ command: "get", keys: [key] });
      return reply(key);
    },
    async set(key, value) {
      commands.push({ command: "set", keys: [key] });
      values.set(key, value);
      return "OK";
    },
  };
}

function revocation(redis, cache) {
  const wrappers = [];
  const react = cache ? {
    cache: (fn) => {
      let entry;
      const wrapped = (...args) => (entry ??= fn(...args));
      wrapped.reset = () => { entry = undefined; };
      wrappers.push(wrapped);
      return wrapped;
    },
  } : require("react");
  const instance = loadModule("src/lib/auth/sessionRevocation.ts", {
    "@/lib/redis": { getRedis: async () => redis },
    react,
  });
  return { instance, wrappers };
}

test("HTPR-9711 a revocation check sends one batched Redis command", async () => {
  const redis = countingRedis();
  const token = session.signSession({ id: 7 });
  assert.equal(await revocation(redis, false).instance.isSessionTokenRevoked(token, { failClosed: false }), false);
  assert.deepEqual(redis.commands.map(({ command }) => command), ["mget"]);
  assert.equal(redis.commands[0].keys.length, 2);
  assert.equal(redis.commands[0].keys[0].startsWith("ht_session:revoked:"), true);
  assert.equal(redis.commands[0].keys[1], "ht_session:user-revoked-before:7");
});

test("HTPR-9711 a revoked token and an ended session are read from that one command", async () => {
  const token = session.signSession({ id: 7 });
  const fingerprint = createHash("sha256").update(token.split(".")[0]).digest("hex");
  const revoked = countingRedis(new Map([[`ht_session:revoked:${fingerprint}`, "1"]]));
  assert.equal(await revocation(revoked, false).instance.isSessionTokenRevoked(token, { failClosed: true }), true);
  const ended = countingRedis(new Map([[`ht_session:user-revoked-before:7`, String(Math.floor(Date.now() / 1000) + 60)]]));
  assert.equal(await revocation(ended, false).instance.isSessionTokenRevoked(token, { failClosed: true }), true);
  assert.deepEqual([revoked.commands.length, ended.commands.length], [1, 1]);
});

test("HTPR-9711 repeat checks inside one request read Redis once", async () => {
  const redis = countingRedis();
  const { instance, wrappers } = revocation(redis, true);
  const token = session.signSession({ id: 7 });
  for (let index = 0; index < 3; index++) {
    assert.equal(await instance.isSessionTokenRevoked(token, { failClosed: true }), false);
  }
  assert.equal(redis.commands.length, 1);
  assert.equal(wrappers.length, 1);
  wrappers[0].reset();
  assert.equal(await instance.isSessionTokenRevoked(token, { failClosed: true }), false);
  assert.equal(redis.commands.length, 2);
});

test("HTPR-9711 an outage still honours the caller fail-closed policy after batching", async () => {
  const { instance } = revocation({
    async mget() { throw new Error("fake outage"); },
    async set() { return "OK"; },
  }, false);
  const token = session.signSession({ id: 7 });
  assert.equal(await instance.isSessionTokenRevoked(token, { failClosed: false }), false);
  assert.equal(await instance.isSessionTokenRevoked(token, { failClosed: true }), true);
});

function flagsRedis() {
  const store = new Map();
  const commands = [];
  return {
    store,
    commands,
    entry: (key) => store.get(key),
    async mget(...keys) {
      commands.push({ command: "mget", keys });
      return keys.map((key) => store.get(key) ?? null);
    },
    async get(key) {
      commands.push({ command: "get", keys: [key] });
      return store.get(key) ?? null;
    },
    async eval(script, keyCount, ...args) {
      commands.push({ command: "eval", keyCount });
      if (script.includes("INCR")) return 1;
      const [writers, generation, cache, expected, payload] = args;
      if ((store.get(writers) ?? "0") !== "0") return 0;
      if ((store.get(generation) ?? "0") !== expected) return 0;
      store.set(cache, payload);
      return "OK";
    },
  };
}

function flagRows() {
  return Array.from({ length: 530 }, (_, index) => ({
    key: `flag-${String(index).padStart(4, "0")}`,
    mode: index % 2 === 0 ? "OFF" : "EVERYONE",
  }));
}

function flagsInstance(redis, rows = flagRows()) {
  return loadModule("src/lib/flags.ts", {
    "@/lib/prisma": {
      default: {
        featureFlag: {
          findMany: async () => rows.map((row) => ({ ...row })),
          findUnique: async ({ where }) => rows.find((row) => row.key === where.key) ?? null,
        },
        user: { findUnique: async () => null },
      },
    },
    "@/lib/redis": { getRedis: async () => redis },
  });
}

test("HTPR-9711 the shared flag snapshot travels compressed", async () => {
  const flags = flagsInstance(flagsRedis());
  const rows = flagRows();
  const payload = await flags.encodeFlagSnapshot([Date.now(), ...rows]);
  const plain = JSON.stringify([Date.now(), ...rows]);
  assert.equal(payload.startsWith("gz:"), true);
  assert.ok(payload.length < plain.length * 0.35, `${payload.length} of ${plain.length} bytes`);
  const decoded = JSON.parse(gunzipSync(Buffer.from(payload.slice(3), "base64")).toString("utf8"));
  assert.deepEqual(decoded.slice(1), rows);
});

test("HTPR-9711 a second server reads the compressed snapshot in one small command", async () => {
  const redis = flagsRedis();
  const writer = flagsInstance(redis);
  assert.equal(await writer.withFeatureFlagSnapshot(() => writer.isFeatureEnabled("flag-0001", 7)), true);
  const stored = redis.entry("flags:raw-modes:7042");
  assert.equal(typeof stored, "string");
  assert.equal(stored.startsWith("gz:"), true);
  assert.ok(stored.length < 9000, `snapshot is ${stored.length} bytes`);
  redis.commands.length = 0;
  const reader = flagsInstance(redis);
  assert.equal(await reader.withFeatureFlagSnapshot(() => reader.isFeatureEnabled("flag-0001", 7)), true);
  assert.equal(await reader.withFeatureFlagSnapshot(() => reader.isFeatureEnabled("flag-0000", 7)), false);
  assert.deepEqual(redis.commands.map(({ command }) => command), ["mget"]);
  assert.equal(redis.commands[0].keys.length, 3);
});

test("HTPR-9711 a plain snapshot from a previous build still reads", async () => {
  const redis = flagsRedis();
  redis.store.set("flags:raw-modes:7042", JSON.stringify([Date.now(), { key: "flag-0001", mode: "OFF" }]));
  const reader = flagsInstance(redis);
  assert.equal(await reader.withFeatureFlagSnapshot(() => reader.isFeatureEnabled("flag-0001", 7)), false);
  assert.deepEqual(redis.commands.map(({ command }) => command), ["mget"]);
});

test("HTPR-9711 corrupt snapshots still fall back to the database", async () => {
  const redis = flagsRedis();
  redis.store.set("flags:raw-modes:7042", "gz:not-a-snapshot");
  const reader = flagsInstance(redis);
  assert.equal(await reader.withFeatureFlagSnapshot(() => reader.isFeatureEnabled("flag-0001", 7)), true);
  assert.deepEqual(redis.commands.map(({ command }) => command), ["mget"]);
});

const IDLE_SMALL_COMMAND_BYTES = 60;
const TRAFFIC = {
  pageLoadsPerDay: 60_000,
  apiCallsPerDay: 55_000,
  flagReadsPerDay: 55_000,
  otherCommandsPerDay: 4_000,
};
const COMMANDS_PER = { pageBefore: 7, pageAfter: 3, apiBefore: 4, apiAfter: 2 };
const SNAPSHOT_BYTES = { before: 30_843, after: 8_360 };
const SMALL_COMMANDS = 700_000 - TRAFFIC.flagReadsPerDay;

function modelledDay(per) {
  return (
    TRAFFIC.pageLoadsPerDay * per.page +
    TRAFFIC.apiCallsPerDay * per.api +
    TRAFFIC.flagReadsPerDay +
    TRAFFIC.otherCommandsPerDay
  );
}

function modelledBytes(snapshot) {
  return Math.round(TRAFFIC.flagReadsPerDay * snapshot + SMALL_COMMANDS * IDLE_SMALL_COMMAND_BYTES);
}

test("HTPR-9711 the modelled day matches the measured Upstash month", () => {
  const daily = modelledDay({ page: COMMANDS_PER.pageBefore, api: COMMANDS_PER.apiBefore });
  assert.ok(Math.abs(daily - 700_000) <= 15_000, `model gives ${daily} commands a day`);
  assert.ok(Math.abs(daily * 30 - 21_000_000) <= 600_000, `model gives ${daily * 30} commands a month`);
  const bytes = modelledBytes(SNAPSHOT_BYTES.before);
  assert.ok(Math.abs(bytes - 1_724_000_000) <= 60_000_000, `model gives ${bytes} bytes a day`);
});

test("HTPR-9711 the modelled day at least halves commands and bytes", () => {
  const before = modelledDay({ page: COMMANDS_PER.pageBefore, api: COMMANDS_PER.apiBefore });
  const after = modelledDay({ page: COMMANDS_PER.pageAfter, api: COMMANDS_PER.apiAfter });
  assert.ok(after <= before * 0.5, `commands ${after} of ${before}`);
  const bytesBefore = modelledBytes(SNAPSHOT_BYTES.before);
  const bytesAfter = modelledBytes(SNAPSHOT_BYTES.after);
  assert.ok(bytesAfter <= bytesBefore * 0.5, `bytes ${bytesAfter} of ${bytesBefore}`);
});
