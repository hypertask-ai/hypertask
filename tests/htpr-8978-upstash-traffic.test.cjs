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

test("a tool call on another server reaches the open connection", async () => {
  const clients = [];
  class FakeRedis {
    constructor() {
      clients.push(this);
      this.subs = new Set();
      this.handlers = {};
      this.published = [];
    }
    on(event, fn) { this.handlers[event] = fn; return this; }
    async connect() {}
    async subscribe(channel) { this.subs.add(channel); }
    async unsubscribe(channel) { this.subs.delete(channel); }
    async publish(channel, message) {
      this.published.push([channel, message]);
      let delivered = 0;
      for (const client of clients) {
        if (client === this || !client.subs.has(channel)) continue;
        delivered += 1;
        client.handlers.message?.(channel, message);
      }
      return delivered;
    }
    disconnect() {}
  }
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://relay.example";
  delete globalThis.__hypertaskLegacySseRelay;
  delete globalThis.__hypertaskLegacySsePublisher;
  const bus = loadModule("src/lib/mcp-server/legacySseBus.ts", {
    ioredis: { default: FakeRedis },
  });
  const channel = `htpr-8978:remote:${Date.now()}`;
  try {
    const seen = [];
    const stop = await bus.subscribeLegacySseAcrossProcesses(channel, (message) => { seen.push(message); });
    assert.equal(clients.length, 1);
    assert.equal(clients[0].subs.has(channel), true);
    assert.equal(await bus.publishLegacySseAcrossProcesses(channel, "same-server"), 1);
    assert.deepEqual(seen, ["same-server"]);
    const remote = new FakeRedis();
    assert.equal(await remote.publish(channel, "other-server"), 1);
    assert.deepEqual(seen, ["same-server", "other-server"]);
    stop();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(clients[0].subs.has(channel), false);
    assert.equal(await bus.publishLegacySseAcrossProcesses("mcp:legacy:session:missing", "x"), 0);
    const publisher = clients.find((client) => client.published.some((entry) => entry[0] === "mcp:legacy:session:missing"));
    assert.deepEqual(publisher.published, [["mcp:legacy:session:missing", "x"]]);
  } finally {
    delete globalThis.__hypertaskLegacySseRelay;
    delete globalThis.__hypertaskLegacySseRelayLive;
    delete globalThis.__hypertaskLegacySsePublisher;
    delete globalThis.__hypertaskLegacySsePublisherLive;
    delete globalThis.__hypertaskLegacySseRelayDown;
    delete globalThis.__hypertaskLegacySseBus;
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});

function clearRelay() {
  delete globalThis.__hypertaskLegacySseRelay;
  delete globalThis.__hypertaskLegacySseRelayLive;
  delete globalThis.__hypertaskLegacySsePublisher;
  delete globalThis.__hypertaskLegacySsePublisherLive;
  delete globalThis.__hypertaskLegacySseRelayDown;
  delete globalThis.__hypertaskLegacySseBus;
}

test("a dropped relay is replaced, and an aborted stream releases the late subscription", async () => {
  const clients = [];
  class FakeRedis {
    constructor() {
      clients.push(this);
      this.subs = new Set();
      this.handlers = {};
      this.published = [];
      this.status = "ready";
    }
    on(event, fn) { this.handlers[event] = fn; return this; }
    async connect() {}
    async subscribe(channel) { this.subs.add(channel); }
    async unsubscribe(channel) { this.subs.delete(channel); }
    async publish(channel, message) {
      this.published.push([channel, message]);
      return this.subs.has(channel) ? 1 : 0;
    }
    disconnect() { this.status = "end"; this.subs.clear(); }
  }
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://relay.example";
  clearRelay();
  const bus = loadModule("src/lib/mcp-server/legacySseBus.ts", { ioredis: { default: FakeRedis } });
  const channel = `htpr-8978:replace:${Date.now()}`;
  try {
    const seen = [];
    let down = 0;
    let stop = () => {};
    stop = await bus.subscribeLegacySseAcrossProcesses(channel, (message) => { seen.push(message); }, () => {
      down += 1;
      stop();
    });
    assert.equal(clients.length, 1);
    for (let i = 0; i < 20; i += 1) {
      const reply = await bus.subscribeLegacySseAcrossProcesses(`${channel}:reply:${i}`, () => {});
      reply();
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.__hypertaskLegacySseRelayLive.tails.size, 1);
    clients[0].handlers.end();
    assert.equal(down, 1);
    assert.equal(clients[0].status, "end");
    const revived = [];
    const stopRevived = await bus.subscribeLegacySseAcrossProcesses(channel, (message) => { revived.push(message); });
    assert.equal(clients.length, 2);
    assert.equal(clients[1].subs.has(channel), true);
    clients[1].handlers.message(channel, "again");
    assert.deepEqual(revived, ["again"]);
    stopRevived();
    await bus.publishLegacySseAcrossProcesses("mcp:legacy:session:missing", "x");
    const publisher = clients.find((client) => client.published.length === 1);
    publisher.status = "end";
    publisher.handlers.end();
    assert.equal(await bus.publishLegacySseAcrossProcesses("mcp:legacy:session:missing", "y"), 0);
    const replacements = clients.filter((client) => client.published.some((entry) => entry[1] === "y"));
    assert.equal(replacements.length, 1);
    assert.notEqual(replacements[0], publisher);

    let releaseConnect;
    class SlowRedis extends FakeRedis {
      connect() { return new Promise((resolve) => { releaseConnect = resolve; }); }
    }
    clearRelay();
    const route = loadModule("src/lib/mcp-server/legacy-sse.ts", { ioredis: { default: SlowRedis } });
    const abort = new AbortController();
    const pending = route.handleLegacySseRequest(
      new Request("https://app.hypertask.ai/sse", { headers: { accept: "text/event-stream" }, signal: abort.signal }),
      { clientId: "1", token: "t", scopes: [] },
      [],
    );
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    releaseConnect();
    assert.equal((await pending).status, 204);
    await new Promise((resolve) => setImmediate(resolve));
    const subscriber = clients.find((client) => client instanceof SlowRedis);
    assert.equal(subscriber.subs.size, 0);
    assert.equal(subscriber.disconnected || subscriber.status === "end", true);
  } finally {
    clearRelay();
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});

function alarm() {
  return loadModule("src/lib/ops/upstashCommandAlarm.ts");
}

test("a relay subscribe failure is retried once and then refused", async () => {
  const clients = [];
  class FlakyRedis {
    constructor() {
      clients.push(this);
      this.subs = new Set();
      this.handlers = {};
      this.status = "ready";
      this.attempts = 0;
      this.fail = 0;
    }
    on(event, fn) { this.handlers[event] = fn; return this; }
    async connect() {}
    async subscribe(channel) {
      this.attempts += 1;
      if (this.attempts <= this.fail) throw new Error("subscribe failed");
      this.subs.add(channel);
    }
    async unsubscribe(channel) { this.subs.delete(channel); }
    async publish() { return 0; }
    disconnect() { this.status = "end"; }
  }
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://relay.example";
  const channel = `htpr-8978:subscribe:${Date.now()}`;
  try {
    clearRelay();
    const adopted = loadModule("src/lib/mcp-server/legacySseBus.ts", {
      ioredis: { default: class extends FlakyRedis { constructor() { super(); this.fail = 1; } } },
    });
    const stop = await adopted.subscribeLegacySseAcrossProcesses(channel, () => {});
    assert.equal(clients.at(-1).attempts, 2);
    assert.equal(clients.at(-1).subs.has(channel), true);
    stop();
    clearRelay();
    const refused = loadModule("src/lib/mcp-server/legacySseBus.ts", {
      ioredis: { default: class extends FlakyRedis { constructor() { super(); this.fail = 2; } } },
    });
    await assert.rejects(() => refused.subscribeLegacySseAcrossProcesses(channel, () => {}));
    assert.equal(clients.at(-1).attempts, 2);
    assert.equal(clients.at(-1).subs.size, 0);
    assert.equal(refused.publishLegacySse(channel, "local"), 0);
    assert.equal(globalThis.__hypertaskLegacySseRelayLive, undefined);
    clearRelay();
    const held = loadModule("src/lib/mcp-server/legacySseBus.ts", {
      ioredis: { default: class extends FlakyRedis {
        subscribe(name) {
          this.attempts += 1;
          if (String(name).includes(":reply:")) return Promise.reject(new Error("acl"));
          this.subs.add(name);
          return Promise.resolve();
        }
      } },
    });
    const keep = await held.subscribeLegacySseAcrossProcesses(channel, () => {});
    for (let i = 0; i < 20; i += 1) {
      await assert.rejects(() => held.subscribeLegacySseAcrossProcesses(`${channel}:reply:${i}`, () => {}));
    }
    assert.equal(globalThis.__hypertaskLegacySseRelayLive.tails.size, 1);
    assert.equal(clients.at(-1).subs.size, 1);
    keep();
    assert.equal(globalThis.__hypertaskLegacySseRelayLive, undefined);
  } finally {
    clearRelay();
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});

test("a day at or under 300,000 commands does not file, and one request over does", () => {
  const { nextCommandSample, readCommandTotal, UPSTASH_DAILY_COMMAND_LIMIT } = alarm();
  const start = Date.parse("2026-11-22T00:00:00.000Z");
  assert.equal(readCommandTotal("# Stats\r\ntotal_commands_processed:10\r\n"), 10);
  assert.equal(readCommandTotal("total_commands_processed:11\r"), 11);
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

test("a lost alarm lock leaves the sample in place so the next run can still file", async () => {
  const { runUpstashCommandCheck, UPSTASH_DAILY_COMMAND_LIMIT } = alarm();
  const opened = Date.parse("2026-11-22T05:51:00.000Z");
  const sample = { current: JSON.stringify({ total: 10, at: opened }) };
  const created = [];
  const at = opened + DAY_MS;
  const info = `total_commands_processed:${10 + UPSTASH_DAILY_COMMAND_LIMIT + 1}`;
  const deps = (claim) => ({
    now: at,
    info,
    readSample: async () => sample.current,
    writeSample: async (value) => { sample.current = value; },
    claim,
    findTicket: async () => null,
    createTicket: async (ticket) => {
      created.push(ticket);
      return created.length;
    },
  });
  const lost = await runUpstashCommandCheck(deps(async () => false));
  assert.equal(lost.filed, false);
  assert.equal(created.length, 0);
  assert.deepEqual(JSON.parse(sample.current), {
    total: 10,
    at: opened,
    pendingCommands: UPSTASH_DAILY_COMMAND_LIMIT + 1,
    pendingAt: at,
    pendingTotal: 10 + UPSTASH_DAILY_COMMAND_LIMIT + 1,
  });
  await assert.rejects(() => runUpstashCommandCheck({
    ...deps(async () => true),
    createTicket: async () => { throw new Error("board down"); },
  }));
  assert.equal(JSON.parse(sample.current).pendingCommands, UPSTASH_DAILY_COMMAND_LIMIT + 1);
  const filed = await runUpstashCommandCheck(deps(async () => true));
  assert.equal(filed.filed, true);
  assert.equal(created.length, 1);
  assert.equal(JSON.parse(sample.current).total, 10 + UPSTASH_DAILY_COMMAND_LIMIT + 1);
  assert.equal(JSON.parse(sample.current).pendingCommands, undefined);
});

test("a missed alert still files after a quiet following day", async () => {
  const { runUpstashCommandCheck } = alarm();
  const opened = Date.parse("2026-11-22T05:51:00.000Z");
  const spike = 10 + 400_001;
  const sample = { current: JSON.stringify({ total: 10, at: opened }) };
  const created = [];
  const run = (at, claim) => runUpstashCommandCheck({
    now: at,
    info: `total_commands_processed:${spike}`,
    readSample: async () => sample.current,
    writeSample: async (value) => { sample.current = value; },
    claim,
    findTicket: async (marker) => created.find((ticket) => ticket.description.includes(marker))?.id ?? null,
    createTicket: async (ticket) => {
      created.push(ticket);
      return created.length;
    },
  });
  const steady = await run(opened + 2 * DAY_MS, async () => true);
  assert.equal(steady.filed, false);
  assert.equal(steady.commands, 200_001);
  assert.equal(created.length, 0);
  sample.current = JSON.stringify({ total: 10, at: opened });
  const lost = await run(opened + DAY_MS, async () => false);
  assert.equal(lost.filed, false);
  assert.equal(JSON.parse(sample.current).pendingCommands, 400_001);
  const next = await run(opened + 2 * DAY_MS, async () => true);
  assert.equal(next.filed, true);
  assert.equal(next.commands, 0);
  assert.equal(created.length, 1);
  assert.match(created[0].description, /400,001/);
  assert.match(created[0].description, /Marker: upstash-daily-commands:2026-11-23/);
  assert.equal(JSON.parse(sample.current).total, spike);
  assert.equal(JSON.parse(sample.current).pendingCommands, undefined);
});

test("a second hot day is still filed after the owed alert", async () => {
  const { runUpstashCommandCheck } = alarm();
  const opened = Date.parse("2026-11-22T05:51:00.000Z");
  const first = 10 + 400_001;
  const second = first + 400_001;
  const sample = { current: JSON.stringify({ total: 10, at: opened }) };
  const created = [];
  const run = (at, total, claim) => runUpstashCommandCheck({
    now: at,
    info: `total_commands_processed:${total}`,
    readSample: async () => sample.current,
    writeSample: async (value) => { sample.current = value; },
    claim,
    findTicket: async (marker) => created.find((ticket) => ticket.description.includes(marker))?.id ?? null,
    createTicket: async (ticket) => {
      created.push(ticket);
      return created.length;
    },
  });
  assert.equal((await run(opened + DAY_MS, first, async () => false)).filed, false);
  const both = await run(opened + 2 * DAY_MS, second, async () => true);
  assert.equal(both.filed, true);
  assert.equal(both.commands, 400_001);
  assert.equal(created.length, 2);
  assert.match(created[0].description, /Marker: upstash-daily-commands:2026-11-23/);
  assert.match(created[1].description, /Marker: upstash-daily-commands:2026-11-24/);
  assert.equal(JSON.parse(sample.current).total, second);
  assert.equal(JSON.parse(sample.current).pendingCommands, undefined);
});

test("a failed second-day filing stays pending for the next run", async () => {
  const { runUpstashCommandCheck } = alarm();
  const opened = Date.parse("2026-11-22T05:51:00.000Z");
  const first = 10 + 400_001;
  const second = first + 400_001;
  const sample = { current: JSON.stringify({ total: 10, at: opened }) };
  const created = [];
  let attempts = 0;
  const run = (at, total, claim) => runUpstashCommandCheck({
    now: at,
    info: `total_commands_processed:${total}`,
    readSample: async () => sample.current,
    writeSample: async (value) => { sample.current = value; },
    claim,
    findTicket: async (marker) => created.find((ticket) => ticket.description.includes(marker))?.id ?? null,
    createTicket: async (ticket) => {
      attempts += 1;
      if (attempts === 2) throw new Error("board down");
      created.push(ticket);
      return created.length;
    },
  });
  assert.equal((await run(opened + DAY_MS, first, async () => false)).filed, false);
  await assert.rejects(() => run(opened + 2 * DAY_MS, second, async () => true));
  assert.equal(created.length, 1);
  assert.deepEqual(JSON.parse(sample.current), {
    total: first,
    at: opened + DAY_MS,
    pendingCommands: 400_001,
    pendingAt: opened + 2 * DAY_MS,
    pendingTotal: second,
  });
  const recovered = await run(opened + 3 * DAY_MS, second, async () => true);
  assert.equal(recovered.filed, true);
  assert.equal(created.length, 2);
  assert.match(created[1].description, /400,001/);
  assert.match(created[1].description, /Marker: upstash-daily-commands:2026-11-24/);
  assert.equal(JSON.parse(sample.current).total, second);
  assert.equal(JSON.parse(sample.current).pendingCommands, undefined);
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
    "@/lib/flags": { featureFlagCandidateUserIds: async () => null, isFeatureEnabled: async () => true },
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

test("with the Upstash skip off, command-line calls count in Upstash again", async () => {
  let redisCalls = 0;
  const { checkMcpRateLimit } = loadModule("src/lib/mcp/auth/rateLimit.ts", {
    "@/lib/redis": { getRedis: async () => ({ incr: async () => { redisCalls += 1; return redisCalls; }, expire: async () => 1, decrby: async () => 0 }) },
    "@/lib/flags/keys": { HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG: "htpr-7462-mcp-ratelimit-exact-count" },
    "@/lib/flags": { featureFlagCandidateUserIds: async () => null, isFeatureEnabled: async () => false },
    "@/lib/flags/definitions/htpr-8978-agent-upstash-skip": { HTPR_8978_AGENT_UPSTASH_SKIP_FLAG: "htpr-8978-agent-upstash-skip" },
    "./session": {
      extractBearerToken: (value) => value?.replace(/^Bearer /, "") ?? null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: null, teamScope: null }),
    },
    "../operationContext": { getMcpOperationContext: () => undefined },
  });
  const response = await checkMcpRateLimit(new NextRequest("https://app.hypertask.ai/api/mcp/tasks", {
    headers: { authorization: "Bearer htk_cli" },
  }));
  assert.equal(response, null);
  assert.equal(redisCalls, 1);
});

test("the skip flag follows the authenticated user and a failed login stays off Upstash", async () => {
  let redisCalls = 0;
  const userIds = [];
  const { checkMcpRateLimit } = loadModule("src/lib/mcp/auth/rateLimit.ts", {
    "@/lib/redis": { getRedis: async () => { redisCalls += 1; return { incr: async () => redisCalls, expire: async () => 1, decrby: async () => 0 }; } },
    "@/lib/flags/keys": { HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG: "htpr-7462-mcp-ratelimit-exact-count", HTPR_8978_AGENT_UPSTASH_SKIP_FLAG: "htpr-8978-agent-upstash-skip" },
    "@/lib/flags": {
      featureFlagCandidateUserIds: async () => null,
      isFeatureEnabled: async (_key, userId) => { userIds.push(userId); return userId === 6; },
    },
    "@/lib/flags/modeCache": { withFeatureFlagSnapshot: (run) => run() },
    "./session": {
      extractBearerToken: (value) => value?.replace(/^Bearer /, "") ?? null,
      validateMcpAuth: async () => null,
    },
    "../operationContext": { getMcpOperationContext: () => undefined },
  });
  const call = (bearer, resolveAuth) => checkMcpRateLimit(new NextRequest("https://app.hypertask.ai/api/mcp/tasks", {
    headers: { authorization: `Bearer ${bearer}` },
  }), resolveAuth);
  const owner = async () => ({ user: { id: 6 }, agentId: null, teamScope: null });
  const other = async () => ({ user: { id: 9 }, agentId: null, teamScope: null });
  assert.equal(await call("htk_owner", owner), null);
  assert.equal(redisCalls, 0);
  assert.deepEqual(userIds, [6]);
  assert.equal(await call("htk_other", other), null);
  assert.equal(redisCalls, 1);
  assert.equal(await call("htk_fake", async () => null), null);
  assert.equal(redisCalls, 1);
});

test("distinct unauthenticated command-line tokens stay bounded without resetting an active caller", async () => {
  let redisCalls = 0;
  const audiences = [];
  const userIds = [];
  const { checkMcpRateLimit } = loadModule("src/lib/mcp/auth/rateLimit.ts", {
    "@/lib/redis": { getRedis: async () => { redisCalls += 1; return { incr: async () => 1, expire: async () => 1 }; } },
    "@/lib/flags/keys": { HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG: "htpr-7462-mcp-ratelimit-exact-count", HTPR_8978_AGENT_UPSTASH_SKIP_FLAG: "htpr-8978-agent-upstash-skip" },
    "@/lib/flags": {
      featureFlagCandidateUserIds: async () => null,
      isFeatureEnabled: async (_key, userId) => { userIds.push(userId); return true; },
    },
    "@/lib/flags/modeCache": { withFeatureFlagSnapshot: (run, audience) => { audiences.push(audience); return run(); } },
    "./session": {
      extractBearerToken: (value) => value?.replace(/^Bearer /, "") ?? null,
      validateMcpAuth: async () => null,
    },
    "../operationContext": { getMcpOperationContext: () => undefined },
  });
  const call = (bearer, resolveAuth) => checkMcpRateLimit(new NextRequest("https://app.hypertask.ai/api/mcp/tasks", {
    headers: { authorization: `Bearer ${bearer}` },
  }), resolveAuth);
  for (let i = 0; i < 600; i += 1) assert.equal(await call("htk_known"), null);
  assert.equal((await call("htk_known")).status, 429);
  for (let i = 0; i < 1000; i += 1) assert.equal(await call(`htk_${i}`), null);
  assert.equal((await call("htk_known")).status, 429);
  assert.equal(await call("htk_overflow"), null);
  assert.equal(await call(token({ agentId: "agent-1", userId: 985 })), null);
  assert.equal(await call("htk_owner", async () => ({ user: { id: 6 }, agentId: null, teamScope: null })), null);
  assert.equal(redisCalls, 0);
  assert.ok(audiences.includes("cli"));
  assert.ok(audiences.includes("agent"));
  assert.ok(userIds.includes(985));
  assert.ok(userIds.includes(6));
});

test("unauthenticated overflow does not refuse a fresh authenticated caller", async () => {
  let redisCalls = 0;
  const { checkMcpRateLimit } = loadModule("src/lib/mcp/auth/rateLimit.ts", {
    "@/lib/redis": { getRedis: async () => { redisCalls += 1; return { incr: async () => 1, expire: async () => 1 }; } },
    "@/lib/flags/keys": { HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG: "htpr-7462-mcp-ratelimit-exact-count", HTPR_8978_AGENT_UPSTASH_SKIP_FLAG: "htpr-8978-agent-upstash-skip" },
    "@/lib/flags": { featureFlagCandidateUserIds: async () => null, isFeatureEnabled: async () => true },
    "@/lib/flags/modeCache": { withFeatureFlagSnapshot: (run) => run() },
    "./session": {
      extractBearerToken: (value) => value?.replace(/^Bearer /, "") ?? null,
      validateMcpAuth: async () => null,
    },
    "../operationContext": { getMcpOperationContext: () => undefined },
  });
  const call = (bearer, resolveAuth) => checkMcpRateLimit(new NextRequest("https://app.hypertask.ai/api/mcp/tasks", {
    headers: { authorization: `Bearer ${bearer}` },
  }), resolveAuth);
  const anonymous = async () => null;
  const known = async () => ({ user: { id: 6 }, agentId: null, teamScope: null });
  const fresh = async () => ({ user: { id: 6 }, agentId: "fresh", teamScope: null });
  for (let i = 0; i < 600; i += 1) assert.equal(await call("htk_known", known), null);
  assert.equal((await call("htk_known", known)).status, 429);
  for (let i = 0; i < 1000; i += 1) {
    assert.equal(await call(`htk_${i}`, anonymous), null);
    assert.equal(await call(`htk_${i}`, anonymous), null);
  }
  for (let i = 0; i < 601; i += 1) await call(`htk_extra_${i}`, anonymous);
  assert.equal((await call("htk_known", known)).status, 429);
  assert.equal(await call("htk_fresh", fresh), null);
  assert.equal(redisCalls, 0);
});
