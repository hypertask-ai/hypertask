const assert = require("node:assert/strict");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "..");
const ticket = "https://app.hypertask.ai/detail/project-15/9384";
const reason = "The browser system has no render-time signal.";

async function load() {
  return import("../scripts/check-risky-patterns.mjs");
}

test("one new effect hook fails and names the exception path", async () => {
  const { countTree, judge, loadJson, BASELINE_PATH, EXCEPTIONS_PATH } = await load();
  const counts = countTree(root);
  const baseline = loadJson(root, BASELINE_PATH);
  const exceptions = loadJson(root, EXCEPTIONS_PATH);
  assert.deepEqual(judge({
    counts,
    baseBaseline: baseline,
    headBaseline: baseline,
    baseExceptions: exceptions,
    headExceptions: exceptions,
  }), []);
  const bumped = { ...counts, effectHooks: counts.effectHooks + 1 };
  const failures = judge({
    counts: bumped,
    baseBaseline: baseline,
    headBaseline: baseline,
    baseExceptions: [],
    headExceptions: [],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], new RegExp(`Effect hooks went from ${counts.effectHooks} allowed to ${counts.effectHooks + 1}`));
  assert.match(failures[0], /useEffect is only for talking to a system outside React/);
  assert.match(failures[0], /scripts\/risky-pattern-exceptions\.json/);
  assert.match(failures[0], /https:\/\/app\.hypertask\.ai\/detail\/project-<board>\/<number>/);
  assert.match(failures[0], /Do not raise scripts\/risky-pattern-baseline\.json/);
});

test("timers, type escapes and lint silences fail when one is added", async () => {
  const { countText, judge, emptyCounts, PATTERNS } = await load();
  const samples = {
    effectHooks: "useEffect(() => {})",
    quickFixTimers: "setTimeout(() => {}, 0)",
    typeEscapes: "const value = input as any",
    lintSilences: "eslint-disable-next-line no-console",
  };
  assert.equal(countText("useLayoutEffect(() => {})").effectHooks, 0);
  assert.equal(countText("setInterval(() => {}, 0)").quickFixTimers, 0);
  assert.equal(countText("const value = input as anyone").typeEscapes, 0);
  const baseline = emptyCounts();
  for (const key of Object.keys(samples)) {
    assert.equal(countText(samples[key])[key], 1, key);
    const counts = { ...baseline, [key]: 1 };
    const failures = judge({
      counts,
      baseBaseline: baseline,
      headBaseline: baseline,
      baseExceptions: [],
      headExceptions: [],
    });
    assert.equal(failures.length, 1, key);
    assert.match(failures[0], new RegExp(`^${PATTERNS[key].label} went from 0 allowed to 1`));
    assert.match(failures[0], new RegExp(PATTERNS[key].rightWay.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("one approved exception allows one new effect hook and a second still fails", async () => {
  const { judge, emptyCounts } = await load();
  const baseline = emptyCounts();
  const approved = [{ pattern: "effectHooks", ticket, reason }];
  const once = { ...baseline, effectHooks: 1 };
  assert.deepEqual(judge({
    counts: once,
    baseBaseline: baseline,
    headBaseline: baseline,
    baseExceptions: [],
    headExceptions: approved,
  }), []);
  const twice = { ...baseline, effectHooks: 2 };
  const failures = judge({
    counts: twice,
    baseBaseline: baseline,
    headBaseline: baseline,
    baseExceptions: [],
    headExceptions: approved,
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Effect hooks went from 1 allowed to 2/);
});

test("an exception kept from production still covers its code", async () => {
  const { judge, emptyCounts } = await load();
  const baseline = emptyCounts();
  const approved = [{ pattern: "effectHooks", ticket, reason }];
  const once = { ...baseline, effectHooks: 1 };
  assert.deepEqual(judge({
    counts: once,
    baseBaseline: baseline,
    headBaseline: baseline,
    baseExceptions: approved,
    headExceptions: approved,
  }), []);
  const dropped = judge({
    counts: once,
    baseBaseline: baseline,
    headBaseline: baseline,
    baseExceptions: approved,
    headExceptions: [],
  });
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /Effect hooks went from 0 allowed to 1/);
});

test("raising the baseline is refused and a bad exception does not add room", async () => {
  const { judge, emptyCounts } = await load();
  const baseline = emptyCounts();
  const raised = { ...baseline, effectHooks: 1 };
  const raisedFailures = judge({
    counts: baseline,
    baseBaseline: baseline,
    headBaseline: raised,
    baseExceptions: [],
    headExceptions: [],
  });
  assert.match(raisedFailures.join("\n"), /Do not raise scripts\/risky-pattern-baseline\.json/);
  const bad = judge({
    counts: { ...baseline, effectHooks: 1 },
    baseBaseline: baseline,
    headBaseline: baseline,
    baseExceptions: [],
    headExceptions: [{ pattern: "effectHooks", ticket: "HTPR-9384", reason }],
  });
  assert.match(bad.join("\n"), /ticket must be a full https:\/\/app\.hypertask\.ai\/detail\/project-<board>\/<number> link/);
  assert.match(bad.join("\n"), /Effect hooks went from 0 allowed to 1/);
});

test("the first baseline has to match the code with no spare room", async () => {
  const { judge, emptyCounts } = await load();
  const counts = emptyCounts();
  const headBaseline = { ...counts, quickFixTimers: 4 };
  const failures = judge({
    counts,
    baseBaseline: null,
    headBaseline,
    baseExceptions: [],
    headExceptions: [],
  });
  assert.match(failures.join("\n"), /Quick-fix timers baseline is 4 and the code has 0/);
  assert.match(failures.join("\n"), /Do not leave room for new copies/);
});
