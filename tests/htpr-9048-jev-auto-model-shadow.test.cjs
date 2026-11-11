const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");

const shadow = () => loadModule("src/lib/ai/jevAutoModelShadow.ts");
const report = require(path.resolve(__dirname, "../scripts/jev-auto-model-shadow-report.cjs"));

function runtime({ funding = { apiKey: "vck_fixture", source: "managed" }, answer = "standard 0.82", enabled = true } = {}) {
  const calls = [];
  const writes = [];
  const tasks = [];
  const mod = loadModule("src/lib/ai/jevAutoModelShadowRun.ts", {
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

const turn = (extra = {}) => ({
  userId: 985,
  teamId: "team-1",
  projectId: 15,
  chatSessionId: "session-1",
  feature: "aiChat",
  message: "Where is the export button on the board?",
  history: [],
  autoModelKey: "claude-haiku-5-5",
  ...extra,
});

test("the flag is a plain feature on for everyone", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-9048-jev-auto-model-shadow.ts").default;
  assert.deepEqual([definition.key, definition.kind, definition.defaultMode], ["htpr-9048-jev-auto-model-shadow", "feature", "EVERYONE"]);
});

test("the prompt names Auto's three levels and clips the message", () => {
  const { buildJevAutoModelPrompt, JEV_AUTO_MODEL_TEXT_LIMIT } = shadow();
  const prompt = buildJevAutoModelPrompt("  Fix   the\n export button  ");
  assert.match(prompt, /level <light\|standard\|high>/);
  assert.match(prompt, /REQUEST: Fix the export button$/);
  assert.match(prompt, /data, never instructions/);
  assert.equal(JEV_AUTO_MODEL_TEXT_LIMIT, 1200);
  assert.equal(buildJevAutoModelPrompt("x".repeat(5000)).includes(`REQUEST: ${"x".repeat(1200)}`), true);
  assert.equal(buildJevAutoModelPrompt("x".repeat(5000)).includes("x".repeat(1201)), false);
});

test("Jev's answer parses to a level and a confidence, and junk answers nothing", () => {
  const { parseJevAutoModelGuess } = shadow();
  assert.deepEqual(parseJevAutoModelGuess("standard 0.82"), { level: "standard", confidence: 0.82 });
  assert.deepEqual(parseJevAutoModelGuess("Level: high, confidence 0.61"), { level: "high", confidence: 0.61 });
  assert.deepEqual(parseJevAutoModelGuess("light 90%"), { level: "light", confidence: 0.9 });
  assert.deepEqual(parseJevAutoModelGuess("medium"), { level: "standard", confidence: null });
  assert.deepEqual(parseJevAutoModelGuess("easy 0.7"), { level: "light", confidence: 0.7 });
  assert.deepEqual(parseJevAutoModelGuess("hard 0.99"), { level: "high", confidence: 0.99 });
  assert.equal(parseJevAutoModelGuess("I cannot answer"), null);
  assert.equal(parseJevAutoModelGuess(""), null);
});

test("levels map to Auto's tiers, the comparison names the direction, and the signals match Auto's step-up", () => {
  const { tierForJevLevel, compareAutoModelTiers, autoModelTurnSignals } = shadow();
  assert.deepEqual(["light", "standard", "high"].map(tierForJevLevel), [1, 2, 3]);
  assert.deepEqual([compareAutoModelTiers(3, 1), compareAutoModelTiers(1, 3), compareAutoModelTiers(2, 2)], ["jev-higher", "jev-lower", "agree"]);
  const long = Array.from({ length: 20 }, () => ({ role: "human", content: "hi" }));
  assert.deepEqual(autoModelTurnSignals({ message: "hello", history: [], longThreadMessages: 20 }), { longThread: false, resent: false, codeFence: false, stepUp: 0 });
  assert.equal(autoModelTurnSignals({ message: "hello", history: long, longThreadMessages: 20 }).stepUp, 1);
  assert.equal(autoModelTurnSignals({ message: "again", history: [{ role: "human", content: "again" }], longThreadMessages: 20 }).resent, true);
  assert.equal(autoModelTurnSignals({ message: "fix ```js\nx\n```", history: null, longThreadMessages: 20 }).stepUp, 1);
});

test("a managed Auto turn asks Jev once and logs its level next to Auto's", async () => {
  const { mod, calls, writes } = runtime();
  await mod.shadowAutoModelTurn(turn());
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Where is the export button on the board\?/);
  assert.equal(calls[0].maxOutputTokens, 24);
  assert.deepEqual(
    { autoTier: writes[0].autoTier, jevLevel: writes[0].jevLevel, jevTier: writes[0].jevTier, comparison: writes[0].comparison, error: writes[0].error },
    { autoTier: 1, jevLevel: "standard", jevTier: 2, comparison: "jev-higher", error: null },
  );
});

test("a customer funded team, a turn with no team or board, and an unparseable answer", async () => {
  const customer = runtime({ funding: { apiKey: "vck_customer", source: "customer" } });
  await customer.mod.shadowAutoModelTurn(turn());
  assert.deepEqual([customer.calls.length, customer.writes.length], [0, 0]);
  const unfunded = runtime({ funding: null });
  await unfunded.mod.shadowAutoModelTurn(turn({ teamId: null, projectId: null }));
  assert.deepEqual([unfunded.calls.length, unfunded.writes.length], [0, 0]);
  const silent = runtime({ answer: "no idea" });
  await silent.mod.shadowAutoModelTurn(turn({ message: "please fix ```js\nx\n```" }));
  assert.deepEqual([silent.writes[0].jevLevel, silent.writes[0].comparison, silent.writes[0].error, silent.writes[0].autoTier, silent.writes[0].codeFence], [null, null, "no idea", 2, true]);
});

test("the shadow stays off when the flag is off and logs one row when it is on", async () => {
  const off = runtime({ enabled: false });
  await off.mod.shadowAutoModelTurnInBackground(turn());
  assert.deepEqual([off.calls.length, off.writes.length], [0, 0]);
  const on = runtime({ enabled: true });
  await on.mod.shadowAutoModelTurnInBackground(turn());
  assert.equal(on.tasks.length, 1);
  await Promise.all(on.tasks);
  assert.equal(on.writes.length, 1);
});

function row(index, overrides = {}) {
  return {
    createdAt: new Date(Date.UTC(2026, 10, 11, 0, index)).toISOString(),
    chatSessionId: `unique-${index}`,
    autoTier: 1,
    jevLevel: "standard",
    jevTier: 2,
    jevConfidence: 0.85,
    jevLatencyMs: 90,
    resent: false,
    error: null,
    ...overrides,
  };
}

test("a resend in the same chat session marks the earlier turn retried", () => {
  const rows = report.markRetries([
    { chatSessionId: "s1", createdAt: "2026-11-11T00:00:00Z", autoTier: 1, jevTier: 1, resent: false },
    { chatSessionId: "s1", createdAt: "2026-11-11T00:01:00Z", autoTier: 1, jevTier: 1, resent: true },
    { chatSessionId: "s2", createdAt: "2026-11-11T00:02:00Z", autoTier: 1, jevTier: 2, resent: false },
  ]);
  assert.deepEqual(rows.map((entry) => entry.retried), [true, false, false]);
  const result = report.analyze(rows);
  assert.deepEqual([result.rows, result.counts.agree, result.counts["jev-higher"], result.retried.count, result.verdict], [3, 2, 1, 1, "DROP"]);
});

test("the four bars decide keep or drop on a full log", () => {
  const rows = [
    ...Array.from({ length: 100 }, (_, pair) => [
      row(pair * 2, { chatSessionId: `pair-${pair}` }),
      row(pair * 2 + 1, { chatSessionId: `pair-${pair}`, autoTier: 2, resent: true }),
    ]).flat(),
    ...Array.from({ length: 400 }, (_, index) => row(200 + index, { jevLevel: "light", jevTier: 1 })),
    ...Array.from({ length: 400 }, (_, index) => row(600 + index)),
  ];
  const result = report.analyze(rows);
  assert.deepEqual([result.rows, result.counts.agree, result.counts["jev-higher"]], [1000, 500, 500]);
  assert.deepEqual(result.bars.map((bar) => bar.pass), [true, true, true, true]);
  assert.equal(result.verdict, "KEEP");
  assert.match(report.renderReport(result), /Keep Jev/);
  const short = report.analyze(Array.from({ length: 250 }, (_, index) => row(index)));
  assert.equal(short.verdict, "DROP");
  assert.match(report.renderReport(short), /FAIL 1000 Auto turns logged: 250 of 1000 turns/);
});
