const test = require('node:test');
const assert = require('node:assert/strict');
const { LEVELS, normaliseAnswer, parseJevAnswer, jevRequest, haikuPrompts, scoreModel, alwaysMedium, paired, verdict, renderReport, loadCorpus, percentile } = require('../scripts/brain-tag-eval.cjs');

const rows = [
  { id: 'HTPR-1', gold: 'brain-light', predicted: 'brain-light', confidence: 0.9, latencyMs: 100, costUsd: 0.00001 },
  { id: 'HTPR-2', gold: 'brain-medium', predicted: 'brain-medium', confidence: 0.8, latencyMs: 300, costUsd: 0.00001 },
  { id: 'HTPR-3', gold: 'brain-hard', predicted: 'brain-medium', confidence: 0.3, latencyMs: 200, costUsd: 0.00001 },
  { id: 'HTPR-4', gold: 'brain-extra-hard', predicted: 'brain-hard', confidence: 0.75, latencyMs: 400 },
  { id: 'HTPR-5', gold: 'brain-medium', error: 'HTTP 500', latencyMs: 50 },
];

test('jev answers map to one of the four brain labels, anything else is an error', () => {
  assert.deepEqual(parseJevAnswer({ answers: { brain: { type: 'choice', choice: 'hard', confidence: 0.62 } } }), { level: 'brain-hard', confidence: 0.62, probabilities: null });
  assert.equal(parseJevAnswer({ answers: { brain: { type: 'choice', choice: 'hard', confidence: 0.7, probabilities: { hard: 0.7 } } } }).probabilities.hard, 0.7);
  assert.match(parseJevAnswer({ answers: { brain: { type: 'choice', choice: 'impossible' } } }).error, /unknown choice/);
  assert.match(parseJevAnswer({ answers: { brain: { type: 'refusal' } } }).error, /no brain answer/);
  assert.match(parseJevAnswer({ error: { message: 'rate limited' } }).error, /rate limited/);
});

test('haiku answers are read from loose text, and unknown text is no answer', () => {
  assert.equal(normaliseAnswer('Extra-hard'), 'brain-extra-hard');
  assert.equal(normaliseAnswer('brain-medium.'), 'brain-medium');
  assert.equal(normaliseAnswer('The answer is: Hard'), 'brain-hard');
  assert.equal(normaliseAnswer('brain-hard, because auth and money'), 'brain-hard');
  assert.equal(normaliseAnswer('brain-light or brain-hard'), 'brain-light');
  assert.equal(normaliseAnswer(''), null);
  assert.equal(normaliseAnswer('brain-twelve'), null);
});

test('both models get the same ticket and the four level definitions', () => {
  const testCase = { id: 'HTPR-7', title: 'Refund fails', text: 'Payments double-charge.', gold: 'brain-hard' };
  const jev = jevRequest(testCase);
  assert.equal(jev.model, 'typesafe/jev-1.14');
  assert.deepEqual(jev.provider, { zdr: true, only: ['typesafe'], data_collection: 'deny' });
  assert.equal(jev.state.title, testCase.title);
  assert.deepEqual(Object.keys(jev.questions.brain.criteria).sort(), ['extra-hard', 'hard', 'light', 'medium']);
  const haiku = haikuPrompts(testCase);
  assert.ok(haiku.input.includes(testCase.title) && haiku.input.includes(testCase.text));
  for (const level of LEVELS) assert.ok(haiku.instructions.includes(level), `${level} missing from the haiku brief`);
});

test('scores count exact, near, macro, confident and confusion per model', () => {
  const stats = scoreModel(rows);
  assert.equal(stats.cases, 5);
  assert.equal(stats.answered, 4);
  assert.equal(stats.errors, 1);
  assert.equal(stats.exact, 0.5);
  assert.equal(stats.withinOne, 1);
  assert.equal(stats.macroExact, 0.5);
  assert.equal(stats.confident.count, 3);
  assert.ok(Math.abs(stats.confident.exact - 2 / 3) < 1e-9);
  assert.equal(stats.confusion['brain-hard']['brain-medium'], 1);
  assert.equal(stats.latencyMs.p50, 200);
  assert.equal(stats.costUsd.toFixed(5), '0.00003');
  assert.deepEqual(stats.errorSamples, ['HTPR-5: HTTP 500']);
});

test('the always-medium default is the baseline the pilot must beat', () => {
  const today = alwaysMedium(rows);
  assert.equal(today.exact, 0.4);
  assert.equal(today.confident.count, 0);
});

test('paired comparison counts who was right on the same ticket and brackets the gap', () => {
  const jevRows = [
    { id: 'a', gold: 'brain-light', predicted: 'brain-light' },
    { id: 'b', gold: 'brain-light', predicted: 'brain-medium' },
    { id: 'c', gold: 'brain-hard', predicted: 'brain-hard' },
    { id: 'd', gold: 'brain-hard', predicted: 'brain-hard' },
    { id: 'e', gold: 'brain-medium', predicted: 'brain-medium' },
  ];
  const haikuRows = [
    { id: 'a', gold: 'brain-light', predicted: 'brain-medium' },
    { id: 'b', gold: 'brain-light', predicted: 'brain-light' },
    { id: 'c', gold: 'brain-hard', predicted: 'brain-medium' },
    { id: 'd', gold: 'brain-hard', predicted: 'brain-hard' },
    { id: 'e', gold: 'brain-medium', predicted: 'brain-medium' },
  ];
  const stats = paired(jevRows, haikuRows);
  assert.equal(stats.n, 5);
  assert.equal(stats.jevOnly, 2);
  assert.equal(stats.haikuOnly, 1);
  assert.equal(stats.both, 2);
  assert.equal(stats.neither, 0);
  assert.ok(Math.abs(stats.gap - 0.2) < 1e-9);
  assert.ok(stats.ci95[0] <= stats.gap && stats.gap <= stats.ci95[1]);
  assert.ok(stats.oneSided > 0 && stats.oneSided <= 1);
  const tiny = paired([{ id: 'a', gold: 'brain-light', predicted: 'brain-light' }, { id: 'b', gold: 'brain-light', predicted: 'brain-light' }], [{ id: 'a', gold: 'brain-light', predicted: 'brain-medium' }, { id: 'b', gold: 'brain-light', predicted: 'brain-medium' }]);
  assert.ok(Math.abs(tiny.oneSided - 0.25) < 1e-9, 'both discordant tickets going Jev way is P = 0.25, not 0.75');
  const reversed = paired([{ id: 'a', gold: 'brain-light', predicted: 'brain-medium' }, { id: 'b', gold: 'brain-light', predicted: 'brain-medium' }], [{ id: 'a', gold: 'brain-light', predicted: 'brain-light' }, { id: 'b', gold: 'brain-light', predicted: 'brain-light' }]);
  assert.equal(reversed.oneSided, 1);
  assert.equal(paired(jevRows, haikuRows).ci95[0], stats.ci95[0], 'the bracket must be reproducible');
});

test('percentiles use the nearest rank and ignore missing latencies', () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.9), 40);
  assert.equal(percentile([undefined, 30], 0.5), 30);
  assert.equal(percentile([], 0.5), null);
});

test('verdict averages the gap over runs, so a knife-edge single run cannot pass the bar', () => {
  const jev = { cases: 600, answered: 600, errors: 0, exact: 0.62, latencyMs: { p50: 300 } };
  const haiku = { cases: 600, answered: 600, errors: 0, exact: 0.59, latencyMs: { p50: 1100 } };
  const today = { exact: 0.53 };
  const repeats = [{ gap: 0.05, ci95: [0.005, 0.1], oneSided: 0.04, coverage: 1 }, { gap: 0.03, ci95: [-0.01, 0.09], oneSided: 0.08, coverage: 1 }, { gap: 0.03, ci95: [-0.01, 0.09], oneSided: 0.08, coverage: 1 }];
  const result = verdict(jev, haiku, today, repeats[0], repeats);
  assert.equal(result.keep, false);
  assert.match(result.bars[0].detail, /mean gap \+3\.7 points/);
  assert.equal(verdict(jev, haiku, today, repeats[0], [{ gap: 0.06, ci95: [0.01, 0.11], coverage: 1 }]).keep, true);
  assert.equal(verdict(jev, haiku, today, { gap: 0.06, ci95: [-0.01, 0.13], coverage: 1 }, [{ gap: 0.06, ci95: [-0.01, 0.13], coverage: 1 }]).keep, false, 'five points with an interval through zero is not clearly better');
  assert.equal(verdict(jev, haiku, today, { gap: 0.06, ci95: [0.01, 0.11], coverage: 0.9 }, [{ gap: 0.06, ci95: [0.01, 0.11], coverage: 0.9 }]).keep, false, 'a partial haiku baseline cannot decide');
  assert.equal(verdict(jev, { ...haiku, errors: 30 }, today, { gap: 0.06, ci95: [0.01, 0.11], coverage: 1 }, [{ gap: 0.06, ci95: [0.01, 0.11], coverage: 1 }]).keep, false, 'a flaky haiku baseline cannot decide');
});

test('verdict keeps Jev only on a five point exact win, a speed win and few errors', () => {
  const v = (jev, haiku, today) => verdict(jev, haiku, today, { gap: jev.exact - haiku.exact, ci95: [0.01, 0.1], coverage: 1 }, [{ gap: jev.exact - haiku.exact, ci95: [0.01, 0.1], coverage: 1 }]);
  const good = { cases: 100, answered: 99, errors: 1, exact: 0.72, latencyMs: { p50: 110 }, confident: { count: 60 } };
  const haiku = { cases: 100, answered: 100, errors: 0, exact: 0.65, latencyMs: { p50: 900 }, confident: { count: 0 } };
  assert.equal(v(good, haiku, { exact: 0.4 }).keep, true);
  assert.equal(v({ ...good, exact: 0.69 }, haiku, { exact: 0.4 }).keep, false);
  assert.equal(v({ ...good, latencyMs: { p50: 1200 } }, haiku, { exact: 0.4 }).keep, false);
  assert.equal(v({ ...good, errors: 10 }, haiku, { exact: 0.4 }).keep, false);
  assert.equal(v(good, { ...haiku, exact: 0.7 }, { exact: 0.4 }).keep, false);
  assert.equal(v(good, { ...haiku, exact: 0.4 }, { exact: 0.4 }).keep, true);
});

test('the pinned corpus is 200 own-board tickets with a brain label and no client text', () => {
  const corpus = loadCorpus();
  assert.equal(corpus.boardId, 15);
  assert.equal(corpus.cases.length, 200);
  const stamps = require('./fixtures/brain-tag-eval/timestamps.json');
  assert.deepEqual(Object.keys(stamps.cases).sort(), corpus.cases.map((c) => c.id).sort());
  assert.ok(Object.values(stamps.cases).every((entry) => entry.createdAt < stamps.cutoff && entry.updatedAt < stamps.cutoff));
  assert.deepEqual([...new Set(corpus.cases.map((c) => c.gold))].sort(), [...LEVELS].sort());
  assert.ok(corpus.cases.every((c) => /^HTPR-\d+$/.test(c.id)));
  assert.ok(corpus.cases.every((c) => c.text.length > 40 && c.text.length <= 1003));
  const changed = structuredClone(corpus);
  changed.cases[0].gold = 'brain-impossible';
  assert.throws(() => loadCorpus(writeTemp(changed)), /gold must be a brain label/);
});

test('the report shows both models beside the always-medium default and the keep bars', () => {
  const stats = scoreModel(rows);
  const report = renderReport({
    startedAt: '2026-11-10T21:00:00.000Z',
    corpus: { cases: 200, boardId: 15, generatedAt: '2026-11-10T20:00:00.000Z' },
    models: { jev: 'typesafe/jev-1.14', haiku: 'claude-haiku-5-5' },
    jev: stats, haiku: stats, today: alwaysMedium(rows),
    repeats: [
      { ...paired([{ id: 'x', gold: 'brain-light', predicted: 'brain-light' }, { id: 'y', gold: 'brain-light', predicted: 'brain-medium' }], [{ id: 'x', gold: 'brain-light', predicted: 'brain-medium' }, { id: 'y', gold: 'brain-light', predicted: 'brain-light' }]) },
      { ...paired([{ id: 'x', gold: 'brain-light', predicted: 'brain-light' }, { id: 'y', gold: 'brain-light', predicted: 'brain-medium' }], [{ id: 'x', gold: 'brain-light', predicted: 'brain-medium' }, { id: 'y', gold: 'brain-light', predicted: 'brain-light' }]) },
    ],
    verdict: verdict({ cases: 5, answered: 4, errors: 1, exact: 0.5, latencyMs: { p50: 200 } }, { cases: 5, answered: 4, errors: 1, exact: 0.5, latencyMs: { p50: 200 } }, { exact: 0.5 }),
  });
  assert.match(report, /^# Brain tag pilot: Jev against Haiku/);
  assert.match(report, /\| metric \| Jev \| Haiku \| Today/);
  assert.match(report, /Confusion, Jev/);
  assert.match(report, /## Every run/);
  assert.match(report, /## Paired comparison on the same tickets/);
  assert.match(report, /95% bootstrap CI/);
  assert.match(report, /2 run\(s\)/);
  assert.match(report, /Drop Jev for the brain tag/);
});

function writeTemp(value) {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = path.join(require('node:os').tmpdir(), `brain-tag-eval-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
