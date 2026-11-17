const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier-eval.mjs");
const alt = "openai/gpt-5";

test("a verifier stuck on FAIL fails the eval, so a strict model cannot block good changes", async () => {
  const { runEval, answersFor } = await load();
  const result = await runEval({ alt, answers: answersFor("blind") });
  assert.equal(result.ok, false);
  const clean = result.results.filter((row) => row.case === "clean");
  assert.equal(clean.length, 2);
  for (const row of clean) {
    assert.equal(row.expected, "PASS");
    assert.equal(row.verdict, "FAIL");
    assert.equal(row.ok, false);
  }
});

test("both cases come out right for both model families", async () => {
  const { runEval, answersFor, FLASH } = await load();
  const result = await runEval({ alt, answers: answersFor("correct") });
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, [FLASH, alt]);
  assert.equal(result.results.length, 4);
  for (const row of result.results) {
    assert.equal(row.ok, true, `${row.case} ${row.model}`);
    assert.ok(row.verdict === row.expected || (row.expected === "PASS" && row.verdict === "PASS+NOTES"));
  }
  const planted = result.results.filter((row) => row.case === "planted-bug");
  for (const row of planted) {
    assert.match(row.notes, /a step failed|text not visible/);
  }
});

test("the eval refuses one family or the same family twice", async () => {
  const { evalModels } = await load();
  assert.throws(() => evalModels(" "), /no other-family verifier configured/);
  assert.throws(() => evalModels("deepseek/deepseek-v4.1-flash"), /no other-family verifier configured/);
  assert.deepEqual(evalModels(alt).length, 2);
});

test("the judge reads the fixture claim and the page evidence", async () => {
  const { CASES, evalPlan, evalEvidence, promptFor } = await load();
  const planted = CASES.find((item) => item.name === "planted-bug");
  const prompt = promptFor(planted, evalPlan(planted, alt), evalEvidence(planted));
  assert.match(prompt, /A saved project field appears in the field list/);
  assert.match(prompt, /text not visible/);
  assert.match(prompt, /Judge whether the changed user path worked/);
});

test("a failed step still fails when the model says PASS", async () => {
  const { CASES, runEval, answersFor } = await load();
  const broken = {
    ...CASES.find((item) => item.name === "clean"),
    name: "broken-step",
    expected: "FAIL",
    evidence: { ...CASES[1].evidence, steps: CASES[1].evidence.steps.map((step, index) => (index === 3 ? { ...step, ok: false, error: "not actionable" } : step)) },
  };
  const result = await runEval({ alt, answers: answersFor("correct"), cases: [broken] });
  assert.equal(result.ok, true);
  for (const row of result.results) {
    assert.equal(row.verdict, "FAIL");
    assert.match(row.notes, /a step failed/);
  }
});

test("replay is the self check the workflow runs both ways", async () => {
  const { main } = await load();
  const passed = await main(["--replay", "correct"], { alt, write() {} });
  const missed = await main(["--replay", "blind"], { alt, write() {} });
  assert.equal(passed, true);
  assert.equal(missed, false);
});

test("live mode refuses to run without a key", async () => {
  const { main } = await load();
  await assert.rejects(main(["--live"], { alt, key: "", write() {} }), /OPENROUTER_EVAL_KEY is missing/);
});

test("the live run calls the model with the fixture prompt and counts the verdicts", async () => {
  const { runEval, answersFor } = await load();
  const prompts = [];
  const complete = async (prompt) => {
    prompts.push(prompt);
    return answersFor("correct")[prompt.includes("text not visible") ? "planted-bug" : "clean"];
  };
  const result = await runEval({ alt, key: "test-key", complete });
  assert.equal(result.ok, true);
  assert.equal(prompts.length, 4);
  assert.equal(new Set(result.results.map((row) => row.model)).size, 2);
});
