const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier-eval.mjs");
const alt = "openai/gpt-5";
const plan = (item) => JSON.stringify(item.plan);

test("a verifier stuck on FAIL fails the eval, so a strict model cannot block good changes", async () => {
  const { runEval } = await load();
  const result = await runEval({ alt, replay: "blind" });
  assert.equal(result.ok, false);
  const clean = result.results.filter((row) => row.case === "clean");
  assert.equal(clean.length, 2);
  for (const row of clean) {
    assert.equal(row.expected, "PASS");
    assert.equal(row.verdict, "FAIL");
    assert.equal(row.ok, false);
  }
});

test("every case comes out right for both model families", async () => {
  const { runEval, CASES, FLASH } = await load();
  const result = await runEval({ alt, replay: "correct" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, [FLASH, alt]);
  assert.equal(result.results.length, CASES.length * 2);
  for (const row of result.results) {
    assert.equal(row.ok, true, `${row.case} ${row.model}`);
    assert.equal(row.failure, "");
    assert.ok(row.verdict === row.expected || (row.expected === "PASS" && row.verdict === "PASS+NOTES"));
  }
  for (const row of result.results.filter((item) => item.case === "planted-bug")) assert.match(row.notes, /failed at step/);
});

test("a bug that only shows at phone width fails and names the phone viewport", async () => {
  const { runEval, CASES } = await load();
  const result = await runEval({ alt, replay: "correct", cases: CASES.filter((item) => item.name === "planted-phone-bug") });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  for (const row of result.results) {
    assert.equal(row.verdict, "FAIL");
    assert.match(row.notes, /change:primary \[phone\]: failed at step/);
    assert.doesNotMatch(row.notes, /\[desktop\]/);
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

test("the plan prompt asks the real planner for the case claim", async () => {
  const { CASES, planPromptFor } = await load();
  const prompt = planPromptFor(CASES[0]);
  assert.match(prompt, /Plan one user check of at most 12 actions/);
  assert.match(prompt, /A saved project field appears in the field list/);
});

test("a failed step still fails when the model says PASS", async () => {
  const { CASES, runEval } = await load();
  const broken = {
    ...CASES.find((item) => item.name === "clean"),
    name: "broken-step",
    expected: "FAIL",
    stepFailure: 3,
    judge: '{"verdict":"PASS","notes":"looks fine"}',
  };
  const result = await runEval({ alt, replay: "correct", cases: [broken] });
  assert.equal(result.ok, true);
  for (const row of result.results) {
    assert.equal(row.verdict, "FAIL");
    assert.match(row.notes, /failed at step/);
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

test("the live run plans and judges every case through the model", async () => {
  const { CASES, runEval } = await load();
  const prompts = [];
  const complete = async (prompt) => {
    prompts.push(prompt);
    if (prompt.includes("Plan one user check")) return JSON.stringify(CASES[0].plan);
    return '{"verdict":"PASS","notes":"The saved field is visible."}';
  };
  const result = await runEval({ alt, key: "test-key", complete });
  assert.equal(result.ok, true);
  assert.equal(prompts.filter((prompt) => prompt.includes("Plan one user check")).length, CASES.length * 2);
  assert.equal(prompts.filter((prompt) => prompt.includes("Judge whether the changed user path worked")).length, 6);
  assert.equal(new Set(result.results.map((row) => row.model)).size, 2);
});

test("a plan stage that returns no actions fails the eval even when the judge says PASS", async () => {
  const { CASES, runEval } = await load();
  const complete = async (prompt) => (prompt.includes("Plan one user check") ? '{"actions":[],"expect":[],"reason":"no user path"}' : '{"verdict":"PASS","notes":"looks fine"}');
  const clean = CASES.filter((item) => item.name === "clean");
  const result = await runEval({ alt, key: "test-key", complete, cases: clean });
  assert.equal(result.ok, false);
  for (const row of result.results) {
    assert.equal(row.ok, false);
    assert.match(row.failure, /no actions/);
  }
});

test("a plan that ignores the fixture fails the eval even with a valid shape", async () => {
  const { CASES, runEval } = await load();
  const complete = async (prompt) => (prompt.includes("Plan one user check") ? '{"actions":[{"op":"goto","path":"/"}],"expect":[{"text":"Welcome"}],"reason":"home"}' : '{"verdict":"PASS","notes":"looks fine"}');
  const clean = CASES.filter((item) => item.name === "clean");
  const result = await runEval({ alt, key: "test-key", complete, cases: clean });
  assert.equal(result.ok, false);
  for (const row of result.results) assert.match(row.failure, /does not exercise the fixture/);
});

test("a failed model call is an eval error, not a FAIL the planted case accepts", async () => {
  const { CASES, runEval } = await load();
  const complete = async (prompt) => {
    if (prompt.includes("Plan one user check")) throw new Error("model HTTP 500");
    return '{"verdict":"PASS","notes":"The saved field is visible."}';
  };
  const planted = CASES.filter((item) => item.name === "planted-bug");
  const result = await runEval({ alt, key: "test-key", complete, cases: planted });
  assert.equal(result.ok, false);
  for (const row of result.results) {
    assert.equal(row.ok, false);
    assert.match(row.failure, /model HTTP 500/);
  }
});
