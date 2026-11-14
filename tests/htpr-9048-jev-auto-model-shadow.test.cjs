const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");
const report = require(path.resolve(__dirname, "../scripts/jev-auto-model-shadow-report.cjs"));

function runtime({ funding = { apiKey: "vck_fixture", source: "managed" }, answer = JSON.stringify({ answers: { level: { type: "choice", choice: "standard", confidence: 0.82 } } }), enabled = true } = {}) {
  const calls = [], writes = [], tasks = [];
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init?.body, authorization: init?.headers?.Authorization });
    if (answer === null) throw new Error("network");
    return { ok: true, text: async () => answer };
  };
  const mod = loadModule("src/lib/ai/jevAutoModelShadow.ts", {
    "@vercel/functions": { waitUntil: (task) => tasks.push(task) },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/prisma": { default: { autoModelShadow: { create: async (input) => (writes.push(input.data), input.data) } } },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => funding ?? undefined },
    "@/app/api/ai/_lib/autoModel": { AUTO_LONG_THREAD_MESSAGES: 20 },
    "@/app/api/ai/_lib/reasoningEffort": { tierForFeature: () => 1 },
  });
  return {
    mod, calls, writes, tasks,
    restore() {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
    },
  };
}

const loaded = runtime();
const shadow = loaded.mod;
loaded.restore();
const turn = (extra = {}) => ({ userId: 985, teamId: "team-1", projectId: 15, chatSessionId: "s1", feature: "aiChat", message: "Where is the export button?", history: [], autoModelKey: "claude-haiku-5-5", ...extra });
const row = (index, overrides = {}) => ({ createdAt: new Date(Date.UTC(2026, 10, 11, 0, index)).toISOString(), chatSessionId: `u-${index}`, autoTier: 1, jevLevel: "standard", jevTier: 2, jevConfidence: 0.85, jevLatencyMs: 90, resent: false, error: null, ...overrides });

test("the flag, the prompt, Jev's answer and Auto's step-up signals", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-9048-jev-auto-model-shadow.ts").default;
  assert.deepEqual([definition.key, definition.kind, definition.defaultMode], ["htpr-9048-jev-auto-model-shadow", "feature", "EVERYONE"]);
  const prompt = shadow.buildJevAutoModelPrompt("  Fix   the\n export button  ");
  assert.match(prompt, /level <light\|standard\|high>/);
  assert.match(prompt, /REQUEST: Fix the export button$/);
  assert.equal(shadow.buildJevAutoModelPrompt("x".repeat(5000)).includes(`REQUEST: ${"x".repeat(1201)}`), false);
  assert.deepEqual(shadow.parseJevAutoModelGuess("standard 0.82"), { level: "standard", confidence: 0.82 });
  assert.deepEqual(shadow.parseJevAutoModelGuess("Level: high, confidence 0.61"), { level: "high", confidence: 0.61 });
  assert.deepEqual(shadow.parseJevAutoModelGuess("hard 90%"), { level: "high", confidence: 0.9 });
  assert.equal(shadow.parseJevAutoModelGuess("I cannot answer"), null);
  assert.deepEqual(["light", "standard", "high"].map(shadow.tierForJevLevel), [1, 2, 3]);
  assert.deepEqual([shadow.compareAutoModelTiers(3, 1), shadow.compareAutoModelTiers(1, 3), shadow.compareAutoModelTiers(2, 2)], ["jev-higher", "jev-lower", "agree"]);
  const long = Array.from({ length: 20 }, (_, index) => ({ role: "human", content: `earlier question ${index}` }));
  const resent = shadow.autoModelTurnSignals({ message: "again", history: [{ role: "human", content: "again" }], longThreadMessages: 20 });
  assert.deepEqual([shadow.autoModelTurnSignals({ message: "next", history: long, longThreadMessages: 20 }).stepUp, resent.resent, resent.stepUp, shadow.autoModelTurnSignals({ message: "same", history: [...long.slice(1), { role: "human", content: "same" }], longThreadMessages: 20 }).stepUp, shadow.autoModelTurnSignals({ message: "```js", history: null, longThreadMessages: 20 }).stepUp], [1, true, 1, 2, 1]);
});

test("a managed turn logs one row next to Auto's level, and the skips make no call", async () => {
  const managed = runtime();
  try {
    managed.mod.shadowAutoModelTurnInBackground(turn());
    await Promise.all(managed.tasks);
    const sent = JSON.parse(managed.calls[0].body);
    assert.deepEqual([managed.calls[0].url, sent.model, managed.calls[0].authorization, managed.writes[0].autoTier, managed.writes[0].jevLevel, managed.writes[0].jevTier, managed.writes[0].comparison, managed.writes[0].error], ["https://openrouter.ai/api/alpha/decisions", "typesafe/jev-1.14", "Bearer test-openrouter-key", 1, "standard", 2, "jev-higher", null]);
  } finally {
    managed.restore();
  }
  for (const [options, input] of [
    [{ funding: { apiKey: "vck_customer", source: "customer" } }, turn()],
    [{ funding: null }, turn({ teamId: null, projectId: null })],
  ]) {
    const skipped = runtime(options);
    try {
      await skipped.mod.shadowAutoModelTurn(input);
      assert.deepEqual([skipped.calls.length, skipped.writes.length], [0, 0]);
    } finally {
      skipped.restore();
    }
  }
});

for (const [answer, error] of [["no idea", "no-level"], [null, "no-answer"]]) {
  test(`a shadow ${error} stores only the error category`, async () => {
    const failed = runtime({ answer });
    try {
      await failed.mod.shadowAutoModelTurn(turn({ message: "fix ```js\nx\n```" }));
      assert.deepEqual([failed.calls.length, failed.writes.length, failed.writes[0].jevLevel, failed.writes[0].error, failed.writes[0].autoTier], [1, 1, null, error, 2]);
    } finally {
      failed.restore();
    }
  });
}

test("the shadow flag gate reads the ticket flag and refuses a turn with no user", async () => {
  const on = loadModule("src/app/api/ai/_lib/autoModelShadow.ts", { "@/lib/flags": { isFeatureEnabled: async () => true } });
  const off = loadModule("src/app/api/ai/_lib/autoModelShadow.ts", { "@/lib/flags": { isFeatureEnabled: async () => false } });
  assert.deepEqual([await on.autoModelShadowEnabled(985), await on.autoModelShadowEnabled(null), await off.autoModelShadowEnabled(985)], [true, false, false]);
});

test("a resend marks the earlier turn retried and the four bars decide keep or drop", () => {
  const retries = report.markRetries([
    { chatSessionId: "s1", createdAt: "2026-11-11T00:00:00Z", autoTier: 1, jevTier: 1, resent: false },
    { chatSessionId: "s1", createdAt: "2026-11-11T00:01:00Z", autoTier: 1, jevTier: 1, resent: true },
    { chatSessionId: "s2", createdAt: "2026-11-11T00:02:00Z", autoTier: 1, jevTier: 2, resent: false },
  ]);
  assert.deepEqual(retries.map((entry) => entry.retried), [true, false, false]);
  const rows = [
    ...Array.from({ length: 100 }, (_, pair) => [row(pair * 2, { chatSessionId: `p-${pair}` }), row(pair * 2 + 1, { chatSessionId: `p-${pair}`, autoTier: 2, resent: true })]).flat(),
    ...Array.from({ length: 400 }, (_, index) => row(200 + index, { jevLevel: "light", jevTier: 1 })),
    ...Array.from({ length: 400 }, (_, index) => row(600 + index)),
  ];
  const result = report.analyze(rows);
  assert.deepEqual([result.rows, result.counts.agree, result.counts["jev-higher"], result.bars.map((bar) => bar.pass), result.verdict], [1000, 500, 500, [true, true, true, true], "KEEP"]);
  assert.match(report.renderReport(result), /Keep Jev/);
  const short = report.analyze(Array.from({ length: 250 }, (_, index) => row(index)));
  assert.deepEqual([short.verdict, /FAIL 1000 Auto turns logged: 250 of 1000 turns/.test(report.renderReport(short))], ["DROP", true]);
});
