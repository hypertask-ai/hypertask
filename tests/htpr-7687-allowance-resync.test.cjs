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
const resyncFlagUsers = [];
stubModule("src/lib/flags.ts", {
  isFeatureEnabled: async (key, userId) => {
    if (key !== "htpr-7687-allowance-resync") return key === "htpr-7079-failed-ai-allowance";
    resyncFlagUsers.push(userId);
    return resyncFlagOn;
  },
});

const jiti = require("jiti")(path.join(root, "tests/htpr-7687-allowance-resync.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { createSharedAllowanceMiddleware, reservePlanAllowance, settlePlanAllowance, SharedAiAllowanceExceededError } = jiti(
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
        results: [{ tag: `team:${TEAM}`, total_cost: gateway.teamSpendUsd },
          ...(gateway.systemSpendUsd ? [{ tag: "included-with-hypertask", total_cost: gateway.systemSpendUsd }] : [])],
      }));
    }
    throw new Error(`Unexpected fetch ${value}`);
  };
}

const JOURNAL_OLD_ENOUGH_MS = 26 * 60 * 1000;

async function freshTeam(committedMicroUsd, { journalAgeMs = JOURNAL_OLD_ENOUGH_MS } = {}) {
  await client.flushall();
  if (journalAgeMs !== null) {
    await client.set(`${prefix}:recent-settled-since`, String(Date.now() - journalAgeMs));
  }
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

const fullReservation = Math.ceil(((2 * 0.000001 + 16_000 * 0.00005) * 1.5 + 0.01) * 1_000_000);

async function ageJournal(minutes) {
  const journalKey = `${prefix}:recent-settled`;
  const members = await client.zrange(journalKey, 0, -1);
  for (const member of members) {
    await client.zadd(journalKey, Date.now() - minutes * 60 * 1000, member);
  }
}

test("a stopped answer still counts the whole reservation, since hidden reasoning is billed", async () => {
  await freshTeam(0);
  await stopStreamAfter(300);
  assert.equal(await committed(), fullReservation);
  assert.equal(await client.zcard(reservationsKey), 0);
});

test("refused: a stopped answer inside the report-delay window keeps its full charge", async () => {
  await freshTeam(CAP_MICRO_USD - fullReservation);
  await stopStreamAfter(300);
  gateway.teamSpendUsd = (CAP_MICRO_USD - fullReservation) / 1_000_000;
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(await committed(), CAP_MICRO_USD);
});

test("allowed: a stopped answer's over-count is corrected once it leaves the report-delay window", async () => {
  await freshTeam(CAP_MICRO_USD - fullReservation);
  await stopStreamAfter(300);
  await ageJournal(16);
  gateway.teamSpendUsd = CAP_USD * 0.5;
  await answer();
  const after = await committed();
  assert.ok(after >= CAP_MICRO_USD * 0.5 && after < CAP_MICRO_USD * 0.5 + 1_000, `committed ${after}`);
});

test("refused: a journal younger than the report delay never lowers the counter", async () => {
  await freshTeam(CAP_MICRO_USD, { journalAgeMs: 5 * 60 * 1000 });
  gateway.teamSpendUsd = CAP_USD * 0.4;
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(await committed(), CAP_MICRO_USD);
});

test("refused: the first resync after switching on only starts the journal and keeps pre-flag spend", async () => {
  await freshTeam(CAP_MICRO_USD, { journalAgeMs: null });
  gateway.teamSpendUsd = CAP_USD * 0.4;
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(await committed(), CAP_MICRO_USD);
  assert.ok(Number(await client.get(`${prefix}:recent-settled-since`)) > Date.now() - 60_000);
});

test("a finished answer still counts its real usage", async () => {
  await freshTeam(0);
  await answer(1_000);
  assert.equal(await committed(), Math.ceil((2 * 0.000001 + 1_000 * 0.00005) * 1_000_000));
});

test("with the flag off a refusal never asks the gateway", async () => {
  resyncFlagOn = false;
  await freshTeam(CAP_MICRO_USD);
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(gateway.reportCalls, 0);
  assert.equal(await committed(), CAP_MICRO_USD);
});

test("refused: an expired reservation swept into the counter is journaled, so a lagging gateway cannot erase it", async () => {
  await freshTeam(3_000_000);
  await client.zadd(reservationsKey, 1, "expired-call|2000000");
  gateway.teamSpendUsd = 3;
  await assert.rejects(answer(), /used its included AI allowance/);
  assert.equal(await committed(), 5_000_000);
});

test("allowed: reported legacy pending spend is not counted twice by a resync", async () => {
  await freshTeam(2_500_000);
  await client.set(`${prefix}:legacy-pending`, "2500000");
  gateway.teamSpendUsd = 4;
  await answer();
  const after = await committed();
  assert.ok(after >= 1_500_000 && after < 1_510_000, `committed ${after}`);
});

test("refused: spend settled while the flag is off is journaled too, so a lagging gateway cannot erase it", async () => {
  await freshTeam(CAP_MICRO_USD - 1_300_000);
  resyncFlagOn = false;
  await answer(26_000);
  assert.equal(await client.zcard(`${prefix}:recent-settled`), 1);
  resyncFlagOn = true;
  gateway.teamSpendUsd = (CAP_MICRO_USD - 1_300_000) / 1_000_000;
  await assert.rejects(answer(20_000), /used its included AI allowance/);
  assert.ok(await committed() >= CAP_MICRO_USD);
});

for (const lane of ["visible", "system"]) {
  test(`plan ${lane} month refusal resyncs both lanes and preserves the system journal`, async () => {
    await freshTeam(100000);
    const systemPrefix = `${prefix}:system`;
    const systemSince = String(Date.now() - JOURNAL_OLD_ENOUGH_MS);
    await client.set(`${systemPrefix}:committed`, String(CAP_MICRO_USD));
    await client.set(`${systemPrefix}:recent-settled-since`, systemSince);
    await client.zadd(`${systemPrefix}:recent-settled`, Date.now(), "recent-system|200000");
    await client.set(`${prefix}:legacy-pending`, "100000");
    gateway.teamSpendUsd = 0.7;
    gateway.systemSpendUsd = 0.3;
    const policy = { mode: "plan", monthlyUsd: CAP_USD, dailyUsd: null, demoGlobal: false };
    const reservation = await reservePlanAllowance({ teamId: TEAM, policy, gatewayApiKey: "vck_test", amountUsd: 0.2, lane });
    assert.equal(gateway.reportCalls, 2, "both month lanes get their matching gateway spend");
    assert.equal(await committed(), 300000, "visible spend deducts legacy pending once");
    assert.equal(await client.get(`${systemPrefix}:committed`), "500000", "recent system settlement stays protected");
    assert.deepEqual(await client.zrange(`${systemPrefix}:recent-settled`, 0, -1), ["recent-system|200000"]);
    assert.equal(await client.get(`${systemPrefix}:recent-settled-since`), systemSince);
    assert.equal(await client.get(`${prefix}:gateway-resync-lock`), "1");
    assert.equal(await client.get(`${systemPrefix}:gateway-resync-lock`), "1");
    assert.equal(reservation.scopes[0].committedKey, lane === "system" ? `${systemPrefix}:committed` : committedKey);
    assert.deepEqual(await client.zrange(reservation.scopes[0].reservationsKey, 0, -1), [reservation.id]);
    await assert.rejects(reservePlanAllowance({ teamId: TEAM, policy, gatewayApiKey: "vck_test", amountUsd: 4.2, lane }),
      (error) => error instanceof SharedAiAllowanceExceededError && error.reason === "month");
    assert.equal(gateway.reportCalls, 2, "each lane's lock throttles further resyncs");
    await settlePlanAllowance(reservation, 0.01);
    const journal = await client.zrange(reservation.scopes[0].committedKey.replace(/:committed$/, ":recent-settled"), 0, -1);
    assert.ok(journal.includes(`${reservation.id}|10000`), "journal member ends in actual settled cost");
  });
}

test("plan month retries when only the system lane can resync", async () => {
  await freshTeam(0);
  await client.set(`${prefix}:gateway-resync-lock`, "1", "EX", 60);
  await client.set(`${prefix}:system:committed`, String(CAP_MICRO_USD));
  await client.set(`${prefix}:system:recent-settled-since`, String(Date.now() - JOURNAL_OLD_ENOUGH_MS));
  gateway.teamSpendUsd = 0.5;
  gateway.systemSpendUsd = 0.5;
  const reservation = await reservePlanAllowance({ teamId: TEAM,
    policy: { mode: "plan", monthlyUsd: CAP_USD, dailyUsd: null, demoGlobal: false },
    gatewayApiKey: "vck_test", amountUsd: 0.2 });
  assert.equal(gateway.reportCalls, 1);
  assert.equal(await client.get(`${prefix}:system:committed`), "500000");
  assert.deepEqual(await client.zrange(reservationsKey, 0, -1), [reservation.id]);
});

test("plan month refusal does not retry when neither resync changes a counter", async (t) => {
  await freshTeam(CAP_MICRO_USD);
  gateway.teamSpendUsd = CAP_USD;
  let attempts = 0;
  const originalEval = client.eval;
  client.eval = function (script, ...args) {
    if (script.includes("local scopes =")) attempts++;
    return originalEval.call(this, script, ...args);
  };
  t.after(() => { client.eval = originalEval; });
  await assert.rejects(reservePlanAllowance({ teamId: TEAM,
    policy: { mode: "plan", monthlyUsd: CAP_USD, dailyUsd: null, demoGlobal: false },
    gatewayApiKey: "vck_test", amountUsd: 0.01 }),
    (error) => error instanceof SharedAiAllowanceExceededError && error.reason === "month");
  assert.equal(gateway.reportCalls, 2);
  assert.equal(attempts, 1);
  assert.equal(await committed(), CAP_MICRO_USD);
});

test("plan day refusal never resyncs or calls the gateway", async () => {
  await freshTeam(0);
  const dayPrefix = `ai-allowance:day:${aiAllowancePeriod().endDate}:${TEAM}`;
  await client.set(`${dayPrefix}:seeded`, "1");
  await client.set(`${dayPrefix}:committed`, "250000");
  await assert.rejects(reservePlanAllowance({ teamId: TEAM,
    policy: { mode: "plan", monthlyUsd: CAP_USD, dailyUsd: 0.25, demoGlobal: false },
    gatewayApiKey: "vck_test", amountUsd: 0.01 }),
    (error) => error instanceof SharedAiAllowanceExceededError && error.reason === "day");
  assert.equal(gateway.reportCalls, 0);
  assert.equal(await client.get(`${dayPrefix}:committed`), "250000");
  assert.equal(await client.exists(`${prefix}:gateway-resync-lock`), 0);
  assert.equal(await client.exists(`${prefix}:system:gateway-resync-lock`), 0);
  assert.equal(await client.zcard(reservationsKey), 0);
  assert.equal(await client.zcard(`${dayPrefix}:reservations`), 0);
});

test("plan demo refusal never resyncs or calls the gateway", async () => {
  await freshTeam(0);
  const demoPrefix = `ai-allowance:demo:${aiAllowancePeriod().key}`;
  await client.set(`${demoPrefix}:seeded`, "1");
  await client.set(`${demoPrefix}:committed`, "15000000");
  await assert.rejects(reservePlanAllowance({ teamId: TEAM,
    policy: { mode: "plan", monthlyUsd: CAP_USD, dailyUsd: null, demoGlobal: true },
    gatewayApiKey: "vck_test", amountUsd: 0.01 }),
    (error) => error instanceof SharedAiAllowanceExceededError && error.reason === "demo");
  assert.equal(gateway.reportCalls, 0);
  assert.equal(await client.get(`${demoPrefix}:committed`), "15000000");
  assert.equal(await client.exists(`${prefix}:gateway-resync-lock`), 0);
  assert.equal(await client.exists(`${prefix}:system:gateway-resync-lock`), 0);
  assert.equal(await client.zcard(reservationsKey), 0);
  assert.equal(await client.zcard(`${demoPrefix}:reservations`), 0);
});

test("the flag is read for the user who makes the call, so Owner + QA reaches Valentin and QA", async () => {
  await freshTeam(0);
  resyncFlagUsers.length = 0;
  await middleware().wrapGenerate({
    params: { ...params, providerOptions: { gateway: { tags: [`team:${TEAM}`, "user:985"] } } },
    model: {},
    doStream: async () => { throw new Error("unused"); },
    doGenerate: async () => ({ content: [], usage: { inputTokens: { total: 2 }, outputTokens: { total: 1 } } }),
  });
  await answer();
  assert.deepEqual(resyncFlagUsers, [985, 0]);
});
