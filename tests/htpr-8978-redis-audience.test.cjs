const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });

test("agent traffic uses in-memory Redis and records zero production commands", async () => {
  const calls = [];
  const fakeClient = {
    incrby: async (key, amount) => {
      calls.push(["incrby", key, amount]);
      return amount;
    },
    hincrby: async () => 1,
    expire: async () => 1,
    get: async () => null,
    hgetall: async () => ({}),
  };
  const { withRedisAudience } = jiti(path.join(root, "src/lib/redis/audience.ts"));
  const { createMemoryRedisClient } = jiti(path.join(root, "src/lib/redis/memoryClient.ts"));
  const memory = createMemoryRedisClient();
  await withRedisAudience("agent", async () => {
    await memory.set("agent-runtime:test", "1");
    assert.equal(await memory.get("agent-runtime:test"), "1");
  });
  const { instrumentRedisMetrics } = jiti(path.join(root, "src/lib/redis/metrics.ts"));
  const instrumented = instrumentRedisMetrics(fakeClient, fakeClient);
  await withRedisAudience("human", async () => {
    await instrumented.incrby("probe", 1);
  });
  assert.deepEqual(calls, [["incrby", "probe", 1]]);
});

test("human flag cache reuses process memory for one minute", async () => {
  const { storeHumanProcessFlagCache, readHumanProcessFlagCache } = jiti(
    path.join(root, "src/lib/flags/modeCache.ts"),
  );
  const rows = [{ key: "htpr-8978-flag", mode: "EVERYONE" }];
  storeHumanProcessFlagCache(rows);
  assert.deepEqual(readHumanProcessFlagCache(), rows);
});
