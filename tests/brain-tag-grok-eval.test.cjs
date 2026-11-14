const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSample, chatRequest, grokCost, decide, renderReport, assemble, budgeted, JEV_MODEL, GROK_MODEL, DEFAULT_BUDGET_USD } = require('../scripts/brain-tag-grok-eval.cjs');

const makeCases = (counts) => Object.entries(counts).flatMap(([gold, count]) => Array.from({ length: count }, (_, index) => ({ id: `${gold}-${index}`, gold, title: `title ${index}`, text: `text ${index}` })));

test('the sample is deterministic, sized exactly and covers every class', () => {
  const cases = makeCases({ 'brain-light': 57, 'brain-medium': 105, 'brain-hard': 36, 'brain-extra-hard': 2 });
  const sample = buildSample(cases, 40);
  assert.equal(sample.length, 40);
  assert.deepEqual(new Set(sample.map((testCase) => testCase.gold)).size, 4);
  assert.deepEqual(sample.map((testCase) => testCase.id), buildSample([...cases].reverse(), 40).map((testCase) => testCase.id));
  assert.equal(new Set(sample.map((testCase) => testCase.id)).size, 40);
});

test('a sample bigger than a class takes what exists and never repeats a ticket', () => {
  const cases = makeCases({ 'brain-light': 3, 'brain-medium': 1, 'brain-hard': 1, 'brain-extra-hard': 40 });
  const sample = buildSample(cases, 40);
  assert.equal(new Set(sample.map((testCase) => testCase.id)).size, sample.length);
  assert.ok(sample.filter((testCase) => testCase.gold === 'brain-light').length <= 3);
  assert.ok(sample.some((testCase) => testCase.gold === 'brain-medium'));
});

test('both models get the same prompt that asks for one of the four brain labels', () => {
  const testCase = { id: 'HTPR-1', title: 'Ship it', text: 'Do the thing.' };
  const jev = chatRequest(JEV_MODEL, testCase);
  assert.equal(jev.model, 'typesafe/jev-router');
  assert.deepEqual(jev, { ...chatRequest(JEV_MODEL, testCase) });
  const grok = chatRequest(GROK_MODEL, testCase);
  assert.equal(grok.model, 'x-ai/grok-4.7');
  assert.deepEqual(jev.messages, grok.messages);
  assert.match(grok.messages[0].content, /brain-light/);
  assert.match(grok.messages[0].content, /brain-extra-hard/);
  assert.match(grok.messages[1].content, /Ship it/);
  assert.equal(grok.usage.include, true);
});

test('grok cost prefers the reported cost and falls back to the model price', () => {
  assert.equal(grokCost({ cost: 0.0012 }), 0.0012);
  assert.equal(grokCost({ prompt_tokens: 1000, completion_tokens: 1000 }), 0.008);
  assert.equal(grokCost(null), 0);
});

test('the meter stops the run when the budget is gone', () => {
  const meter = budgeted(DEFAULT_BUDGET_USD);
  assert.equal(meter.left(), true);
  meter.add(1.5);
  assert.equal(meter.left(), true);
  meter.add(0.6);
  assert.equal(meter.left(), false);
  assert.equal(meter.spent(), 2.1);
});

test('the decision switches only on a clear accuracy win and keeps grok otherwise', () => {
  const stats = (overrides = {}) => ({ cases: 40, errors: 0, answered: 40, exact: 0.5, macroExact: 0.5, withinOne: 0.8, perClass: [], confident: { threshold: 0.7, count: 10, coverage: 0.25, exact: 0.7 }, latencyMs: { p50: 300, p90: 600 }, costUsd: 0.1, confusion: {}, errorSamples: [], ...overrides });
  const pairs = (gap, low) => ({ gap, ci95: [low, gap + 0.05], jevOnly: 5, haikuOnly: 1, both: 10, neither: 5 });
  assert.equal(decide(stats({ exact: 0.6, costUsd: 0.01 }), stats({ exact: 0.5 }), stats({ exact: 0.4 }), pairs(0.1, 0.02)).recommendation, 'switch');
  assert.equal(decide(stats({ exact: 0.5, confident: { threshold: 0.7, count: 10, coverage: 0.25, exact: 0.5 } }), stats({ exact: 0.5 }), stats({ exact: 0.4 }), pairs(0, -0.05)).recommendation, 'keep');
  assert.equal(decide(stats({ exact: 0.5, confident: { threshold: 0.7, count: 12, coverage: 0.3, exact: 0.85 } }), stats({ exact: 0.5 }), stats({ exact: 0.4 }), pairs(0, -0.02)).recommendation, 'split');
});

test('the report carries the metric table, the spend and one recommendation line', () => {
  const cases = makeCases({ 'brain-light': 1, 'brain-medium': 1, 'brain-hard': 1, 'brain-extra-hard': 1 });
  const rows = (level) => cases.map((testCase) => ({ id: testCase.id, gold: testCase.gold, predicted: level, confidence: null, latencyMs: 200, costUsd: 0.0005 }));
  const result = assemble({ cases, boardId: 15, generatedAt: '2026-11-10T00:00:00Z', sha256: 'abc' }, { jev: JEV_MODEL, grok: GROK_MODEL }, '2026-11-11T00:00:00Z', rows('brain-medium'), rows('brain-medium'), 2);
  const report = renderReport(result);
  assert.match(report, /^\| metric \| Jev Router \| Grok \| Today \(always medium\) \|$/m);
  assert.match(report, /cost per tag/);
  assert.match(report, /^Recommendation: (switch|split|keep)$/m);
  assert.equal(result.spendUsd, 0.004);
});
