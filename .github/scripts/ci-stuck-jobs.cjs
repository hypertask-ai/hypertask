#!/usr/bin/env node
// HYCI-66: on 2026-11-01 nine jobs of one push finished every step and then sat
// still for exactly 3600 s before the job was marked complete, so one push took
// 68.0 minutes for 8.0 minutes of work. Run 41286623269 is the sample: jobs
// browser-smoke-mobile, browser-smoke-desktop, browser-smoke-flags, test-shard
// (1), (2) and (4) logged their last line at 08:00-08:05Z and the API recorded
// their completed_at 3601-3604 s later, while every other job in the same run
// closed in one to three seconds. Nothing in the runner log follows the last
// step, so the work is done and only the completion report is missing: the
// runner went away and the service held the job until its lease ran out.
//
// This cannot be un-stuck from inside a job, so the wait is capped instead.
// A job whose every step has completed and whose newest step is older than
// STUCK_SECONDS is not doing anything, so this sweep cancels that run and, once
// the cancellation settles, re-runs its failed jobs: the second attempt reports
// normally on a fresh runner. Provenance is the sweep's own cancel call, so a
// run that was cancelled by anything else (a person, a superseded push) is
// history and is never restarted. A run that holds a real failure is left alone
// as well, so no genuine red check is ever retried. Only pull-request runs are
// touched: a production push run verifies a deploy and is reported, never
// cancelled. Only runs touched in the last RECENT_MINUTES and first attempts
// are read at all, so an old run costs no request.
//
// HYCI-71: capping the wait is worth nothing if the sweep is not there to do it.
// GitHub drops most scheduled triggers on a repository this busy: in the 87
// hours from 2026-10-29T00:00Z it delivered 17 of the 349 runs
// feature-flag-gate asks for on a 15-minute cron, 16 of 87 for the hourly
// ux-signoff-gate, and 33 of about 1049 for prod-health's five-minute crons. A
// ten-minute sweep is therefore a sweep every few hours, and a job whose last
// step is older than RECENT_MINUTES is not read at all, so the cap almost never
// fired. Each sweep now waits and dispatches the next one, which is a real tick;
// a scheduled or pushed run only restarts a chain that died.
//
// HYCI-73: the three-minute rule on a three-minute tick still left 184-411 s of
// idle on the nine real stuck jobs, because the rule and the tick add up. Both
// are now short and the tick is cheap: the rule is STUCK_SECONDS, one chain link
// sweeps every TICK_GAP_MS for TICKS_PER_LINK ticks and then hands the tick on,
// so runner startup is paid once per eight ticks instead of once per tick, and
// discovery reads only in-progress runs in one request. Measured on the same nine
// jobs, 216 real finished jobs of 30 PR runs close 0-4 s after their last step
// (median 2 s), so a forty-five-second rule never touches a healthy job.
const { execFile } = require('node:child_process');
const { readFileSync } = require('node:fs');

const STUCK_SECONDS = 45;
const RECENT_MINUTES = 30;
// A cancel usually settles in one or two polls; a slower one is now carried by a
// tick that is TICK_GAP_MS away instead of a whole chain wait.
const SETTLE_ATTEMPTS = 10;
const SETTLE_DELAY_MS = 2000;
const PR_EVENT = 'pull_request';
const REPORT_ONLY = 'report';
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
// A cancel that does not settle, or a re-run that fails after it, used to leave
// the run cancelled for good: every later sweep reads in-progress runs only, so
// nothing re-ran it and the pull request kept a cancelled check for ever. The
// cancelled run id is written to a repository variable, and every later sweep
// finishes the recoveries its predecessor started. Only a run this sweep
// cancelled itself is ever recorded, so a run a person cancelled never enters it.
const PENDING_VARIABLE = 'STUCK_RECOVERY_PENDING';
const PENDING_LIMIT = 20;
const RECOVERY_ATTEMPTS = 3;
const PENDING_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const WORKFLOW_FILE = 'stuck-job-recovery.yml';
const CHAIN_REF = 'production';
// One link is one runner: it sweeps, sleeps TICK_GAP_MS, sweeps again, and after
// TICKS_PER_LINK ticks it dispatches the next link. A tick's period is therefore
// the gap plus one sweep (about fifteen seconds of API work), and runner startup
// is in the path once per link instead of once per tick.
const TICK_GAP_MS = 30 * 1000;
const TICKS_PER_LINK = 8;
const HANDOFF_TRIES = 4;
// What a stuck job pays before its second attempt starts: the rule, the wait for
// the next tick, one sweep, the cancel settling, and the re-run request. This is
// the number HYCI-73 holds under two minutes, and `decide` is only one term of it.
const CAP_BUDGET_MS = 120 * 1000;
const SETTLE_FAILED = 'cancel did not settle';
const RERUN_FAILED = 're-run request failed';
const JOBS_UNAVAILABLE = 'job list unavailable after the cancel';
const CANCEL_FAILED = 'cancel request failed';
const NOT_FIRST_ATTEMPT = 'no longer a first attempt in progress';
const NO_FAILURE_SEEN = 'a genuine failure appeared';
const NOT_CANCELLED = 'no job left cancelled';
const STORE_UNAVAILABLE = 'recovery storage is unreadable';
const STORE_FULL = 'recovery store is full';
const STORE_UNWRITABLE = 'recovery storage refused the reservation';
const UNISSUED = 'the cancel never reached GitHub';
const CANCEL_AMBIGUOUS = 'the cancel outcome is unknown';
// A cancel can land after the sweep that issued it gave up, so the recovery is
// kept until something settles it: a re-run, a real failure, no cancelled job
// left, or a newer attempt replacing the one this sweep cancelled.
// The only outcomes that leave a landed cancel still needing the next sweep.
const UNFINISHED = new Set([SETTLE_FAILED, JOBS_UNAVAILABLE, RERUN_FAILED]);

function stepEnd(step) {
  return step && step.completed_at ? Date.parse(step.completed_at) : null;
}

// A job in progress reports no conclusion yet, so a red test step shows only on
// the step itself until the completion report arrives. Both are a genuine
// failure and neither is ever recovered.
function holdsFailure(job) {
  if (FAILED.has(job.conclusion)) return true;
  return (job.steps ?? []).some(step => step.completed_at && FAILED.has(step.conclusion));
}

function finishedJob(job, now, stuckSeconds) {
  const steps = job.steps ?? [];
  if (!steps.length) return null;
  if (job.status !== 'in_progress') return null;
  const ends = steps.map(stepEnd);
  if (ends.some(end => end === null)) return null;
  const last = Math.max(...ends);
  if (!Number.isFinite(last)) return null;
  const idle = (now - last) / 1000;
  return idle >= stuckSeconds ? { name: job.name, idle: Math.round(idle), lastStepAt: new Date(last).toISOString() } : null;
}

function fresh(run, now, recentMinutes) {
  const touched = run.updated_at ? Date.parse(run.updated_at) : null;
  return touched === null || (now - touched) / 60000 <= recentMinutes;
}

function liveRun(run, now, recentMinutes) {
  if ((run.run_attempt ?? 1) !== 1) return false;
  if (run.status !== 'in_progress') return false;
  return fresh(run, now, recentMinutes);
}

function decide(run, jobs, { now = Date.now(), stuckSeconds = STUCK_SECONDS, recentMinutes = RECENT_MINUTES } = {}) {
  if (!fresh(run, now, recentMinutes)) return null;
  if ((run.run_attempt ?? 1) !== 1) return null;
  if (jobs.some(holdsFailure)) return null;
  if (run.status !== 'in_progress') return null;
  const stuck = jobs.map(job => finishedJob(job, now, stuckSeconds)).filter(Boolean);
  if (!stuck.length) return null;
  return {
    runId: run.id,
    workflow: run.name ?? '',
    event: run.event ?? '',
    attempt: run.run_attempt ?? 1,
    title: (run.display_title ?? '').slice(0, 80),
    action: run.event === PR_EVENT ? 'cancel' : REPORT_ONLY,
    stuck,
  };
}

function ghApi(args, fields, token) {
  const body = fields ? Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`]) : [];
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', ...args, ...body], { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, (error, stdout) =>
      error ? reject(new Error(`gh api ${args[0]} failed: ${String(error.message).slice(0, 200)}`)) : resolve(stdout));
  });
}

async function request(path, method = 'GET', fields = undefined, token = undefined) {
  const args = method === 'GET' ? [path] : ['-X', method, path];
  const stdout = await ghApi(args, fields, token);
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return {};
  }
}

function json(path, method = 'GET', fields = undefined) {
  return request(path, method, fields);
}

// Repository variables are their own permission and `github.token` carries none
// of it, so the store is read and written with the token the alarms already use
// for the same endpoints (prod-health.yml). Run control keeps `github.token`,
// which is the only token with actions: write. No token means no store, and no
// store means no cancel: a cancelled run nobody can finish is worse than a slow
// one.
function storeJson(path, method = 'GET', fields = undefined) {
  return request(path, method, fields, process.env.STORE_TOKEN);
}

// Only in-progress runs can hold a stuck job, and the endpoint filters them
// server-side, so discovery is one request on a quiet repository instead of five
// pages of everything. At a tick every forty-five seconds that difference is the
// sweep's whole API budget.
async function plan(repo, { now = Date.now(), stuckSeconds = STUCK_SECONDS, recentMinutes = RECENT_MINUTES, runs = null, jobsFor = null, api = json } = {}) {
  const listed = runs ?? (await pages(`/repos/${repo}/actions/runs?status=in_progress&per_page=100`, api));
  const decisions = [];
  const unread = [];
  for (const run of listed) {
    if (!liveRun(run, now, recentMinutes)) continue;
    let jobs;
    try {
      jobs = jobsFor ? jobsFor(run.id) ?? [] : await jobsOf(repo, run.id, api);
    } catch (error) {
      // One unreadable job list is one run this sweep cannot judge, not the end
      // of the sweep: the others are still read and the store is still finished.
      unread.push({ runId: run.id, reason: String(error.message).slice(0, 80) });
      continue;
    }
    const decision = decide(run, jobs, { now, stuckSeconds, recentMinutes });
    if (decision) decisions.push(decision);
  }
  return { decisions, unread };
}

async function jobsOf(repo, runId, api = json) {
  const payload = await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  return payload.jobs ?? [];
}

async function pages(path, api = json) {
  const found = [];
  for (let page = 1; page <= 5; page++) {
    const payload = await api(`${path}&page=${page}`);
    const batch = payload.workflow_runs ?? [];
    found.push(...batch);
    if (batch.length < 100) break;
  }
  return found;
}

// A 4xx is GitHub refusing the cancel, so nothing was cancelled and nothing
// needs a recovery. Anything else (a network error, a timeout, a 5xx, 408, 429)
// may have been accepted and lost on the way back, so it is unconfirmed rather
// than refused and the run is reconciled on a later sweep.
function refusesCancel(message) {
  if (!/HTTP 4\d\d/.test(message)) return false;
  return !/HTTP (408|429)/.test(message);
}

async function apply(repo, decisions, { api = json, settle = settleCancel, beforeCancel = null, onIssue = null, onConfirmed = null } = {}) {
  const done = [];
  for (const decision of decisions.filter(entry => entry.action === 'cancel')) {
    try {
      if (beforeCancel && !(await beforeCancel(decision))) {
        done.push({ runId: decision.runId, action: 'skip', rerun: false, reason: NOT_FIRST_ATTEMPT });
        continue;
      }
      if (onIssue && (await onIssue(decision)) === false) {
        done.push({ runId: decision.runId, action: 'skip', rerun: false, reason: STORE_UNWRITABLE });
        continue;
      }
      await api(`/repos/${repo}/actions/runs/${decision.runId}/cancel`, 'POST');
    } catch (error) {
      const message = String(error.message).slice(0, 80);
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: `${CANCEL_FAILED}: ${message}`, definitive: refusesCancel(message) });
      continue;
    }
    if (onConfirmed) await onConfirmed(decision);
    if (!(await settle(repo, decision.runId, api))) {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: SETTLE_FAILED });
      continue;
    }
    let jobs;
    try {
      jobs = await jobsOf(repo, decision.runId, api);
    } catch {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: JOBS_UNAVAILABLE });
      continue;
    }
    if (jobs.some(holdsFailure)) {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: NO_FAILURE_SEEN });
      continue;
    }
    const cutOff = jobs.filter(job => job.conclusion === 'cancelled').map(job => job.name);
    if (!cutOff.length) {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: NOT_CANCELLED });
      continue;
    }
    try {
      await api(`/repos/${repo}/actions/runs/${decision.runId}/rerun-failed-jobs`, 'POST');
      done.push({ runId: decision.runId, action: 'recover', rerun: true, jobs: cutOff });
    } catch {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: RERUN_FAILED });
    }
  }
  return done;
}

function pendingList(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(entry => Number.isInteger(entry?.runId) && typeof entry.cancelledAt === 'string')
      : [];
  } catch {
    return [];
  }
}

// Only a confirmed missing variable is an empty store. Any other read failure
// means the stored recoveries are unknown, and a save would overwrite them.
async function readPending(repo, api = storeJson) {
  try {
    const payload = await api(`/repos/${repo}/actions/variables/${PENDING_VARIABLE}`);
    return { ok: true, pending: pendingList(payload.value) };
  } catch (error) {
    const missing = /HTTP 404|Not Found/.test(String(error.message));
    return { ok: missing, pending: [] };
  }
}

// An entry the store cannot hold is an entry a cancelled run cannot be finished
// from, so nothing is ever dropped to make room: a full store refuses to write
// and the caller cancels nothing.
async function writePending(repo, pending, api = storeJson) {
  if (pending.length > PENDING_LIMIT) return false;
  const value = JSON.stringify(pending);
  try {
    await api(`/repos/${repo}/actions/variables/${PENDING_VARIABLE}`, 'PATCH', { name: PENDING_VARIABLE, value });
    return true;
  } catch {
    try {
      await api(`/repos/${repo}/actions/variables`, 'POST', { name: PENDING_VARIABLE, value });
      return true;
    } catch {
      return false;
    }
  }
}

// One stored cancel, carried by whichever sweep comes next: the cancel already
// landed, so the only question is whether the run now holds the cancelled jobs
// this sweep would have re-run, and whether it still may be re-run at all.
// `confirmed` means this sweep saw GitHub accept the cancel; `issued` means it
// sent the request and never learned the outcome. A reservation with neither is
// an intent this sweep never acted on, and a cancellation by a person or by a
// superseded push must never be restarted because of it.
async function resume(repo, entry, { api = json, now = Date.now(), attempts = RECOVERY_ATTEMPTS, maxAgeMs = PENDING_MAX_AGE_MS } = {}) {
  if (!(now - Date.parse(entry.cancelledAt) <= maxAgeMs)) {
    return { runId: entry.runId, action: 'drop', reason: 'older than the recovery window' };
  }
  if ((entry.tries ?? 0) >= attempts) {
    return { runId: entry.runId, action: 'drop', reason: `still not re-run after ${attempts} sweeps` };
  }
  if (entry.issued !== true) {
    return { runId: entry.runId, action: 'drop', reason: UNISSUED };
  }
  // Only a cancel GitHub accepted is proof that this sweep cancelled anything. An
  // answer that never came back is kept for a person to look at and is never
  // re-run on our own, because the run may equally have been cancelled by a
  // person or by a superseded push.
  if (entry.confirmed !== true) {
    return { runId: entry.runId, action: 'report', reason: CANCEL_AMBIGUOUS, keep: true };
  }
  const run = await api(`/repos/${repo}/actions/runs/${entry.runId}`);
  if ((entry.attempt ?? 1) !== (run.run_attempt ?? 1)) {
    return { runId: entry.runId, action: 'drop', reason: 'a newer attempt replaced it' };
  }
  if (run.status !== 'completed') {
    return { runId: entry.runId, action: 'wait', reason: 'the cancel has not settled yet', keep: true };
  }
  const jobs = await jobsOf(repo, entry.runId, api);
  if (jobs.some(holdsFailure)) {
    return { runId: entry.runId, action: 'drop', reason: NO_FAILURE_SEEN };
  }
  const cutOff = jobs.filter(job => job.conclusion === 'cancelled').map(job => job.name);
  if (!cutOff.length) {
    return { runId: entry.runId, action: 'drop', reason: NOT_CANCELLED };
  }
  try {
    await api(`/repos/${repo}/actions/runs/${entry.runId}/rerun-failed-jobs`, 'POST');
    return { runId: entry.runId, action: 'recover', rerun: true, jobs: cutOff };
  } catch {
    return { runId: entry.runId, action: 'wait', reason: RERUN_FAILED, keep: true };
  }
}

function keeper(save, pending) {
  let stored = JSON.stringify(pending);
  let ok = true;
  return {
    get saved() {
      return ok;
    },
    get available() {
      return Boolean(save);
    },
    async write(value) {
      if (!save) return true;
      const list = value.map(entry => ({ ...entry }));
      if (JSON.stringify(list) === stored) return true;
      if (!(await save(list))) {
        ok = false;
        return false;
      }
      stored = JSON.stringify(list);
      return true;
    },
  };
}

// The half that finishes what an earlier sweep started. Nothing here discovers
// anything, so it runs first and a slow or failing run list cannot delay it.
async function finishPending(repo, { api = json, now = Date.now(), pending = [], attempts = RECOVERY_ATTEMPTS, maxAgeMs = PENDING_MAX_AGE_MS, store = null } = {}) {
  const done = [];
  const carried = [];
  for (const entry of pending) {
    let outcome;
    try {
      outcome = await resume(repo, entry, { api, now, attempts, maxAgeMs });
    } catch (error) {
      outcome = { runId: entry.runId, action: 'wait', reason: String(error.message).slice(0, 80), keep: true };
    }
    done.push(outcome);
    if (outcome.keep) carried.push({ ...entry, tries: (entry.tries ?? 0) + 1 });
  }
  if (store) await store.write(carried);
  return { done, carried };
}

// What keeps an entry for the next sweep: a cancel that landed and still needs
// finishing, or one whose outcome GitHub never told us. Everything else is
// settled, and a run whose cancel this sweep never issued is not settled by us
// at all.
function carries(outcome) {
  if (outcome.action === 'skip') return false;
  if (outcome.rerun) return false;
  if (UNFINISHED.has(outcome.reason)) return true;
  if (String(outcome.reason ?? '').startsWith(CANCEL_FAILED)) return outcome.definitive === false;
  return false;
}

// The half that starts new recoveries. Every entry is written before its cancel
// is issued, so a sweep that dies leaves an unissued reservation rather than a
// cancelled run with no record, and a run that cannot be reserved is not
// cancelled at all.
async function startRecoveries(repo, decisions, { api = json, settle = settleCancel, now = Date.now(), carried: seed = [], save = null, store = null } = {}) {
  const done = [];
  const carried = seed.map(entry => ({ ...entry }));
  // No store means no cancel: a cancelled run nobody can finish is worse than a
  // slow one.
  if (!(store ? store.available : Boolean(save))) {
    const refused = decisions.filter(decision => decision.action === 'cancel')
      .map(decision => ({ runId: decision.runId, action: 'skip', rerun: false, reason: STORE_UNAVAILABLE }));
    done.push(...refused);
    return { done, pending: carried, saved: true, refused: refused.length };
  }
  const held = store ?? keeper(save, carried);
  const known = new Set(carried.map(entry => entry.runId));
  const wanted = decisions.filter(decision => decision.action === 'cancel' && !known.has(decision.runId));
  let room = PENDING_LIMIT - carried.length;
  let writable = true;
  for (const decision of wanted) {
    if (!writable || room <= 0) {
      done.push({ runId: decision.runId, action: 'skip', rerun: false, reason: writable ? STORE_FULL : STORE_UNWRITABLE });
      continue;
    }
    const entry = { runId: decision.runId, attempt: decision.attempt ?? 1, cancelledAt: new Date(now).toISOString(), tries: 0, issued: false, confirmed: false };
    carried.push(entry);
    room -= 1;
    const mark = (patch) => {
      Object.assign(entry, patch);
      return held.write(carried);
    };
    const outcomes = await apply(repo, [decision], {
      api,
      settle,
      beforeCancel: async () => {
        const run = await api(`/repos/${repo}/actions/runs/${decision.runId}`);
        return run.status === 'in_progress' && (run.run_attempt ?? 1) === (decision.attempt ?? 1);
      },
      onIssue: () => mark({ issued: true }),
      onConfirmed: () => mark({ confirmed: true }),
    });
    done.push(...outcomes);
    // A reservation whose cancel was never issued, or whose outcome is settled,
    // is not carried: the run keeps its own lease or is done with us.
    if (!entry.issued || !outcomes.some(carries)) {
      carried.splice(carried.indexOf(entry), 1);
      room += 1;
    }
  }
  await held.write(carried);
  return { done, pending: carried, saved: held.saved };
}

async function recover(repo, decisions, { api = json, settle = settleCancel, now = Date.now(), pending = [], save = null, attempts = RECOVERY_ATTEMPTS, maxAgeMs = PENDING_MAX_AGE_MS } = {}) {
  const store = keeper(save, pending);
  const finished = await finishPending(repo, { api, now, pending, attempts, maxAgeMs, store });
  const started = await startRecoveries(repo, decisions, { api, settle, now, carried: finished.carried, store });
  return { done: [...finished.done, ...started.done], pending: started.pending, saved: store.saved, refused: started.refused };
}

async function settleCancel(repo, runId, api) {
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
    const run = await api(`/repos/${repo}/actions/runs/${runId}`);
    if (run.status === 'completed') return true;
    await new Promise(resolve => setTimeout(resolve, SETTLE_DELAY_MS));
  }
  return false;
}

function fixturePlan(entry, options) {
  const jobsByRun = new Map(Object.entries(entry.jobs ?? {}).map(([id, jobs]) => [Number(id), jobs]));
  return plan(entry.repo, { ...options, runs: entry.runs, jobsFor: id => jobsByRun.get(id) ?? [] });
}

// One sweep. Discovery is the half that can fail and the half that can be slow,
// so the store is read and the recoveries an earlier sweep started are finished
// before anything is discovered: a cancelled check is the one thing here a person
// would otherwise have to finish by hand.
async function sweep(repo, { now = Date.now(), read = null, discover = null, save = null, api = json, settle = settleCancel } = {}) {
  const stored = await (read ?? (() => readPending(repo)))();
  // An unreadable store leaves no store at all, and no store cancels nothing.
  const store = stored.ok ? keeper(save ?? (list => writePending(repo, list)), stored.pending) : null;
  const finished = await finishPending(repo, { api, now, pending: stored.pending, store });
  let decisions = [];
  let unread = [];
  let discovery = null;
  try {
    ({ decisions, unread } = await (discover ?? (() => plan(repo, { now })))());
  } catch (error) {
    discovery = String(error.message).slice(0, 120);
  }
  const started = await startRecoveries(repo, decisions, { api, settle, now, carried: finished.carried, store });
  const recovery = { done: [...finished.done, ...started.done], pending: started.pending, saved: store ? store.saved : true, refused: started.refused };
  return { decisions, unread, discovery, stored, recovery };
}

// The sweep a scheduled or pushed run should not duplicate: a chain link is
// already on its way, and it sweeps within TICK_GAP_MS. Its own run is never
// counted, because a link is still running when the sweep it dispatched starts.
async function sweepInFlight(repo, { api = json, ownRunId = null } = {}) {
  const payload = await api(`/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=30`);
  const live = (payload.workflow_runs ?? []).filter(run => run.status === 'in_progress' || run.status === 'queued');
  return live.find(run => String(run.id) !== String(ownRunId)) ?? null;
}

// The ticks inside one link. Each link sweeps, then waits TICK_GAP_MS, and does
// that TICKS_PER_LINK times, so the runner startup and the two setup steps are
// paid once per eight ticks instead of once per tick. A tick that throws is
// reported and the loop keeps ticking: one bad sweep is forty-five seconds, not
// a dead chain.
async function tick(repo, { sweeps = TICKS_PER_LINK, gapMs = TICK_GAP_MS, once, sleep = wait } = {}) {
  const done = [];
  for (let index = 1; index < Math.max(1, sweeps); index++) {
    await sleep(gapMs);
    try {
      done.push(await once());
    } catch (error) {
      done.push({ error: String(error.message).slice(0, 120) });
    }
  }
  return done;
}

// The scheduled trigger is a backstop that fires every few hours, so a link that
// has used its ticks dispatches the next one and the chain keeps ticking until a
// run fails, the repository has no runner, or a production push restarts it. The
// dispatch never starts a second chain while another link is queued or running,
// so it waits instead of giving up: the link it gave way to may be a backstop
// that stands down, and a chain that stops there waits for the next cron, which
// is minutes. Waiting here keeps one link per tick and costs nothing when no
// other link appears.
async function handOff(repo, { api = json, ownRunId = process.env.GITHUB_RUN_ID, ref = CHAIN_REF, tries = HANDOFF_TRIES, gapMs = TICK_GAP_MS, sleep = wait } = {}) {
  for (let attempt = 1; attempt <= Math.max(1, tries); attempt++) {
    let busy;
    try {
      busy = await sweepInFlight(repo, { api, ownRunId });
    } catch (error) {
      return { dispatched: false, reason: `the run list could not be read: ${String(error.message).slice(0, 80)}` };
    }
    if (!busy) {
      try {
        await api(`/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, 'POST', { ref });
        return { dispatched: true, ref };
      } catch (error) {
        return { dispatched: false, reason: `the next sweep was not dispatched: ${String(error.message).slice(0, 80)}` };
      }
    }
    if (attempt === Math.max(1, tries)) return { dispatched: false, reason: `another sweep is still ${busy.status} after ${tries} tries` };
    await sleep(gapMs);
  }
  return { dispatched: false, reason: 'no dispatch was attempted' };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The clock is read when a sweep starts, not when the link starts. A link's
// ticks share one options object, so a time captured once would judge every
// later tick against the first one and a job that goes idle between two ticks
// would wait for the next link, minutes away, instead of the next tick.
function nowFrom(options = {}) {
  const clock = options.now;
  if (typeof clock === 'function') return clock();
  return clock ?? Date.now();
}

// One sweep, with its report. A tick in the middle of a link says less than the
// first one: the JSON is for a person reading a run, and eight copies of it bury
// the notices that matter.
async function sweepOnce(repo, { live, fixture, options = {}, quiet = false } = {}) {
  const now = nowFrom(options);
  let decisions = [];
  let unread = [];
  let discovery = null;
  let stored = { ok: true, pending: [] };
  let recovery = { done: [], pending: [], saved: true };
  if (live) {
    ({ decisions, unread, discovery, stored, recovery } = await sweep(repo, { now }));
  } else {
    try {
      ({ decisions, unread } = fixture
        ? await fixturePlan(JSON.parse(readFileSync(fixture, 'utf8')), { ...options, now })
        : await plan(repo, { ...options, now }));
    } catch (error) {
      discovery = String(error.message).slice(0, 120);
    }
  }
  const report = { repo, decisions, unread, discovery, pending: recovery.pending, applied: recovery.done, pendingSaved: recovery.saved, readOnly: !live };
  if (quiet) {
    const recovered = recovery.done.filter(outcome => outcome.action === 'recover').length;
    console.log(`::notice::tick: ${decisions.length} candidate run(s), ${recovered} recovered, ${recovery.pending.length} carried.`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  if (discovery) {
    console.log(`::warning::the run list could not be read this sweep (${discovery}); stored recoveries were still finished.`);
  }
  for (const entry of unread) {
    console.log(`::warning::run ${entry.runId} was not judged: ${entry.reason}.`);
  }
  if (!stored.ok) {
    console.log(`::warning::${PENDING_VARIABLE} cannot be read, so no recovery is stored this sweep and the stored ones are left untouched.`);
  } else if (recovery.refused) {
    console.log(`::warning::${recovery.refused} stuck run(s) left to their own lease: ${STORE_UNAVAILABLE}.`);
  } else if (!recovery.saved) {
    console.log('::warning::A recovery could not be stored, so the next sweep will not finish it.');
  }
  for (const outcome of recovery.done.filter(entry => entry.action === 'drop' || entry.reason === STORE_FULL || entry.reason === STORE_UNWRITABLE)) {
    console.log(`::warning::run ${outcome.runId} was not cancelled: ${outcome.reason}.`);
  }
  for (const outcome of recovery.done.filter(entry => entry.action === 'drop')) {
    console.log(`::warning::run ${outcome.runId} was cancelled by this sweep and abandoned: ${outcome.reason}.`);
  }
  for (const outcome of recovery.done.filter(entry => entry.action === 'report')) {
    console.log(`::warning::run ${outcome.runId}: ${outcome.reason}; re-run it by hand if its jobs are cancelled: https://github.com/${repo}/actions/runs/${outcome.runId}`);
  }
  for (const outcome of recovery.done.filter(entry => entry.action === 'recover' && entry.rerun)) {
    console.log(`::notice::run ${outcome.runId} re-runs after its cancel: ${outcome.jobs.join(', ')}`);
  }
  if (decisions.some(decision => decision.action === REPORT_ONLY)) {
    console.log('::warning::A run outside the recovery lane is stuck; leaving it to its own lease.');
  }
  for (const decision of decisions) {
    const names = decision.stuck.map(entry => entry.name).join(', ');
    console.log(`::notice::${decision.workflow} run ${decision.runId} ${decision.action}: ${names}`);
  }
  return report;
}

async function main() {
  const argv = process.argv.slice(2);
  const repo = argValue(argv, '--repo') ?? process.env.REPO ?? process.env.GITHUB_REPOSITORY;
  const fixture = argValue(argv, '--fixture');
  const applyChanges = argv.includes('--apply');
  const sweeps = Math.max(1, Number(argValue(argv, '--ticks') ?? TICKS_PER_LINK));
  const gapMs = Number(argValue(argv, '--gap-ms') ?? TICK_GAP_MS);
  // A live link reads the wall clock per sweep. A replay pins its clock and
  // advances it by one gap per sweep, so a fixture chain crosses the rule the
  // way a live one does instead of freezing at the first tick.
  let pinned = Date.parse(argValue(argv, '--now') ?? '');
  const clock = Number.isNaN(pinned) ? () => Date.now() : () => (pinned += gapMs);
  const options = {
    stuckSeconds: Number(argValue(argv, '--stuck-seconds') ?? STUCK_SECONDS),
    now: clock,
  };
  const live = applyChanges && !fixture;
  const chaining = argv.includes('--chain');
  // A scheduled or pushed run only exists to restart a chain that died, so it
  // gives way to a link that is already running instead of sweeping twice.
  const backstop = ['schedule', 'push'].includes(process.env.GITHUB_EVENT_NAME ?? '');
  if (live && backstop) {
    let busy = null;
    try {
      busy = await sweepInFlight(repo, { ownRunId: process.env.GITHUB_RUN_ID });
    } catch {
      busy = null;
    }
    if (busy) {
      console.log(`::notice::this sweep stood down: run ${busy.id} is already ${busy.status} and sweeps again within ${Math.round(gapMs / 1000)} seconds.`);
      return;
    }
  }
  await sweepOnce(repo, { live, fixture, options });
  if (!chaining) return;
  const later = await tick(repo, { sweeps, gapMs, once: () => sweepOnce(repo, { live, fixture, options, quiet: true }) });
  for (const outcome of later) {
    if (outcome && outcome.error) console.log(`::warning::a tick failed: ${outcome.error}.`);
  }
  const next = await handOff(repo);
  if (next.dispatched) console.log(`::notice::the next sweep is dispatched on ${next.ref}.`);
  else console.log(`::warning::the chain stopped: ${next.reason}. The next scheduled or production push run restarts it.`);
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

module.exports = { decide, finishedJob, holdsFailure, fresh, liveRun, plan, apply, resume, recover, sweep, tick, handOff, sweepInFlight, sweepOnce, nowFrom, finishPending, startRecoveries, pendingList, readPending, writePending, settleCancel, fixturePlan, STUCK_SECONDS, RECENT_MINUTES, TICK_GAP_MS, TICKS_PER_LINK, CAP_BUDGET_MS, SETTLE_ATTEMPTS, SETTLE_DELAY_MS, WORKFLOW_FILE, PENDING_VARIABLE, PENDING_LIMIT };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
