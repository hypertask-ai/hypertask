const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const stub = (file, exports) => {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
let redis;
let flag = true;
let ownerFailure = false;
let identityFailure = false;
let ownerUid = "owner";
let plan = "Pro";
let seats = 3;
let teamOverride = {};
let flagCalls = [];
let prismaCalls = { team: 0, user: 0 };
let highWaterWrites = 0;
let projectReads = 0;
let daySpend = 0;
let monthSpend = 0;
let demoSpend = 0;
let reports = [];
let keyRows = {};
let keyReads = [];
let providerCalls = [];
let customerFailure;
const originalFetch = global.fetch;
const originalSharedKey = process.env.AI_GATEWAY_API_KEY;
const originalDemoKey = process.env.DEMO_AI_GATEWAY_API_KEY;
const planFlag = "htpr-7324-plan-ai-caps";
stub("src/lib/redis.ts", { getRedis: async () => redis });
stub("src/lib/flags.ts", { isFeatureEnabled: async (key, userId) => {
  if (key !== planFlag) return false;
  flagCalls.push(userId);
  if (flag instanceof Error) throw flag;
  return flag;
} });
stub("src/lib/prisma.ts", { default: {
  project: { findFirst: async () => { projectReads++; return { teamId: "project-team" }; } },
  team: { findUnique: async ({ select }) => {
    prismaCalls.team++;
    if (ownerFailure) throw new Error("owner lookup unavailable");
    return {
      id: "team", googleAccount: { userId: 7324 }, members: [{ userId: 7324 }, { userId: 9 }, { userId: 9 }, { userId: 10 }],
      activeSubscriptionPlanId: "sub", activeSubscriptionPlanItemId: "item",
      subscriptionPlan: [{ subscriptionId: "sub", subscriptionStatus: "active", subscriptionItemId: "item", subscriptionObject: {
        items: { data: [{ id: "unrelated", quantity: 100 }, { id: "item", quantity: seats }] },
      } }],
      ...teamOverride,
    };
  } },
  user: { findUnique: async () => { prismaCalls.user++; if (identityFailure) throw new Error("owner identity lookup unavailable"); return ownerUid === null ? null : { uid: ownerUid }; } },
  teamByokApiKey: { findUnique: async ({ where }) => {
    const provider = where.teamId_provider.provider;
    keyReads.push(provider);
    return keyRows[provider] ? { enabled: true, ciphertext: keyRows[provider] } : null;
  } },
} });
stub("src/lib/crypto/byokCipher.ts", { decryptByokSecret: (value) => value });
stub("src/utils/controllers/projects/getAllIncludes.ts", { getProjectWhere: () => ({}) });
stub("src/app/api/ai/_lib/planGate.ts", {
  storePlanIdForProject: async () => plan,
  haiku55ModelEnabled: async () => false,
  haikuDefaultModelEnabled: async () => false,
  backgroundClaudeModelEnabled: async () => false,
});
const managed = new Set();
stub("src/app/api/ai/_lib/modelProvider.ts", {
  isVercelAiGatewayKey: (key) => typeof key === "string" && key.startsWith("vck_"),
  registerManagedGatewayKey: (key) => managed.add(key),
  gatewayFundingSourceForApiKey: (key) => key === process.env.AI_GATEWAY_API_KEY ? "shared" : managed.has(key) ? "managed" : "customer",
  resolveAiModel: (provider, modelId, credential) => ({
    specificationVersion: "v4", provider, modelId, supportedUrls: {},
    doGenerate: async () => {
      providerCalls.push({ provider, modelId, credential });
      if (provider === "claude") throw customerFailure;
      return { content: [{ type: "text", text: "OK" }], usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } };
    },
  }),
  inheritAiModelUsage() {}, configureAiModelUsage() {},
  aiUsageProviderForCredential: () => "test", providerOptionsForAiModel: () => ({}),
});
const allowance = load(path.join(root, "src/app/api/ai/_lib/sharedAllowance.ts"));
const policy = load(path.join(root, "src/app/api/ai/_lib/planAllowancePolicy.ts"));
const byok = load(path.join(root, "src/app/api/ai/_lib/byokKeys.ts"));
const jobs = load(path.join(root, "src/lib/ai/batch/batchJobs.ts"));
const constants = load(path.join(root, "src/lib/aiAllowancePolicy.ts"));

function fakeRedis() {
  const values = new Map();
  const sets = new Map();
  const get = (key) => Number(values.get(key) ?? 0);
  const zset = (key) => { if (!sets.has(key)) sets.set(key, new Map()); return sets.get(key); };
  return {
    values, sets,
    get: async (key) => values.get(key) ?? null,
    exists: async (key) => Number(values.has(key)),
    set: async (key, value, ...options) => {
      if (options.includes("NX") && values.has(key)) return null;
      values.set(key, String(value)); return "OK";
    },
    eval: async (script, count, ...all) => {
      const keys = all.slice(0, count);
      const args = all.slice(count);
      if (script.includes('local previous =')) {
        highWaterWrites++;
        const high = Math.max(get(keys[0]), Number(args[0]));
        values.set(keys[0], String(high)); return high;
      }
      if (script.includes('local initialized =')) {
        if (values.has(keys[2])) return 0;
        const pending = Math.max(get(keys[0]) - Number(args[0]), 0);
        [args[1], args[2], args[4], pending, args[3]].forEach((value, i) => values.set(keys[i], String(value)));
        return 1;
      }
      if (script.includes('KEYS[2], "1", "EX"')) {
        if (values.has(keys[1])) return 0;
        values.set(keys[1], "1"); values.set(keys[0], String(get(keys[0]) + Number(args[0]))); return 1;
      }
      if (script.includes('local visible =')) {
        if (!values.has(keys[0]) && !values.has(keys[1])) return null;
        return keys.reduce((sum, key) => sum + get(key), 0);
      }
      if (script.includes('local scopes =')) {
        const scopes = JSON.parse(args[0]);
        if (script.includes('local removed =')) {
          let removed = 0;
          for (const [c, r] of scopes) {
            if (zset(keys[r - 1]).delete(args[1])) {
              values.set(keys[c - 1], String(get(keys[c - 1]) + Number(args[2]))); removed++;
            }
          }
          return removed;
        }
        for (const [index, scope] of scopes.entries()) {
          let total = 0;
          for (const [c, r] of scope.pairs) {
            for (const [member, expiry] of zset(keys[r - 1])) {
              if (expiry <= Number(args[1])) {
                values.set(keys[c - 1], String(get(keys[c - 1]) + Number(member.split("|").at(-1))));
                zset(keys[r - 1]).delete(member);
              }
            }
            total += get(keys[c - 1]);
            for (const member of zset(keys[r - 1]).keys()) total += Number(member.split("|").at(-1));
          }
          if (scope.pending) total += get(keys[scope.pending - 1]);
          if (total + Number(args[2]) > scope.cap) return -index - 1;
        }
        for (const scope of scopes) zset(keys[scope.pairs[scope.writeIndex - 1][1] - 1]).set(args[4], Number(args[3]));
        return 1;
      }
      throw new Error(`Unexpected fake Redis script: ${script.slice(0, 60)}`);
    },
  };
}

function mockFetch() {
  global.fetch = async (url, options) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/models")) return Response.json({ data: [{ id: "openai/test", pricing: { input: "0.000001", output: "0.000001" } }] });
    reports.push(parsed);
    if (options?.headers?.Authorization === "Bearer vck_demo_test") return Response.json({ results: [{ total_cost: demoSpend }] });
    const sameTeamReports = reports.filter((value) => value.searchParams.get("tags") === parsed.searchParams.get("tags"));
    const spend = sameTeamReports.length === 1 ? monthSpend : daySpend;
    const teamId = parsed.searchParams.get("tags").slice(5);
    return Response.json({ results: spend ? [{ tag: `team:${teamId}`, total_cost: spend }] : [] });
  };
}

test.beforeEach(() => {
  prismaCalls = { team: 0, user: 0 }; highWaterWrites = 0; projectReads = 0;
  redis = fakeRedis(); flag = true; ownerFailure = false; identityFailure = false; ownerUid = "owner"; plan = "Pro"; seats = 3;
  teamOverride = {}; flagCalls = []; reports = []; daySpend = 0; monthSpend = 0; demoSpend = 0;
  keyRows = {}; keyReads = []; providerCalls = []; managed.clear();
  customerFailure = Object.assign(new Error("customer model unavailable"), { statusCode: 404 });
  process.env.AI_GATEWAY_API_KEY = "vck_shared_test";
  delete process.env.DEMO_AI_GATEWAY_API_KEY;
  allowance.resetGatewayPricingCacheForTests();
  mockFetch();
});
test.after(() => {
  global.fetch = originalFetch;
  if (originalSharedKey === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = originalSharedKey;
  if (originalDemoKey === undefined) delete process.env.DEMO_AI_GATEWAY_API_KEY; else process.env.DEMO_AI_GATEWAY_API_KEY = originalDemoKey;
});
const free = { mode: "plan", monthlyUsd: 1, dailyUsd: 0.25, demoGlobal: false };
const paid = { mode: "plan", monthlyUsd: 15, dailyUsd: null, demoGlobal: false };
const reserve = (overrides = {}) => allowance.reservePlanAllowance({ teamId: "team", policy: free, gatewayApiKey: "vck_test", amountUsd: 0.1, ...overrides });
const refusal = (reason) => (error) => error instanceof allowance.SharedAiAllowanceExceededError && error.reason === reason;

test("feature flag inherits Owner + QA and declares the registry's highest release risk", () => {
  const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7324-plan-ai-caps.ts"));
  const value = definition.default ?? definition;
  assert.equal(value.key, planFlag); assert.equal(value.kind, "feature");
  assert.equal(value.defaultMode, undefined); assert.equal(value.releaseRisk.risk, "new");
  assert.equal(value.releaseRisk.highRisk, "money");
  assert.match(value.releaseRisk.reason, /High risk/);
  assert.match(fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8"), /DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA"/);
});

test("flag parser accepts money classification but rejects invalid or default-Everyone money flags", async () => {
  const { parseFlagFiles } = await import("../.github/scripts/feature-flag-registry.mjs");
  const file = "src/lib/flags/definitions/htpr-7324-plan-ai-caps.ts";
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.equal(parseFlagFiles([file], () => source)[0].definition.releaseRisk.highRisk, "money");
  assert.throws(() => parseFlagFiles([file], () => source.replace('highRisk: "money"', 'highRisk: "unknown"')), /releaseRisk.highRisk must be/);
  assert.throws(() => parseFlagFiles([file], () => source.replace('kind: "feature",', 'kind: "feature", defaultMode: "EVERYONE",')), /may not default to Everyone|only bugfix flags/);
});

test("owner flag is read each call; accepted cached owner, not caller, controls mode", async () => {
  assert.equal((await policy.resolveTeamAllowancePolicy("owner-team", "managed")).monthlyUsd, 15);
  flag = false;
  assert.deepEqual(await policy.resolveTeamAllowancePolicy("owner-team", "managed"), { mode: "legacy", monthlyUsd: 40, dailyUsd: null, demoGlobal: false });
  assert.deepEqual(flagCalls, [7324, 7324]);
  assert.equal((await policy.resolveTeamAllowancePolicy("owner-team", "shared")).monthlyUsd, 1);
});

test("saved matching entitling item controls seats and month high-water never decreases", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    assert.equal((await policy.resolveTeamAllowancePolicy("seat-team", "managed")).monthlyUsd, 15);
    seats = 1;
    now += 5 * 60 * 1000;
    assert.equal((await policy.resolveTeamAllowancePolicy("seat-team", "managed")).monthlyUsd, 15);
    assert.equal(highWaterWrites, 1, "seat decreases do not write the high-water");
    seats = 5;
    assert.equal((await policy.resolveTeamAllowancePolicy("seat-team", "managed")).monthlyUsd, 15, "seat snapshot lasts five minutes");
    now += 5 * 60 * 1000;
    assert.equal((await policy.resolveTeamAllowancePolicy("seat-team", "managed")).monthlyUsd, 25);
    assert.equal(highWaterWrites, 2, "only a newly observed increase writes the high-water");
    assert.equal(await redis.get(`ai-allowance:${constants.aiAllowancePeriod().key}:seat-team:seats-high`), "5");
  } finally { Date.now = realNow; }
});

test("cached high-water refreshes increases seen by another process without rewriting Redis", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    assert.equal((await policy.resolveTeamAllowancePolicy("cross-process-seats", "managed")).monthlyUsd, 15);
    redis.values.set(`ai-allowance:${constants.aiAllowancePeriod().key}:cross-process-seats:seats-high`, "7");
    now += 5 * 60 * 1000;
    assert.equal((await policy.resolveTeamAllowancePolicy("cross-process-seats", "managed")).monthlyUsd, 35);
    assert.equal(highWaterWrites, 1);
  } finally { Date.now = realNow; }
});

test("seat high-water resets at the next UTC month", async () => {
  const RealDate = global.Date;
  let now = new RealDate("2026-11-30T23:59:00Z").getTime();
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  try {
    seats = 5;
    assert.equal((await policy.resolveTeamAllowancePolicy("month-seats", "managed")).monthlyUsd, 25);
    seats = 1;
    assert.equal((await policy.resolveTeamAllowancePolicy("month-seats", "managed")).monthlyUsd, 25);
    now = new RealDate("2026-12-01T00:01:00Z").getTime();
    assert.equal((await policy.resolveTeamAllowancePolicy("month-seats", "managed")).monthlyUsd, 5);
  } finally { global.Date = RealDate; }
});

test("selector uses active entitling row, including legacy paid status, not unrelated subscription", async () => {
  teamOverride.subscriptionPlan = [
    { subscriptionId: "old", subscriptionStatus: "canceled", subscriptionItemId: "old-item", subscriptionObject: { items: { data: [{ id: "old-item", quantity: 99 }] } } },
    { subscriptionId: "sub", subscriptionStatus: "paid", subscriptionItemId: "item", subscriptionObject: { items: { data: [{ id: "item", quantity: 4 }] } } },
  ];
  assert.equal((await policy.resolveTeamAllowancePolicy("legacy-paid", "managed")).monthlyUsd, 20);
});

test("corrupt or missing paid items use one seat, never accepted-member or invite counts", async () => {
  for (const quantity of [0, -2, 1.5, NaN, Infinity, "9", undefined]) {
    seats = quantity;
    assert.equal((await policy.resolveTeamAllowancePolicy(`invalid-${quantity}`, "managed")).monthlyUsd, 5);
  }
  teamOverride.subscriptionPlan = [];
  assert.equal((await policy.resolveTeamAllowancePolicy("missing-paid", "managed")).monthlyUsd, 5);
});

test("comp and entitled trial with no Stripe item count distinct accepted users only", async () => {
  teamOverride = { compedUntil: new Date(Date.now() + 100000), subscriptionPlan: [] };
  assert.equal((await policy.resolveTeamAllowancePolicy("comp-team", "managed")).monthlyUsd, 15);
  teamOverride = { activeSubscriptionPlanItemId: null, subscriptionPlan: [{ subscriptionId: "sub", subscriptionStatus: "trialing", subscriptionItemId: "", subscriptionObject: null }] };
  assert.equal((await policy.resolveTeamAllowancePolicy("trial-team", "managed")).monthlyUsd, 15);
  teamOverride.subscriptionPlan[0].subscriptionStatus = "canceled";
  assert.equal((await policy.resolveTeamAllowancePolicy("expired-trial", "managed")).monthlyUsd, 5);
});

test("flag errors use strict all-in policy and cap paid high-water at the legacy monthly maximum", async () => {
  flag = new Error("flag unavailable"); seats = 20;
  assert.deepEqual(await policy.resolveTeamAllowancePolicy("strict-team", "managed"), { mode: "plan", monthlyUsd: 40, dailyUsd: null, demoGlobal: false });
  assert.deepEqual(await policy.resolveTeamAllowancePolicy("strict-team", "shared"), free);
  assert.equal(await policy.teamPlanAllowanceEnabled("strict-team"), true);
  assert.equal(jobs.batchEligibleFunding("managed", await policy.teamPlanAllowanceEnabled("strict-team")), false);
});

test("owner/seat/Redis lookup failures are strict at every policy entry point", async () => {
  ownerFailure = true;
  assert.equal(await policy.teamPlanAllowanceEnabled("missing-owner"), true);
  assert.equal((await policy.resolveTeamAllowancePolicy("missing-owner", "managed")).monthlyUsd, 1);
  ownerFailure = false;
  redis.eval = async () => { throw new Error("Redis unavailable"); };
  const strict = await policy.resolveTeamAllowancePolicy("seat-error", "managed");
  assert.equal(strict.mode, "plan"); assert.equal(strict.monthlyUsd, 5);
});

test("unknown owner identity uses strict team-only monthly and daily limits", async () => {
  for (const failure of ["owner", "identity", "missing-user"]) {
    ownerFailure = failure === "owner";
    identityFailure = failure === "identity";
    ownerUid = failure === "missing-user" ? null : "owner";
    for (const funding of ["shared", "managed"]) {
      assert.deepEqual(await policy.resolveTeamAllowancePolicy(`unknown-${failure}-${funding}`, funding), free);
    }
  }
});

test("unknown ordinary owner does not consume an exhausted demo pool; confirmed guests still do", async () => {
  identityFailure = true;
  const strict = await policy.resolveTeamAllowancePolicy("unknown-owner-pool", "managed");
  process.env.DEMO_AI_GATEWAY_API_KEY = "vck_demo_test";
  demoSpend = 15;
  const reservation = await reserve({ teamId: "unknown-owner-pool", policy: strict });
  assert.equal(reservation.scopes.length, 2);
  assert.ok(reservation.scopes.every((scope) => !scope.committedKey.includes(":demo:")));
  identityFailure = false; ownerUid = "guest_confirmed";
  const guestPolicy = await policy.resolveTeamAllowancePolicy("confirmed-guest-pool", "shared");
  await assert.rejects(reserve({ teamId: "confirmed-guest-pool", policy: guestPolicy }), refusal("demo"));
});

test("guest team policy adds the demo global scope even on ordinary team AI calls", async () => {
  ownerUid = "guest_7324";
  assert.deepEqual(await policy.resolveTeamAllowancePolicy("guest-team", "shared"), { ...free, demoGlobal: true });
  assert.deepEqual(await policy.resolveTeamAllowancePolicy("guest-team", "managed"), { ...free, demoGlobal: true });
});

test("fake Redis checks shared visible/system month plus legacy pending once and snapshots exclude reservations", async () => {
  const prefix = `ai-allowance:${constants.aiAllowancePeriod().key}:team`;
  redis.values.set(`${prefix}:committed`, "600000");
  monthSpend = 0.4;
  const first = await reserve({ policy: { ...free, dailyUsd: null }, amountUsd: 0.3, lane: "system" });
  assert.equal((await allowance.teamAllowanceSnapshot("team", 1, free)).usedUsd, 0.6);
  await assert.rejects(reserve({ policy: { ...free, dailyUsd: null }, amountUsd: 0.2 }), refusal("month"));
  await allowance.settlePlanAllowance(first, 0.1);
  await allowance.settlePlanAllowance(first, 0.9);
  assert.equal((await allowance.teamAllowanceSnapshot("team", 1, free)).usedUsd, 0.7);
  assert.equal(await allowance.teamAllowanceSnapshot("missing", 1, free), null);
});

test("day seed refuses before inference and retries neither reseed nor leave reservations", async () => {
  daySpend = 0.2;
  const first = await reserve({ amountUsd: 0.04 });
  await assert.rejects(reserve({ amountUsd: 0.02 }), refusal("day"));
  assert.equal(reports.length, 2, "month and day seed once");
  for (const scope of first.scopes) assert.deepEqual([...redis.sets.get(scope.reservationsKey).keys()], [first.id]);
  for (const set of redis.sets.values()) assert.ok([...set.keys()].every((member) => member === first.id));
  assert.equal(allowance.sharedAiAllowanceErrorMessage(new allowance.SharedAiAllowanceExceededError("month", "day")), constants.DAILY_AI_ALLOWANCE_EXCEEDED_MESSAGE);
});

test("monthly demo seed is once and shared across teams and demo-only callers", async () => {
  process.env.DEMO_AI_GATEWAY_API_KEY = "vck_demo_test"; demoSpend = 14.8;
  const first = await reserve({ policy: { ...free, demoGlobal: true }, amountUsd: 0.15 });
  await assert.rejects(reserve({ teamId: undefined, policy: { ...free, demoGlobal: true }, amountUsd: 0.1 }), refusal("demo"));
  assert.equal(reports.filter((url) => !url.searchParams.has("tags")).length, 1);
  assert.equal(first.scopes.length, 3);
});

test("free over cap is refused while paid under 5 x saved seats is admitted", async () => {
  monthSpend = 1.01;
  await assert.rejects(reserve({ policy: await policy.resolveTeamAllowancePolicy("team", "shared") }), refusal("month"));
  const paidPolicy = await policy.resolveTeamAllowancePolicy("paid-team", "managed");
  const reservation = await reserve({ teamId: "paid-team", policy: paidPolicy, amountUsd: 5 });
  assert.equal(reservation.scopes.length, 1); assert.equal(paidPolicy.monthlyUsd, 15);
});

test("both language and image middleware resolve policy for each call, before provider use", async () => {
  monthSpend = 1.1;
  for (const factory of [allowance.createSharedAllowanceMiddleware, allowance.createImageAllowanceMiddleware]) {
    const teams = [];
    const middleware = factory({ allowanceUsd: 40, gatewayApiKey: "vck_test", modelSlug: "openai/test", resolvePolicy: async (teamId) => { teams.push(teamId); return free; } });
    await assert.rejects(middleware.wrapGenerate({ params: { prompt: [], n: 1, providerOptions: { gateway: { tags: ["team:team"] } } }, doGenerate: async () => { throw new Error("provider must not run"); } }), refusal("month"));
    assert.deepEqual(teams, ["team"]);
  }
});

test("plan batch admission is false; flag-off managed funding still uses batches", async () => {
  assert.equal(jobs.batchEligibleFunding("managed", true), false);
  flag = false;
  assert.equal(jobs.batchEligibleFunding("managed", await policy.teamPlanAllowanceEnabled("batch-team")), true);
  assert.equal(jobs.batchEligibleFunding("shared"), false);
  assert.equal(jobs.batchEligibleFunding("customer"), false);
  for (const [file, team] of [["src/lib/slack/threadSummaryBatch.ts", "context.teamId"], ["src/lib/ai/labelClassifier.ts", "teamId"]]) {
    assert.ok(fs.readFileSync(path.join(root, file), "utf8").includes(`await teamPlanAllowanceEnabled(${team})`));
  }
});

test("BYOK broken key preserves original failure and never uses shared or managed credentials; customer fallback still works", async () => {
  plan = "BYOK";
  const lookup = { trustedTeamId: "byok-team" };
  const original = new Error("customer key rejected");
  managed.add("vck_managed");
  for (const credential of [undefined, "vck_shared_test", "vck_managed"]) {
    await assert.rejects(byok.resolveAiFallbackCredential(lookup, async () => credential, original), (error) => error === original);
  }
  await assert.rejects(byok.resolveAiFallbackCredential(lookup, async () => { throw new Error("fallback resolution failed"); }, original), (error) => error === original);
  assert.equal(await byok.getTeamGatewayApiKey(lookup), undefined);
  assert.ok(!keyReads.includes("managed_gateway"));
  assert.equal(providerCalls.length, 0);
  assert.equal(await byok.resolveAiFallbackCredential(lookup, async () => "sk_customer", original), "sk_customer");
  keyRows.gateway = "vck_customer";
  assert.equal(await byok.getTeamGatewayApiKey(lookup), "vck_customer");
  flag = new Error("flag unavailable"); keyRows = {};
  assert.equal(await byok.getTeamGatewayApiKey(lookup), undefined);
  await assert.rejects(byok.resolveAiFallbackCredential(lookup, async () => "vck_shared_test", original), (error) => error === original);
});

test("fallback credential lookup failures never escape with credential-bearing diagnostics", async () => {
  for (const enabled of [true, false]) {
    flag = enabled; plan = "BYOK";
    const original = new Error("customer model unavailable");
    const sensitiveValue = require("node:crypto").randomUUID();
    const sensitiveFailure = Object.assign(new Error(`credential lookup failed: ${sensitiveValue}`), { apiKey: sensitiveValue });
    await assert.rejects(byok.resolveAiFallbackCredential({ trustedTeamId: `lookup-failure-${enabled}` }, async () => {
      throw sensitiveFailure;
    }, original), (error) => error === original && !("apiKey" in error) && !error.message.includes(sensitiveValue));
  }
});

test("broken BYOK automatic model call rethrows the actual customer error without platform inference", async () => {
  plan = "BYOK";
  const lookup = { trustedTeamId: "byok-model-team" };
  const model = byok.resolveAutomaticAiModel("claude", "claude-haiku-5-5", "sk_broken_customer", { haiku55Enabled: true, lookup, feature: "summary" });
  await assert.rejects(model.doGenerate({ prompt: [] }), (error) => error === customerFailure);
  assert.deepEqual(providerCalls.map((call) => call.credential), ["sk_broken_customer"]);
  assert.ok(!keyReads.includes("managed_gateway"));
  keyRows.openai = "sk_customer_fallback";
  const working = byok.resolveAutomaticAiModel("claude", "claude-haiku-5-5", "sk_broken_customer", { haiku55Enabled: true, lookup, feature: "summary" });
  assert.equal((await working.doGenerate({ prompt: [] })).content[0].text, "OK");
  assert.deepEqual(providerCalls.map((call) => call.credential), ["sk_broken_customer", "sk_broken_customer", "sk_customer_fallback"]);
});

test("flag-off retains BYOK shared-key fallback and the legacy $1/$40 and 10x policies", async () => {
  flag = false; plan = "BYOK";
  assert.equal(await byok.getTeamGatewayApiKey({ trustedTeamId: "legacy-byok" }), "vck_shared_test");
  const original = new Error("key rejected");
  assert.equal(await byok.resolveAiFallbackCredential({ trustedTeamId: "legacy-byok" }, async () => "vck_shared_test", original), "vck_shared_test");
  assert.equal((await policy.resolveTeamAllowancePolicy("legacy-free", "shared")).monthlyUsd, 1);
  assert.equal((await policy.resolveTeamAllowancePolicy("legacy-paid", "managed")).monthlyUsd, 40);
  assert.equal(allowance.SYSTEM_AI_ALLOWANCE_MULTIPLIER, 10);
});

function moduleWithStubs(file, stubs) {
  const ts = require("typescript");
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  require("node:vm").runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: (id) => id in stubs ? stubs[id] : id.startsWith("@/") || id.startsWith("./") ? {} : require(id),
    Error, Response, Request, URL, URLSearchParams, AbortController, console, Date, setTimeout, clearTimeout, process,
    fetch: (...args) => global.fetch(...args),
  }, { filename });
  return loaded.exports;
}

test("month/day/demo refusals map through wrapped chat errors by type and reason", async () => {
  const errors = moduleWithStubs("src/lib/ai/chatStream/errors.ts", {
    "@/lib/api/errorMessage": { toErrorMessage: (error) => error.message },
  });
  for (const reason of ["month", "day", "demo"]) {
    const error = new allowance.SharedAiAllowanceExceededError("2026-10", reason);
    const wrapped = new Error("retry failed", { cause: error });
    assert.equal(errors.userFacingErrorMessage(wrapped, "test"), error.message);
    assert.equal(errors.includedAllowanceError(wrapped).reason, reason);
    assert.deepEqual({ ...errors.userFacingErrorDetails(wrapped, "team") }, {
      allowancePeriod: "2026-10", allowanceTeamId: "team",
    });
  }
  assert.equal(errors.includedAllowanceError(new Error(constants.DAILY_AI_ALLOWANCE_EXCEEDED_MESSAGE)), null);
});

test("settings displays the all-in committed snapshot including legacy pending; missing snapshot is null; legacy reports stay unchanged", async () => {
  let displayPolicy = paid;
  const teamId = "display-team";
  const prefix = `ai-allowance:${constants.aiAllowancePeriod().key}:${teamId}`;
  redis.values.set(`${prefix}:committed`, "200000");
  redis.values.set(`${prefix}:system:committed`, "300000");
  redis.values.set(`${prefix}:legacy-pending`, "100000");
  const route = moduleWithStubs("src/app/api/settings/ai-usage/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/auth/serverUser": { getServerCookieUser: async () => ({ id: 7324 }) },
    "@/lib/prisma": { __esModule: true, default: {
      team: { findUnique: async () => ({ googleAccount: { userId: 7324 } }) },
      aiUsage: { groupBy: async () => [] },
      project: { findMany: async () => [] }, task: { findMany: async () => [] }, agent: { findMany: async () => [] },
    } },
    "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess": { __esModule: true, default: async () => true },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => ({ source: "managed", apiKey: "vck_test" }) },
    "@/app/api/ai/_lib/planAllowancePolicy": { resolveTeamAllowancePolicy: async () => displayPolicy },
    "@/app/api/ai/_lib/sharedAllowance": allowance,
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "Pro" },
    "@/lib/aiAllowancePolicy": constants,
    "./gatewayUsage": {
      gatewayBillingPeriodRange: constants.aiAllowancePeriod,
      aggregateGatewayTeamUsage: () => ({ totalCost: 7 }),
      aggregateGatewaySystemSpend: () => 2,
      aggregateGatewayByModel: () => [], buildDisplayModelUsage: () => [],
    },
  });
  global.fetch = async () => Response.json({ results: [] });
  const read = async () => (await route.GET(new Request(`https://example.test/api/settings/ai-usage?teamId=${teamId}`))).json();
  let response = await read();
  assert.equal(response.allowance.budgetUsd, 15); assert.equal(response.allowance.usedUsd, 0.6);
  assert.equal(response.allowance.remainingUsd, 14.4);
  redis.values.clear(); response = await read(); assert.equal(response.allowance, null);
  displayPolicy = { mode: "legacy", monthlyUsd: 40, dailyUsd: null, demoGlobal: false };
  response = await read(); assert.equal(response.allowance.budgetUsd, 40); assert.equal(response.allowance.usedUsd, 5);
});

test("personal shares use the plan cap and include background spend rather than subtracting its legacy tags", async () => {
  const usage = load(path.join(root, "src/app/api/settings/ai-usage/gatewayUsage.ts"));
  global.fetch = async (url) => Response.json({ results: String(url).includes("group_by=day")
    ? [{ total_cost: 3 }] : [{ tag: "user:7324", total_cost: 1 }, { tag: "summary", total_cost: 1 }, { tag: "included-with-hypertask", total_cost: 1 }] });
  const result = await usage.computePersonalTeamSharePct({
    allowanceUsd: 5, includeSystemUsage: true, gatewayKey: "vck_test", teamId: "team", userId: 7324,
    memberIds: [7324], members: [{ displayName: "Owner", userId: 7324 }],
  });
  assert.equal(result.userSharePct, 20);
  assert.deepEqual(result.memberUsage, [
    { displayName: "Other / agents", sharePct: 40, userId: null },
    { displayName: "Owner", sharePct: 20, userId: 7324 },
  ]);
});

test("BYOK title without a customer credential skips AI; a customer credential still generates a title", async () => {
  plan = "BYOK";
  let calls = 0;
  const titles = moduleWithStubs("src/lib/ai/chatStream/title.ts", {
    "@/app/api/ai/_lib/byokKeys": {
      resolveAiFallbackCredential: byok.resolveAiFallbackCredential,
      getAiDefaultModelContext: async () => ({ haiku55Enabled: false, plan: "BYOK" }),
    },
    "@/app/api/ai/_lib/modelProvider": {
      isAiGatewayEnabled: () => true, resolveAiModel: () => { calls++; return {}; },
      providerOptionsForAiModel: () => ({}),
    },
    "@/lib/aiModelOptions": { defaultModelKeyFor: () => "gpt-6-luna" },
    "@/lib/ai/prompts/registry": { renderPrompt: () => "title instructions" },
    ai: { generateText: async () => ({ text: "Customer funded title" }) },
  });
  assert.equal(await titles.generateConversationTitle("Content", "Local fallback", "vck_shared_test", { teamId: "title-team" }), "Local fallback");
  assert.equal(calls, 0);
  assert.equal(await titles.generateConversationTitle("Content", "Local fallback", "sk_customer", { teamId: "title-team" }), "Customer funded title");
  assert.equal(calls, 1);
});

async function realRedis(t) {
  const available = spawnSync("redis-server", ["--version"], { encoding: "utf8" });
  if (available.error?.code === "ENOENT") { t.skip("redis-server missing: real Redis Lua checks require a local redis-server binary"); return null; }
  assert.equal(available.status, 0, available.stderr);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "htpr-7324-"));
  const socket = path.join(scratch, "r.sock");
  const server = spawn("redis-server", ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit");
  t.after(async () => { server.kill("SIGTERM"); await exited; fs.rmSync(scratch, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Redis startup timed out")), 10000);
    server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Redis exited before readiness: ${code}`)); });
    server.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("ready to accept connections") || output.includes("Ready to accept connections")) { clearTimeout(timeout); resolve(); }
    });
  });
  const Redis = require("ioredis");
  const client = new Redis(socket, { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0 });
  client.on("error", () => {});
  await client.connect();
  t.after(() => client.disconnect());
  return client;
}

test("real Redis Lua: concurrent lanes, all scopes, seeding, refusal atomicity, idempotent settlement and expiry", async (t) => {
  redis = await realRedis(t); if (!redis) return;
  const prefix = `ai-allowance:${constants.aiAllowancePeriod().key}:team`;
  const result = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => reserve({ policy: { ...free, dailyUsd: null }, amountUsd: 0.1, lane: i % 2 ? "system" : "visible" })));
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 10);
  assert.ok(result.filter((r) => r.status === "rejected").every((r) => refusal("month")(r.reason)));
  assert.equal(await redis.zcard(`${prefix}:reservations`) + await redis.zcard(`${prefix}:system:reservations`), 10);

  await redis.flushdb(); reports = []; daySpend = 0.2; demoSpend = 14.8;
  process.env.DEMO_AI_GATEWAY_API_KEY = "vck_demo_test";
  const guest = { ...free, demoGlobal: true };
  const one = await reserve({ policy: guest, amountUsd: 0.04 });
  await assert.rejects(reserve({ policy: guest, amountUsd: 0.02, lane: "system" }), refusal("day"));
  for (const scope of one.scopes) {
    assert.deepEqual(await redis.zrange(scope.reservationsKey, 0, -1), [one.id]);
    assert.ok(await redis.ttl(scope.reservationsKey) > 0);
  }
  assert.equal(await redis.zcard(`${prefix}:system:reservations`), 0);
  assert.equal(reports.length, 3, "month/day/demo bootstrap each runs once");
  await allowance.settlePlanAllowance(one, 0.01);
  await allowance.settlePlanAllowance(one, 0.09);
  assert.deepEqual(await Promise.all(one.scopes.map((s) => redis.get(s.committedKey))), ["10000", "210000", "14810000"]);
  const two = await reserve({ policy: guest, amountUsd: 0.03, lane: "system" });
  for (const scope of two.scopes) await redis.zadd(scope.reservationsKey, Date.now() - 1, two.id);
  const three = await reserve({ policy: guest, amountUsd: 0.005 });
  await allowance.settlePlanAllowance(two, 0.001);
  assert.deepEqual(await Promise.all(two.scopes.map((s) => redis.get(s.committedKey))), ["30000", "240000", "14840000"]);
  for (const scope of three.scopes) assert.deepEqual(await redis.zrange(scope.reservationsKey, 0, -1), [three.id]);
  assert.equal((await allowance.teamAllowanceSnapshot("team", 1, guest)).usedUsd, 0.04);

  await redis.flushdb(); daySpend = 0; demoSpend = 14.95;
  await assert.rejects(reserve({ policy: guest, amountUsd: 0.1 }), refusal("demo"));
  for (const key of await redis.keys("*:reservations")) assert.equal(await redis.zcard(key), 0);
  const demoOnly = await reserve({ teamId: undefined, policy: guest, amountUsd: 0.02 });
  assert.equal(demoOnly.scopes.length, 1);
  await allowance.settlePlanAllowance(demoOnly, 0.01);
  assert.equal(await redis.get(demoOnly.scopes[0].committedKey), "14960000");

  await redis.flushdb(); monthSpend = 1.1; flag = new Error("flag lookup unavailable");
  const strictFree = await policy.resolveTeamAllowancePolicy("real-free", "shared");
  await assert.rejects(reserve({ teamId: "real-free", policy: strictFree }), refusal("month"));
  const strictPaid = await policy.resolveTeamAllowancePolicy("real-paid", "managed");
  assert.equal(strictPaid.monthlyUsd, 15);
  await reserve({ teamId: "real-paid", policy: strictPaid, amountUsd: 5 });

  flag = true; plan = "BYOK";
  const broken = byok.resolveAutomaticAiModel("claude", "claude-haiku-5-5", "sk_broken_customer", {
    haiku55Enabled: true, lookup: { trustedTeamId: "real-byok" }, feature: "summary",
  });
  await assert.rejects(broken.doGenerate({ prompt: [] }), (error) => error === customerFailure);
  assert.deepEqual(providerCalls.map((call) => call.credential), ["sk_broken_customer"]);

  flag = false; plan = "Pro";
  for (const [funding, cap] of [["shared", 1], ["managed", 40]]) {
    await redis.flushdb();
    const teamId = `real-legacy-${funding}`;
    const prefix = `ai-allowance:${constants.aiAllowancePeriod().key}:${teamId}`;
    await redis.set(`${prefix}:system-split-v1`, String(Date.now()));
    await redis.set(`${prefix}:committed`, String((cap + 0.1) * 1000000));
    await redis.set(`${prefix}:system:committed`, String((cap * 10 - 0.1) * 1000000));
    let calls = 0;
    const middleware = allowance.createSharedAllowanceMiddleware({
      allowanceUsd: cap, gatewayApiKey: "vck_test", modelSlug: "openai/test",
      resolvePolicy: (team) => policy.resolveTeamAllowancePolicy(team, funding),
    });
    const generate = (tags) => middleware.wrapGenerate({
      params: { prompt: [], maxOutputTokens: 1, providerOptions: { gateway: { tags: [`team:${teamId}`, ...tags] } } },
      doGenerate: async () => { calls++; return { usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } }; },
    });
    await assert.rejects(generate([]), refusal("month"));
    await generate(["included-with-hypertask"]);
    assert.equal(calls, 1, `legacy ${funding} system lane retains its 10x cap`);
  }

});


test("real Redis sliding windows: boundary burst, exact rolling expiry, concurrent admission and TTL", async (t) => {
  redis = await realRedis(t); if (!redis) return;
  const { consumeDemoWindow } = load(path.join(root, "src/lib/demo/slidingWindow.ts"));
  const hour = 60 * 60 * 1000;
  const key = "demo:chat:ip:test";
  const beforeEdge = 10 * hour - 1;
  const burst = await Promise.all(Array.from({ length: 40 }, () => consumeDemoWindow(key, 20, beforeEdge)));
  assert.equal(burst.filter((r) => r.allowed).length, 20);
  assert.equal(await redis.zcard(key), 20);
  assert.equal((await consumeDemoWindow(key, 20, beforeEdge + 2)).allowed, false, "calendar hour boundary must not reset rolling window");
  assert.deepEqual(await consumeDemoWindow(key, 20, beforeEdge + hour - 1), { allowed: false, retryAfter: 1 });
  assert.equal((await consumeDemoWindow(key, 20, beforeEdge + hour)).allowed, true);
  assert.equal(await redis.zcard(key), 1);
  assert.ok(await redis.pttl(key) > hour - 5000);
  for (const [scope, limit] of [["creation", 5], ["regeneration", 3]]) {
    const results = await Promise.all(Array.from({ length: limit * 3 }, () => consumeDemoWindow(`demo:${scope}`, limit, beforeEdge)));
    assert.equal(results.filter((r) => r.allowed).length, limit);
    assert.equal(await redis.zcard(`demo:${scope}`), limit);
  }
});


test("plan hot path caches owner identity and seats; warm call has no team/user queries or high-water writes", async () => {
  const policies = [];
  const middleware = allowance.createSharedAllowanceMiddleware({
    allowanceUsd: 40, gatewayApiKey: "vck_test", modelSlug: "openai/test",
    resolvePolicy: async (teamId) => {
      const snapshot = await policy.resolveTeamAllowancePolicy(teamId, "managed");
      policies.push(snapshot); return snapshot;
    },
  });
  const generate = () => middleware.wrapGenerate({
    params: { prompt: [], maxOutputTokens: 1, providerOptions: { gateway: { tags: ["team:hot-path-team"] } } },
    doGenerate: async () => ({ usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } }),
  });
  await generate();
  assert.equal(policies[0].monthlyUsd, 15);
  assert.ok(prismaCalls.team > 0 && prismaCalls.user > 0);
  const writes = highWaterWrites;
  prismaCalls = { team: 0, user: 0 };
  await generate();
  assert.deepEqual(policies[1], policies[0]);
  assert.deepEqual(prismaCalls, { team: 0, user: 0 });
  assert.equal(highWaterWrites, writes);
  assert.deepEqual(flagCalls, [7324, 7324], "flag is still read per call");
});

test("owner uid stays cached with its id for five minutes, then refreshes", async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    assert.deepEqual(await policy.resolveTeamAllowancePolicy("identity-ttl", "shared"), free);
    ownerUid = "guest_changed";
    prismaCalls = { team: 0, user: 0 };
    now += 5 * 60 * 1000 - 1;
    assert.deepEqual(await policy.resolveTeamAllowancePolicy("identity-ttl", "shared"), free);
    assert.deepEqual(prismaCalls, { team: 0, user: 0 });
    now++;
    assert.deepEqual(await policy.resolveTeamAllowancePolicy("identity-ttl", "shared"), { ...free, demoGlobal: true });
    assert.deepEqual(prismaCalls, { team: 1, user: 1 });
  } finally { Date.now = realNow; }
});

test("fallback resolves project/team only once and flag-off behavior stays permissive", async () => {
  plan = "BYOK"; flag = false;
  assert.equal(await byok.resolveAiFallbackCredential({ projectId: 7324, userId: 7324 }, async () => "vck_shared_test", new Error("customer failed")), "vck_shared_test");
  assert.equal(projectReads, 1);
});

for (const sweeper of ["refusal", "other-team", "demo-only", "legacy"]) {
  test(`real Redis expired reservation sweeps all original scopes via ${sweeper}; late settlement is a no-op`, async (t) => {
    redis = await realRedis(t); if (!redis) return;
    const guest = { ...free, demoGlobal: true };
    const original = await reserve({ policy: guest });
    for (const scope of original.scopes) await redis.zadd(scope.reservationsKey, Date.now() - 1, original.id);
    if (sweeper === "refusal") {
      await redis.set(original.scopes[0].committedKey, "900000");
      await assert.rejects(reserve({ policy: guest, amountUsd: 0.01 }), refusal("month"));
    } else if (sweeper === "legacy") {
      await allowance.createSharedAllowanceMiddleware({ gatewayApiKey: "vck_test", allowanceUsd: 1, modelSlug: "openai/test" }).wrapGenerate({
        params: { prompt: [], maxOutputTokens: 1, providerOptions: { gateway: { tags: ["team:team"] } } },
        doGenerate: async () => ({ usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } }),
      });
    } else {
      await reserve({ teamId: sweeper === "other-team" ? "another-team" : undefined, policy: guest, amountUsd: 0.01 });
    }
    for (const scope of original.scopes) assert.equal(await redis.zscore(scope.reservationsKey, original.id), null);
    const expected = sweeper === "refusal" ? ["1000000", "100000", "100000"] : ["100000", "100000", "100000"];
    assert.deepEqual(await Promise.all(original.scopes.map((scope) => redis.get(scope.committedKey))), expected);
    await allowance.settlePlanAllowance(original, 0.02);
    assert.deepEqual(await Promise.all(original.scopes.map((scope) => redis.get(scope.committedKey))), expected);
    if (sweeper === "refusal") {
      for (const key of await redis.keys("*:reservations")) assert.equal(await redis.zcard(key), 0);
    }
  });
}

for (const entry of ["editor", "chat"]) {
  for (const missing of ["custom", "openrouter"]) {
    for (const credential of ["sk_customer_default", "vck_shared_test", undefined]) {
      test(`${entry} missing ${missing} allows only customer-funded default (${credential ? credential.startsWith("sk_") ? "customer" : "platform" : "missing"})`, async () => {
        plan = "BYOK";
        const options = load(path.join(root, "src/lib/aiModelOptions.ts"));
        const fallback = options.getAiModelOptionById("gpt-6-luna");
        const lookup = { trustedTeamId: `fallback-${entry}-${missing}` };
        const selectedCredentials = [];
        const getKey = async (option) => (option.source ?? option) === "openai" ? credential : undefined;
        const providers = {
          isCustomEndpointConfig: (value) => !!value && typeof value === "object",
          isVercelAiGatewayKey: (value) => typeof value === "string" && value.startsWith("vck_"),
          resolveAiModel: (_provider, _model, key) => { selectedCredentials.push(key); return {}; },
          aiUsageProviderForCredential: () => "test", providerOptionsForAiModel: () => ({}),
          configureAiModelUsage() {}, inheritAiModelUsage() {},
        };
        const stubs = {
          "@/app/api/ai/_lib/byokKeys": {
            resolveAiFallbackCredential: byok.resolveAiFallbackCredential,
            getByokOrTeamGatewayApiKeyForModelOption: getKey,
            getByokOrTeamGatewayApiKeyForProvider: getKey,
          },
          "@/app/api/ai/_lib/modelProvider": providers,
          "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "BYOK", haiku55ModelEnabled: async () => false, assertModelAllowedForPlan: async () => {} },
          "@/lib/aiModelOptions": { ...options, getDefaultAiModelOptionForPlan: () => fallback },
          "@/app/api/ai/_lib/providerGate": { filterModelOptionForTeam: (option) => option },
          "@/lib/aiProviders": { resolveTeamProviderEnabled: () => true },
          "@/lib/aiModelPreferences": { getAiModelPreferenceIds: () => ({}) },
          "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true, resolveUserFacingModelOption: () => fallback },
          "@/app/api/ai/chat/stream/modelFallback": { previousModelForFailedStream: () => null },
          ai: { wrapLanguageModel: ({ model }) => model },
        };
        let result;
        if (entry === "editor") {
          const editor = moduleWithStubs("src/app/api/ai/_lib/editorAi.ts", stubs);
          const call = editor.selectTaskWriterModel({ sourceSelected: missing, modelSelected: missing, modelOptionId: missing === "custom" ? "custom" : undefined, teamContext: { teamId: lookup.trustedTeamId, settings: {} } });
          if (credential === "sk_customer_default") result = await call;
          else await assert.rejects(call, new RegExp(`${missing === "custom" ? "custom AI" : "OpenRouter"} key is unavailable`));
        } else {
          const models = moduleWithStubs("src/lib/ai/chatStream/models.ts", {
            ...stubs, "@/lib/ai/tools/constants": { OPENAI_MODELS: new Set([fallback.model]), DEFAULT_MODEL: fallback.model },
            "@/lib/ai/chatStream/prompt": { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES: [] },
          });
          const chat = moduleWithStubs("src/lib/ai/chatStream/turnModel.ts", {
            ...stubs,
            "@/lib/ai/chatStream/models": models,
            "@/lib/prisma": { __esModule: true, default: { userSetting: { findUnique: async () => null } } },
            "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => {} },
            "@/lib/ai/tools/helpers": { loadActingAgent: async () => null },
            "@/lib/nativeAgent/modelPin": { resolveAgentModelPin: ({ requestedModelOptionId }) => requestedModelOptionId },
            "@/app/api/ai/_lib/chatTeamContext": {
              resolveChatTeamContext: async () => ({ teamId: lookup.trustedTeamId }),
              buildChatProviderContext: () => ({ keyLookupContext: lookup }),
            },
            "@/lib/ai/chatStream/errors": { reportHandledChatError: async () => {}, errorMessage: (error) => error.message, createSseErrorResponse: (message) => Response.json({ error: message }, { status: 400 }) },
          });
          result = await chat.loadTurnModel({ provider: missing, model: missing, modelOptionId: missing === "custom" ? "custom" : undefined, aiFeature: "aiChat" }, { id: 7324 });
          if (credential !== "sk_customer_default") {
            assert.equal(result.status, 400);
            assert.match((await result.json()).error, new RegExp(`${missing === "custom" ? "custom AI" : "OpenRouter"} key is unavailable`));
          }
        }
        if (credential === "sk_customer_default") {
          assert.equal((result.selected ?? result).provider, "openai");
          assert.deepEqual(selectedCredentials, [credential]);
        } else assert.deepEqual(selectedCredentials, []);
      });
    }
  }
}
