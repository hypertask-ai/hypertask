const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function load(file, mocks = {}, modules = new Map()) {
  if (modules.has(file)) return modules.get(file).exports;
  const javascript = ts.transpileModule(read(file), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module_ = { exports: {} };
  modules.set(file, module_);
  const importModule = (name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
    const base = name.startsWith("@/") ? `src/${name.slice(2)}` : path.join(path.dirname(file), name);
    const resolved = [base, `${base}.ts`, `${base}.tsx`].find(
      (item) => fs.existsSync(path.join(root, item)) && fs.statSync(path.join(root, item)).isFile(),
    );
    assert.ok(resolved, `Missing import ${name}`);
    return load(resolved, mocks, modules);
  };
  new Function("require", "module", "exports", javascript)(importModule, module_, module_.exports);
  return module_.exports;
}

class FakeRedis {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
    this.calls = [];
  }
  async mget(...keys) {
    this.calls.push(["mget", keys.length]);
    return keys.map((key) => this.values.get(key) ?? null);
  }
  async get(key) {
    this.calls.push(["get", key]);
    return this.values.get(key) ?? null;
  }
  async set(key, value) {
    this.calls.push(["set", key]);
    this.values.set(key, String(value));
    return "OK";
  }
  async info() {
    this.calls.push(["info"]);
    return this.infoText;
  }
}

function sessionModule(redis) {
  return load("src/lib/auth/sessionRevocation.ts", {
    "@/lib/auth/session": {
      SESSION_TTL_SECONDS: 3600,
      sessionRevocationClaims: (token) =>
        token ? { expiresAt: Math.floor(Date.now() / 1000) + 3600, userId: 7, issuedAt: 1000 } : null,
    },
    "@/lib/redis": { getRedis: async () => redis },
  });
}

test("a revocation check costs one mget and repeats answer from memory", async () => {
  const redis = new FakeRedis();
  const { isSessionTokenRevoked } = sessionModule(redis);

  assert.equal(await isSessionTokenRevoked("token-a", { failClosed: false }), false);
  assert.deepEqual(redis.calls, [["mget", 2]]);

  assert.equal(await isSessionTokenRevoked("token-a", { failClosed: false }), false);
  assert.equal(redis.calls.length, 1, "a second check inside the window must not touch Redis");
});

test("a revoked token in Redis is refused and cached", async () => {
  const redis = new FakeRedis();
  const { isSessionTokenRevoked, sessionTokenFingerprint } = sessionModule(redis);
  const fingerprint = sessionTokenFingerprint("token-b");
  redis.values.set(`ht_session:revoked:${fingerprint}`, "1");

  assert.equal(await isSessionTokenRevoked("token-b", { failClosed: false }), true);
  assert.equal(await isSessionTokenRevoked("token-b", { failClosed: false }), true);
  assert.equal(redis.calls.length, 1);
});

test("revoking every session of a user also drops the local cleared answer", async () => {
  const redis = new FakeRedis();
  const { isSessionTokenRevoked, revokeOtherUserSessions } = sessionModule(redis);

  assert.equal(await isSessionTokenRevoked("token-c", { failClosed: false }), false);
  assert.equal(redis.calls.length, 1);

  redis.values.set("ht_session:user-revoked-before:7", String(Math.floor(Date.now() / 1000) + 60));
  assert.equal(await revokeOtherUserSessions(7), true);
  assert.equal(await isSessionTokenRevoked("token-c", { failClosed: false }), true);
  assert.equal(redis.calls.length, 2);
});

test("error intake claims both counters in one command", async () => {
  const route = read("src/app/api/errors/route.ts");
  assert.match(route, /redis\.eval\(INTAKE_CLAIM, 2, ipKey, globalKey, RATE_WINDOW_SECONDS\)/);
  assert.doesNotMatch(route, /incrementWithExpiry/);
  assert.match(route, /return \{ip, global\}/);
});

test("Upstash alarm parses INFO totals and projects a day", () => {
  const { parseTotalCommands, projectDailyRequests } = load("src/lib/ops/upstashRequestAlarm.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/redis": { getRedis: async () => new FakeRedis() },
    "@/utils/controllers/tasks/createTaskCore": { createProvisionedTaskCore: async () => ({ task: { id: 1 } }) },
  });

  assert.equal(
    parseTotalCommands("# Stats\r\ntotal_connections_received:12\r\ntotal_commands_processed:987654\r\n"),
    987654,
  );
  assert.equal(parseTotalCommands("total_commands_processed:not-a-number"), null);
  assert.equal(projectDailyRequests(30_000, 60 * 60 * 1000), 720_000);
  assert.equal(projectDailyRequests(0, 0), 0);
});

function alarmModule(redis, tasks) {
  return load("src/lib/ops/upstashRequestAlarm.ts", {
    "@/lib/prisma": {
      default: {
        task: { findFirst: async () => (tasks.ticketId ? { id: tasks.ticketId } : null) },
        project: {
          findFirst: async () => ({
            uniqueIdentifier: "HTPR",
            section: [{ id: 1, section_title: "Bugs" }],
            labels: [{ id: 2 }],
          }),
        },
      },
    },
    "@/lib/redis": { getRedis: async () => redis },
    "@/utils/controllers/tasks/createTaskCore": {
      createProvisionedTaskCore: async () => {
        tasks.created += 1;
        return { task: { id: 4242 } };
      },
    },
  });
}

test("alarm files one ticket when the projection crosses 300k a day", async () => {
  const redis = new FakeRedis();
  const tasks = { created: 0, ticketId: null };
  const { checkUpstashDailyRequests } = alarmModule(redis, tasks);

  redis.infoText = "total_commands_processed:1000";
  const first = await checkUpstashDailyRequests();
  assert.equal(first.reason, "first-sample");
  assert.equal(tasks.created, 0);

  const sample = JSON.parse(redis.values.get("upstash:requests:sample"));
  redis.values.set("upstash:requests:sample", JSON.stringify({ at: sample.at - 60 * 60 * 1000, total: 1000 - 500_000 }));
  redis.infoText = "total_commands_processed:501000";

  const second = await checkUpstashDailyRequests();
  assert.equal(second.alarm, true);
  assert.equal(second.filedTaskId, 4242);
  assert.equal(tasks.created, 1);

  tasks.ticketId = 4242;
  const afterSecond = JSON.parse(redis.values.get("upstash:requests:sample"));
  redis.values.set("upstash:requests:sample", JSON.stringify({ at: afterSecond.at - 60 * 60 * 1000, total: 500_000 }));
  const third = await checkUpstashDailyRequests();
  assert.equal(third.reason, "already-filed");
  assert.equal(tasks.created, 1);
});

test("alarm stays quiet under 300k a day", async () => {
  const redis = new FakeRedis();
  const tasks = { created: 0, ticketId: null };
  const { checkUpstashDailyRequests } = alarmModule(redis, tasks);

  redis.infoText = "total_commands_processed:1000";
  await checkUpstashDailyRequests();
  const sample = JSON.parse(redis.values.get("upstash:requests:sample"));
  redis.values.set("upstash:requests:sample", JSON.stringify({ at: sample.at - 60 * 60 * 1000, total: 1000 - 4000 }));
  redis.infoText = "total_commands_processed:5000";

  const result = await checkUpstashDailyRequests();
  assert.equal(result.alarm, false);
  assert.equal(result.projectedDailyRequests, 96_000);
  assert.equal(tasks.created, 0);
});
