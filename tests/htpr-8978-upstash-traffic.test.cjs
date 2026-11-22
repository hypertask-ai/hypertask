const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { NextRequest } = require("next/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const DAY_MS = 24 * 60 * 60 * 1000;

test("command-line and agent callers skip the shared flag cache", () => {
  const { upstashFlagAudience, flagCacheSkipsUpstash } = loadModule("src/lib/flags/modeCache.ts");
  assert.equal(upstashFlagAudience("htk_cli", null), "cli");
  assert.equal(upstashFlagAudience("htk_cli", "agent-1"), "agent");
  assert.equal(upstashFlagAudience("user-jwt", null), undefined);
  assert.equal(upstashFlagAudience("user-jwt", ""), undefined);
  assert.equal(flagCacheSkipsUpstash("cli"), true);
  assert.equal(flagCacheSkipsUpstash("agent"), true);
  assert.equal(flagCacheSkipsUpstash("human"), false);
  assert.equal(flagCacheSkipsUpstash(undefined), false);
});

test("the tool connection relays between module copies and sends no Redis commands", () => {
  const first = loadModule("src/lib/mcp-server/legacySseBus.ts");
  const second = loadModule("src/lib/mcp-server/legacySseBus.ts");
  const channel = `htpr-8978:${Date.now()}`;
  const seen = [];
  const stop = first.subscribeLegacySse(channel, (message) => { seen.push(message); });
  assert.equal(second.publishLegacySse(channel, "tool-call"), 1);
  assert.deepEqual(seen, ["tool-call"]);
  stop();
  assert.equal(first.publishLegacySse(channel, "after-close"), 0);
  assert.equal(second.publishLegacySse("missing-session", "x"), 0);
});

function alarm() {
  return loadModule("src/lib/ops/upstashCommandAlarm.ts");
}

test("a day at or under 300,000 commands does not file, and one request over does", () => {
  const { nextCommandSample, readCommandTotal, UPSTASH_DAILY_COMMAND_LIMIT } = alarm();
  const start = Date.parse("2026-11-22T00:00:00.000Z");
  assert.equal(readCommandTotal("# Stats\r\ntotal_commands_processed:10\r\n"), 10);
  assert.equal(readCommandTotal("no-total"), null);
  const first = nextCommandSample(null, 10, start);
  assert.equal(first.alert, false);
  assert.equal(first.commands, null);
  assert.equal(first.replace, true);
  const early = nextCommandSample(first.next, 10 + UPSTASH_DAILY_COMMAND_LIMIT + 1, start + DAY_MS - 1);
  assert.equal(early.alert, false);
  assert.equal(early.replace, false);
  const onTheLine = nextCommandSample(first.next, 10 + UPSTASH_DAILY_COMMAND_LIMIT, start + DAY_MS);
  assert.equal(onTheLine.commands, UPSTASH_DAILY_COMMAND_LIMIT);
  assert.equal(onTheLine.alert, false);
  assert.equal(onTheLine.replace, true);
  const over = nextCommandSample(first.next, 10 + UPSTASH_DAILY_COMMAND_LIMIT + 1, start + DAY_MS);
  assert.equal(over.commands, UPSTASH_DAILY_COMMAND_LIMIT + 1);
  assert.equal(over.alert, true);
  const restarted = nextCommandSample(first.next, 3, start + DAY_MS);
  assert.equal(restarted.alert, false);
  assert.deepEqual(restarted.next, { total: 3, at: start + DAY_MS });
  const opened = Date.parse("2026-11-22T05:51:30.000Z");
  const nextMorning = Date.parse("2026-11-23T05:51:00.000Z");
  const skewed = nextCommandSample({ total: 10, at: opened }, 10 + UPSTASH_DAILY_COMMAND_LIMIT + 1, nextMorning);
  assert.equal(skewed.alert, true);
  assert.equal(skewed.replace, true);
  assert.equal(skewed.next.at, nextMorning);
  const skewedLine = nextCommandSample({ total: 10, at: opened }, 10 + UPSTASH_DAILY_COMMAND_LIMIT, nextMorning);
  assert.equal(skewedLine.alert, false);
  assert.equal(skewedLine.replace, true);
  const twoDays = nextCommandSample({ total: 10, at: opened }, 10 + 400_000, opened + 2 * DAY_MS);
  assert.equal(twoDays.commands, 200_000);
  assert.equal(twoDays.alert, false);
  assert.equal(twoDays.replace, true);
  const twoDaysOver = nextCommandSample({ total: 10, at: opened }, 10 + 600_001, opened + 2 * DAY_MS);
  assert.equal(twoDaysOver.alert, true);
  assert.equal(twoDaysOver.replace, true);
});

test("the daily alarm files one Urgent ticket and the cron refuses the wrong caller", async () => {
  const { runUpstashCommandCheck, upstashAlarmDay, upstashAlarmMarker, UPSTASH_DAILY_COMMAND_LIMIT } = alarm();
  const now = Date.parse("2026-11-22T05:51:00.000Z");
  const day = upstashAlarmDay(now);
  assert.equal(upstashAlarmMarker(day), "upstash-daily-commands:2026-11-22");
  const sample = { current: null };
  const created = [];
  const deps = (info, at) => ({
    now: at,
    info,
    readSample: async () => sample.current,
    writeSample: async (value) => { sample.current = value; },
    claim: async () => true,
    findTicket: async (marker) => created.find((ticket) => ticket.description.includes(marker))?.id ?? null,
    createTicket: async (ticket) => {
      created.push(ticket);
      return created.length;
    },
  });
  const quiet = await runUpstashCommandCheck(deps("total_commands_processed:10", now));
  assert.equal(quiet.filed, false);
  assert.equal(created.length, 0);
  const over = await runUpstashCommandCheck(deps(`total_commands_processed:${10 + UPSTASH_DAILY_COMMAND_LIMIT + 1}`, now + DAY_MS));
  assert.equal(over.filed, true);
  assert.equal(over.taskId, 1);
  assert.equal(created[0].priorityIndex, 1);
  assert.match(created[0].description, /Marker: upstash-daily-commands:2026-11-23/);
  const again = await runUpstashCommandCheck(deps(`total_commands_processed:${10 + UPSTASH_DAILY_COMMAND_LIMIT + 50}`, now + DAY_MS));
  assert.equal(again.filed, false);
  assert.equal(created.length, 1);
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "cron-secret";
  const redisCalls = [];
  try {
    const { GET } = loadModule("src/app/api/cron/upstash-commands/route.ts", {
      "@/lib/redis": { getRedis: async () => ({
        info: async () => { redisCalls.push("info"); return "total_commands_processed:1"; },
        get: async () => null,
        set: async () => "OK",
      }) },
      "@/lib/prisma": { default: { task: { findFirst: async () => null }, project: { findFirst: async () => null } } },
      "@/utils/controllers/tasks/createTaskCore": { createProvisionedTaskCore: async () => { throw new Error("no ticket on the first sample"); } },
    });
    const request = (authorization) => GET(new NextRequest("https://app.hypertask.ai/api/cron/upstash-commands", {
      headers: authorization ? { authorization } : {},
    }));
    assert.equal((await request()).status, 401);
    assert.equal((await request("Bearer wrong")).status, 401);
    assert.equal(redisCalls.length, 0);
    const allowed = await request("Bearer cron-secret");
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { commands: null, filed: false, taskId: null });
    assert.deepEqual(redisCalls, ["info"]);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
  const crons = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")).crons;
  assert.equal(crons.find((entry) => entry.path === "/api/cron/upstash-commands").schedule, "51 5 * * *");
});

function token(payload) {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

test("agent and command-line calls are limited without Upstash, and a human call still counts there", async () => {
  let redisCalls = 0;
  const redis = { incr: async () => { redisCalls += 1; return redisCalls; }, expire: async () => 1 };
  const { checkMcpRateLimit, rateLimitSkipsUpstash } = loadModule("src/lib/mcp/auth/rateLimit.ts", {
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags/keys": { HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG: "htpr-7462-mcp-ratelimit-exact-count" },
    "@/lib/flags": { featureFlagCandidateUserIds: async () => null },
    "./session": {
      extractBearerToken: (value) => value?.replace(/^Bearer /, "") ?? null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: null, teamScope: null }),
    },
    "../operationContext": { getMcpOperationContext: () => undefined },
  });
  const agentJwt = token({ agentId: "agent-1" });
  assert.equal(rateLimitSkipsUpstash("htk_cli"), true);
  assert.equal(rateLimitSkipsUpstash(agentJwt), true);
  assert.equal(rateLimitSkipsUpstash(token({ userId: 6 })), false);
  assert.equal(rateLimitSkipsUpstash("not a jwt"), false);
  const call = (bearer) => checkMcpRateLimit(new NextRequest("https://app.hypertask.ai/api/mcp/tasks", {
    headers: { authorization: `Bearer ${bearer}` },
  }));
  assert.equal(await call("htk_cli"), null);
  assert.equal(await call(agentJwt), null);
  assert.equal(redisCalls, 0);
  for (let i = 0; i < 599; i += 1) assert.equal(await call("htk_cli"), null);
  const refused = await call("htk_cli");
  assert.equal(refused.status, 429);
  assert.equal(redisCalls, 0, "agent and command-line calls send no Upstash commands");
  assert.equal(await call("human-session"), null);
  assert.equal(redisCalls, 1, "a human call still uses Upstash");
});

test("distinct unauthenticated command-line tokens cannot grow the in-memory limit without a cap", async () => {
  let redisCalls = 0;
  const { checkMcpRateLimit } = loadModule("src/lib/mcp/auth/rateLimit.ts", {
    "@/lib/redis": { getRedis: async () => { redisCalls += 1; return { incr: async () => 1, expire: async () => 1 }; } },
    "@/lib/flags/keys": { HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG: "htpr-7462-mcp-ratelimit-exact-count" },
    "@/lib/flags": { featureFlagCandidateUserIds: async () => null },
    "./session": {
      extractBearerToken: (value) => value?.replace(/^Bearer /, "") ?? null,
      validateMcpAuth: async () => null,
    },
    "../operationContext": { getMcpOperationContext: () => undefined },
  });
  const call = (bearer) => checkMcpRateLimit(new NextRequest("https://app.hypertask.ai/api/mcp/tasks", {
    headers: { authorization: `Bearer ${bearer}` },
  }));
  assert.equal(await call("htk_known"), null);
  for (let i = 0; i < 999; i += 1) assert.equal(await call(`htk_${i}`), null);
  assert.equal(await call("htk_known"), null);
  assert.equal((await call("htk_overflow")).status, 429);
  assert.equal(redisCalls, 0);
});
