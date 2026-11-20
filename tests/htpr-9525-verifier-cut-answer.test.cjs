const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };

const cutPlanAttemptOne = '```json { "actions": [ {"op": "goto", "path": "/project?id={id}"}, {"op": "shot", "name": "board-view';
const cutPlanAttemptTwo = '```json {"actions":[{"op":"goto","path":"/detail/project-{id}/1"},{"op":"shot","name":"task-detail"}],"expect":[{"path":"/detail/project-{id}/';
const cutVerdict = '```json {"verdict":"FAIL","notes":"The plan navigated to /wiki/agents and checked for universal agent onboarding documentation, which does not exercise or verify the changed QStash schedule registration or startup path';
const breakTestCode = 'const test = require("node:test");\nconst { loadModule } = require("../helpers/loadModule.cjs");\ntest("blank title is rejected", () => { const title = loadModule("src/lib/title.ts"); test("x", () => assert.equal(title.slug(""), "")); });';
const cutBreakIt = `Here are the tests: {"tests":[{"name":"blank-title","code":${JSON.stringify(breakTestCode).slice(0, 120)}`;

test("a plan answer the model stopped mid-object still plans the actions it sent", async () => {
  const { parsePlan } = await load();
  const first = parsePlan(cutPlanAttemptOne);
  assert.deepEqual(first.actions.map((action) => action.op), ["goto", "shot"]);
  assert.equal(first.actions[0].path, "/project?id={id}");
  assert.equal(first.actions[1].name, "board-view");
  const second = parsePlan(cutPlanAttemptTwo);
  assert.deepEqual(second.actions.map((action) => action.op), ["goto", "shot"]);
  assert.equal(second.actions[1].name, "task-detail");
  assert.equal(second.expect[0].path, "/detail/project-{id}/");
});

test("a verdict the model stopped mid-notes keeps the verdict it named", async () => {
  const { parseAnswer } = await load();
  const answer = parseAnswer(cutVerdict);
  assert.equal(answer.verdict, "FAIL");
  assert.match(answer.notes, /^The plan navigated to \/wiki\/agents/);
});

test("a break-it answer cut inside a test file keeps the test it named", async () => {
  const { parseBreakTests } = await import("../.github/scripts/break-it-review.mjs");
  const tests = parseBreakTests(cutBreakIt);
  assert.equal(tests[0].file, "break-it-blank-title.test.cjs");
  assert.match(tests[0].code, /^const test = require\("node:test"\);/);
});

test("a cut answer names the cut instead of blaming a placeholder", async () => {
  const { parsePlan } = await load();
  assert.throws(() => parsePlan('```json {"note": "/project?id={id}"'), /model answer was not JSON: .*stopped mid-object at \d+ characters/);
  assert.throws(() => parsePlan("no object here"), (error) => !/stopped mid-object/.test(error.message));
});

test("a verdict the parser cannot name is an error, not a silent pass", async () => {
  const { parseAnswer, askModel, decide } = await load();
  assert.throws(() => parseAnswer('{"verdict":"LGTM","notes":"looks fine"}'), /model answer had no verdict: LGTM/);
  assert.throws(() => parseAnswer('{"verdict":"","notes":"the page loaded"}'), /model answer had no verdict/);
  const seen = [];
  const contents = ['{"verdict":"LGTM","notes":"looks fine"}', '{"verdict":"LGTM","notes":"looks fine"}'];
  const options = {
    key: "secret",
    model: "deepseek/deepseek-v4.1-flash",
    fetchImpl: async (_url, request) => {
      seen.push(JSON.parse(request.body).model);
      return { ok: true, async json() { return { choices: [{ message: { content: contents[seen.length - 1] } }] }; } };
    },
  };
  let thrown;
  try { await askModel("same prompt", options, parseAnswer); } catch (error) { thrown = error; }
  assert.equal(seen.length, 2);
  const result = decide({ model: { unevaluated: thrown.message }, plan: { ...binding, actions: [{ op: "goto", path: "/" }], expect: [] }, evidence: { ...binding, steps: [{ ok: true, error: "" }], expects: [], navigations: [{ url: "http://127.0.0.1:3100/", status: 200 }], offOrigin: [] }, binding });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /model answer had no verdict: LGTM/);
});
