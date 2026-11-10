const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });

test("metrics tally one command without reading metric keys", async () => {
  const calls = [];
  const raw = {
    hincrby: async (key, field, amount) => {
      calls.push(["hincrby", key, field, amount]);
      return amount;
    },
    expire: async () => 1,
    hgetall: async () => ({ human: "2" }),
  };
  const { withRedisAudience } = jiti(path.join(root, "src/lib/redis/audience.ts"));
  const { instrumentRedisMetrics, readUpstashDailyMetrics } = jiti(path.join(root, "src/lib/redis/metrics.ts"));
  const instrumented = instrumentRedisMetrics({ incr: async () => 1 }, raw);
  await withRedisAudience("human", async () => {
    await instrumented.incr("probe");
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2], "human");
  const metrics = await readUpstashDailyMetrics(raw);
  assert.equal(metrics.total, 2);
  assert.equal(metrics.human, 2);
});

test("human flag cache reuses process memory for one minute", async () => {
  const { storeHumanProcessFlagCache, readHumanProcessFlagCache } = jiti(
    path.join(root, "src/lib/flags/modeCache.ts"),
  );
  const rows = [{ key: "htpr-8978-flag", mode: "EVERYONE" }];
  storeHumanProcessFlagCache(rows);
  assert.deepEqual(readHumanProcessFlagCache(), rows);
});
