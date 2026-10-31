const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

async function loadCounter() {
  return import(
    pathToFileURL(path.join(root, "scripts/test-execution-count.mjs")).href
  );
}

const SPEC_PASSED = [
  "✔ passes (1.2ms)",
  "ℹ tests 3",
  "ℹ suites 0",
  "ℹ pass 2",
  "ℹ fail 1",
  "ℹ cancelled 0",
  "ℹ skipped 0",
  "ℹ todo 0",
  "",
].join("\n");

const TAP_SKIPPED = [
  "not ok 1 - needs docker # SKIP",
  "1..1",
  "# tests 1",
  "# suites 0",
  "# pass 0",
  "# fail 0",
  "# cancelled 0",
  "# skipped 1",
  "# todo 0",
  "# duration_ms 1.5",
  "",
].join("\n");

test("spec reporter output counts executed tests", async () => {
  const { createExecutionCounter } = await loadCounter();
  const counter = createExecutionCounter();
  counter.push(SPEC_PASSED);
  const counted = counter.finish();
  assert.equal(counted.pass, 2);
  assert.equal(counted.fail, 1);
  assert.equal(counted.skipped, 0);
  assert.equal(counted.executed, 3);
  assert.equal(counted.summaries, 1);
});

test("tap output counts a fully skipped file as nothing executed", async () => {
  const { createExecutionCounter } = await loadCounter();
  const counter = createExecutionCounter();
  counter.push(TAP_SKIPPED);
  const counted = counter.finish();
  assert.equal(counted.pass, 0);
  assert.equal(counted.skipped, 1);
  assert.equal(counted.executed, 0);
});

test("counts add up across every runner in one lane and strip colours", async () => {
  const { createExecutionCounter } = await loadCounter();
  const counter = createExecutionCounter();
  counter.push(TAP_SKIPPED);
  counter.push("\u001b[32mℹ pass 4\u001b[39m\n\u001b[32mℹ tests 4\u001b[39m\n");
  const counted = counter.finish();
  assert.equal(counted.executed, 4);
  assert.equal(counted.skipped, 1);
  assert.equal(counted.summaries, 2);
});

test("a summary split across chunks is still counted once", async () => {
  const { createExecutionCounter } = await loadCounter();
  const counter = createExecutionCounter();
  counter.push("ℹ pa");
  counter.push("ss 7\nℹ skip");
  counter.push("ped 2\n");
  const counted = counter.finish();
  assert.equal(counted.executed, 7);
  assert.equal(counted.skipped, 2);
});

test("non-summary output never counts as executed tests", async () => {
  const { createExecutionCounter } = await loadCounter();
  const counter = createExecutionCounter();
  counter.push("Test inventory: 412 Node tests, 37 TypeScript tests.\n");
  counter.push("> Node test suite\n");
  const counted = counter.finish();
  assert.equal(counted.executed, 0);
  assert.equal(counted.summaries, 0);
});

test("a lane that executed nothing fails, a lane with one pass does not", async () => {
  const { createExecutionCounter, executionFailure } = await loadCounter();
  const skipped = createExecutionCounter();
  skipped.push(TAP_SKIPPED);
  assert.match(executionFailure(skipped.finish(), 2), /No test executed: 2 test file\(s\) selected, 1 skipped/);
  const passed = createExecutionCounter();
  passed.push(SPEC_PASSED);
  assert.equal(executionFailure(passed.finish(), 2), null);
});

test("stdout and stderr counters stay separate and combine into one total", async () => {
  const { combineCounters, createExecutionCounter } = await loadCounter();
  const stdout = createExecutionCounter();
  const stderr = createExecutionCounter();
  stderr.push("warning: unfinished line");
  stdout.push(SPEC_PASSED);
  const counted = combineCounters(stdout.finish(), stderr.finish());
  assert.equal(counted.executed, 3);
  assert.equal(counted.skipped, 0);
  assert.equal(counted.summaries, 1);
});

test("combining counters adds every field, executed included", async () => {
  const { combineCounters } = await loadCounter();
  const counted = combineCounters(
    { tests: 2, pass: 1, fail: 1, cancelled: 0, skipped: 3, todo: 0, summaries: 1 },
    { tests: 4, pass: 4, fail: 0, cancelled: 0, skipped: 0, todo: 1, summaries: 1 },
  );
  assert.deepEqual(counted, {
    tests: 6, pass: 5, fail: 1, cancelled: 0, skipped: 3, todo: 1, summaries: 2, executed: 6,
  });
});
