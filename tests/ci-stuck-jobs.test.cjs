const assert = require('node:assert/strict');
const test = require('node:test');
const { decide } = require('../.github/scripts/ci-stuck-jobs.cjs');

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

test('a cancelled run re-runs only the jobs cut off after their steps succeeded', () => {
  const cancelledRun = { ...stuckRun, status: 'completed', conclusion: 'cancelled' };
  const jobs = [
    job('test-shard (1)', 'completed', [step('Test shard', finishedAt)], 'cancelled'),
    job('ci-tests', 'completed', [step('Summary', finishedAt)], 'success'),
  ];
  const decision = decide(cancelledRun, jobs, { now });
  assert.equal(decision.action, 'rerun');
  assert.deepEqual(decision.stuck.map(entry => entry.name), ['test-shard (1)']);
});

test('a completed green run and a second attempt are ignored', () => {
  const jobs = [job('test-shard (1)', 'in_progress', [step('Test shard', finishedAt)])];
  assert.equal(decide({ ...stuckRun, status: 'completed', conclusion: 'success' }, jobs, { now }), null);
  assert.equal(decide({ ...stuckRun, run_attempt: 2 }, jobs, { now }), null);
});

test('an old cancelled run is history and is never re-run', () => {
  const jobs = [job('test-shard (1)', 'completed', [step('Test shard', finishedAt)], 'cancelled')];
  const stale = { ...stuckRun, status: 'completed', conclusion: 'cancelled', updated_at: '2026-11-01T08:10:00Z' };
  assert.equal(decide(stale, jobs, { now }), null);
});

test('an empty job list is ignored instead of cancelling blind', () => {
  assert.equal(decide(stuckRun, [], { now }), null);
  assert.equal(decide(stuckRun, [job('queued', 'queued', [])], { now }), null);
});
