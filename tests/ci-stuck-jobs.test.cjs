const assert = require('node:assert/strict');
const test = require('node:test');
const { decide, apply, plan } = require('../.github/scripts/ci-stuck-jobs.cjs');

const now = Date.parse('2026-11-01T09:00:00Z');
const step = (name, finished) => ({ name, conclusion: 'success', completed_at: finished });
const job = (name, status, steps, conclusion = null) => ({ name, status, conclusion, steps });

const finishedAt = '2026-11-01T08:00:56Z';
const justNow = '2026-11-01T08:59:30Z';

const stuckRun = { id: 41286623269, name: 'CI Tests', event: 'pull_request', status: 'in_progress', conclusion: null, run_attempt: 1, display_title: 'HYCI-44 keep ledgers' };

test('finished jobs that only miss their completion report are cancelled on a pull-request run', () => {
  const jobs = ['test-shard (4)', 'test-shard (1)', 'browser-smoke-mobile'].map(name => job(name, 'in_progress', [step('Test shard', finishedAt), step('Complete job', finishedAt)]));
  const decision = decide(stuckRun, jobs, { now });
  assert.equal(decision.action, 'cancel');
  assert.deepEqual(decision.stuck.map(entry => entry.name), ['test-shard (4)', 'test-shard (1)', 'browser-smoke-mobile']);
  assert.equal(decision.stuck[0].idle, 3544);
});

test('a job still running a step is left alone', () => {
  const jobs = [job('test-shard (1)', 'in_progress', [step('Test shard', finishedAt), { name: 'Upload', conclusion: null, completed_at: null }])];
  assert.equal(decide(stuckRun, jobs, { now }), null);
});

test('a job that finished steps a moment ago is not yet stuck', () => {
  const jobs = [job('ci-tests', 'in_progress', [step('Summary', justNow)])];
  assert.equal(decide(stuckRun, jobs, { now }), null);
});

test('a production push run is reported and never cancelled', () => {
  const pushRun = { ...stuckRun, event: 'push' };
  const jobs = [job('browser-smoke-desktop', 'in_progress', [step('Complete job', finishedAt)])];
  const decision = decide(pushRun, jobs, { now });
  assert.equal(decision.action, 'report');
  assert.equal(decision.stuck.length, 1);
});

test('a cancelled run recovery did not cancel is never re-run', () => {
  const cancelledRun = { ...stuckRun, status: 'completed', conclusion: 'cancelled' };
  const jobs = [job('test-shard (1)', 'completed', [step('Test shard', finishedAt)], 'cancelled')];
  assert.equal(decide(cancelledRun, jobs, { now }), null);
});

test('a run holding a genuine failure is never cancelled and never retried', () => {
  const jobs = [
    job('test-shard (1)', 'in_progress', [step('Test shard', finishedAt)], null),
    job('tests', 'completed', [step('Test', '2026-11-01T07:40:00Z')], 'failure'),
  ];
  assert.equal(decide(stuckRun, jobs, { now }), null);
  assert.equal(decide({ ...stuckRun, event: 'push' }, jobs, { now }), null);
});

test('apply cancels and re-runs only the run it cancelled itself', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path.endsWith('/jobs?per_page=100')) return { jobs: [{ name: 'test-shard (1)', conclusion: 'cancelled' }] };
    return { status: 'completed' };
  };
  const done = await apply('o/r', [
    { runId: 7, action: 'cancel', stuck: [{ name: 'test-shard (1)' }] },
    { runId: 8, action: 'rerun', stuck: [] },
    { runId: 9, action: 'report', stuck: [{ name: 'browser-smoke' }] },
  ], { api });
  assert.deepEqual(calls, [
    'POST /repos/o/r/actions/runs/7/cancel',
    'GET /repos/o/r/actions/runs/7/jobs?per_page=100',
    'POST /repos/o/r/actions/runs/7/rerun-failed-jobs',
  ]);
  assert.deepEqual(done, [{ runId: 7, action: 'recover', rerun: true, jobs: ['test-shard (1)'] }]);
});

test('a run that finished clean before the cancel lands is not re-run', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path.endsWith('/jobs?per_page=100')) return { jobs: [{ name: 'test-shard (1)', conclusion: 'success' }] };
    return { status: 'completed' };
  };
  const done = await apply('o/r', [{ runId: 7, action: 'cancel', stuck: [{ name: 'test-shard (1)' }] }], { api });
  assert.deepEqual(calls, ['POST /repos/o/r/actions/runs/7/cancel', 'GET /repos/o/r/actions/runs/7/jobs?per_page=100']);
  assert.deepEqual(done, [{ runId: 7, action: 'cancel', rerun: false, reason: 'no job left cancelled' }]);
});

test('a cancel that never settles is reported and never retried', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    return { status: 'in_progress' };
  };
  const done = await apply('o/r', [{ runId: 7, action: 'cancel', stuck: [{ name: 'test-shard (1)' }] }], { api, settle: async () => false });
  assert.deepEqual(calls, ['POST /repos/o/r/actions/runs/7/cancel']);
  assert.deepEqual(done, [{ runId: 7, action: 'cancel', rerun: false, reason: 'cancel did not settle' }]);
});

test('a completed green run and a second attempt are ignored', () => {
  const jobs = [job('test-shard (1)', 'in_progress', [step('Test shard', finishedAt)])];
  assert.equal(decide({ ...stuckRun, status: 'completed', conclusion: 'success' }, jobs, { now }), null);
  assert.equal(decide({ ...stuckRun, run_attempt: 2 }, jobs, { now }), null);
});

test('an old run is history and costs no job request', async () => {
  const stale = { ...stuckRun, updated_at: '2026-11-01T08:10:00Z' };
  let fetched = 0;
  const decisions = await plan('o/r', {
    now,
    runs: [stale, { ...stuckRun, run_attempt: 2, id: 5 }, { ...stuckRun, status: 'completed', conclusion: 'cancelled', id: 6 }],
    jobsFor: () => {
      fetched += 1;
      return [];
    },
  });
  assert.deepEqual(decisions, []);
  assert.equal(fetched, 0);
});

test('an empty job list is ignored instead of cancelling blind', () => {
  assert.equal(decide(stuckRun, [], { now }), null);
  assert.equal(decide(stuckRun, [job('queued', 'queued', [])], { now }), null);
});
