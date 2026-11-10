const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

class FakeRedis {
  constructor() { this.values = new Map(); this.calls = []; this.infoText = ""; }
  async mget(...keys) { this.calls.push("mget"); return keys.map((key) => this.values.get(key) ?? null); }
  async set(key, value) { this.calls.push("set"); this.values.set(key, String(value)); return "OK"; }
  async get(key) { this.calls.push("get"); return this.values.get(key) ?? null; }
  async info() { this.calls.push("info"); return this.infoText; }
}

const sessionModule = (redis) => loadModule("src/lib/auth/sessionRevocation.ts", {
  "@/lib/auth/session": {
    SESSION_TTL_SECONDS: 3600,
    sessionRevocationClaims: (token) => (token ? { expiresAt: Math.floor(Date.now() / 1000) + 3600, userId: 7, issuedAt: 1000 } : null),
  },
  "@/lib/redis": { getRedis: async () => redis },
});

test("a revocation check costs one command, down from two", async () => {
  const redis = new FakeRedis();
  assert.equal(await sessionModule(redis).isSessionTokenRevoked("token-a", { failClosed: false }), false);
  assert.deepEqual(redis.calls, ["mget"]);
});

test("the error intake claims both counters in one command behind the ticket flag", () => {
  const route = read("src/app/api/errors/route.ts");
  assert.match(route, /HTPR_8978_UPSTASH_TRAFFIC_FLAG/);
  assert.match(route, /redis\.eval\(INTAKE_CLAIM, 2, ipKey, globalKey, RATE_WINDOW_SECONDS\)/);
});

function alarmModule(redis, tasks) {
  return loadModule("src/lib/ops/upstashRequestAlarm.ts", {
    "@/lib/prisma": {
      default: {
        task: { findFirst: async () => (tasks.ticketId ? { id: tasks.ticketId } : null) },
        project: { findFirst: async () => ({ uniqueIdentifier: "HTPR", section: [{ id: 1, section_title: "Bugs" }], labels: [{ id: 2 }] }) },
      },
    },
    "@/lib/redis": { getRedis: async () => redis },
    "@/utils/controllers/tasks/createTaskCore": {
      createProvisionedTaskCore: async () => { tasks.created += 1; return { task: { id: 4242 } }; },
    },
  });
}

function backdateSample(redis, total) {
  const sample = JSON.parse(redis.values.get("upstash:requests:sample"));
  redis.values.set("upstash:requests:sample", JSON.stringify({ at: sample.at - 3_600_000, total }));
}

test("the alarm parses INFO totals and projects a day", () => {
  const { parseTotalCommands, projectDailyRequests } = alarmModule(new FakeRedis(), { created: 0, ticketId: null });
  assert.equal(parseTotalCommands("# Stats\r\ntotal_connections_received:12\r\ntotal_commands_processed:987654\r\n"), 987654);
  assert.equal(parseTotalCommands("total_commands_processed:not-a-number"), null);
  assert.equal(projectDailyRequests(30_000, 60 * 60 * 1000), 720_000);
  assert.equal(projectDailyRequests(0, 0), 0);
});

test("the alarm files one ticket over 300k a day and one only", async () => {
  const redis = new FakeRedis();
  const tasks = { created: 0, ticketId: null };
  const { checkUpstashDailyRequests } = alarmModule(redis, tasks);

  redis.infoText = "total_commands_processed:1000";
  assert.equal((await checkUpstashDailyRequests()).reason, "first-sample");
  assert.equal(tasks.created, 0);

  backdateSample(redis, 1000);
  redis.infoText = "total_commands_processed:501000";
  assert.equal((await checkUpstashDailyRequests()).filedTaskId, 4242);
  assert.equal(tasks.created, 1);

  tasks.ticketId = 4242;
  backdateSample(redis, 1000);
  assert.equal((await checkUpstashDailyRequests()).reason, "already-filed");
  assert.equal(tasks.created, 1);
});

test("the alarm stays quiet under 300k a day", async () => {
  const redis = new FakeRedis();
  const tasks = { created: 0, ticketId: null };
  const { checkUpstashDailyRequests } = alarmModule(redis, tasks);

  redis.infoText = "total_commands_processed:1000";
  await checkUpstashDailyRequests();
  backdateSample(redis, 0);
  redis.infoText = "total_commands_processed:4000";

  const result = await checkUpstashDailyRequests();
  assert.equal(result.alarm, false);
  assert.equal(result.projectedDailyRequests, 96_000);
  assert.equal(tasks.created, 0);
});
