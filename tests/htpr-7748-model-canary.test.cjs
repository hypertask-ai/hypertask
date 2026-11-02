const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const stub = (file, exports) => {
  const filename = fs.realpathSync(path.join(root, file));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const TEAM = "qa-owned-team";
const KEY = "vck_synthetic_canary_internal_credential";
const TRIALS = "vck_synthetic_canary_trials_credential";
const BYOK = "sk_synthetic_canary_direct_credential";
const NativeDate = Date;
let now, redis, alerts, calls, usage, keys, settings, behavior, authenticated, rateLimited, lookups, flagEnabled;
let forcedUsageProvider, replacementModel, selectedCredentials;

stub("src/lib/redis.ts", { getRedis: async () => redis });
stub("src/lib/ai/teamAiFunding.ts", require("./helpers/team-ai-funding-stub.cjs"));
stub("src/lib/prisma.ts", { default: { team: { findMany: async (query) => {
  assert.equal(query.where.googleAccount.userId, 985);
  return [{ id: TEAM, aiProviderSettings: settings }];
} } } });
stub("src/lib/errors/reportError.ts", { reportError: async (report) => alerts.push(report) });
stub("src/app/api/ai/_lib/byokKeys.ts", { resolveTeamByokApiKey: async (provider, lookup) => {
  assert.equal(lookup.trustedTeamId, TEAM);
  assert.equal(lookup.userId, 985);
  lookups.push(provider);
  return keys.get(provider);
} });
stub("src/app/api/ai/_lib/sharedAllowance.ts", { gatewayCatalogModelSlug: (slug) => slug });
stub("src/lib/systemModelLadder.ts", {});
stub("src/app/api/ai/_lib/providerGate.ts", {});
stub("src/lib/ai/chatStream/prompt.ts", { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-5"] });
stub("src/app/api/ai/_lib/modelProvider.ts", {
  isVercelAiGatewayKey: (value) => typeof value === "string" && value.startsWith("vck_"),
  aiUsageProviderForCredential: (provider, credential, option) => forcedUsageProvider ?? (
    credential?.startsWith("vck_") ? provider : `byok:${option.source === "claude" ? "claude" : option.source === "openai" ? "openai" : option.modelKey.startsWith("deepseek") ? "deepseek" : "google"}`
  ),
  resolveAiModel: (provider, modelId, credential, option) => {
    selectedCredentials.push(credential);
    return {
      modelId: replacementModel ?? (credential?.startsWith("vck_") && provider !== "gateway" ? `${provider === "claude" ? "anthropic" : provider}/${modelId}` : provider === "gateway" && !credential?.startsWith("vck_") ? option?.directModel ?? modelId.slice(modelId.indexOf("/") + 1) : modelId),
      provider: credential?.startsWith("vck_") ? "gateway" : "openai.chat",
      option,
    };
  },
  providerOptionsForAiModel: (model, _feature, tags, option) => {
    model.option = option;
    return { gateway: { tags: ["chat", `team:${tags.teamId}`, `user:${tags.userId}`] }, ...option?.providerOptions };
  },
  configureAiModelUsage: (_model, context) => usage.push(context),
});
stub("node_modules/ai/dist/index.js", { streamText: (params) => {
  calls.push(params);
  return { fullStream: (async function* () {
    const parts = await behavior(params);
    for (const part of parts) yield part;
  })() };
} });
stub("node_modules/next/server.js", { NextResponse: { json: (body, init) => Response.json(body, init) } });
stub("src/lib/flags.ts", {
  MODEL_CANARY_STATE_FLAG: "htpr-7748-model-canary-state",
  isFeatureEnabled: async (key, userId) => {
    assert.equal(key, "htpr-7748-model-canary-state");
    return flagEnabled;
  },
});
stub("src/lib/mcp/routeWrapper.ts", {
  wrapMcpRoute: (handler) => handler,
  validateMcpRouteAuth: async () => authenticated ? { user: { id: 123 }, agentId: "test-agent" } : null,
  checkMcpRouteRateLimit: async () => rateLimited ? Response.json({ error: "rate limited" }, { status: 429 }) : null,
});
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const canary = load(path.join(root, "src/lib/ai/modelCanary.ts"));
const cron = load(path.join(root, "src/app/api/cron/ai-model-canary/route.ts"));
const status = load(path.join(root, "src/app/api/mcp/ai/models/status/route.ts"));
const env = Object.fromEntries(["AI_GATEWAY_API_KEY", "MODEL_CANARY_AI_GATEWAY_API_KEY", "NODE_ENV", "VERCEL_ENV", "CRON_SECRET"].map((key) => [key, process.env[key]]));

function fakeRedis() {
  const values = new Map();
  const hashes = new Map();
  return {
    values, hashes,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value, ...options) => {
      if (options.includes("NX") && values.has(key)) return null;
      values.set(key, String(value));
      return "OK";
    },
    hvals: async (key) => [...(hashes.get(key)?.values() ?? [])],
    eval: async (script, count, ...all) => {
      const key = all[0];
      const args = all.slice(count);
      if (values.get(key) !== args[0]) return 0;
      if (script.includes('"HSET"')) {
        if (!hashes.has(all[1])) hashes.set(all[1], new Map());
        hashes.get(all[1]).set(args[1], args[2]);
        return 1;
      }
      if (script.includes('"SET"')) {
        for (let index = 1; index < count; index++) values.set(all[index], args[index]);
        return 1;
      }
      return Number(values.delete(key));
    },
  };
}
const text = (value = "OK") => [{ type: "text-delta", text: value }, { type: "finish", finishReason: "stop" }];
const probe = (option = catalog.aiModelOptions[0], lane = "gateway", credential = KEY) =>
  canary.probeModelCanary(option, lane, credential, TEAM, new AbortController().signal);
const rows = async () => (await canary.readModelCanaryStatus()).models;
const request = (authorization) => ({ headers: new Headers(authorization ? { authorization } : {}) });

test.beforeEach(() => {
  now = new NativeDate("2026-10-24T04:40:00Z").getTime();
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  redis = fakeRedis(); alerts = []; calls = []; usage = []; keys = new Map(); settings = {};
  lookups = []; behavior = async () => text(); authenticated = true; rateLimited = false; flagEnabled = true;
  forcedUsageProvider = undefined; replacementModel = undefined; selectedCredentials = [];
  process.env.AI_GATEWAY_API_KEY = TRIALS;
  process.env.MODEL_CANARY_AI_GATEWAY_API_KEY = ` ${KEY} `;
  process.env.NODE_ENV = "production"; process.env.VERCEL_ENV = "production";
  process.env.CRON_SECRET = "synthetic-cron-authority";
});
test.afterEach(() => {
  global.Date = NativeDate;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("inventory derives every visible option and effort variant; images are skipped, never chat passes", async () => {
  const inventory = canary.modelCanaryInventory();
  const expected = catalog.aiModelOptions.filter((option) => catalog.isAiModelOptionVisible(option, true));
  assert.deepEqual(inventory.filter((target) => target.capability === "chat").map((target) => target.optionId), expected.map((option) => option.id));
  for (const option of expected) assert.deepEqual(inventory.find((target) => target.optionId === option.id).option.providerOptions, option.providerOptions);
  assert.deepEqual(inventory.filter((target) => target.capability === "image").map((target) => target.optionId), catalog.aiImageModelDefinitions.map((image) => image.key));
  const result = await canary.runModelCanary();
  assert.equal(result.checked, inventory.length);
  assert.equal(calls.length, expected.filter((option) => option.source !== "custom").length);
  assert.ok((await rows()).filter((row) => row.capability === "image").every((row) => row.outcome === "skipped" && row.lastPassAt === null));
});

test("canary gateway probes use only the internal key, never the trials key", async () => {
  const result = await canary.runModelCanary();
  assert.ok(result.pass > 0);
  assert.ok(selectedCredentials.length > 0);
  assert.ok(selectedCredentials.every((credential) => credential === KEY));
  assert.equal((await probe(catalog.aiModelOptions[0], "gateway", TRIALS)).outcome, "skipped");
  assert.ok(!selectedCredentials.includes(TRIALS));
});

test("missing, malformed or trials-reused internal key disables the whole canary until configured", async () => {
  keys.set("openai", BYOK);
  const cases = [
    [undefined, "missing_internal_gateway_key"], ["", "missing_internal_gateway_key"], [" ", "missing_internal_gateway_key"],
    ["sk_not_a_gateway_key", "malformed_internal_gateway_key"], ["vck_", "malformed_internal_gateway_key"], ["vck_contains whitespace", "malformed_internal_gateway_key"],
    [TRIALS, "internal_key_equals_trials_key"], [` ${TRIALS} `, "internal_key_equals_trials_key"],
  ];
  for (const [value, reason] of cases) {
    if (value === undefined) delete process.env.MODEL_CANARY_AI_GATEWAY_API_KEY;
    else process.env.MODEL_CANARY_AI_GATEWAY_API_KEY = value;
    redis = fakeRedis(); calls = []; selectedCredentials = [];
    const result = await canary.runModelCanary();
    assert.deepEqual(result, { checked: 0, pass: 0, fail: 0, skipped: 0, inconclusive: 0 });
    assert.equal(calls.length, 0);
    assert.deepEqual(selectedCredentials, []);
    assert.deepEqual([...redis.values.keys()], ["ai-model-canary:v1:state"]);
    const state = JSON.parse(redis.values.get("ai-model-canary:v1:state"));
    assert.equal(state.state, "disabled"); assert.equal(state.reason, reason); assert.equal(state.checkedAt, new Date(now).toISOString());
    const disabled = await canary.readModelCanaryStatus();
    assert.equal(disabled.state, "disabled"); assert.equal(disabled.reason, reason); assert.deepEqual(disabled.models, []);
  }
  process.env.MODEL_CANARY_AI_GATEWAY_API_KEY = KEY;
  const result = await canary.runModelCanary();
  assert.ok(result.pass > 0);
  const enabled = await canary.readModelCanaryStatus();
  assert.equal(enabled.state, "enabled"); assert.equal(enabled.reason, null); assert.ok(enabled.models.length > 0);
  assert.ok(selectedCredentials.includes(KEY));
  assert.ok(selectedCredentials.includes(BYOK));
  assert.ok(selectedCredentials.every((credential) => credential === KEY || credential === BYOK));
});

test("model status enhancement defaults to Everyone with small release risk", () => {
  const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7748-model-canary-state.ts"));
  const flag = definition.default ?? definition;
  assert.equal(flag.key, "htpr-7748-model-canary-state");
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("status separates never-run from disabled so an empty list never reads as healthy models", async () => {
  const empty = await canary.readModelCanaryStatus();
  assert.deepEqual([empty.state, empty.reason, empty.checkedAt, empty.configured, empty.models], ["never_run", null, null, true, []]);
  delete process.env.MODEL_CANARY_AI_GATEWAY_API_KEY;
  const unconfigured = await canary.readModelCanaryStatus();
  assert.deepEqual([unconfigured.state, unconfigured.configured, unconfigured.configuredReason], ["never_run", false, "missing_internal_gateway_key"]);
  await canary.runModelCanary();
  const disabled = await canary.readModelCanaryStatus();
  assert.deepEqual([disabled.state, disabled.reason, disabled.checkedAt, disabled.models], ["disabled", "missing_internal_gateway_key", null, []]);
  const response = await status.GET(request("Bearer synthetic"));
  const body = await response.json();
  assert.equal(body.success, true); assert.equal(body.state, "disabled"); assert.equal(body.reason, "missing_internal_gateway_key");
  assert.equal(body.configured, false); assert.equal(body.configuredReason, "missing_internal_gateway_key");
  flagEnabled = false;
  const gated = await (await status.GET(request("Bearer synthetic"))).json();
  assert.deepEqual(Object.keys(gated).sort(), ["checkedAt", "models", "success"]);
  flagEnabled = true;
  redis = fakeRedis();
  redis.values.set("ai-model-canary:v1:checkedAt", new Date(now).toISOString());
  const legacy = await canary.readModelCanaryStatus();
  assert.deepEqual([legacy.state, legacy.reason, legacy.checkedAt], ["enabled", null, new Date(now).toISOString()]);
});

test("probe keeps actual provider options and allowance team tags, one prompt, no tools/history/retries", async () => {
  const option = catalog.aiModelOptions.find((candidate) => candidate.effort === "high");
  assert.equal((await probe(option)).outcome, "pass");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, "Reply with the word OK");
  assert.equal(calls[0].messages, undefined); assert.equal(calls[0].tools, undefined);
  assert.equal(calls[0].maxRetries, 0); assert.equal(calls[0].maxOutputTokens, 2048);
  for (const [provider, options] of Object.entries(option.providerOptions)) assert.deepEqual(calls[0].providerOptions[provider], options);
  assert.ok(calls[0].providerOptions.gateway.tags.includes(`team:${TEAM}`));
  assert.ok(calls[0].providerOptions.gateway.tags.includes("model-canary"));
  assert.equal(usage[0].feature, "model-canary"); assert.equal(usage[0].userId, 985);
});

test("original provider error keeps stage/status and redacts credentials, header data and long text", async () => {
  const error = Object.assign(new Error(`model missing ${BYOK} vck_abcdefghijklmnopqrstuvwxyz012345 api-key: do-not-store\nheaders: x-secret=sensitive\n${"z".repeat(400)}`), { statusCode: 404 });
  behavior = async () => [{ type: "error", error }];
  const result = await probe(catalog.aiModelOptions[0], "byok:openai", BYOK);
  assert.equal(result.outcome, "fail"); assert.equal(result.stage, "provider"); assert.equal(result.statusCode, 404);
  assert.ok(result.safeError.length <= 300);
  assert.doesNotMatch(result.safeError, /sk_synthetic|vck_abcdef|do-not-store|sensitive|z{32}/);
  assert.match(result.safeError, /model missing/);
});

test("gateway pricing errors and nested HTTP errors preserve their original diagnosis", async () => {
  behavior = async () => [{ type: "error", error: new Error("AI Gateway model pricing returned 503") }];
  const pricing = await probe();
  assert.equal(pricing.stage, "pricing"); assert.equal(pricing.statusCode, 503);
  behavior = async () => [{ type: "error", error: Object.assign(new Error("retry wrapper"), { lastError: Object.assign(new Error("not found"), { statusCode: 404 }) }) }];
  const gateway = await probe();
  assert.equal(gateway.stage, "gateway"); assert.equal(gateway.statusCode, 404); assert.equal(gateway.safeError, "not found");
});

test("empty and reasoning-only text fail rather than fabricate a reply", async () => {
  for (const parts of [text("  "), [{ type: "reasoning-delta", text: "thinking" }]]) {
    behavior = async () => parts;
    const result = await probe();
    assert.equal(result.outcome, "fail"); assert.equal(result.stage, "empty");
  }
});

test("fallback text or partial output after a requested-model error cannot turn it green", async () => {
  behavior = async () => [...text("partial"), { type: "error", error: Object.assign(new Error("requested model failed"), { statusCode: 500 }) }, ...text("fallback OK")];
  assert.equal((await probe()).outcome, "fail"); assert.equal(calls.length, 1);
  replacementModel = "openai/different-working-model";
  assert.equal((await probe()).outcome, "fail"); assert.equal(calls.length, 1);
});

test("wrong model id deepseek/does-not-exist fails instead of selecting a working default", async () => {
  const option = { ...catalog.aiModelOptions.find((candidate) => candidate.modelKey.startsWith("deepseek")), model: "deepseek/does-not-exist" };
  behavior = async (params) => params.model.modelId === option.model ? [{ type: "error", error: Object.assign(new Error("model does not exist"), { statusCode: 404 }) }] : text();
  const result = await probe(option);
  assert.equal(result.outcome, "fail"); assert.equal(result.statusCode, 404);
  assert.equal(calls[0].model.modelId, option.model);
  assert.equal((await probe()).outcome, "pass");
  assert.equal((await probe({ ...catalog.aiModelOptions[0], model: "invalid-openai-id" })).outcome, "fail");
});

test("BYOK runs only saved enabled QA-team keys; missing, gateway and mismatched lanes are skipped", async () => {
  keys.set("openai", BYOK); keys.set("deepseek", "sk_disabled_provider_fixture");
  await canary.runModelCanary();
  const direct = (await rows()).filter((row) => row.lane.startsWith("byok:"));
  assert.ok(direct.length > 0); assert.ok(direct.every((row) => row.lane === "byok:openai" && row.outcome === "pass"));
  assert.equal(lookups.includes("deepseek"), false);
  assert.equal((await canary.probeModelCanary(catalog.aiModelOptions[0], "byok:openai", undefined, TEAM, new AbortController().signal)).safeError, "skipped_no_test_key");
  assert.equal((await probe(catalog.aiModelOptions[0], "byok:openai", KEY)).outcome, "skipped");
  forcedUsageProvider = "byok:claude";
  assert.equal((await probe(catalog.aiModelOptions[0], "byok:openai", BYOK)).safeError, "skipped_no_test_key");
});

test("lastPassAt survives later failures; reports dedupe per option/lane/UTC day across runs", async () => {
  keys.set("openai", BYOK);
  await canary.runModelCanary();
  const before = await rows();
  now += 60_000;
  behavior = async () => [{ type: "error", error: Object.assign(new Error("unavailable"), { statusCode: 503 }) }];
  await canary.runModelCanary(); await canary.runModelCanary();
  const failed = (await rows()).filter((row) => row.outcome === "fail");
  assert.equal(alerts.length, failed.length);
  assert.equal(new Set(alerts.map((alert) => alert.fingerprintKey)).size, failed.length);
  for (const row of failed) {
    assert.equal(row.lastPassAt, before.find((prior) => prior.id === row.id && prior.lane === row.lane).lastPassAt);
    assert.deepEqual(row.dailyFailDates, ["2026-10-24"]);
  }
  const { errorFingerprint } = load(path.join(root, "src/lib/errors/errorFingerprint.ts"));
  const today = new Set(alerts.map((alert) => errorFingerprint(alert.fingerprintKey)));
  now += 86_400_000;
  await canary.runModelCanary();
  assert.equal(alerts.length, failed.length * 2);
  assert.ok(alerts.slice(failed.length).every((alert) => !today.has(errorFingerprint(alert.fingerprintKey))));
  for (let day = 0; day < 8; day++) { now += 86_400_000; await canary.runModelCanary(); }
  assert.ok((await rows()).every((row) => row.dailyFailDates.length <= 7));
  const stored = JSON.stringify([...(redis.hashes.get("ai-model-canary:v1:latest")?.values() ?? []), ...redis.values.values(), alerts]);
  assert.ok(!stored.includes(KEY)); assert.ok(!stored.includes(BYOK));
});

test("lease prevents concurrent runs and compare-delete never releases a successor's lease", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  behavior = async () => { entered(); await blocked; return text(); };
  const first = canary.runModelCanary();
  await started;
  assert.deepEqual(await canary.runModelCanary(), { checked: 0, pass: 0, fail: 0, skipped: 0, inconclusive: 0 });
  redis.values.set("ai-model-canary:v1:lock", "successor-token");
  release();
  await assert.rejects(first, /lease expired/);
  assert.equal(redis.values.get("ai-model-canary:v1:lock"), "successor-token");
});

test("four workers bound probes and unstarted targets stay inconclusive, then resume first", async () => {
  let active = 0, peak = 0;
  behavior = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--; now += 190_000;
    return text();
  };
  await canary.runModelCanary();
  assert.equal(peak, 4);
  const pending = JSON.parse(redis.values.get("ai-model-canary:v1:pending"));
  assert.ok(pending.length > 0);
  assert.ok((await rows()).filter((row) => pending.includes(`${row.id}|${row.lane}`)).every((row) => row.outcome === "inconclusive"));
  calls = []; behavior = async () => text();
  await canary.runModelCanary();
  assert.equal(calls[0].model.option.id, pending[0].split("|")[0]);
  assert.deepEqual(JSON.parse(redis.values.get("ai-model-canary:v1:pending")), []);
});

test("45-second probes abort and the whole-run watchdog stops within 240 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  behavior = async (params) => {
    entered();
    await new Promise((resolve) => params.abortSignal.addEventListener("abort", resolve, { once: true }));
    return [];
  };
  const run = canary.runModelCanary();
  await started;
  now += 190_000;
  t.mock.timers.tick(45_000);
  const result = await run;
  assert.ok(result.fail > 0); assert.ok(result.inconclusive > 0);
  assert.ok(calls.every((call) => call.abortSignal.aborted));
  for (const row of (await rows()).filter((row) => row.outcome === "fail")) assert.ok(row.latencyMs >= 45_000);
  redis = fakeRedis();
  let release;
  redis.get = async () => new Promise((resolve) => { release = resolve; entered(); });
  const hung = canary.runModelCanary();
  const rejected = assert.rejects(hung, /run time budget exhausted/);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(230_000);
  await rejected;
  release(null);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.reset();
});

test("cron rejects missing/empty secrets, skips previews and returns production counts only", async () => {
  assert.equal((await cron.GET(request())).status, 401); assert.equal(calls.length, 0);
  process.env.CRON_SECRET = "";
  assert.equal((await cron.GET(request("Bearer "))).status, 401);
  process.env.CRON_SECRET = "synthetic-cron-authority"; process.env.VERCEL_ENV = "preview";
  assert.equal((await cron.GET(request("Bearer synthetic-cron-authority"))).status, 200);
  assert.equal(calls.length, 0);
  process.env.VERCEL_ENV = "production";
  const response = await cron.GET(request("Bearer synthetic-cron-authority"));
  assert.deepEqual(Object.keys(await response.json()).sort(), ["checked", "fail", "inconclusive", "pass", "skipped"]);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(manifest.crons.filter((entry) => entry.path === "/api/cron/ai-model-canary"), [{ path: "/api/cron/ai-model-canary", schedule: "40 4 * * *" }]);
});

test("MCP status requires auth, honors rate limits, returns private no-store rows and aliases without probing", async () => {
  authenticated = false;
  assert.equal((await status.GET(request())).status, 401);
  assert.equal(redis.values.size, 0);
  authenticated = true; rateLimited = true;
  assert.equal((await status.GET(request("Bearer test"))).status, 429);
  rateLimited = false;
  await canary.runModelCanary();
  const before = calls.length;
  const response = await status.GET(request("Bearer test"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.checkedAt, new Date(now).toISOString()); assert.ok(body.models.length > 0);
  for (const row of body.models) {
    assert.equal(row.id, row.optionId); assert.equal(row.status, row.outcome); assert.equal(row.lastCheckedAt, row.checkedAt);
    for (const field of ["label", "model", "lane", "capability", "stage", "statusCode", "safeError", "latencyMs", "lastPassAt", "dailyFailDates"]) assert.ok(Object.hasOwn(row, field));
  }
  assert.equal(calls.length, before);
});
