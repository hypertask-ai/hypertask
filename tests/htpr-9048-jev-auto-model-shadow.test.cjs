const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");
const report = require(path.resolve(__dirname, "../scripts/jev-auto-model-shadow-report.cjs"));

function runtime({ funding = { apiKey: "vck_fixture", source: "managed" }, answer = "standard 0.82", enabled = true } = {}) {
  const calls = [], writes = [], tasks = [];
  const mod = loadModule("src/lib/ai/jevAutoModelShadow.ts", {
    ai: { generateText: (input) => (calls.push(input), Promise.resolve({ text: answer })) },
    "@vercel/functions": { waitUntil: (task) => tasks.push(task) },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/flags/definitions/htpr-9048-jev-auto-model-shadow": { HTPR_9048_JEV_AUTO_MODEL_SHADOW_FLAG: "htpr-9048-jev-auto-model-shadow" },
    "@/lib/prisma": { default: { autoModelShadow: { create: async (input) => (writes.push(input.data), input.data) } } },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => funding ?? undefined },
    "@/app/api/ai/_lib/modelProvider": { resolveGatewayModel: () => ({ provider: "gateway" }), gatewayProviderOptionsForModel: () => undefined },
    "@/app/api/ai/_lib/autoModel": { AUTO_LONG_THREAD_MESSAGES: 20 },
    "@/app/api/ai/_lib/reasoningEffort": { tierForFeature: () => 1 },
  });
  return { mod, calls, writes, tasks };
}

const shadow = runtime().mod;
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
  const long = Array.from({ length: 20 }, () => ({ role: "human", content: "hi" }));
  assert.deepEqual([shadow.autoModelTurnSignals({ message: "hi", history: long, longThreadMessages: 20 }).stepUp, shadow.autoModelTurnSignals({ message: "again", history: [{ role: "human", content: "again" }], longThreadMessages: 20 }).resent, shadow.autoModelTurnSignals({ message: "```js", history: null, longThreadMessages: 20 }).stepUp], [1, true, 1]);
});

test("a managed turn logs one row next to Auto's level, and the skips make no call", async () => {
  const { mod, calls, writes } = runtime();
  await mod.shadowAutoModelTurn(turn());
  assert.deepEqual([calls[0].maxOutputTokens, writes[0].autoTier, writes[0].jevLevel, writes[0].jevTier, writes[0].comparison, writes[0].error], [24, 1, "standard", 2, "jev-higher", null]);
  const customer = runtime({ funding: { apiKey: "vck_customer", source: "customer" } });
  await customer.mod.shadowAutoModelTurn(turn());
  const untied = runtime({ funding: null });
  await untied.mod.shadowAutoModelTurn(turn({ teamId: null, projectId: null }));
  const silent = runtime({ answer: "no idea" });
  await silent.mod.shadowAutoModelTurn(turn({ message: "fix ```js\nx\n```" }));
  assert.deepEqual([customer.calls.length, customer.writes.length, untied.calls.length, untied.writes.length, silent.writes[0].jevLevel, silent.writes[0].error, silent.writes[0].autoTier], [0, 0, 0, 0, null, "no idea", 2]);
  const off = runtime({ enabled: false });
  await off.mod.shadowAutoModelTurnInBackground(turn());
  const on = runtime({ enabled: true });
  await on.mod.shadowAutoModelTurnInBackground(turn());
  await Promise.all(on.tasks);
  assert.deepEqual([off.writes.length, on.writes.length], [0, 1]);
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
