import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const identityFlag = "htpr-7269-signup-identity-link";
const durableFlag = "htpr-7290-durable-signup-identify";
const cookie = "ht_cookie_consent=all";
const anonymousId = "anon-original-visitor";
const input = { anonymousId, consent: "all", attribution: { utm_source: "website" } };

function harness() {
  const h = activationHarness();
  const rows: any[] = [];
  const locks: any[] = [];
  const phases: string[] = [];
  const values = new Map<string, string>();
  let inTransaction = false;
  let transactionFailure = false;
  for (const name of ["htpr-7269-signup-identity-link", "htpr-7290-durable-signup-identify"]) {
    h.mocks[`@/lib/flags/definitions/${name}`] = h.load(`src/lib/flags/definitions/${name}.ts`);
  }
  h.mocks["@/lib/analytics/signupIdentity"] = h.load("src/lib/analytics/signupIdentity.ts");
  h.mocks["@/lib/redis"] = { getRedis: async () => ({
    set: async (key: string, value: string) => { values.set(key, value); return "OK"; },
    getdel: async (key: string) => { const value = values.get(key); values.delete(key); return value ?? null; },
  }) };
  const context = h.load("src/lib/auth/signupAttributionContext.ts");
  h.mocks["@/lib/auth/signupAttributionContext"] = context;
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (value instanceof Date) return row[key].getTime() === value.getTime();
    if (value && typeof value === "object") {
      if ("path" in value) return value.path.reduce((object: any, part: string) => object?.[part], row[key]) === value.equals;
      if ("not" in value) return row[key] !== value.not;
      if ("lte" in value) return row[key] <= value.lte;
      if ("lt" in value) return row[key] < value.lt;
    }
    return row[key] === value;
  });
  h.prisma.analyticsOutbox = {
    findUnique: async ({ where }: any) => rows.find((row) => matches(row, where)) ?? null,
    findFirst: async ({ where }: any) => rows.find((row) => matches(row, where)) ?? null,
    create: async ({ data }: any) => {
      assert.equal(inTransaction, true);
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
    assert.deepEqual(options, { timeout: 20000, maxWait: 1500 });
    if (transactionFailure) throw Error("mock transaction unavailable");
    const oldRows = [...rows];
    inTransaction = true;
    try {
      const result = await callback(tx);
      phases.push("commit");
      return result;
    } catch (error) {
      rows.splice(0, rows.length, ...oldRows);
      throw error;
    } finally { inTransaction = false; }
  }, options);
  h.prisma.$executeRaw = async (strings: TemplateStringsArray, ...parameters: unknown[]) => {
    assert.equal(inTransaction, true);
    locks.push([strings.join("?"), parameters]);
    return 0;
  };
  const PostHog = h.mocks["posthog-node"].PostHog;
  h.mocks["posthog-node"].PostHog = class extends PostHog {
    constructor() {
      super();
      const capture = this.captureImmediate;
      this.captureImmediate = async (payload: any) => {
        assert.equal(inTransaction, false);
        phases.push("capture");
        await capture(payload);
      };
    }
  };
  const api = h.load("src/lib/telemetry/signupIdentityLink.ts");
  const outbox = h.load("src/lib/telemetry/analyticsOutbox.ts");
  return {
    ...h, api, outbox, context, rows, locks, phases, values,
    createContext: (overrides = {}) => context.createSignupContext({ ...input, ...overrides }, 1800, cookie),
    link: (userId = 123, value: any = h.mocks["@/lib/analytics/signupIdentity"].normalizeSignupContext(input), consentCookie = cookie) => api.recordSignupIdentityLink(userId, true, value, consentCookie),
    failTransaction: () => { transactionFailure = true; },
  };
}

test("PostHog failure retains signup identify for a successful cron retry", async () => {
  const h = harness();
  h.setFailure("capture");
  const id = await h.createContext();
  const decision = await h.link(123, id);
  assert.equal(decision.link, true);
  assert.equal(h.values.size, 0);
  await h.drain();
  assert.equal(h.rows.length, 1, "failed delivery must retain a durable identify row");
  const row = h.rows[0];
  assert.equal(row.key, "123:analytics:signup_identify");
  assert.equal(row.attempts, 1);
  assert.equal(row.deliveredAt, null);
  assert.equal(row.lastError, "PostHog delivery failed");
  assert.ok(row.nextAttemptAt > new Date());
  assert.deepEqual(h.phases, ["outbox", "commit", "capture"]);
  assert.deepEqual(h.captures, []);
  h.setFailure(null);
  row.nextAttemptAt = new Date(0);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 1, failed: 0, skipped: 0 });
  assert.equal(h.captures.length, 1);
  assert.equal(h.captureAttempts.length, 2);
  assert.deepEqual(h.captureAttempts[1], {
    distinctId: "123", event: "$identify", uuid: h.api.signupIdentityUuid(123),
    properties: { $anon_distinct_id: anonymousId }, timestamp: row.occurredAt,
  });
  assert.ok(row.deliveredAt instanceof Date);
  assert.equal(row.lastError, null);
  row.nextAttemptAt = new Date(0);
  assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 0 });
  assert.equal(h.captures.length, 1);
});

test("identify delivery uses only signup flags, not payment flags", async () => {
  const h = harness();
  h.setFlagEnabled("htpr-7272-payment-login-agent-events", false);
  assert.equal(await h.outbox.isAnalyticsOutboxEnabled(123), false);
  h.flagChecks.length = 0;
  assert.equal(await h.outbox.isSignupIdentifyOutboxEnabled(123), true);
  assert.equal((await h.link()).link, true);
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.ok(h.rows[0].deliveredAt instanceof Date);
  assert.equal(h.flagChecks.some(({ key }) => key === "htpr-7272-payment-login-agent-events"), false);
});

for (const flag of [identityFlag, durableFlag]) {
  test(`queued identify waits when ${flag} is off and delivers when restored`, async () => {
    const h = harness();
    h.setFailure("capture");
    await h.link();
    await h.drain();
    const row = h.rows[0];
    row.nextAttemptAt = new Date(0);
    h.setFailure(null);
    h.setFlagEnabled(flag, false);
    assert.equal(await h.outbox.isSignupIdentifyOutboxEnabled(123), false);
    assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 0, failed: 0, skipped: 1 });
    assert.equal(row.attempts, 1);
    assert.equal(row.deliveredAt, null);
    assert.ok(row.nextAttemptAt.getTime() >= Date.now() + 3590000);
    assert.equal(h.captureAttempts.length, 1);
    h.setFlagEnabled(flag, true);
    row.nextAttemptAt = new Date(0);
    assert.deepEqual(await h.outbox.retryAnalyticsOutbox(), { delivered: 1, failed: 0, skipped: 0 });
    assert.equal(h.captures.length, 1);
  });
}

for (const scenario of ["essential", "missing consent", "missing context", "withdrawn"] as const) {
  test(`${scenario} creates no identity row or capture`, async (t) => {
    t.mock.method(console, "warn", () => {});
    const h = harness();
    const id = scenario === "missing context" ? null : await h.createContext({ consent: scenario === "essential" ? "essential" : scenario === "missing consent" ? null : "all" });
    const decision = await h.link(123, id, scenario === "withdrawn" ? "ht_cookie_consent=essential" : cookie);
    assert.equal(decision.link, false);
    assert.equal(decision.reason, scenario === "missing context" ? "context_missing" : scenario === "withdrawn" ? "consent_withdrawn" : "consent_denied");
    await h.drain();
    assert.equal(h.rows.length, 0);
    assert.equal(h.captureAttempts.length, 0);
    assert.equal(h.locks.length, 0);
  });
}

test("same user reuses one row and a second account cannot merge the same anonymous identity", async () => {
  const h = harness();
  const decisions = await Promise.all([h.link(), h.link(), h.link(124)]);
  await h.drain();
  assert.deepEqual(decisions.map((decision) => decision.link), [true, true, false]);
  assert.equal(decisions[2].reason, "anonymous_id_already_linked");
  assert.deepEqual(decisions[2].attribution, decisions[0].attribution);
  assert.equal(h.rows.length, 1);
  assert.equal(h.captureAttempts.length, 1);
  assert.ok(h.rows[0].deliveredAt instanceof Date);
  assert.equal((await h.link()).link, true);
  assert.equal((await h.link(124)).reason, "anonymous_id_already_linked");
  await h.drain();
  assert.equal(h.rows.length, 1);
  assert.equal(h.captureAttempts.length, 1);
  for (const [sql, parameters] of h.locks) {
    assert.equal(sql, "SELECT pg_advisory_xact_lock(7290::int, hashtext(?))");
    assert.deepEqual(parameters, [anonymousId]);
  }
  assert.equal((await h.link(124, await h.createContext({ anonymousId: "anon-other-visitor" }))).link, true);
  await h.drain();
  assert.equal(h.rows.length, 2);
  assert.equal(h.captures.length, 2);
});

test("transaction failure returns an unlinked decision with attribution and no capture", async (t) => {
  const warnings: any[] = [];
  t.mock.method(console, "warn", (...args: any[]) => warnings.push(args));
  const h = harness();
  h.failTransaction();
  const decision = await h.link(123, await h.createContext());
  assert.deepEqual(decision, { link: false, reason: "link_not_persisted", attribution: input.attribution, attributionStatus: "known" });
  await h.drain();
  assert.deepEqual(warnings, [["[signup-identity] unlinked", { reason: "link_not_persisted" }]]);
  assert.equal(h.rows.length, 0);
  assert.equal(h.captureAttempts.length, 0);
});

test("durable flag off preserves immediate capture without an outbox transaction", async () => {
  const h = harness();
  h.setFlagEnabled(durableFlag, false);
  h.failTransaction();
  assert.equal((await h.link()).link, true);
  await h.drain();
  assert.equal(h.rows.length, 0);
  assert.equal(h.captureAttempts.length, 1);
  assert.deepEqual(h.captureAttempts[0], {
    distinctId: "123", event: "$identify", uuid: h.api.signupIdentityUuid(123), properties: { $anon_distinct_id: anonymousId },
  });
  assert.deepEqual(h.phases, ["capture"]);
});

test("durable signup identify flag defaults to Everyone as a small-risk bugfix", () => {
  const h = harness();
  const definition = h.mocks[`@/lib/flags/definitions/${durableFlag}`];
  assert.equal(definition.HTPR_7290_DURABLE_SIGNUP_IDENTIFY_FLAG, durableFlag);
  assert.equal(definition.default.key, durableFlag);
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  assert.equal(definition.default.shippedOn, "2026-10-17");
  assert.equal(definition.default.releaseRisk.risk, "small");
});
