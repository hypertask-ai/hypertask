const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/ci-failure-census/three-runs.json'), 'utf8'));
const subject = import('../scripts/ci-failure-census.mjs');

function fixtureApi(endpoint, raw) {
  if (endpoint.startsWith('/actions/workflows/')) return { workflow_runs: fixture.runs };
  if (endpoint.startsWith('/contents/')) {
    assert.equal(raw, true);
    return fixture.workflow;
  }
  const jobs = endpoint.match(/^\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?/);
  if (jobs) {
    assert.equal(Number(jobs[2]), fixture.runs.find(run => run.id === Number(jobs[1])).run_attempt);
    return { jobs: fixture.jobs[jobs[1]] };
  }
  const log = endpoint.match(/^\/actions\/jobs\/(\d+)\/logs$/);
  if (log) return fixture.logs[log[1]];
  throw new Error(`Unexpected API request: ${endpoint}`);
}

test('three-run fixture counts every failure and separates the dependent cascade', async () => {
  const { failureRows, stepCounts, collectCensus } = await subject;
  const rows = fixture.runs.flatMap(run => failureRows(run, fixture.jobs[run.id], fixture.workflow, fixture.logs));
  assert.deepEqual(stepCounts(rows), [
    { step: 'Test', failures: 2, cascades: 0 },
    { step: 'Browser test', failures: 1, cascades: 0 },
    { step: 'Publish result', failures: 1, cascades: 1 },
  ]);
  assert.deepEqual(rows.map(row => [row.run, row.error, row.cascade]), [
    [101, 'not ok 3 - expected comment', false],
    [102, 'AssertionError: expected 2, got 1', false],
    [103, 'Error: layout shifted', false],
    [103, 'browser-smoke did not pass', true],
  ]);
  const report = collectCensus({ workflow: 'ci-tests.yml', limit: 3, repo: 'example/repo' }, fixtureApi);
  assert.match(report, /Scanned 3 runs; 3 failing runs; 4 failing steps\./);
  assert.match(report, /\| 101 \| pull_request \| fix\/tests \| ci-tests \| Test \| not ok 3 - expected comment \|/);
  assert.match(report, /mcp-cli-api-contract \(cascade\)/);
  assert.match(report, /Counts per step/);
  assert.match(report, /\| Test \| 2 \| 0 \|/);
  assert.match(report, /\| Publish result \| 1 \| 1 \|/);
  assert.match(report, /Unavailable job logs: 0/);
});

test('GitHub rate-limit diagnostics precede the generic shell exit error', async () => {
  const { firstError } = await subject;
  assert.equal(firstError([
    '2026-10-24T10:00:00Z GitHub API rate limit remaining: 3000',
    '2026-10-24T10:00:01Z gh: API rate limit exceeded for installation. (HTTP 403)',
    '2026-10-24T10:00:02Z ##[error]Process completed with exit code 1.',
  ].join('\n')), 'gh: API rate limit exceeded for installation. (HTTP 403)');
  assert.equal(firstError('gh: Resource not accessible by integration (HTTP 403)\n##[error]Process completed with exit code 1.'), 'gh: Resource not accessible by integration (HTTP 403)');
});

test('pagination keeps a fixed page size and bounds the run count', async () => {
  const { collectCensus } = await subject;
  const runs = Array.from({ length: 151 }, (_, id) => ({ id, conclusion: 'success' }));
  const report = collectCensus({ workflow: 'CI Tests', limit: 150, repo: 'example/repo' }, endpoint => {
    const url = new URL(endpoint, 'https://example.test');
    assert.equal(url.pathname, '/actions/workflows/CI%20Tests/runs');
    assert.equal(url.searchParams.get('per_page'), '100');
    const start = (Number(url.searchParams.get('page')) - 1) * 100;
    return { workflow_runs: runs.slice(start, start + 100) };
  });
  assert.match(report, /Scanned 150 runs; 0 failing runs; 0 failing steps\./);
});

test('expired logs remain visible and failed metadata requests do not silently undercount', async () => {
  const { collectCensus } = await subject;
  const options = { workflow: 'ci-tests.yml', limit: 3, repo: 'example/repo' };
  const report = collectCensus(options, (endpoint, raw) => {
    if (endpoint === '/actions/jobs/11/logs') throw new Error('expired');
    return fixtureApi(endpoint, raw);
  });
  assert.match(report, /\| ci-tests \| Test \| Log unavailable \|/);
  assert.match(report, /Unavailable job logs: 1/);
  assert.match(report, /\| Test \| 2 \| 0 \|/);
  assert.throws(() => collectCensus(options, () => { throw new Error('metadata failed'); }), /metadata failed/);
});

test('scalar needs, matrix display names, multiple failing steps and step-less jobs', async () => {
  const { failureRows, firstError, formatCensus } = await subject;
  const jobs = [
    { id: 1, name: 'producer (linux)', conclusion: 'failure', steps: [] },
    { id: 2, name: 'consumer', conclusion: 'failure', steps: [
      { name: 'Test', conclusion: 'failure' },
      { name: 'Cleanup', conclusion: 'failure' },
    ] },
    { id: 3, name: 'cancelled', conclusion: 'cancelled', steps: [] },
  ];
  const rows = failureRows({ id: 1, event: 'push', head_branch: 'pipe|branch' }, jobs, 'jobs:\n  producer: {}\n  consumer:\n    needs: producer\n', { 2: 'ordinary output' });
  assert.deepEqual(rows.map(row => [row.step, row.error, row.cascade]), [
    ['(no failing step reported)', 'Log unavailable', false],
    ['Test', 'No error line found', true],
    ['Cleanup', 'No error line found', true],
  ]);
  assert.equal(firstError('\u001b[31merror TS2322: wrong type\u001b[0m'), 'error TS2322: wrong type');
  assert.match(formatCensus(rows, 1), /pipe\\\|branch/);
});

test('invalid historical YAML and workflow-level failures stay visible without inventing cascade status', async () => {
  const { failureRows, formatCensus, collectCensus } = await subject;
  const rows = failureRows(fixture.runs[0], fixture.jobs[101], 'jobs: [invalid: yaml', fixture.logs);
  assert.equal(rows[0].cascade, null);
  assert.match(formatCensus(rows, 1), /ci-tests \(cascade unknown\)/);
  assert.match(formatCensus(rows, 1), /Cascade classification unavailable for 1 failing steps/);
  const report = collectCensus({ workflow: 'ci-tests.yml', limit: 1, repo: 'example/repo' }, endpoint => {
    if (endpoint.startsWith('/actions/workflows/')) return { workflow_runs: [fixture.runs[0]] };
    if (endpoint.startsWith('/actions/runs/')) return { jobs: [] };
    throw new Error('Workflow source and logs are unnecessary without jobs');
  });
  assert.match(report, /Scanned 1 runs; 1 failing runs; 1 failing steps\./);
  assert.match(report, /\(no failing job reported\)/);
  assert.match(report, /Run conclusion: failure; no failing job returned by GitHub/);
});

test('CLI documents usage and rejects invalid limits before making GitHub calls', () => {
  const script = path.join(__dirname, '../scripts/ci-failure-census.mjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--workflow ci-tests.yml --limit 100/);
  for (const args of [['--limit', '0'], ['--limit', '1.5'], ['--workflow'], ['--unknown', 'x']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /positive integer|Usage:/);
  }
});

test('CLI dispatches read-only requests and prints the complete three-run census', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-census-cli-'));
  try {
    writeFileSync(path.join(directory, 'gh'), `#!/usr/bin/env node
const assert = require('node:assert/strict');
const fixture = ${JSON.stringify(fixture)};
const args = process.argv.slice(2);
if (args[0] === 'repo') {
  console.log('example/repo');
} else if (args[0] === 'run') {
  assert.equal(args[1], 'view');
  assert.equal(args[args.indexOf('-R') + 1], 'example/repo');
  const job = args[args.indexOf('--job') + 1];
  if (!(job in fixture.logs)) throw new Error('Unexpected job log: ' + job);
  console.log(fixture.logs[job]);
} else {
  assert.equal(args[0], 'api');
  assert.equal(args[args.indexOf('--method') + 1], 'GET');
  const endpoint = args.at(-1).replace(/^repos\\/example\\/repo/, '');
  if (endpoint.startsWith('/actions/workflows/')) console.log(JSON.stringify({ workflow_runs: fixture.runs }));
  else if (endpoint.startsWith('/contents/')) console.log(fixture.workflow);
  else {
    const jobs = endpoint.match(/^\\/actions\\/runs\\/(\\d+)\\/attempts\\/(\\d+)\\/jobs\\?/);
    const log = endpoint.match(/^\\/actions\\/jobs\\/(\\d+)\\/logs$/);
    if (jobs) {
      assert.equal(Number(jobs[2]), fixture.runs.find(run => run.id === Number(jobs[1])).run_attempt);
      console.log(JSON.stringify({ jobs: fixture.jobs[jobs[1]] }));
    } else if (log) console.log(fixture.logs[log[1]]);
    else throw new Error('Unexpected request: ' + endpoint);
  }
}
`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/ci-failure-census.mjs'), '--workflow', 'ci-tests.yml', '--limit', '3'], {
      encoding: 'utf8', env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /example\/repo: ci-tests.yml/);
    assert.match(result.stdout, /Scanned 3 runs; 3 failing runs; 4 failing steps\./);
    assert.match(result.stdout, /mcp-cli-api-contract \(cascade\)/);
    assert.match(result.stdout, /\| Test \| 2 \| 0 \|/);
    assert.match(result.stdout, /\| Publish result \| 1 \| 1 \|/);
    assert.match(result.stdout, /Unavailable job logs: 0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const run = (id, conclusion, created, updated, attempt = 1, extra = {}) => ({
  id, conclusion, created_at: created, updated_at: updated, run_attempt: attempt, head_branch: 'production', head_sha: `sha-${id}`, ...extra,
});

test('a red is classed by the strongest evidence it has', async () => {
  const { redClass } = await subject;
  assert.equal(redClass({ conclusion: 'startup_failure', kind: 'other', rerunPassed: true, prGreen: true }), 'infra');
  assert.equal(redClass({ conclusion: 'failure', kind: 'infra', rerunPassed: true, prGreen: true }), 'infra');
  assert.equal(redClass({ conclusion: 'failure', kind: 'test', rerunPassed: true, prGreen: true }), 'flaky');
  assert.equal(redClass({ conclusion: 'failure', kind: 'test', rerunPassed: false, prGreen: true }), 'production-only');
  assert.equal(redClass({ conclusion: 'failure', kind: 'test', rerunPassed: false, prGreen: false, prSeen: true }), 'break');
  assert.equal(redClass({ conclusion: 'failure', kind: 'test', rerunPassed: false, prGreen: false }), 'unattributed');
});

test('red hours run from the first red until production goes green again', async () => {
  const { redWindows, hoursByWindow } = await subject;
  const runs = [
    run(1, 'success', '2026-10-20T01:00:00Z', '2026-10-20T01:30:00Z'),
    { ...run(2, 'failure', '2026-10-20T02:00:00Z', '2026-10-20T02:10:00Z'), class: 'break' },
    { ...run(3, 'failure', '2026-10-20T02:20:00Z', '2026-10-20T02:30:00Z'), class: 'infra' },
    run(4, 'success', '2026-10-20T03:00:00Z', '2026-10-20T03:30:00Z'),
  ];
  assert.deepEqual(redWindows(runs), [
    { class: 'break', start: Date.parse('2026-10-20T02:00:00Z'), end: Date.parse('2026-10-20T03:30:00Z') },
    { class: 'infra', start: Date.parse('2026-10-20T02:20:00Z'), end: Date.parse('2026-10-20T03:30:00Z') },
  ]);
  const hours = hoursByWindow(redWindows(runs));
  assert.deepEqual(hours.byDay, [{ day: '2026-10-20', hours: 1.5 }]);
  assert.deepEqual(hours.byClass.map(row => [row.class, Math.round(row.hours * 100) / 100]), [['break', 1.5]]);
});

test('overlapping red windows are counted once', async () => {
  const { redWindows, hoursByWindow } = await subject;
  const runs = [
    { ...run(1, 'failure', '2026-10-22T00:00:00Z', '2026-10-22T00:10:00Z'), class: 'production-only' },
    run(2, 'success', '2026-10-22T01:00:00Z', '2026-10-22T03:00:00Z'),
    { ...run(3, 'failure', '2026-10-22T02:00:00Z', '2026-10-22T02:10:00Z'), class: 'break' },
    run(4, 'success', '2026-10-22T03:30:00Z', '2026-10-22T05:00:00Z'),
  ];
  assert.deepEqual(redWindows(runs), [
    { class: 'production-only', start: Date.parse('2026-10-22T00:00:00Z'), end: Date.parse('2026-10-22T03:00:00Z') },
    { class: 'break', start: Date.parse('2026-10-22T02:00:00Z'), end: Date.parse('2026-10-22T03:00:00Z') },
  ]);
  assert.deepEqual(hoursByWindow(redWindows(runs)).byClass, [{ class: 'production-only', hours: 3 }]);
});

test('a rerun that went green counts as flaky red time on its own', async () => {
  const { redWindows, hoursByWindow, formatClasses } = await subject;
  const runs = [
    { ...run(1, 'failure', '2026-10-21T02:00:00Z', '2026-10-21T02:20:00Z', 2), class: 'flaky' },
    run(2, 'success', '2026-10-21T02:40:00Z', '2026-10-21T03:00:00Z', 2, { recovered: true }),
  ];
  assert.deepEqual(redWindows(runs), [
    { class: 'flaky', start: Date.parse('2026-10-21T02:00:00Z'), end: Date.parse('2026-10-21T03:00:00Z') },
    { class: 'flaky', start: Date.parse('2026-10-21T02:40:00Z'), end: Date.parse('2026-10-21T03:00:00Z') },
  ]);
  assert.deepEqual(hoursByWindow(redWindows(runs)).byClass, [{ class: 'flaky', hours: 1 }]);
  const report = formatClasses({
    workflow: 'ci-tests.yml',
    branch: 'production',
    since: '2026-10-21',
    runs,
    evidence: [{ run: runs[0], job: 'ci-tests', step: 'Test', evidenceLine: 'not ok 3 - expected comment', class: 'flaky' }],
  });
  assert.match(report, /2 runs, 1 red, 1 red then green on rerun\./);
  assert.match(report, /\| flaky \| 1 \| 100% \|/);
  assert.match(report, /not ok 3 - expected comment/);
});

test('class mode needs a since day and the census usage still documents itself', () => {
  const script = path.join(__dirname, '../scripts/ci-failure-census.mjs');
  const missing = spawnSync(process.execPath, [script, '--classes'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--classes needs --since YYYY-MM-DD/);
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /--classes --since YYYY-MM-DD/);
});

test('touching outages keep their own class', async () => {
  const { redWindows, hoursByWindow } = await subject;
  const runs = [
    { ...run(1, 'failure', '2026-10-23T00:00:00Z', '2026-10-23T00:10:00Z'), class: 'infra' },
    run(2, 'success', '2026-10-23T00:10:00Z', '2026-10-23T01:00:00Z'),
    { ...run(3, 'failure', '2026-10-23T01:00:00Z', '2026-10-23T01:10:00Z'), class: 'production-only' },
    run(4, 'success', '2026-10-23T01:10:00Z', '2026-10-23T02:00:00Z'),
  ];
  assert.deepEqual(hoursByWindow(redWindows(runs)).byClass, [
    { class: 'infra', hours: 1 },
    { class: 'production-only', hours: 1 },
  ]);
});
