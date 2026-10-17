import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const flag = "htpr-7272-payment-login-agent-events";
const occurredAt = new Date("2026-10-16T12:00:00.000Z");
const marker = "analytics:payment_succeeded:in_paid";
const properties = { invoice_id: "in_paid", amount_paid: 1200, occurred_at: occurredAt.toISOString() };

function harness(configure?: (h: ReturnType<typeof activationHarness>) => void) {
  const h = activationHarness();
  h.setFlagEnabled(flag, true);
  configure?.(h);
  const rows: any[] = [];
  const phases: string[] = [];
  const locks: any[] = [];
  let inTransaction = false;
  h.mocks["@/lib/flags"].HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG = flag;
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (value instanceof Date) return row[key].getTime() === value.getTime();
    if (value && typeof value === "object") {
      if ("lte" in value) return row[key] <= value.lte;
      if ("lt" in value) return row[key] < value.lt;
    }
    return row[key] === value;
  });
  h.prisma.analyticsOutbox = {
    findUnique: async ({ where }: any) => rows.find((row) => matches(row, where)) ?? null,
    create: async ({ data }: any) => {
      assert.equal(inTransaction, true);
      assert.ok(h.logs.some((log) => log.log === data.key.replace(/^(business|\d+):/, "")));
      assert.equal(rows.some((row) => row.key === data.key), false);
      const row = {
        id: `outbox-${rows.length + 1}`, attempts: 0, nextAttemptAt: new Date(), deliveredAt: null,
        lastError: null, createdAt: new Date(), ...data, properties: JSON.parse(JSON.stringify(data.properties)),
      };
      rows.push(row);
      phases.push("outbox");
      return { ...row };
    },
    findMany: async ({ where, take, orderBy }: any) => {
      assert.deepEqual(orderBy, { nextAttemptAt: "asc" });
      assert.equal(take, 100);
      return rows.filter((row) => matches(row, where)).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt).slice(0, take).map((row) => ({ ...row }));
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows.filter((candidate) => matches(candidate, where))) {
        for (const [key, value] of Object.entries(data) as [string, any][]) {
          row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
        }
        count++;
      }
      return { count };
    },
  };
  const transaction = h.prisma.$transaction;
  h.prisma.$transaction = (callback: any, options: any) => transaction(async (tx: any) => {
    const oldLogs = [...h.logs];
    const oldRows = [...rows];
    inTransaction = true;
    try {
      const result = await callback(tx);
      phases.push("commit");
      return result;
    } catch (error) {
      h.logs.splice(0, h.logs.length, ...oldLogs);
      rows.splice(0, rows.length, ...oldRows);
      throw error;
    } finally { inTransaction = false; }
  }, options);
  h.prisma.$executeRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => { locks.push([strings.join("?"), values]); return 0; };
  const PostHog = h.mocks["posthog-node"].PostHog;
  h.mocks["posthog-node"].PostHog = class extends PostHog {
    constructor() {
      super();
      const capture = this.captureImmediate;
      this.captureImmediate = async (payload: any) => {
        phases.push(inTransaction ? "inline-capture" : "capture");
        await capture(payload);
      };
    }
  };
  h.mocks["@/lib/cronAuthorization"] = h.load("src/lib/cronAuthorization.ts");
  h.mocks["next/server"] = { NextResponse: { json: (body: any, options?: any) => ({ status: options?.status ?? 200, json: async () => body }) } };
  const api = h.load("src/lib/telemetry/analyticsOccurrences.ts");
  const outbox = h.load("src/lib/telemetry/analyticsOutbox.ts");
  const capture = (options: any = { occurredAt }) => api.captureAnalyticsOccurrence(123, "payment_succeeded", marker, properties, options);
  return { ...h, rows, phases, locks, capture, api, outbox };
}

test("flag on commits marker and durable occurrence before delivery with stable UUID and business time", async () => {
  const h = harness();
  let computed = 0;
  await h.api.captureAnalyticsOccurrence(123, "payment_succeeded", marker, async (tx: any) => {
    computed++;
    assert.equal(await tx.logs.findFirst({ where: { log: marker } }), null);
    return properties;
  }, { scope: "business", occurredAt, createdAt: occurredAt });
  assert.equal(computed, 1);
  assert.deepEqual(h.phases, ["outbox", "commit", "capture"]);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].createdAt, occurredAt);
  assert.equal(h.rows.length, 1);
  const row = h.rows[0];
  assert.equal(row.key, `business:${marker}`);
  assert.equal(row.userId, 123);
  assert.deepEqual(row.properties, properties);
  assert.ok(row.deliveredAt instanceof Date);
  assert.equal(row.attempts, 0);
  assert.equal(row.lastError, null);
  assert.deepEqual(h.captureAttempts[0], { distinctId: "123", event: "payment_succeeded", uuid: row.uuid, properties, timestamp: occurredAt });
  assert.match(row.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(h.locks.length, 2);
  assert.match(h.locks[0][0], /7034::int/);
  assert.match(h.locks[1][0], /7268::int/);
  assert.deepEqual(h.locks[1][1], [marker]);
});

test("without an explicit time the outbox keeps the business occurred_at as the envelope timestamp", async () => {
  const h = harness();
  const paidAt = "2026-10-01T08:30:00.000Z";
  await h.api.captureAnalyticsOccurrence(123, "subscription_canceled", marker, { ...properties, occurred_at: paidAt }, { scope: "business" });
  assert.equal(h.rows[0].occurredAt.toISOString(), paidAt);
  assert.equal(h.captureAttempts[0].timestamp.toISOString(), paidAt);
});

test("parallel and later replays keep one outbox row and one capture", async () => {
  const h = harness();
  await Promise.all([h.capture(), h.capture(), h.capture()]);
  await h.capture();
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].key, `123:${marker}`);
  assert.equal(h.logs.length, 1);
  assert.equal(h.captureAttempts.length, 1);
});

test("failed delivery stays pending; a due cron retries once with the original UUID and timestamp", async () => {
  const h = harness();
  h.setFailure("capture");
  const before = Date.now();
  await assert.doesNotReject(h.capture());
  const row = h.rows[0];
  assert.equal(h.logs.length, 1);
  assert.equal(row.deliveredAt, null);
  assert.equal(row.attempts, 1);
  assert.ok(row.nextAttemptAt.getTime() >= before + 60000);
  assert.ok(row.nextAttemptAt.getTime() <= Date.now() + 60000);
  assert.equal(row.lastError, "PostHog delivery failed");
  assert.ok(row.lastError.length <= 200);
  await h.capture();
  assert.equal(h.captureAttempts.length, 1);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 0 });
  row.nextAttemptAt = new Date(0);
  h.setFailure(null);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 1, failed: 0, skipped: 0 });
  assert.equal(h.captures.length, 1);
  assert.equal(h.captureAttempts[1].uuid, h.captureAttempts[0].uuid);
  assert.equal(h.captureAttempts[1].timestamp, occurredAt);
  assert.deepEqual(h.captureAttempts[1].properties, properties);
  assert.ok(row.deliveredAt instanceof Date);
  assert.equal(row.lastError, null);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 0 });
  assert.equal(await h.outbox.deliverAnalyticsOutbox({ ...row, deliveredAt: null }), "skipped");
  assert.equal(h.captureAttempts.length, 2);
});

test("flag off preserves the exact inline envelope, ordering, and retry behavior with no outbox writes", async () => {
  const h = harness();
  h.setFlagEnabled(flag, false);
  h.setFailure("capture");
  await assert.rejects(h.capture(), /mock capture unavailable/);
  assert.equal(h.rows.length, 0);
  assert.equal(h.logs.length, 0);
  const uuid = h.captureAttempts[0].uuid;
  h.setFailure(null);
  await h.capture();
  await h.capture();
  assert.equal(h.rows.length, 0);
  assert.equal(h.logs.length, 1);
  assert.equal(h.captures.length, 1);
  assert.deepEqual(h.captureAttempts[1], { distinctId: "123", event: "payment_succeeded", uuid, properties, timestamp: occurredAt });
  assert.equal(h.captureAttempts[0].timestamp, occurredAt);
  assert.deepEqual(h.phases, ["inline-capture", "inline-capture", "commit", "commit"]);
});

const beforeMidnight = "2026-10-15T23:59:59.000Z";
const afterMidnight = new Date("2026-10-16T00:00:05.000Z");

for (const [mode, configure] of [
  ["flag off", (h: any) => h.setFlagEnabled(flag, false)],
  ["ineligible", (h: any) => h.setEnabled(false)],
  ["outbox", () => {}],
] as const) {
  test(`${mode}: a business time just before midnight keeps its UTC day when delivery runs after midnight`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: afterMidnight });
    const h = harness(configure);
    await h.api.captureAnalyticsOccurrence(123, "task_created", marker, { ...properties, occurred_at: beforeMidnight });
    assert.equal(h.captureAttempts[0].timestamp.toISOString(), beforeMidnight);
  });
}

test("direct path: an explicit occurredAt wins over the property and createdAt", async () => {
  const h = harness();
  h.setFlagEnabled(flag, false);
  const explicit = new Date(beforeMidnight);
  await h.api.captureAnalyticsOccurrence(123, "task_created", marker, async () => ({ ...properties, occurred_at: "2026-10-01T00:00:00.000Z" }), {
    occurredAt: explicit, createdAt: afterMidnight,
  });
  assert.equal(h.captureAttempts[0].timestamp, explicit);
});

test("direct path: a failed capture retries with the original business time, not the retry time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: afterMidnight });
  const h = harness();
  h.setFlagEnabled(flag, false);
  h.setFailure("capture");
  const send = () => h.api.captureAnalyticsOccurrence(123, "task_created", marker, { ...properties, occurred_at: beforeMidnight });
  await assert.rejects(send(), /mock capture unavailable/);
  t.mock.timers.tick(3600000);
  h.setFailure(null);
  await send();
  assert.deepEqual(h.captureAttempts.map((attempt: any) => attempt.timestamp.toISOString()), [beforeMidnight, beforeMidnight]);
});

for (const [mode, configure] of [["flag off", (h: any) => h.setFlagEnabled(flag, false)], ["outbox", () => {}]] as const) {
  test(`${mode}: a malformed occurred_at falls back to createdAt, then to the capture time`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: afterMidnight });
    const withCreatedAt = harness(configure);
    await withCreatedAt.api.captureAnalyticsOccurrence(123, "task_created", marker, { ...properties, occurred_at: "not a date" }, { createdAt: new Date(beforeMidnight) });
    assert.equal(withCreatedAt.captureAttempts[0].timestamp.toISOString(), beforeMidnight);
    const withoutTime = harness(configure);
    await withoutTime.api.captureAnalyticsOccurrence(123, "task_created", marker, { ...properties, occurred_at: 42 });
    assert.equal(withoutTime.captureAttempts[0].timestamp.toISOString(), afterMidnight.toISOString());
  });
}

test("a pre-outbox log marker blocks repeats, including business scope with a different user", async () => {
  const h = harness();
  h.logs.push({ log: marker, LoggedById: 123 });
  await h.capture();
  h.users.set(234, { id: 234, uid: "real_234", email: "other@example.test" });
  await h.api.captureAnalyticsOccurrence(234, "payment_succeeded", marker, properties, { scope: "business", occurredAt });
  assert.equal(h.rows.length, 0);
  assert.equal(h.captures.length, 0);
  assert.equal(h.logs.length, 1);
});

test("an outbox business key blocks repeats even when its log marker is missing", async () => {
  const h = harness();
  await h.capture({ scope: "business", occurredAt });
  h.logs.splice(0);
  h.users.set(234, { id: 234, uid: "real_234", email: "other@example.test" });
  await h.api.captureAnalyticsOccurrence(234, "payment_succeeded", marker, () => { throw Error("must not recompute"); }, { scope: "business" });
  assert.equal(h.rows.length, 1);
  assert.equal(h.logs.length, 0);
  assert.equal(h.captureAttempts.length, 1);
});

test("outbox insert failure rolls back the marker and never captures", async () => {
  const h = harness();
  h.prisma.analyticsOutbox.create = async () => { throw Error("insert unavailable"); };
  await assert.rejects(h.capture(), /insert unavailable/);
  assert.equal(h.logs.length, 0);
  assert.equal(h.rows.length, 0);
  assert.equal(h.captureAttempts.length, 0);
});

test("cron and immediate workers claim each pending row once under concurrency", async () => {
  const h = harness();
  h.setFailure("capture");
  await h.capture();
  h.setFailure(null);
  h.rows[0].nextAttemptAt = new Date(0);
  const results = await Promise.all([
    h.outbox.retryAnalyticsOutbox(), h.outbox.retryAnalyticsOutbox(), h.outbox.deliverAnalyticsOutbox({ ...h.rows[0] }),
  ]);
  assert.equal(h.captures.length, 1);
  assert.equal(h.captureAttempts.length, 2);
  assert.ok(h.rows[0].deliveredAt);
  assert.equal(results.filter((result) => result === "delivered").length + results.filter((result) => result.delivered === 1).length, 1);
});

test("retry delays are 1m, 5m, 30m, 2h, then 12h and stop after ten failures", async () => {
  const h = harness();
  h.setFailure("capture");
  await h.capture();
  for (let attempt = 1; attempt < 10; attempt++) {
    const row = h.rows[0];
    row.nextAttemptAt = new Date(0);
    const before = Date.now();
    assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 1, skipped: 0 });
    assert.equal(row.attempts, attempt + 1);
    const delay = [60000, 300000, 1800000, 7200000, 43200000][Math.min(attempt, 4)];
    assert.ok(row.nextAttemptAt.getTime() >= before + delay);
    assert.ok(row.nextAttemptAt.getTime() <= Date.now() + delay);
  }
  h.rows[0].nextAttemptAt = new Date(0);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 0 });
  assert.equal(h.captureAttempts.length, 10);
});

test("turning the flag off or losing eligibility pauses durable delivery", async () => {
  const h = harness();
  h.setFailure("capture");
  await h.capture();
  h.setFailure(null);
  h.rows[0].nextAttemptAt = new Date(0);
  h.setFlagEnabled(flag, false);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 1 });
  h.setFlagEnabled(flag, true);
  h.setEnabled(false);
  h.rows[0].nextAttemptAt = new Date(0);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 1 });
  assert.equal(h.captureAttempts.length, 1);
  h.setEnabled(true);
  h.rows[0].nextAttemptAt = new Date(0);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 1, failed: 0, skipped: 0 });
});

test("ineligible users keep the legacy inline behavior instead of creating an outbox", async () => {
  const h = harness();
  h.setEnabled(false);
  await h.capture();
  assert.equal(h.rows.length, 0);
  assert.equal(h.captures.length, 1);
  assert.ok(h.phases.includes("inline-capture"));
});

test("no configured PostHog client returns before any eligibility or database access", async () => {
  const h = harness();
  const token = process.env.POSTHOG_SERVER_PROJECT_TOKEN;
  delete process.env.POSTHOG_SERVER_PROJECT_TOKEN;
  try {
    await h.capture();
    assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 0 });
    assert.deepEqual(h.prismaCalls, []);
    assert.deepEqual(h.flagChecks, []);
    assert.deepEqual(h.rows, []);
  } finally { process.env.POSTHOG_SERVER_PROJECT_TOKEN = token; }
});

test("delivery bookkeeping failures do not escape and retain a recoverable lease", async () => {
  const h = harness();
  h.setFailure("capture");
  await h.capture();
  h.rows[0].nextAttemptAt = new Date(0);
  const update = h.prisma.analyticsOutbox.updateMany;
  let calls = 0;
  h.prisma.analyticsOutbox.updateMany = async (args: any) => {
    if (++calls > 1) throw Error("database unavailable with secret payload");
    return update(args);
  };
  const before = Date.now();
  assert.equal(await h.outbox.deliverAnalyticsOutbox(h.rows[0]), "failed");
  assert.equal(calls, 2);
  assert.equal(h.rows[0].attempts, 1);
  assert.ok(h.rows[0].nextAttemptAt.getTime() >= before + 300000);
  assert.equal(h.rows[0].lastError, "PostHog delivery failed");
  h.prisma.analyticsOutbox.updateMany = update;
  h.rows[0].nextAttemptAt = new Date(0);
  h.setFailure(null);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 1, failed: 0, skipped: 0 });
});

test("failed lease claims never attempt delivery bookkeeping for a lease they do not own", async () => {
  const h = harness();
  h.setFailure("capture");
  await h.capture();
  h.rows[0].nextAttemptAt = new Date(0);
  let calls = 0;
  h.prisma.analyticsOutbox.updateMany = async () => { calls++; throw Error("claim unavailable"); };
  assert.equal(await h.outbox.deliverAnalyticsOutbox(h.rows[0]), "failed");
  assert.equal(calls, 1);
  assert.equal(h.rows[0].attempts, 1);
});

test("cron authenticates with the shared authorization helper and returns delivery counts", async () => {
  const h = harness();
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "local-cron-fixture";
  try {
    const route = h.load("src/app/api/cron/analytics-outbox/route.ts");
    for (const authorization of [null, "Bearer wrong", "local-cron-fixture"]) {
      const response = await route.GET({ headers: new Headers(authorization ? { authorization } : {}) });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
    assert.equal(h.prismaCalls.length, 0);
    h.setFailure("capture");
    await h.capture();
    h.setFailure(null);
    h.rows[0].nextAttemptAt = new Date(0);
    const response = await route.GET({ headers: new Headers({ authorization: "Bearer local-cron-fixture" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { delivered: 1, failed: 0, skipped: 0 });
    delete process.env.CRON_SECRET;
    assert.equal((await route.GET({ headers: new Headers({ authorization: "Bearer local-cron-fixture" }) })).status, 401);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("cron is scheduled every five minutes and considers at most 100 due records", async () => {
  const h = harness();
  h.setFailure("capture");
  await h.capture();
  h.setFailure(null);
  const original = { ...h.rows[0], nextAttemptAt: new Date(0), attempts: 0 };
  h.rows.splice(0);
  for (let i = 0; i < 101; i++) h.rows.push({ ...original, id: `row-${i}`, key: `key-${i}`, uuid: `uuid-${i}` });
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 100, failed: 0, skipped: 0 });
  assert.equal(h.rows.filter((row) => row.deliveredAt).length, 100);
  assert.equal(h.rows[100].deliveredAt, null);
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.deepEqual(config.crons.filter((cron: any) => cron.path === "/api/cron/analytics-outbox"), [{ path: "/api/cron/analytics-outbox", schedule: "*/5 * * * *" }]);
});

for (const reason of ["flag", "eligibility"]) {
  test(`100+ ${reason}-paused rows yield to an eligible row on the next cron run without consuming attempts`, async () => {
    let paused = false;
    const h = harness((h) => {
      const isFeatureEnabled = h.mocks["@/lib/flags"].isFeatureEnabled;
      h.mocks["@/lib/flags"].isFeatureEnabled = async (key: string, userId: number) =>
        !(paused && userId === 123 && key === (reason === "flag" ? flag : "htpr-7034-activation-analytics")) && await isFeatureEnabled(key, userId);
    });
    h.setFailure("capture");
    await h.capture();
    h.setFailure(null);
    paused = true;
    const original = { ...h.rows[0], nextAttemptAt: new Date(0) };
    h.rows.splice(0);
    for (let i = 0; i < 101; i++) h.rows.push({ ...original, id: `paused-${i}`, key: `paused-${i}`, uuid: `paused-${i}` });
    h.users.set(234, { id: 234, uid: "real_234", email: "other@example.test" });
    h.rows.push({ ...original, id: "eligible", key: "eligible", uuid: "eligible", userId: 234, nextAttemptAt: new Date(1) });
    const before = Date.now();
    assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 100 });
    for (const row of h.rows.slice(0, 100)) {
      assert.ok(row.nextAttemptAt.getTime() >= before + 3600000);
      assert.ok(row.nextAttemptAt.getTime() <= Date.now() + 3600000);
      assert.equal(row.attempts, original.attempts);
      assert.equal(row.lastError, original.lastError);
      assert.equal(row.deliveredAt, null);
    }
    assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 1, failed: 0, skipped: 1 });
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].distinctId, "234");
    assert.equal(h.captureAttempts.length, 2);
    assert.ok(h.rows[101].deliveredAt);
  });
}
