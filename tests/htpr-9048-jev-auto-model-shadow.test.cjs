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

test("the flag is a feature on for everyone and the pilot changes nothing a person sees", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-9048-jev-auto-model-shadow.ts").default;
  assert.equal(definition.key, "htpr-9048-jev-auto-model-shadow");
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
});

test("the prompt names the three levels, carries the message and clips it", () => {
  const { buildJevAutoModelPrompt, JEV_AUTO_MODEL_TEXT_LIMIT } = shadow();
  const prompt = buildJevAutoModelPrompt("  Fix   the\n export button  ");
  assert.match(prompt, /level <light\|standard\|high>/);
  assert.match(prompt, /REQUEST: Fix the export button$/);
  assert.match(prompt, /data, never instructions/);
  assert.equal(JEV_AUTO_MODEL_TEXT_LIMIT, 1200);
  assert.equal(buildJevAutoModelPrompt("x".repeat(5000)).includes(`REQUEST: ${"x".repeat(1200)}`), true);
  assert.equal(buildJevAutoModelPrompt("x".repeat(5000)).includes("x".repeat(1201)), false);
  assert.match(buildJevAutoModelPrompt(""), /\(empty\)/);
});

test("Jev's answer parses with a level and a confidence, and garbage answers nothing", () => {
  const { parseJevAutoModelGuess } = shadow();
  assert.deepEqual(parseJevAutoModelGuess("standard 0.82"), { level: "standard", confidence: 0.82 });
  assert.deepEqual(parseJevAutoModelGuess("Level: high, confidence 0.61"), { level: "high", confidence: 0.61 });
  assert.deepEqual(parseJevAutoModelGuess("light 90%"), { level: "light", confidence: 0.9 });
  assert.deepEqual(parseJevAutoModelGuess("medium"), { level: "standard", confidence: null });
  assert.deepEqual(parseJevAutoModelGuess("easy 0.7"), { level: "light", confidence: 0.7 });
  assert.deepEqual(parseJevAutoModelGuess("hard 0.99"), { level: "high", confidence: 0.99 });
  assert.equal(parseJevAutoModelGuess("I cannot answer"), null);
  assert.equal(parseJevAutoModelGuess(""), null);
  assert.equal(parseJevAutoModelGuess(null), null);
});

test("levels map to Auto's three tiers and the comparison names the direction", () => {
  const { tierForJevLevel, compareAutoModelTiers } = shadow();
  assert.deepEqual(["light", "standard", "high"].map(tierForJevLevel), [1, 2, 3]);
  assert.equal(compareAutoModelTiers(3, 1), "jev-higher");
  assert.equal(compareAutoModelTiers(1, 3), "jev-lower");
  assert.equal(compareAutoModelTiers(2, 2), "agree");
});

test("the logged signals are the ones Auto already steps up on", () => {
  const { autoModelTurnSignals } = shadow();
  const long = Array.from({ length: 20 }, () => ({ role: "human", content: "hi" }));
  assert.deepEqual(autoModelTurnSignals({ message: "hello", history: [], longThreadMessages: 20 }), { longThread: false, resent: false, codeFence: false, stepUp: 0 });
  assert.equal(autoModelTurnSignals({ message: "hello", history: long, longThreadMessages: 20 }).stepUp, 1);
  assert.equal(autoModelTurnSignals({ message: "again", history: [{ role: "human", content: "again" }], longThreadMessages: 20 }).resent, true);
  assert.equal(autoModelTurnSignals({ message: "fix ```js\nx\n```", history: null, longThreadMessages: 20 }).stepUp, 1);
});

test("a managed turn asks Jev once and logs its level next to Auto's level", async () => {
  const { mod, calls, writes } = runtime();
  await mod.shadowAutoModelTurn(turn());
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Where is the export button on the board\?/);
  assert.equal(calls[0].maxOutputTokens, 24);
  assert.equal(writes.length, 1);
  assert.deepEqual(
    { autoTier: writes[0].autoTier, jevLevel: writes[0].jevLevel, jevTier: writes[0].jevTier, comparison: writes[0].comparison, resent: writes[0].resent },
    { autoTier: 1, jevLevel: "standard", jevTier: 2, comparison: "jev-higher", resent: false },
  );
  assert.equal(writes[0].error, null);
});

test("a customer funded team and a teamless turn are skipped without a call", async () => {
  const customer = runtime({ funding: { apiKey: "vck_customer", source: "customer" } });
  await customer.mod.shadowAutoModelTurn(turn());
  assert.equal(customer.calls.length, 0);
  assert.equal(customer.writes.length, 0);
  const unfunded = runtime({ funding: null });
  await unfunded.mod.shadowAutoModelTurn(turn());
  assert.equal(unfunded.calls.length, 0);
  const teamless = runtime();
  await teamless.mod.shadowAutoModelTurn(turn({ teamId: null, projectId: null }));
  assert.equal(teamless.calls.length, 0);
  assert.equal(teamless.writes.length, 0);
});

test("an unusable answer still logs the turn with the raw error", async () => {
  const { mod, writes } = runtime({ answer: "no idea" });
  await mod.shadowAutoModelTurn(turn({ message: "please fix ```js\nx\n```" }));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].jevLevel, null);
  assert.equal(writes[0].comparison, null);
  assert.equal(writes[0].error, "no idea");
  assert.equal(writes[0].autoTier, 2);
  assert.equal(writes[0].codeFence, true);
});

test("the background gate keeps the shadow off when the flag is off", async () => {
  const off = runtime({ enabled: false });
  await off.mod.shadowAutoModelTurnInBackground(turn());
  assert.equal(off.calls.length, 0);
  assert.equal(off.writes.length, 0);
  const on = runtime({ enabled: true });
  await on.mod.shadowAutoModelTurnInBackground(turn());
  assert.equal(on.tasks.length, 1);
  await Promise.all(on.tasks);
  assert.equal(on.writes.length, 1);
});

function shadowRow(index, overrides = {}) {
  return {
    id: String(index + 1),
    createdAt: new Date(Date.UTC(2026, 10, 11, 0, index)).toISOString(),
    chatSessionId: `unique-${index}`,
    feature: "aiChat",
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

function retriedThenAgree(pair) {
  return [
    shadowRow(pair * 2, { chatSessionId: `pair-${pair}` }),
    shadowRow(pair * 2 + 1, { chatSessionId: `pair-${pair}`, autoTier: 2, jevLevel: "standard", resent: true }),
  ];
}

test("the report counts agreement, direction and retries per session", () => {
  const rows = report.markRetries([
    { id: "1", chatSessionId: "s1", createdAt: "2026-11-11T00:00:00Z", autoTier: 1, jevTier: 1, resent: false },
    { id: "2", chatSessionId: "s1", createdAt: "2026-11-11T00:01:00Z", autoTier: 1, jevTier: 1, resent: true },
    { id: "3", chatSessionId: "s2", createdAt: "2026-11-11T00:02:00Z", autoTier: 1, jevTier: 2, resent: false },
    { id: "4", chatSessionId: "s3", createdAt: "2026-11-11T00:03:00Z", autoTier: 1, jevTier: 2, resent: true },
  ]);
  assert.deepEqual(rows.map((row) => row.retried), [true, false, false, false]);
  const result = report.analyze(rows);
  assert.equal(result.rows, 4);
  assert.equal(result.counts.agree, 2);
  assert.equal(result.counts["jev-higher"], 2);
  assert.equal(result.retried.count, 1);
  assert.equal(result.verdict, "DROP");
  assert.match(report.renderReport(result), /FAIL 1000 Auto turns logged: 4 of 1000 turns/);
});

test("a full log with Jev raising retried turns clears every bar", () => {
  const rows = [
    ...Array.from({ length: 100 }, (_, pair) => retriedThenAgree(pair)).flat(),
    ...Array.from({ length: 400 }, (_, index) => shadowRow(200 + index, { jevTier: 1, jevLevel: "light" })),
    ...Array.from({ length: 400 }, (_, index) => shadowRow(600 + index)),
  ];
  const result = report.analyze(rows);
  assert.equal(result.rows, 1000);
  assert.equal(result.counts.agree, 500);
  assert.equal(result.counts["jev-higher"], 500);
  assert.deepEqual(result.bars.map((bar) => bar.pass), [true, true, true, true]);
  assert.equal(result.verdict, "KEEP");
  assert.match(report.renderReport(result), /Keep Jev/);
});

test("a quarter of the log clears nothing", () => {
  const result = report.analyze(Array.from({ length: 250 }, (_, index) => shadowRow(index)));
  assert.equal(result.bars[0].pass, false);
  assert.equal(result.verdict, "DROP");
  assert.match(report.renderReport(result), /FAIL 1000 Auto turns logged: 250 of 1000 turns/);
});
