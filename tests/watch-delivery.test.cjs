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

test('the oldest run is read from the last page, because the runs list is newest first and ignores sort', async () => {
  const { measureWindow } = await subject;
  const newest = run('required-check-settings.yml', 'schedule', until - HOUR);
  const oldest = run('required-check-settings.yml', 'schedule', until - 400 * DAY);
  const seen = [];
  const api = async path => {
    seen.push(path);
    if (path.includes('created=')) return { workflow_runs: [newest] };
    if (path.endsWith('page=1')) return { total_count: 250, workflow_runs: [newest] };
    if (path.endsWith('page=3')) return { total_count: 250, workflow_runs: [oldest] };
    throw new Error(`unexpected path ${path}`);
  };
  const window = await measureWindow({ repo: 'example/repo', sinceMs: until - 7 * DAY, untilMs: until, only: 'watches', commits: async () => 0 }, api);
  const settings = window.watches.find(row => row.workflow === 'required-check-settings.yml');
  assert.equal(settings.asked, 168, 'a watch whose oldest run predates the window is asked for all seven days');
  assert.equal(settings.coveredDays, 7);
  assert.equal(settings.delivered, 7, 'one run counted in each of the seven day slices');
  assert.equal(settings.rate, 7 / 168);
  assert.ok(seen.some(path => path.endsWith('page=3')), 'the second read asks for the last page, not for page one again');
});

test('a workflow with one page needs no second read, and a workflow with no runs has no record', async () => {
  const { measureWindow } = await subject;
  const only = run('prod-health.yml', 'schedule', until - 2 * DAY);
  const paths = [];
  const api = async path => {
    paths.push(path);
    if (path.includes('created=')) return { workflow_runs: [] };
    if (path.includes('prod-health.yml')) return { total_count: 1, workflow_runs: [only] };
    return { total_count: 0, workflow_runs: [] };
  };
  const window = await measureWindow({ repo: 'example/repo', sinceMs: until - 2 * DAY, untilMs: until, only: 'watches', commits: async () => 0 }, api);
  const legacy = window.watches.find(row => row.workflow === 'prod-health.yml');
  const settings = window.watches.find(row => row.workflow === 'required-check-settings.yml');
  assert.equal(legacy.asked, 672);
  assert.equal(settings.asked, 0, 'a workflow with no record anywhere is asked for nothing, not judged over the window');
  assert.equal(settings.enough, false);
  assert.equal(paths.filter(path => path.includes('prod-health.yml') && path.includes('page=2')).length, 0);
});

test('legacy cron runs and chained runs are counted apart', async () => {
  const { measureWindow } = await subject;
  const pages = {
    'production-watch.yml': [run('production-watch.yml', 'workflow_dispatch', until - HOUR)],
    'required-check-settings.yml': [run('required-check-settings.yml', 'schedule', until - HOUR)],
    'ux-signoff-chain.yml': [run('ux-signoff-chain.yml', 'schedule', until - HOUR)],
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
    ['hourly design check, chained', 1],
    ['production watch, legacy cron', 1],
  ]);
  assert.equal(window.pushes.commits, 2);
  assert.equal(window.pushes.runs, 1);
});

test('the hourly design check is counted from its chain, so a pull-request gate run is never a link', async () => {
  const { measureWindow, WATCHES } = await subject;
  const design = WATCHES.find(watch => watch.label.startsWith('hourly design check'));
  assert.equal(design.workflow, 'ux-signoff-chain.yml');
  assert.deepEqual(design.events, ['schedule', 'workflow_dispatch']);

  const reads = [];
  const within = (path, runs) => {
    const bounds = /created=([^&]+)/.exec(path)?.[1];
    if (!bounds) return runs;
    const [from, to] = bounds.split('..').map(value => Date.parse(value));
    return runs.filter(entry => Date.parse(entry.created_at) >= from && Date.parse(entry.created_at) < to);
  };
  const api = async path => {
    reads.push(path);
    if (path.includes('ux-signoff-chain.yml')) {
      return {
        workflow_runs: within(path, Array.from({ length: 24 * 7 }, (_, index) => run(
          'ux-signoff-chain.yml',
          index === 5 ? 'workflow_dispatch' : 'schedule',
          until - 7 * DAY + index * HOUR,
        ))),
      };
    }
    if (path.includes('ux-signoff-gate.yml')) {
      return {
        workflow_runs: Array.from({ length: 43 }, (_, index) => run('ux-signoff-gate.yml', 'pull_request_target', until - 7 * DAY + index * 4 * HOUR)),
      };
    }
    return { workflow_runs: [] };
  };
  const window = await measureWindow({ repo: 'example/repo', sinceMs: until - 7 * DAY, untilMs: until, only: 'watches', commits: async () => 0 }, api);
  const row = window.watches.find(entry => entry.label === 'hourly design check, chained');
  assert.equal(row.asked, 168);
  assert.equal(row.delivered, 168);
  assert.equal(row.enough, true);
  assert.equal(reads.some(path => path.includes('ux-signoff-gate.yml')), false, 'a gate run neither waits out the hour nor starts a successor, so its run list is never read as links');
});

test('the gap meter reads the pre-fix design-check week as a wait of most of a day', async () => {
  const { formatWindow, watchRow, WATCHES } = await subject;
  const design = WATCHES.find(watch => watch.label.startsWith('hourly design check'));

  let at = until - 7 * DAY;
  const starved = [run('ux-signoff-chain.yml', 'schedule', at)];
  for (const minutes of [266, 266, 266, 266, 266, 266, 266, 266, 266, 266, 266, 424]) {
    at += minutes * 60000;
    starved.push(run('ux-signoff-chain.yml', 'schedule', at));
  }
  const starvedRow = watchRow(design, { sinceMs: until - 7 * DAY, untilMs: until, runs: starved, firstRecordedMs: until - 30 * DAY });
  assert.equal(starvedRow.delivered, 13);
  assert.equal(starvedRow.medianGap, 266);
  assert.equal(starvedRow.worstGap, 424, 'the 424-minute wait is the design question that sat most of a day');

  const healthy = Array.from({ length: 24 * 7 }, (_, index) => run('ux-signoff-chain.yml', 'schedule', until - 7 * DAY + index * HOUR));
  const healthyRow = watchRow(design, { sinceMs: until - 7 * DAY, untilMs: until, runs: healthy, firstRecordedMs: until - 30 * DAY });
  assert.equal(healthyRow.medianGap, 60);
  assert.equal(healthyRow.worstGap, 60);

  const text = formatWindow('Measured window', { sinceMs: until - 7 * DAY, untilMs: until, watches: [starvedRow], pushes: null });
  assert.match(text, /\| Median gap \| Worst gap \| Nine in ten \|/);
  assert.match(text, /worst gap 424m \(7\.1h\)/);
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
