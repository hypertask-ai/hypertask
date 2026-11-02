const { test } = require('node:test');
const assert = require('node:assert/strict');

const subject = import('../scripts/watch-delivery.mjs');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const until = Date.parse('2026-11-09T00:00:00Z');
const run = (workflow, event, at, extra = {}) => ({
  event,
  status: 'completed',
  conclusion: 'success',
  head_branch: 'production',
  head_sha: `sha-${workflow}-${at}`,
  created_at: new Date(at).toISOString(),
  ...extra,
});

test('countDelivered keeps only runs inside the window and separates red from finished', async () => {
  const { countDelivered } = await subject;
  const runs = [
    run('a.yml', 'schedule', until - HOUR),
    run('a.yml', 'schedule', until - 2 * HOUR, { conclusion: 'failure' }),
    run('a.yml', 'schedule', until - 2 * HOUR, { status: 'queued', conclusion: null }),
    run('a.yml', 'schedule', until - 8 * DAY),
  ];
  const counted = countDelivered(runs, until - DAY, until);
  assert.equal(counted.runs, 2);
  assert.equal(counted.queued, 1);
  assert.equal(counted.finished, 2);
  assert.equal(counted.red, 1);
  assert.deepEqual(counted.perDay, [{ day: '2026-11-08', runs: 2 }]);
});

test('queued records do not count as delivered monitoring, however many pile up', async () => {
  const { watchRow, WATCHES } = await subject;
  const settings = WATCHES.find(watch => watch.workflow === 'required-check-settings.yml');
  const queued = Array.from({ length: 24 * 7 }, (_, index) => run('required-check-settings.yml', 'schedule', until - 7 * DAY + index * HOUR, { status: 'queued', conclusion: null }));
  const row = watchRow(settings, { sinceMs: until - 7 * DAY, untilMs: until, runs: queued, firstRecordedMs: until - 30 * DAY });
  assert.equal(row.queued, 168);
  assert.equal(row.delivered, 0);
  assert.equal(row.enough, false);
});

test('a watch already running when the window opened is measured over the whole window', async () => {
  const { watchRow, WATCHES } = await subject;
  const settings = WATCHES.find(watch => watch.workflow === 'required-check-settings.yml');
  const hourly = Array.from({ length: 24 * 7 }, (_, index) => run('required-check-settings.yml', 'schedule', until - 7 * DAY + index * HOUR + 6 * 60 * 1000));
  const row = watchRow(settings, { sinceMs: until - 7 * DAY, untilMs: until, runs: hourly, firstRecordedMs: until - 30 * DAY });
  assert.equal(row.coveredDays, 7);
  assert.equal(row.asked, 168);
  assert.equal(row.enough, true, 'a watch older than the window is judged over all seven days, not from its first run inside them');
});

test('a watch that delivered nine in ten for seven days passes, a starved one does not', async () => {
  const { watchRow, WATCHES } = await subject;
  const settings = WATCHES.find(watch => watch.workflow === 'required-check-settings.yml');
  const hourly = Array.from({ length: 24 * 7 }, (_, index) => run('required-check-settings.yml', 'schedule', until - 7 * DAY + index * HOUR));
  const healthy = watchRow(settings, { sinceMs: until - 7 * DAY, untilMs: until, runs: hourly });
  assert.equal(healthy.asked, 168);
  assert.equal(healthy.delivered, 168);
  assert.equal(healthy.coveredDays, 7);
  assert.equal(healthy.enough, true);

  const starved = watchRow(settings, { sinceMs: until - 7 * DAY, untilMs: until, runs: hourly.slice(0, 7) });
  assert.equal(starved.asked, 168);
  assert.equal(starved.enough, false);
});

test('asked time starts at the first run, so a brand new watch is not judged over the whole window', async () => {
  const { watchRow, WATCHES } = await subject;
  const chained = WATCHES.find(watch => watch.workflow === 'production-watch.yml');
  const runs = [
    run('production-watch.yml', 'workflow_dispatch', until - 2 * HOUR),
    run('production-watch.yml', 'workflow_dispatch', until - HOUR),
  ];
  const row = watchRow(chained, { sinceMs: until - 7 * DAY, untilMs: until, runs });
  assert.equal(row.asked, 4);
  assert.equal(row.delivered, 2);
  assert.equal(row.coveredDays, 0.1);
  assert.equal(row.rate, 0.5);
  assert.equal(row.enough, false, 'four hours of record is not seven days');
});

test('legacy cron runs and chained runs are counted apart', async () => {
  const { measureWindow } = await subject;
  const pages = {
    'production-watch.yml': [run('production-watch.yml', 'workflow_dispatch', until - HOUR)],
    'required-check-settings.yml': [run('required-check-settings.yml', 'schedule', until - HOUR)],
    'prod-health.yml': [
      run('prod-health.yml', 'schedule', until - 2 * HOUR),
      run('prod-health.yml', 'push', until - 3 * HOUR),
    ],
  };
  const api = async path => {
    const workflow = Object.keys(pages).find(name => path.includes(name));
    if (!workflow) throw new Error(`unexpected path ${path}`);
    return { workflow_runs: path.includes('event=push') ? pages[workflow].filter(entry => entry.event === 'push') : pages[workflow] };
  };
  const window = await measureWindow({ repo: 'example/repo', sinceMs: until - DAY, untilMs: until, commits: async () => 2 }, api);
  assert.deepEqual(window.watches.map(row => [row.label, row.delivered]), [
    ['production watch, chained', 1],
    ['hourly settings check', 1],
    ['production watch, legacy cron', 1],
  ]);
  assert.equal(window.pushes.commits, 2);
  assert.equal(window.pushes.runs, 1);
});

test('push delivery above the count of commits is clamped, and a drop against the earlier window is a regression', async () => {
  const { pushRow, compareWindows, verdictLines, measureWindow } = await subject;
  const noisy = pushRow({ commits: 2, runs: [1, 2, 3].map(index => run('prod-health.yml', 'push', until - index * HOUR)), sinceMs: until - DAY, untilMs: until });
  assert.equal(noisy.rate, 1);

  const api = async () => ({ workflow_runs: [] });
  const after = await measureWindow({ repo: 'example/repo', sinceMs: until - DAY, untilMs: until, only: 'pushes', commits: async () => 10 }, api);
  after.pushes.runs = 5;
  after.pushes.rate = 0.5;
  const before = await measureWindow({ repo: 'example/repo', sinceMs: until - 2 * DAY, untilMs: until - DAY, only: 'pushes', commits: async () => 10 }, api);
  before.pushes.runs = 9;
  before.pushes.rate = 0.9;
  const comparison = compareWindows(after, before);
  assert.equal(comparison.pushes.regression, true);
  assert.match(verdictLines(comparison), /pushes lost their check/);
});

test('a repository override that is not this checkout is refused instead of mixing two histories', async () => {
  const { originMatches, gitCommits } = await subject;
  assert.equal(originMatches('git@github.com:hypertask-ai/hypertask.git', 'hypertask-ai/hypertask'), true);
  assert.equal(originMatches('https://github.com/hypertask-ai/hypertask.git', 'hypertask-ai/hypertask'), true);
  assert.equal(originMatches('https://github.com/other/repo.git', 'hypertask-ai/hypertask'), false);
  await assert.rejects(gitCommits('other/repo', until - DAY, until), /run it from a clone of other\/repo/);
});

test('the verdict names the short watch and its reason', async () => {
  const { compareWindows, verdictLines } = await subject;
  const comparison = compareWindows(
    { watches: [{ label: 'production watch, chained', rate: 0.99, enough: false, coveredDays: 2.5, current: true, asked: 120 }], pushes: { rate: 1 } },
    { watches: [{ label: 'production watch, chained', rate: 0.02, enough: false, coveredDays: 7 }], pushes: { rate: 1 } },
  );
  const text = verdictLines(comparison);
  assert.match(text, /pushes keep their check: 100% of production commits started a prod-health push run, was 100%\./);
  assert.match(text, /watch delivery is short: production watch, chained 99% \(was 2%\), short of nine in ten or of seven days: production watch, chained \(2\.5 days of record, needs 7\)\./);
});
