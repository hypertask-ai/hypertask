const assert = require('node:assert/strict');
const test = require('node:test');
const { decide, apply, plan, resume, recover, readPending } = require('../.github/scripts/ci-stuck-jobs.cjs');

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

test('a red test step inside a job that never reported its end is never recovered', () => {
  const jobs = [job('test-shard (1)', 'in_progress', [
    { name: 'Test shard', conclusion: 'failure', completed_at: finishedAt },
  ])];
  assert.equal(decide(stuckRun, jobs, { now }), null);
  assert.equal(decide({ ...stuckRun, event: 'push' }, jobs, { now }), null);
});

test('apply refuses a rerun when a genuine failure appears while the cancel settles', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path.endsWith('/jobs?per_page=100')) {
      return { jobs: [{ name: 'test-shard (1)', conclusion: 'cancelled' }, { name: 'tests', conclusion: 'failure' }] };
    }
    return { status: 'completed' };
  };
  const done = await apply('o/r', [{ runId: 7, action: 'cancel', stuck: [{ name: 'test-shard (1)' }] }], { api });
  assert.deepEqual(calls, [
    'POST /repos/o/r/actions/runs/7/cancel',
    'GET /repos/o/r/actions/runs/7',
    'GET /repos/o/r/actions/runs/7/jobs?per_page=100',
  ]);
  assert.deepEqual(done, [{ runId: 7, action: 'cancel', rerun: false, reason: 'a genuine failure appeared' }]);
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
    'GET /repos/o/r/actions/runs/7',
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
  assert.deepEqual(calls, [
    'POST /repos/o/r/actions/runs/7/cancel',
    'GET /repos/o/r/actions/runs/7',
    'GET /repos/o/r/actions/runs/7/jobs?per_page=100',
  ]);
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

const found = { runId: 7, attempt: 1, cancelledAt: '2026-11-01T08:50:00Z', tries: 1 };
const record = async () => true;

test('the recovery is stored the moment the cancel lands, before the run is read again', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    return { status: 'in_progress' };
  };
  const written = [];
  const outcome = await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api, settle: async () => false, now, save: async (list) => { calls.push('save'); written.push(list); return true; },
  });
  assert.deepEqual(calls, ['GET /repos/o/r/actions/runs/7', 'POST /repos/o/r/actions/runs/7/cancel', 'save']);
  assert.deepEqual(written, [[{ runId: 7, attempt: 1, cancelledAt: new Date(now).toISOString(), tries: 0 }]]);
  assert.deepEqual(outcome.done, [{ runId: 7, action: 'cancel', rerun: false, reason: 'cancel did not settle' }]);
  assert.equal(outcome.saved, true);
});

test('a cancel that does not settle is carried into the next sweep that finishes it', async () => {
  const calls = [];
  const state = { settled: false };
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path === '/repos/o/r/actions/runs/7') return { status: state.settled ? 'completed' : 'in_progress' };
    if (path.endsWith('/jobs?per_page=100')) return { jobs: [{ name: 'test-shard (1)', conclusion: 'cancelled' }] };
    return {};
  };
  const written = [];
  const outcome = await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api, settle: async () => false, now, save: async (list) => { written.push(list); return true; },
  });
  assert.deepEqual(outcome.done, [{ runId: 7, action: 'cancel', rerun: false, reason: 'cancel did not settle' }]);
  assert.deepEqual(outcome.pending, [{ runId: 7, attempt: 1, cancelledAt: new Date(now).toISOString(), tries: 0 }]);
  assert.deepEqual(written, [outcome.pending]);
  state.settled = true;
  const next = await resume('o/r', outcome.pending[0], { api, now: now + 60000 });
  assert.deepEqual(next, { runId: 7, action: 'recover', rerun: true, jobs: ['test-shard (1)'] });
  assert.deepEqual(calls.slice(-3), [
    'GET /repos/o/r/actions/runs/7',
    'GET /repos/o/r/actions/runs/7/jobs?per_page=100',
    'POST /repos/o/r/actions/runs/7/rerun-failed-jobs',
  ]);
});

test('a run already waiting for its recovery is never cancelled a second time', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path === '/repos/o/r/actions/runs/7') return { status: 'in_progress' };
    return {};
  };
  await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api, now, pending: [found], save: record,
  });
  assert.deepEqual(calls, ['GET /repos/o/r/actions/runs/7']);
});

test('a decision is refused when the run moved on to a newer attempt', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path === '/repos/o/r/actions/runs/8') return { status: 'in_progress', run_attempt: 2 };
    return {};
  };
  const outcome = await recover('o/r', [{ runId: 8, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard' }] }], {
    api, now, save: record,
  });
  assert.deepEqual(calls, ['GET /repos/o/r/actions/runs/8']);
  assert.deepEqual(outcome.done, [{ runId: 8, action: 'skip', rerun: false, reason: 'no longer a first attempt in progress' }]);
  assert.deepEqual(outcome.pending, []);
});

test('a run this sweep did not cancel is never carried', async () => {
  const written = [];
  const outcome = await recover('o/r', [{ runId: 9, action: 'report', stuck: [{ name: 'browser-smoke' }] }], {
    api: async () => ({}), now, save: async (list) => { written.push(list); return true; },
  });
  assert.deepEqual(outcome.done, []);
  assert.deepEqual(outcome.pending, []);
  assert.deepEqual(written, []);
});

test('an unreadable store is reported, never overwritten', async () => {
  const denied = await readPending('o/r', async () => { throw new Error('gh api failed: HTTP 403'); });
  assert.deepEqual(denied, { ok: false, pending: [] });
  const missing = await readPending('o/r', async () => { throw new Error('gh api failed: Not Found (HTTP 404)'); });
  assert.deepEqual(missing, { ok: true, pending: [] });
  const parsed = await readPending('o/r', async () => ({ value: '[{"runId":7,"cancelledAt":"2026-11-01T08:50:00Z"}]' }));
  assert.deepEqual(parsed.pending, [{ runId: 7, cancelledAt: '2026-11-01T08:50:00Z' }]);
  assert.deepEqual((await readPending('o/r', async () => ({ value: 'not json' }))).pending, []);
});

test('a carried recovery stops after three sweeps and says so', async () => {
  let reads = 0;
  const api = async () => { reads += 1; return { status: 'completed' }; };
  const outcome = await resume('o/r', { ...found, tries: 3 }, { api, now });
  assert.deepEqual(outcome, { runId: 7, action: 'drop', reason: 'still not re-run after 3 sweeps' });
  assert.equal(reads, 0);
});

test('a carried recovery older than the window costs no request', async () => {
  let reads = 0;
  const api = async () => { reads += 1; return {}; };
  const outcome = await resume('o/r', found, { api, now: Date.parse('2026-11-01T18:00:00Z') });
  assert.deepEqual(outcome, { runId: 7, action: 'drop', reason: 'older than the recovery window' });
  assert.equal(reads, 0);
});

test('a carried recovery for a newer attempt is dropped, never re-run', async () => {
  const outcome = await resume('o/r', found, { api: async () => ({ status: 'completed', run_attempt: 2 }), now });
  assert.deepEqual(outcome, { runId: 7, action: 'drop', reason: 'a newer attempt replaced it' });
});

test('a carried run holding a genuine failure is dropped, never re-run', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path === '/repos/o/r/actions/runs/7') return { status: 'completed' };
    return { jobs: [{ name: 'tests', conclusion: 'failure' }, { name: 'test-shard (1)', conclusion: 'cancelled' }] };
  };
  const outcome = await resume('o/r', found, { api, now });
  assert.deepEqual(outcome, { runId: 7, action: 'drop', reason: 'a genuine failure appeared' });
  assert.deepEqual(calls, ['GET /repos/o/r/actions/runs/7', 'GET /repos/o/r/actions/runs/7/jobs?per_page=100']);
});

test('a carried run still settling is kept for the sweep after', async () => {
  const outcome = await resume('o/r', found, { api: async () => ({ status: 'in_progress' }), now });
  assert.equal(outcome.keep, true);
  assert.equal(outcome.action, 'wait');
});

test('a carried re-run that fails again stays carried with one more try', async () => {
  const api = async (path) => {
    if (path === '/repos/o/r/actions/runs/7') return { status: 'completed' };
    if (path.endsWith('/rerun-failed-jobs')) throw new Error('gh api failed');
    return { jobs: [{ name: 'test-shard (1)', conclusion: 'cancelled' }] };
  };
  const written = [];
  const outcome = await recover('o/r', [], { api, now, pending: [found], save: async (list) => { written.push(list); return true; } });
  assert.deepEqual(outcome.pending, [{ ...found, tries: 2 }]);
  assert.deepEqual(written.at(-1), [{ ...found, tries: 2 }]);
});

test('nothing is cancelled while the recovery store cannot be read', async () => {
  const calls = [];
  const outcome = await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api: async (path) => { calls.push(path); return { status: 'in_progress' }; }, now,
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(outcome.done, [{ runId: 7, action: 'skip', rerun: false, reason: 'recovery storage is unreadable' }]);
  assert.equal(outcome.refused, 1);
});

test('a stored entry whose request fails is kept for the next sweep', async () => {
  const written = [];
  const outcome = await recover('o/r', [], {
    api: async () => { throw new Error('gh api failed: HTTP 502'); }, now, pending: [found], save: async (list) => { written.push(list); return true; },
  });
  assert.deepEqual(outcome.done, [{ runId: 7, action: 'wait', reason: 'gh api failed: HTTP 502', keep: true }]);
  assert.deepEqual(outcome.pending, [{ ...found, tries: 2 }]);
  assert.deepEqual(written.at(-1), [{ ...found, tries: 2 }]);
});
