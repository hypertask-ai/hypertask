const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  decide, apply, plan, resume, recover, sweep, tick, handOff, sweepInFlight, readPending, sweepOnce,
  STUCK_SECONDS, TICK_GAP_MS, TICKS_PER_LINK, CAP_BUDGET_MS, SETTLE_ATTEMPTS, SETTLE_DELAY_MS, PENDING_LIMIT,
} = require('../.github/scripts/ci-stuck-jobs.cjs');

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
  assert.deepEqual(decisions, { decisions: [], unread: [] });
  assert.equal(fetched, 0);
});

test('an empty job list is ignored instead of cancelling blind', () => {
  assert.equal(decide(stuckRun, [], { now }), null);
  assert.equal(decide(stuckRun, [job('queued', 'queued', [])], { now }), null);
});

const found = { runId: 7, attempt: 1, cancelledAt: '2026-11-01T08:50:00Z', tries: 1, issued: true, confirmed: true };
const record = async () => true;

test('the recovery is written before the cancel is issued and confirmed after it', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    return { status: 'in_progress' };
  };
  const written = [];
  const outcome = await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api, settle: async () => false, now, save: async (list) => { calls.push('save'); written.push(list); return true; },
  });
  assert.deepEqual(calls, [
    'GET /repos/o/r/actions/runs/7',
    'save',
    'POST /repos/o/r/actions/runs/7/cancel',
    'save',
  ]);
  assert.equal(written[0][0].issued, true);
  assert.equal(written[0][0].confirmed, false);
  assert.equal(written.at(-1)[0].confirmed, true);
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
  assert.deepEqual(outcome.pending, [{ runId: 7, attempt: 1, cancelledAt: new Date(now).toISOString(), tries: 0, issued: true, confirmed: true }]);
  assert.deepEqual(written.at(-1), outcome.pending);
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

test('a full store refuses a new cancel instead of dropping a stored recovery', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    return { status: 'in_progress' };
  };
  const full = Array.from({ length: PENDING_LIMIT }, (_, index) => ({ runId: 100 + index, attempt: 1, cancelledAt: new Date(now).toISOString(), tries: 0, issued: true, confirmed: true }));
  const outcome = await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api, now, pending: full, save: record,
  });
  assert.deepEqual(outcome.pending.map(entry => entry.runId), full.map(entry => entry.runId));
  assert.deepEqual(outcome.done.filter(entry => entry.action === 'skip'), [
    { runId: 7, action: 'skip', rerun: false, reason: 'recovery store is full' },
  ]);
  assert.equal(calls.filter(call => call.endsWith('/cancel')).length, 0);
});

test('a reservation the store refuses is a cancel that never happens', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    return { status: 'in_progress' };
  };
  const outcome = await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api, now, save: async () => false,
  });
  assert.deepEqual(outcome.done, [{ runId: 7, action: 'skip', rerun: false, reason: 'recovery storage refused the reservation' }]);
  assert.deepEqual(calls, ['GET /repos/o/r/actions/runs/7']);
  assert.equal(outcome.saved, false);
  assert.deepEqual(outcome.pending, []);
});

test('a cancel GitHub refuses drops its reservation', async () => {
  const api = async (path, method = 'GET') => {
    if (method === 'POST') throw new Error('gh api failed: HTTP 403');
    return { status: 'in_progress' };
  };
  const written = [];
  const outcome = await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api, now, save: async (list) => { written.push(list); return true; },
  });
  assert.deepEqual(outcome.pending, []);
  assert.equal(outcome.done.at(-1).reason.startsWith('cancel request failed'), true);
  assert.deepEqual(written.at(-1), []);
});

test('a cancel whose answer never came back keeps its reservation for the next sweep', async () => {
  const api = async (path, method = 'GET') => {
    if (method === 'POST') throw new Error('gh api failed: HTTP 502');
    return { status: 'in_progress' };
  };
  const outcome = await recover('o/r', [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], {
    api, now, save: record,
  });
  assert.equal(outcome.done.at(-1).definitive, false);
  assert.deepEqual(outcome.pending, [{ runId: 7, attempt: 1, cancelledAt: new Date(now).toISOString(), tries: 0, issued: true, confirmed: false }]);
});

test('a reservation this sweep never issued is never re-run', async () => {
  let reads = 0;
  const outcome = await resume('o/r', { ...found, issued: false, confirmed: false }, { api: async () => { reads += 1; return {}; }, now });
  assert.deepEqual(outcome, { runId: 7, action: 'drop', reason: 'the cancel never reached GitHub' });
  assert.equal(reads, 0);
});

test('stored recoveries are finished before anything is discovered', async () => {
  const order = [];
  const api = async (path, method = 'GET') => {
    order.push(`${method} ${path}`);
    if (path === '/repos/o/r/actions/runs/7') return { status: 'completed' };
    if (path.endsWith('/jobs?per_page=100')) return { jobs: [{ name: 'test-shard (1)', conclusion: 'cancelled' }] };
    return {};
  };
  const result = await sweep('o/r', {
    now,
    read: async () => ({ ok: true, pending: [found] }),
    discover: async () => {
      order.push('discover');
      return { decisions: [], unread: [] };
    },
    save: record,
    api,
  });
  assert.deepEqual(order, [
    'GET /repos/o/r/actions/runs/7',
    'GET /repos/o/r/actions/runs/7/jobs?per_page=100',
    'POST /repos/o/r/actions/runs/7/rerun-failed-jobs',
    'discover',
  ]);
  assert.deepEqual(result.recovery.pending, []);
});

test('a candidate whose job list fails does not stop the other candidates', async () => {
  const runs = [
    { ...stuckRun, id: 11, updated_at: new Date(now).toISOString() },
    { ...stuckRun, id: 12, updated_at: new Date(now).toISOString() },
  ];
  const result = await plan('o/r', {
    now, runs,
    jobsFor: (id) => {
      if (id === 11) throw new Error('gh api failed: HTTP 502');
      return [job('test-shard (1)', 'in_progress', [step('Test shard', finishedAt)])];
    },
  });
  assert.deepEqual(result.decisions.map(decision => decision.runId), [12]);
  assert.deepEqual(result.unread, [{ runId: 11, reason: 'gh api failed: HTTP 502' }]);
});

test('a run list that cannot be read still finishes the stored recoveries', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path === '/repos/o/r/actions/runs/7') return { status: 'completed' };
    if (path.endsWith('/jobs?per_page=100')) return { jobs: [{ name: 'test-shard (1)', conclusion: 'cancelled' }] };
    return {};
  };
  const result = await sweep('o/r', {
    now,
    read: async () => ({ ok: true, pending: [found] }),
    discover: async () => { throw new Error('gh api failed: HTTP 502'); },
    save: record,
    api,
  });
  assert.equal(result.discovery, 'gh api failed: HTTP 502');
  assert.deepEqual(result.recovery.done, [{ runId: 7, action: 'recover', rerun: true, jobs: ['test-shard (1)'] }]);
  assert.deepEqual(calls, [
    'GET /repos/o/r/actions/runs/7',
    'GET /repos/o/r/actions/runs/7/jobs?per_page=100',
    'POST /repos/o/r/actions/runs/7/rerun-failed-jobs',
  ]);
});

test('a store the sweep cannot read cancels nothing but still reports the store', async () => {
  const result = await sweep('o/r', {
    now,
    read: async () => ({ ok: false, pending: [] }),
    discover: async () => ({ decisions: [{ runId: 7, action: 'cancel', attempt: 1, stuck: [{ name: 'test-shard (1)' }] }], unread: [] }),
    save: record,
    api: async () => { throw new Error('gh api failed: must not be called'); },
  });
  assert.equal(result.stored.ok, false);
  assert.deepEqual(result.recovery.done, [{ runId: 7, action: 'skip', rerun: false, reason: 'recovery storage is unreadable' }]);
});

test('a cancel with no answer from GitHub is never re-run on its own', async () => {
  let calls = 0;
  const outcome = await resume('o/r', { ...found, confirmed: false }, { api: async () => { calls += 1; return {}; }, now });
  assert.deepEqual(outcome, { runId: 7, action: 'report', reason: 'the cancel outcome is unknown', keep: true });
  assert.equal(calls, 0);
});

test('a cancel with no answer is reported until it leaves the recovery window', async () => {
  const uncertain = { runId: 7, attempt: 1, cancelledAt: '2026-11-01T08:50:00Z', tries: 1, issued: true, confirmed: false };
  const written = [];
  const outcome = await recover('o/r', [], { api: async () => { throw new Error('must not be called'); }, now, pending: [uncertain], save: async (list) => { written.push(list); return true; } });
  assert.deepEqual(outcome.done, [{ runId: 7, action: 'report', reason: 'the cancel outcome is unknown', keep: true }]);
  assert.deepEqual(outcome.pending, [{ ...uncertain, tries: 2 }]);
  assert.deepEqual(written.at(-1), [{ ...uncertain, tries: 2 }]);
});

test('the rule is forty-five seconds and both sides of it are pinned', () => {
  const at = (iso) => job('test-shard (1)', 'in_progress', [step('Test shard', iso)]);
  assert.equal(STUCK_SECONDS, 45);
  assert.equal(decide(stuckRun, [at('2026-11-01T08:59:16Z')], { now }), null);
  const decision = decide(stuckRun, [at('2026-11-01T08:59:15Z')], { now });
  assert.equal(decision.action, 'cancel');
  assert.equal(decision.stuck[0].idle, 45);
  assert.equal(decide(stuckRun, [at('2026-11-01T08:59:14Z')], { now }).stuck[0].idle, 46);
});

test('a link that used its ticks dispatches the next one', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (path.includes('/workflows/stuck-job-recovery.yml/runs')) return { workflow_runs: [{ id: 5, status: 'completed' }] };
    return {};
  };
  const outcome = await handOff('o/r', { api, ownRunId: '5' });
  assert.deepEqual(outcome, { dispatched: true, ref: 'production' });
  assert.deepEqual(calls, [
    'GET /repos/o/r/actions/workflows/stuck-job-recovery.yml/runs?per_page=30',
    'POST /repos/o/r/actions/workflows/stuck-job-recovery.yml/dispatches',
  ]);
});

test('one link sweeps eight ticks and waits the gap between them', async () => {
  const waits = [];
  let sweeps = 0;
  const done = await tick('o/r', {
    sweeps: TICKS_PER_LINK,
    gapMs: TICK_GAP_MS,
    once: async () => {
      sweeps += 1;
      return { swept: sweeps };
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(TICKS_PER_LINK, 8);
  assert.equal(sweeps, TICKS_PER_LINK - 1);
  assert.deepEqual(done.map(entry => entry.swept), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(waits, Array(TICKS_PER_LINK - 1).fill(TICK_GAP_MS));
  assert.equal(TICK_GAP_MS, 30000);
});

test('a tick that throws does not stop the rest of the link', async () => {
  let calls = 0;
  const done = await tick('o/r', {
    sweeps: 3,
    once: async () => {
      calls += 1;
      if (calls === 1) throw new Error('gh api timed out');
      return { swept: calls };
    },
    sleep: async () => {},
  });
  assert.equal(calls, 2);
  assert.match(done[0].error, /timed out/);
  assert.deepEqual(done[1], { swept: 2 });
});

test('a link catches a job that goes idle between two ticks, not on the next link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hyci73-'));
  const fixture = join(dir, 'stuck.json');
  const idleAtLinkStartMs = 30 * 1000;
  const jobs = [job('test-shard (1)', 'in_progress', [step('Test shard', new Date(now - idleAtLinkStartMs).toISOString())])];
  writeFileSync(fixture, JSON.stringify({ repo: 'o/r', runs: [stuckRun], jobs: { [stuckRun.id]: jobs } }));
  let clock = now;
  const once = () => sweepOnce('o/r', {
    live: false,
    fixture,
    options: { stuckSeconds: STUCK_SECONDS, now: () => clock },
    quiet: true,
  });
  const first = await once();
  const later = await tick('o/r', { sweeps: 2, gapMs: TICK_GAP_MS, once, sleep: async ms => { clock += ms; } });
  assert.ok(idleAtLinkStartMs / 1000 < STUCK_SECONDS);
  assert.ok((idleAtLinkStartMs + TICK_GAP_MS) / 1000 > STUCK_SECONDS);
  assert.equal(first.decisions.length, 0);
  assert.equal(later.length, 1);
  assert.equal(later[0].decisions[0].action, 'cancel');
  assert.equal(later[0].decisions[0].stuck[0].idle, (idleAtLinkStartMs + TICK_GAP_MS) / 1000);
});

test('a sweep never starts a second chain while a link is still running', async () => {
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    return { workflow_runs: [{ id: 9, status: 'in_progress' }, { id: 5, status: 'completed' }] };
  };
  const outcome = await handOff('o/r', { api, ownRunId: '5', tries: 3, sleep: async () => {} });
  assert.deepEqual(outcome, { dispatched: false, reason: 'another sweep is still in_progress after 3 tries' });
  assert.equal(calls.filter(call => call.startsWith('POST')).length, 0);
  assert.equal(calls.filter(call => call.startsWith('GET')).length, 3);
});

test('a hand-off waits out a link that stands down instead of losing the chain', async () => {
  let listing = 1;
  const calls = [];
  const api = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`);
    if (method === 'POST') return {};
    listing += 1;
    return { workflow_runs: listing <= 3 ? [{ id: 9, status: 'queued' }] : [] };
  };
  const waits = [];
  const outcome = await handOff('o/r', { api, ownRunId: '5', tries: 4, gapMs: 30000, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(outcome, { dispatched: true, ref: 'production' });
  assert.deepEqual(waits, [30000, 30000]);
});

test('a sweep gives way to a link that is already on its way', async () => {
  const queued = await sweepInFlight('o/r', { api: async () => ({ workflow_runs: [{ id: 4, status: 'queued' }] }), ownRunId: '5' });
  assert.deepEqual(queued, { id: 4, status: 'queued' });
  const own = await sweepInFlight('o/r', { api: async () => ({ workflow_runs: [{ id: 5, status: 'in_progress' }] }), ownRunId: '5' });
  assert.equal(own, null);
});

test('a chain that cannot read the run list dispatches nothing', async () => {
  const outcome = await handOff('o/r', { api: async () => { throw new Error('gh api failed: HTTP 500'); }, ownRunId: '5' });
  assert.equal(outcome.dispatched, false);
  assert.match(outcome.reason, /run list could not be read/);
});

test('a chain whose dispatch fails says so instead of claiming a tick', async () => {
  const api = async (path, method = 'GET') => {
    if (method === 'POST') throw new Error('gh api failed: HTTP 422');
    return { workflow_runs: [] };
  };
  const outcome = await handOff('o/r', { api, ownRunId: '5' });
  assert.equal(outcome.dispatched, false);
  assert.match(outcome.reason, /not dispatched/);
});

test('live runs are read with a status filter, so a sweep costs one run-list request', async () => {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    return { workflow_runs: [stuckRun] };
  };
  const decisions = await plan('o/r', { now, api, jobsFor: () => [] });
  assert.deepEqual(decisions, { decisions: [], unread: [] });
  assert.deepEqual(calls, ['/repos/o/r/actions/runs?status=in_progress&per_page=100&page=1']);
});

const SWEEP_COST_MS = 15000;
const RERUN_COST_MS = 1000;
const realStuckLastSteps = [
  '2026-11-01T08:01:21Z', '2026-11-01T08:02:23Z', '2026-11-01T08:02:03Z',
  '2026-11-01T08:00:56Z', '2026-11-01T08:00:14Z', '2026-11-01T08:00:44Z',
  '2026-11-01T08:01:09Z', '2026-11-01T08:02:30Z', '2026-11-01T08:02:36Z',
];

function worstIdle(lastStep, ruleSeconds, periodMs, settleMs) {
  let worst = 0;
  for (let phase = 0; phase < periodMs; phase += 1000) {
    const firstTick = phase + Math.ceil((lastStep + ruleSeconds * 1000 - phase) / periodMs) * periodMs;
    const idle = firstTick - lastStep + settleMs + RERUN_COST_MS;
    if (idle > worst) worst = idle;
  }
  return worst;
}

function measuredIdle(settleMs) {
  return Math.max(...realStuckLastSteps.map(iso => worstIdle(Date.parse(iso), STUCK_SECONDS, TICK_GAP_MS + SWEEP_COST_MS, settleMs)));
}

test('the cap ends a stuck push within two minutes', () => {
  assert.equal(CAP_BUDGET_MS, 120000);
  const worstSettle = SETTLE_ATTEMPTS * SETTLE_DELAY_MS;
  const worst = measuredIdle(worstSettle);
  assert.ok(worst < CAP_BUDGET_MS, `worst idle ${worst} ms must be under ${CAP_BUDGET_MS} ms`);
  assert.ok(STUCK_SECONDS * 1000 + TICK_GAP_MS + SWEEP_COST_MS + worstSettle + RERUN_COST_MS <= CAP_BUDGET_MS);
  assert.ok(measuredIdle(2 * SETTLE_DELAY_MS) < measuredIdle(worstSettle));
});

test('the nine real stuck jobs of run 41286623269 paid minutes and now pay seconds', () => {
  const oldWorst = Math.max(120000, Math.max(...realStuckLastSteps.map(iso => worstIdle(Date.parse(iso), 180, 211000, 5000))));
  const newWorst = measuredIdle(2 * SETTLE_DELAY_MS);
  assert.equal(realStuckLastSteps.length, 9);
  assert.ok(oldWorst > 180000, `the old cadence paid ${oldWorst} ms`);
  assert.ok(newWorst < CAP_BUDGET_MS, `the new cadence pays ${newWorst} ms`);
});
