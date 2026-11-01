const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const fixturePath = path.join(__dirname, 'fixtures/ci-check-time/factory.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const subject = import('../scripts/ci-check-time.mjs');

test('step names fall into setup, tests or other without guessing', async () => {
  const { classifyStep } = await subject;
  assert.equal(classifyStep('Set up job'), 'setup');
  assert.equal(classifyStep('Run actions/checkout@v4'), 'setup');
  assert.equal(classifyStep('Run actions/setup-node@v4'), 'setup');
  assert.equal(classifyStep('Run npm ci'), 'setup');
  assert.equal(classifyStep('Run npm test'), 'tests');
  assert.equal(classifyStep('Run npm run lint'), 'tests');
  assert.equal(classifyStep('Run npx playwright test'), 'tests');
  assert.equal(classifyStep('Run actions/upload-artifact@v4'), 'other');
  assert.equal(classifyStep(''), 'other');
});

test('a run splits into queue, worker time and between-job wait', async () => {
  const { decomposeRun } = await subject;
  const run = {
    id: 1, head_sha: 'abc', name: 'ci-tests', conclusion: 'success', created_at: '2026-10-31T10:00:00Z',
    run_started_at: '2026-10-31T10:00:20Z', updated_at: '2026-10-31T10:03:50Z',
  };
  const jobs = [{
    name: 'ci-tests', started_at: '2026-10-31T10:00:20Z', completed_at: '2026-10-31T10:03:40Z',
    steps: [
      { name: 'Run actions/checkout@v4', started_at: '2026-10-31T10:00:20Z', completed_at: '2026-10-31T10:00:25Z' },
      { name: 'Run npm ci', started_at: '2026-10-31T10:00:25Z', completed_at: '2026-10-31T10:01:25Z' },
      { name: 'Run npm test', started_at: '2026-10-31T10:01:25Z', completed_at: '2026-10-31T10:03:40Z' },
    ],
  }];
  const row = decomposeRun(run, jobs);
  assert.deepEqual(
    { waiting: row.waiting, wall: row.wall, setup: row.setup, tests: row.tests, other: row.other, gap: row.gap, clipped: row.clipped },
    { waiting: 20, wall: 210, setup: 65, tests: 135, other: 0, gap: 10, clipped: false },
  );
  assert.equal(row.total, 230);
});

test('a run missing timestamps is skipped, and steps longer than their job are flagged', async () => {
  const { decomposeRun } = await subject;
  assert.equal(decomposeRun({ id: 2, created_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T10:01:00Z' }), null);
  const run = { id: 3, created_at: '2026-10-31T10:00:00Z', run_started_at: '2026-10-31T10:00:10Z', updated_at: '2026-10-31T10:01:00Z' };
  const jobs = [{
    name: 'ci-tests', started_at: '2026-10-31T10:00:10Z', completed_at: '2026-10-31T10:00:20Z',
    steps: [{ name: 'Run npm test', started_at: '2026-10-31T10:00:10Z', completed_at: '2026-10-31T10:00:40Z' }],
  }];
  assert.equal(decomposeRun(run, jobs).clipped, true);
});

test('push to green counts only commits where every run passed', async () => {
  const { appFromFixture } = await subject;
  const hypertask = appFromFixture(fixture.apps[0]);
  assert.equal(hypertask.runs, 5);
  assert.equal(hypertask.greenPushes, 2);
  assert.equal(hypertask.pushToGreen.median, 330);
  assert.ok(hypertask.pushToGreen.p90 >= hypertask.pushToGreen.median);
  assert.equal(hypertask.clipped, 0);
  assert.equal(hypertask.median.waiting, 10);
  assert.equal(hypertask.median.gap, 0);
});

test('the share inside the target counts a push once, from its first run to its last', async () => {
  const { summarize } = await subject;
  const row = () => ({
    id: 1, sha: 'abc', workflow: 'ci-tests', waiting: 10, wall: 100, setup: 40, tests: 50, other: 10,
    overhead: 0, clipped: false, createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T10:01:40Z', conclusion: 'success',
  });
  const commit = (from, to) => [
    { conclusion: 'success', createdAt: from, updatedAt: to, unreadable: false },
  ];
  const commits = new Map([
    ['fast', commit('2026-10-31T10:00:00Z', '2026-10-31T10:07:00Z')],
    ['target', commit('2026-10-31T11:00:00Z', '2026-10-31T11:10:00Z')],
    ['slow', commit('2026-10-31T12:00:00Z', '2026-10-31T12:14:00Z')],
  ]);
  const summary = summarize({ name: 'app', repo: 'owner/app' }, [row()], new Map(), { commits });
  assert.equal(summary.greenPushes, 3);
  assert.equal(summary.pushToGreen.withinTarget, 2);
  assert.equal(summary.pushToGreen.share, 67);
});

test('the slowest spots are named from job durations with at least two samples', async () => {
  const { appFromFixture } = await subject;
  const hypertask = appFromFixture(fixture.apps[0]);
  assert.deepEqual(hypertask.slowSpots, [
    { work: 'ci-tests / ci-tests', samples: 2, median: 130 },
    { work: 'app-smoke / app-smoke', samples: 2, median: 119 },
    { work: 'ci-tests / lint', samples: 2, median: 85 },
  ]);
  assert.equal(hypertask.setupSteps[0].work, 'ci-tests / Run npm ci');
  assert.equal(hypertask.setupSteps[0].median, 57.5);
});

test('the page shows every app in both factories and keeps user text escaped', async () => {
  const { formatHtml, formatMarkdown, formatText, appFromFixture } = await subject;
  const summaries = fixture.apps.map(entry => appFromFixture(entry));
  summaries[0].label = '<script>Hypertask</script>';
  const html = formatHtml(summaries, { limit: 150, generatedAt: '2026-10-31T12:00:00Z', command: 'node scripts/ci-check-time.mjs' });
  assert.ok(html.includes('&lt;script&gt;Hypertask&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /push to all green/);
  assert.match(html, /browser-smoke|app-smoke/);
  assert.equal((html.match(/<h2>/g) ?? []).length, 2);
  assert.match(html, /Software Factory/);
  assert.match(html, /node scripts\/ci-check-time\.mjs/);
  assert.match(html, /green pushes inside 10 minutes<\/td><td>2 of 2 \(100%\)/);
  assert.match(formatText(summaries, { limit: 150 }), /green pushes inside 10 minutes: 2 of 2 \(100%\)/);
  assert.match(formatText(summaries, { limit: 150 }), /Postbox \(valentinyeo\/postbox, 2 runs measured, 0 skipped, 2 green commits\)/);
  const markdown = formatMarkdown(summaries, { limit: 150, generatedAt: '2026-10-31T12:00:00Z', command: 'node scripts/ci-check-time.mjs' });
  assert.match(markdown, /## Postbox \(Software Factory\)/);
  assert.match(markdown, /\| Push to all green \| 5\.5m \| 5\.5m \|/);
  assert.match(markdown, /\| Run time outside jobs \| 0s \| - \|/);
  assert.match(markdown, /\| ci-tests \/ ci-tests \| 2\.2m \| 2 \|/);
  assert.match(markdown, /Rerun: `node scripts\/ci-check-time\.mjs`/);
});

test('the command replays a saved fixture without network access', () => {
  const result = spawnSync(process.execPath, ['scripts/ci-check-time.mjs', '--fixture', fixturePath, '--json', '--limit', '150'], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.apps.length, 2);
  assert.equal(payload.clipped, 0);
  assert.deepEqual(payload.apps.map(app => app.repo), ['hypertask-ai/hypertask', 'valentinyeo/postbox']);
  assert.equal(payload.apps[0].slowSpots.length, 3);
});

test('collecting runs pages through GitHub, proves each commit and reads jobs', async () => {
  const { collectApp, summarize } = await subject;
  const seen = [];
  const gh = async (repo, url) => {
    seen.push(`${repo}${url}`);
    if (url.startsWith('/actions/runs?head_sha=')) {
      const sha = new URLSearchParams(url.split('?')[1]).get('head_sha');
      return { workflow_runs: fixture.apps[0].runs.filter(run => run.head_sha === sha) };
    }
    if (url.startsWith('/actions/runs?')) {
      const page = Number(new URLSearchParams(url.split('?')[1]).get('page'));
      return { workflow_runs: page === 1 ? fixture.apps[0].runs.slice(0, 3) : [] };
    }
    const id = Number(url.match(/\/actions\/runs\/(\d+)\//)[1]);
    return { jobs: fixture.apps[0].jobs[String(id)] ?? [] };
  };
  const { rows, jobsByRun, commits, excluded } = await collectApp({ name: 'hypertask', repo: 'hypertask-ai/hypertask' }, { limit: 2, gh });
  assert.equal(rows.length, 2);
  assert.ok(seen.includes('hypertask-ai/hypertask/actions/runs?head_sha=aaa&per_page=100&page=1'));
  assert.deepEqual(seen.filter(url => url.includes('/jobs?')), [
    'hypertask-ai/hypertask/actions/runs/101/attempts/1/jobs?per_page=100&page=1',
    'hypertask-ai/hypertask/actions/runs/102/attempts/1/jobs?per_page=100&page=1',
  ]);
  assert.equal(jobsByRun.get(101).length, 2);
  assert.equal(commits.get('aaa').length, 2);
  assert.equal(excluded.has('aaa'), true);
  const summary = summarize({ name: 'hypertask', repo: 'hypertask-ai/hypertask' }, rows, jobsByRun, { excluded, commits });
  assert.equal(summary.runs, 2);
  assert.equal(summary.greenPushes, 0);
});

test('a commit is timed from every run it has, including one outside the sampled window', async () => {
  const { summarize } = await subject;
  const row = () => ({
    id: 1, sha: 'abc', workflow: 'ci', waiting: 5, wall: 60, setup: 20, tests: 35, other: 5, gap: 0,
    clipped: false, createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T10:01:00Z', conclusion: 'success',
  });
  const commits = new Map([['abc', [
    { conclusion: 'success', createdAt: '2026-10-31T09:58:00Z', updatedAt: '2026-10-31T09:59:00Z', unreadable: false },
    { conclusion: 'success', createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T10:01:00Z', unreadable: false },
  ]]]);
  const summary = summarize({ name: 'app', repo: 'owner/app' }, [row()], new Map(), { commits });
  assert.equal(summary.pushToGreen.median, 180);
  const unfinished = new Map([['abc', [{ conclusion: '', status: 'in_progress', createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T10:01:00Z', unreadable: false }]]]);
  assert.equal(summarize({ name: 'app', repo: 'owner/app' }, [row()], new Map(), { commits: unfinished }).greenPushes, 0);
});

test('skipped runs never block green and never count as CI time', async () => {
  const { summarize } = await subject;
  const row = (overrides) => ({
    id: 1, sha: 'abc', workflow: 'ci-tests', waiting: 10, wall: 100, setup: 40, tests: 50, other: 10,
    overhead: 0, clipped: false, createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T10:01:40Z', conclusion: 'success',
    ...overrides,
  });
  const rows = [
    row({ id: 1 }),
    row({ id: 2, conclusion: 'skipped', wall: 1, waiting: 1, setup: 0, tests: 0, other: 0 }),
    row({ id: 3, sha: 'def', conclusion: 'failure' }),
    row({ id: 4, sha: 'ghi' }),
    row({ id: 5, sha: 'ghi', conclusion: 'skipped', wall: 1 }),
  ];
  const summary = summarize({ name: 'app', repo: 'owner/app' }, rows, new Map());
  assert.equal(summary.runs, 3);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.greenPushes, 2);
  assert.equal(summary.median.waiting, 10);
  assert.equal(summary.median.wall, 100);
});

test('two back-to-back jobs leave no uncovered wall clock', async () => {
  const { decomposeRun } = await subject;
  const run = { id: 9, created_at: '2026-10-31T10:00:00Z', run_started_at: '2026-10-31T10:00:10Z', updated_at: '2026-10-31T10:02:20Z' };
  const jobs = [
    { name: 'one', started_at: '2026-10-31T10:00:10Z', completed_at: '2026-10-31T10:01:15Z', steps: [] },
    { name: 'two', started_at: '2026-10-31T10:01:15Z', completed_at: '2026-10-31T10:02:20Z', steps: [] },
  ];
  const row = decomposeRun(run, jobs);
  assert.equal(row.wall, 130);
  assert.equal(row.gap, 0);
});

test('a commit whose runs are unfinished, cut off or unreadable is never called green', async () => {
  const { summarize } = await subject;
  const row = (overrides) => ({
    id: 1, sha: 'abc', workflow: 'ci', waiting: 5, wall: 60, setup: 20, tests: 35, other: 5, gap: 0,
    clipped: false, createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T10:01:00Z', conclusion: 'success',
    ...overrides,
  });
  const rows = [row({ id: 1 }), row({ id: 2, sha: 'def' }), row({ id: 3, sha: 'ghi', unreadable: true })];
  const settled = summarize({ name: 'app', repo: 'owner/app' }, rows, new Map());
  assert.equal(settled.greenPushes, 2);
  assert.equal(settled.unreadable, 1);
  const excludedApp = summarize({ name: 'app', repo: 'owner/app' }, rows, new Map(), { excluded: new Set(['abc']) });
  assert.equal(excludedApp.greenPushes, 1);
  const unreadableSha = summarize({ name: 'app', repo: 'owner/app' }, rows, new Map());
  assert.equal(unreadableSha.greenPushes, 2);
});

test('skipped jobs and steps never rank as slow spots', async () => {
  const { summarize } = await subject;
  const row = {
    id: 1, sha: 'abc', workflow: 'ci', waiting: 5, wall: 300, setup: 20, tests: 250, other: 5, gap: 0,
    clipped: false, createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T10:05:00Z', conclusion: 'success',
  };
  const jobs = [
    {
      name: 'ci', conclusion: 'success', started_at: '2026-10-31T10:00:10Z', completed_at: '2026-10-31T10:04:00Z',
      steps: [
        { name: 'Run npm ci', conclusion: 'success', started_at: '2026-10-31T10:00:10Z', completed_at: '2026-10-31T10:01:10Z' },
        { name: 'Run npm ci again', conclusion: 'skipped', started_at: '2026-10-31T10:01:10Z', completed_at: '2026-10-31T10:02:10Z' },
      ],
    },
    { name: 'docs', conclusion: 'skipped', started_at: '2026-10-31T10:00:10Z', completed_at: '2026-10-31T10:00:20Z', steps: [] },
    { name: 'other', conclusion: 'success', started_at: '2026-10-31T10:01:00Z', completed_at: '2026-10-31T10:03:00Z', steps: [] },
  ];
  const summary = summarize({ name: 'app', repo: 'owner/app' }, [row, { ...row, id: 2 }], new Map([[1, jobs], [2, jobs]]));
  assert.deepEqual(summary.slowSpots.map(spot => spot.work), ['ci / ci', 'ci / other']);
  assert.deepEqual(summary.setupSteps.map(spot => spot.work), ['ci / Run npm ci']);
});

test('a tiny fixture limit still times a commit from its whole run list', () => {
  const result = spawnSync(process.execPath, ['scripts/ci-check-time.mjs', '--fixture', fixturePath, '--json', '--limit', '1'], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const [hypertask] = JSON.parse(result.stdout).apps;
  assert.equal(hypertask.runs, 1);
  assert.equal(hypertask.pushToGreen.median, 330);
});

test('the fixture replay honours repo and run limits', () => {
  const one = spawnSync(process.execPath, ['scripts/ci-check-time.mjs', '--fixture', fixturePath, '--json', '--limit', '2'], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
  });
  assert.equal(one.status, 0, one.stderr);
  const limited = JSON.parse(one.stdout);
  assert.deepEqual(limited.apps.map(app => app.runs), [2, 2]);
  assert.equal(limited.apps[0].pushToGreen.median, 330);
  const narrowed = spawnSync(process.execPath, ['scripts/ci-check-time.mjs', '--fixture', fixturePath, '--json', '--repos', 'valentinyeo/postbox'], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
  });
  assert.equal(narrowed.status, 0, narrowed.stderr);
  assert.deepEqual(JSON.parse(narrowed.stdout).apps.map(app => app.repo), ['valentinyeo/postbox']);
});
