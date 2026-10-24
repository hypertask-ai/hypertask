const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { fsCache: false });
const flagKey = "htpr-7754-deepseek-auth-refusal";
const safeMessage = "DeepSeek rejected your AI key. Update it in Settings > AI keys, then try again.";
const genericMessage = "Sorry, something went wrong while generating a response. Please try again.";

function load(file, stubs, globals = {}) {
  const filename = path.join(root, file);
  const code = jiti.transform({ source: fs.readFileSync(filename, "utf8"), filename, ts: true });
  const module = { exports: {} };
  const resolve = (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: resolve, jitiImport: async (id) => resolve(id),
    Error, Set, console, ...globals,
  }, { filename });
  return module.exports;
}

function authError(overrides = {}) {
  return Object.assign(new Error("Authentication Fails, Your api key: fixture-invalid is invalid (request_id: fixture-request)"), {
    name: "AI_APICallError", statusCode: 401,
    url: "https://api.deepseek.com/chat/completions", ...overrides,
  });
}

function harness({ enabled = true, flagError = false, failure = authError() } = {}) {
  const logs = { warn: [], error: [], info: [] };
  const reports = [], checks = [], events = [], outcomes = [];
  const flag = load("src/lib/flags/definitions/htpr-7754-deepseek-auth-refusal.ts", {});
  const errors = load("src/lib/ai/chatStream/errors.ts", {
    "@/lib/api/errorMessage": { toErrorMessage: (error) => error.message },
    zod: { z: {} },
    "@/lib/errors/reportError": { reportError: async (report) => reports.push(report) },
    "@/lib/ai/tools/constants": {},
    "@/lib/flags/definitions/htpr-7754-deepseek-auth-refusal": flag,
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      if (flagError) throw new Error("Flag store unavailable");
      return enabled;
    } },
  }, { console: Object.fromEntries(Object.keys(logs).map((level) => [level, (...args) => logs[level].push(args)])) });
  const reply = load("src/lib/ai/chatStream/modelReply.ts", {
    "@/lib/net/downloadWithoutBrotli": {},
    "@/app/api/ai/_lib/planGate": {},
    "@/app/api/ai/_lib/byokKeys": {},
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} },
    "@/lib/aiModelOptions": { resolveHaikuModelId: (id) => id, isHaiku55Model: () => false },
    "@/lib/aiProviders": {},
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/modelFallback": { previousModelForFailedStream: () => null },
    "@/app/api/ai/chat/stream/bulkTools": { hasVisibleCompletion: (chunks) => chunks.join("").trim().length > 0 },
    "@/lib/ai/chatStream/errors": errors,
    "@/lib/ai/tools/constants": { MAX_TOOL_STEPS: 1 },
    "@/lib/ai/chatStream/models": {},
    "@/lib/ai/chatStream/content": {},
    "@/lib/ai/tools/metadata": {},
    ai: { stepCountIs: () => ({}), streamText: ({ onError }) => ({ textStream: (async function* () {
      if (failure) await onError({ error: failure });
      else yield "DeepSeek reply";
    })() }) },
  });
  const state = {
    dbUser: { id: 123 }, gatewayTags: { teamId: "team-fixture" },
    selected: { model: {}, resolvedModelId: "deepseek-flash", settings: {} },
    providerAbort: new AbortController(),
    send: (...event) => events.push(event), finish: (...event) => events.push(["finish", ...event]),
    recordTurnOutcome: (...outcome) => outcomes.push(outcome),
  };
  return { errors, logs, reports, checks, events, outcomes, flag,
    run: () => reply.generateModelReply(state, { instructions: "Fixture", messages: [], tools: {}, toolExecutions: [] }),
  };
}

test("direct DeepSeek invalid BYOK is an actionable warning, not an incident", async () => {
  const h = harness();
  await h.run();
  assert.equal(h.events[0][0], "error");
  assert.equal(h.events[0][1].content, safeMessage);
  assert.equal(h.events[1][0], "finish");
  assert.equal(h.events[1][1], "error");
  assert.equal(h.logs.warn.length, 1);
  assert.equal(h.logs.error.length, 0);
  assert.equal(h.reports.length, 0);
  assert.deepEqual(h.checks, [[flagKey, 123]]);
  assert.doesNotMatch(JSON.stringify([h.events, h.logs, h.outcomes]), /fixture-invalid|fixture-request/);
});

test("valid DeepSeek BYOK is still allowed to stream a reply", async () => {
  const h = harness({ failure: null });
  const reply = await h.run();
  assert.equal(reply.chunks.join(""), "DeepSeek reply");
  assert.deepEqual(JSON.parse(JSON.stringify(h.events)), [["content", { content: "DeepSeek reply" }]]);
  assert.deepEqual(h.checks, []);
});

test("SDK retry wrappers preserve the direct DeepSeek refusal", async () => {
  for (const failure of [new Error("wrapped", { cause: authError() }), { lastError: authError() }]) {
    const h = harness({ failure });
    await h.run();
    assert.equal(h.events[0][1].content, safeMessage);
    assert.equal(h.logs.warn.length, 1);
    assert.equal(h.reports.length, 0);
  }
});

test("Off or unavailable flag preserves the previous error handling", async () => {
  for (const options of [{ enabled: false }, { flagError: true }]) {
    const h = harness(options);
    await h.run();
    assert.equal(h.events[0][1].content, genericMessage);
    assert.equal(h.logs.error.length, 1);
    assert.equal(h.reports.length, 1);
  }
});

test("platform gateway auth, other providers, and non-auth DeepSeek failures remain incidents", async () => {
  for (const failure of [
    authError({ url: "https://ai-gateway.vercel.sh/v1/chat/completions" }),
    authError({ url: "https://api.openai.com/v1/chat/completions" }),
    authError({ url: "https://api.deepseek.com.attacker.invalid/chat/completions" }),
    authError({ statusCode: 429 }), authError({ statusCode: 500 }),
    new Error("Authentication Fails, Your api key is invalid"),
  ]) {
    const h = harness({ failure });
    await h.run();
    assert.equal(h.events[0][1].content, genericMessage);
    assert.equal(h.logs.error.length, 1);
    assert.equal(h.reports.length, 1);
    assert.deepEqual(h.checks, []);
  }
});

test("included allowance refusal keeps its existing message and severity", async () => {
  const failure = Object.assign(new Error("Your included AI allowance is used up."), { name: "SharedAiAllowanceExceededError" });
  const h = harness({ failure });
  await h.run();
  assert.equal(h.events[0][1].content, failure.message);
  assert.equal(h.logs.info.length, 1);
  assert.equal(h.logs.warn.length, 0);
  assert.equal(h.reports.length, 0);
});

test("cyclic error wrappers terminate and remain ordinary incidents", async () => {
  const failure = new Error("Cyclic failure");
  failure.cause = failure;
  const h = harness({ failure });
  await h.run();
  assert.equal(h.events[0][1].content, genericMessage);
  assert.equal(h.reports.length, 1);
});

test("the rollback flag is a low-risk Everyone bugfix", () => {
  const { flag } = harness();
  assert.equal(flag.default.key, flagKey);
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.equal(flag.default.releaseRisk.highRisk, undefined);
});
