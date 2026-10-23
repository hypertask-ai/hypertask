const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createServer } = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const Redis = require("ioredis");

const root = path.resolve(__dirname, "..");
const TEAM = "drifted-team";
const CAP_USD = 5;
const CAP_MICRO_USD = CAP_USD * 1_000_000;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

let client;
let resyncFlagOn = true;
stubModule("src/lib/redis.ts", { getRedis: async () => client });
stubModule("src/lib/flags.ts", {
  isFeatureEnabled: async (key) =>
    key === "htpr-7687-allowance-resync"
      ? resyncFlagOn
      : key === "htpr-7079-failed-ai-allowance",
});

const jiti = require("jiti")(path.join(root, "tests/htpr-7687-allowance-resync.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { createSharedAllowanceMiddleware } = jiti(
  path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"),
);
const { aiAllowancePeriod } = jiti(path.join(root, "src/lib/aiAllowancePolicy.ts"));

const prefix = `ai-allowance:${aiAllowancePeriod().key}:${TEAM}`;
const committedKey = `${prefix}:committed`;
const reservationsKey = `${prefix}:reservations`;

let gateway = { reportCalls: 0, teamSpendUsd: 0, reportFails: false };

function installFetch() {
  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith("/models")) {
      return new Response(JSON.stringify({
        data: [{ id: "test/model", pricing: { input: "0.000001", output: "0.00005" } }],
      }));
    }
    if (value.includes("/report?")) {
      gateway.reportCalls += 1;
      if (gateway.reportFails) return new Response("down", { status: 503 });
      return new Response(JSON.stringify({
        results: [{ tag: `team:${TEAM}`, total_cost: gateway.teamSpendUsd }],
      }));
    }
    throw new Error(`Unexpected fetch ${value}`);
  };
}

async function freshTeam(committedMicroUsd) {
  await client.flushall();
  await client.set(`${prefix}:system-split-v1`, String(Date.now()));
  await client.set(`${prefix}:legacy-reconcile-complete`, "1");
  await client.set(committedKey, String(committedMicroUsd));
  gateway = { reportCalls: 0, teamSpendUsd: 0, reportFails: false };
}

const middleware = () => createSharedAllowanceMiddleware({
  allowanceUsd: CAP_USD,
  gatewayApiKey: "vck_test",
  modelSlug: "test/model",
});

const params = { prompt: [], maxOutputTokens: 1, providerOptions: { gateway: { tags: [`team:${TEAM}`] } } };

function answer(outputTokens = 1) {
  return middleware().wrapGenerate({
    params,
    model: {},
    doStream: async () => { throw new Error("unused"); },
    doGenerate: async () => ({
      content: [],
      usage: { inputTokens: { total: 2 }, outputTokens: { total: outputTokens } },
    }),
  });
}

async function committed() {
  return Number(await client.get(committedKey));
}

let server;
test.before(async () => {
  const port = await new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const redisArgs = ["--bind", "127.0.0.1", "--port", String(port), "--save", "", "--appendonly", "no"];
  server = spawnSync("redis-server", ["--version"]).status === 0
    ? spawn("redis-server", redisArgs)
    : spawn("docker", ["run", "--rm", "--network", "host",
      "ghcr.io/hypertask-ai/ci-redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf",
      "redis-server", ...redisArgs]);
  await new Promise((resolve, reject) => {
    let output = "";
    server.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Ready to accept connections")) resolve();
    });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Redis exited ${code}`)));
  });
  client = new Redis(`redis://127.0.0.1:${port}`);
  installFetch();
});

test.after(async () => {
  client?.disconnect();
  server?.kill("SIGTERM");
});

test.beforeEach(() => {
  resyncFlagOn = true;
});

test("refused: a counter at the cap with the gateway also at the cap stays refused", async () => {
  await freshTeam(CAP_MICRO_USD);
  gateway.teamSpendUsd = CAP_USD;
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(await committed(), CAP_MICRO_USD);
  assert.equal(gateway.reportCalls, 1);
});

test("allowed: a counter drifted to the cap is re-synced to the gateway's real 40% and the call runs", async () => {
  await freshTeam(CAP_MICRO_USD);
  gateway.teamSpendUsd = CAP_USD * 0.4;
  await answer();
  assert.equal(gateway.reportCalls, 1);
  const after = await committed();
  assert.ok(after >= CAP_MICRO_USD * 0.4 && after < CAP_MICRO_USD * 0.4 + 1_000, `committed ${after}`);
});

test("refused: a failed gateway lookup keeps the counter and the refusal", async () => {
  await freshTeam(CAP_MICRO_USD);
  gateway.reportFails = true;
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(await committed(), CAP_MICRO_USD);
});

test("refused: real spend over the cap with a stale low gateway number stays refused", async () => {
  await freshTeam(CAP_MICRO_USD - 3_000_000);
  gateway.teamSpendUsd = 0;
  for (let call = 0; call < 3; call += 1) await answer(20_000);
  const realSpend = await committed();
  assert.ok(realSpend >= CAP_MICRO_USD, `real spend ${realSpend}`);

  gateway.teamSpendUsd = (CAP_MICRO_USD - 3_000_000) / 1_000_000;
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(gateway.reportCalls, 1);
  assert.equal(await committed(), realSpend);
});

test("the gateway is asked at most once a minute per team", async () => {
  await freshTeam(CAP_MICRO_USD);
  gateway.teamSpendUsd = CAP_USD;
  await assert.rejects(answer(), /used its included AI allowance/);
  await assert.rejects(answer(), /used its included AI allowance/);
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(gateway.reportCalls, 1);
});

test("a gateway number above the counter raises it to the real spend", async () => {
  await freshTeam(CAP_MICRO_USD);
  gateway.teamSpendUsd = CAP_USD * 1.2;
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(await committed(), CAP_MICRO_USD * 1.2);
});

async function stopStreamAfter(characters) {
  const result = await middleware().wrapStream({
    params: { ...params, maxOutputTokens: undefined },
    model: {},
    doGenerate: async () => { throw new Error("unused"); },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-delta", id: "t", delta: "x".repeat(characters) });
        },
      }),
    }),
  });
  const reader = result.stream.getReader();
  await reader.read();
  await reader.read();
  await reader.cancel("user stopped");
}

test("a stopped answer counts what was streamed, not the whole reservation", async () => {
  await freshTeam(0);
  await stopStreamAfter(300);
  const expected = Math.ceil((2 * 0.000001 + 100 * 0.00005) * 1_000_000);
  assert.equal(await committed(), expected);
  assert.equal(await client.zcard(reservationsKey), 0);
});

test("with the flag off a stopped answer still counts the whole reservation", async () => {
  resyncFlagOn = false;
  await freshTeam(0);
  await stopStreamAfter(300);
  assert.ok(await committed() > 1_000_000);
});

test("a finished answer still counts its real usage", async () => {
  await freshTeam(0);
  await answer(1_000);
  assert.equal(await committed(), Math.ceil((2 * 0.000001 + 1_000 * 0.00005) * 1_000_000));
});

test("an expired reservation counts its input only; an old-format one still counts in full", async () => {
  await freshTeam(0);
  await client.zadd(reservationsKey, 1, "expired-new|7|900000", 1, "expired-old|400000");
  await answer();
  const settledAnswer = Math.ceil((2 * 0.000001 + 0.00005) * 1_000_000);
  assert.equal(await committed(), 7 + 400_000 + settledAnswer);
});
