const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { actor, root, loadTs, memoryRedis } = require("./slack-app-fixtures.cjs");

async function concurrentTurns(redis) {
  const { saveSlackChatTurn, loadSlackChatContext } = loadTs("src/lib/slack/assistant.ts", { "@/lib/redis": { getRedis: async () => redis } });
  const input = { channelId: "D1", threadTs: "1.0" };
  await Promise.all(Array.from({ length: 20 }, (_, index) => saveSlackChatTurn(actor, input, `turn-${index}`, [{ text: `result-${index}` }])));
  const history = await loadSlackChatContext(actor, input);
  for (let index = 0; index < 20; index++) {
    assert.ok(history.includes(`User: turn-${index}\n`), `lost turn ${index}`);
    assert.ok(history.includes(`"result-${index}"`), `lost result ${index}`);
  }
  assert.equal(history.match(/User:/g).length, 20);
  return { saveSlackChatTurn, loadSlackChatContext, input };
}

test("concurrent completed turns are appended without overwriting one another", async () => {
  await concurrentTurns(memoryRedis());
});

test("atomic history append runs against Redis and retains UTF-8, expiry and identity isolation", { skip: spawnSync("redis-server", ["--version"]).error?.code === "ENOENT", timeout: 20_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(root, ".slack-redis-"));
  const socket = path.join(directory, "redis.sock");
  const server = spawn("redis-server", ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"], { stdio: ["ignore", "pipe", "pipe"] });
  let redis;
  t.after(async () => {
    if (redis) redis.disconnect();
    if (server.exitCode === null) {
      await new Promise((resolve) => { server.once("close", resolve); server.kill("SIGTERM"); });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Redis exited before readiness: ${code}`)));
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("ready to accept connections")) resolve(); });
  });
  const Redis = require("ioredis").default;
  redis = new Redis(socket, { protocol: 2 });
  const { saveSlackChatTurn, loadSlackChatContext, input } = await concurrentTurns(redis);
  const key = `slack:assistant:${actor.installId}:D1:1.0:${actor.slackUserId}`;
  assert.ok(await redis.ttl(key) > 86_390);
  await saveSlackChatTurn(actor, input, "🙂".repeat(3_000), [{ text: "latest" }]);
  const history = await loadSlackChatContext(actor, input);
  assert.ok(Buffer.byteLength(await redis.hget(key, `history:${actor.user.id}`)) <= 8_000);
  assert.ok(history.length <= 8_000);
  assert.ok(!history.includes("\uFFFD"));
  assert.ok(history.includes("latest"));
  assert.equal(await loadSlackChatContext({ ...actor, user: { ...actor.user, id: 99 } }, input), "");
});
