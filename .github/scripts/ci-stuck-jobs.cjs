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
// STUCK_MINUTES is not doing anything, so this sweep cancels that run and, once
// the cancellation settles, re-runs its failed jobs: the second attempt reports
// normally on a fresh runner. Provenance is the sweep's own cancel call, so a
// run that was cancelled by anything else (a person, a superseded push) is
// history and is never restarted. A run that holds a real failure is left alone
// as well, so no genuine red check is ever retried. Only pull-request runs are
// touched: a production push run verifies a deploy and is reported, never
// cancelled. Only runs touched in the last RECENT_MINUTES and first attempts
// are read at all, so an old run costs no request.
const { execFile } = require('node:child_process');
const { readFileSync } = require('node:fs');

const STUCK_MINUTES = 8;
const RECENT_MINUTES = 30;
const SETTLE_ATTEMPTS = 12;
const SETTLE_DELAY_MS = 5000;
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
const SETTLE_FAILED = 'cancel did not settle';
const RERUN_FAILED = 're-run request failed';
const JOBS_UNAVAILABLE = 'job list unavailable after the cancel';
const CANCEL_FAILED = 'cancel request failed';
const NOT_FIRST_ATTEMPT = 'no longer a first attempt in progress';
const NO_FAILURE_SEEN = 'a genuine failure appeared';
const NOT_CANCELLED = 'no job left cancelled';
const STORE_UNAVAILABLE = 'recovery storage is unreadable';
// A cancel can land after the sweep that issued it gave up, so the recovery is
// kept until something settles it: a re-run, a real failure, no cancelled job
// left, or a newer attempt replacing the one this sweep cancelled.
const SETTLED = new Set([NO_FAILURE_SEEN, NOT_CANCELLED, NOT_FIRST_ATTEMPT]);

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

function finishedJob(job, now, stuckMinutes) {
  const steps = job.steps ?? [];
  if (!steps.length) return null;
  if (job.status !== 'in_progress') return null;
  const ends = steps.map(stepEnd);
  if (ends.some(end => end === null)) return null;
  const last = Math.max(...ends);
  if (!Number.isFinite(last)) return null;
  const idle = (now - last) / 1000;
  return idle >= stuckMinutes * 60 ? { name: job.name, idle: Math.round(idle), lastStepAt: new Date(last).toISOString() } : null;
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

function decide(run, jobs, { now = Date.now(), stuckMinutes = STUCK_MINUTES, recentMinutes = RECENT_MINUTES } = {}) {
  if (!fresh(run, now, recentMinutes)) return null;
  if ((run.run_attempt ?? 1) !== 1) return null;
  if (jobs.some(holdsFailure)) return null;
  if (run.status !== 'in_progress') return null;
  const stuck = jobs.map(job => finishedJob(job, now, stuckMinutes)).filter(Boolean);
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

function ghApi(args, fields) {
  const body = fields ? Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`]) : [];
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', ...args, ...body], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, (error, stdout) =>
      error ? reject(new Error(`gh api ${args[0]} failed: ${String(error.message).slice(0, 200)}`)) : resolve(stdout));
  });
}

async function json(path, method = 'GET', fields = undefined) {
  const args = method === 'GET' ? [path] : ['-X', method, path];
  const stdout = await ghApi(args, fields);
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return {};
  }
}

async function plan(repo, { now = Date.now(), stuckMinutes = STUCK_MINUTES, recentMinutes = RECENT_MINUTES, runs = null, jobsFor = null } = {}) {
  const listed = runs ?? (await pages(`/repos/${repo}/actions/runs?per_page=100`));
  const decisions = [];
  for (const run of listed) {
    if (!liveRun(run, now, recentMinutes)) continue;
    const jobs = jobsFor ? jobsFor(run.id) ?? [] : await jobsOf(repo, run.id);
    const decision = decide(run, jobs, { now, stuckMinutes, recentMinutes });
    if (decision) decisions.push(decision);
  }
  return decisions;
}

async function jobsOf(repo, runId, api = json) {
  const payload = await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  return payload.jobs ?? [];
}

async function pages(path) {
  const found = [];
  for (let page = 1; page <= 5; page++) {
    const payload = await json(`${path}&page=${page}`);
    const batch = payload.workflow_runs ?? [];
    found.push(...batch);
    if (batch.length < 100) break;
  }
  return found;
}

async function apply(repo, decisions, { api = json, settle = settleCancel, beforeCancel = null, onCancelled = null } = {}) {
  const done = [];
  for (const decision of decisions.filter(entry => entry.action === 'cancel')) {
    try {
      if (beforeCancel && !(await beforeCancel(decision))) {
        done.push({ runId: decision.runId, action: 'skip', rerun: false, reason: NOT_FIRST_ATTEMPT });
        continue;
      }
      await api(`/repos/${repo}/actions/runs/${decision.runId}/cancel`, 'POST');
    } catch (error) {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: `${CANCEL_FAILED}: ${String(error.message).slice(0, 80)}` });
      continue;
    }
    if (onCancelled) await onCancelled(decision);
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
async function readPending(repo, api = json) {
  try {
    const payload = await api(`/repos/${repo}/actions/variables/${PENDING_VARIABLE}`);
    return { ok: true, pending: pendingList(payload.value) };
  } catch (error) {
    const missing = /HTTP 404|Not Found/.test(String(error.message));
    return { ok: missing, pending: [] };
  }
}

async function writePending(repo, pending, api = json) {
  const value = JSON.stringify(pending.slice(0, PENDING_LIMIT));
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
async function resume(repo, entry, { api = json, now = Date.now(), attempts = RECOVERY_ATTEMPTS, maxAgeMs = PENDING_MAX_AGE_MS } = {}) {
  if (!(now - Date.parse(entry.cancelledAt) <= maxAgeMs)) {
    return { runId: entry.runId, action: 'drop', reason: 'older than the recovery window' };
  }
  if ((entry.tries ?? 0) >= attempts) {
    return { runId: entry.runId, action: 'drop', reason: `still not re-run after ${attempts} sweeps` };
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

async function recover(repo, decisions, { api = json, settle = settleCancel, now = Date.now(), pending = [], save = null, attempts = RECOVERY_ATTEMPTS, maxAgeMs = PENDING_MAX_AGE_MS } = {}) {
  const done = [];
  const carried = [];
  let stored = JSON.stringify(pending);
  const write = async (value) => {
    if (!save) return true;
    const list = value.slice(0, PENDING_LIMIT).map(entry => ({ ...entry }));
    if (JSON.stringify(list) === stored) return true;
    if (!(await save(list))) return false;
    stored = JSON.stringify(list);
    return true;
  };
  let saved = true;
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
  const known = new Set(pending.map(entry => entry.runId));
  const candidates = decisions.filter(decision => !known.has(decision.runId));
  // A cancel that cannot be stored is a cancel nobody can finish, so nothing is
  // cancelled while the store is unreadable: the run keeps its own lease instead.
  if (!save) {
    const refused = candidates.filter(decision => decision.action === 'cancel')
      .map(decision => ({ runId: decision.runId, action: 'skip', rerun: false, reason: STORE_UNAVAILABLE }));
    done.push(...refused);
    return { done, pending: carried.slice(0, PENDING_LIMIT), saved: true, refused: refused.length };
  }
  const outcomes = await apply(repo, candidates, {
    api,
    settle,
    beforeCancel: async (decision) => {
      const run = await api(`/repos/${repo}/actions/runs/${decision.runId}`);
      return run.status === 'in_progress' && (run.run_attempt ?? 1) === (decision.attempt ?? 1);
    },
    // Stored the moment the cancel lands, before this sweep reads anything else
    // about the run: a sweep that dies after the cancel must not lose it.
    onCancelled: async (decision) => {
      carried.push({ runId: decision.runId, attempt: decision.attempt ?? 1, cancelledAt: new Date(now).toISOString(), tries: 0 });
      if (!(await write(carried))) saved = false;
    },
  });
  done.push(...outcomes);
  const settled = new Set(outcomes.filter(outcome => outcome.rerun || SETTLED.has(outcome.reason)).map(outcome => outcome.runId));
  const next = carried.filter(entry => !settled.has(entry.runId)).slice(0, PENDING_LIMIT);
  if (!(await write(next))) saved = false;
  return { done, pending: next, saved };
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

async function main() {
  const argv = process.argv.slice(2);
  const repo = argValue(argv, '--repo') ?? process.env.REPO ?? process.env.GITHUB_REPOSITORY;
  const fixture = argValue(argv, '--fixture');
  const applyChanges = argv.includes('--apply');
  const options = {
    stuckMinutes: Number(argValue(argv, '--stuck-minutes') ?? STUCK_MINUTES),
    now: Date.parse(argValue(argv, '--now')) || Date.now(),
  };
  const decisions = fixture
    ? await fixturePlan(JSON.parse(readFileSync(fixture, 'utf8')), options)
    : await plan(repo, options);
  const live = applyChanges && !fixture;
  const stored = live ? await readPending(repo) : { ok: true, pending: [] };
  const recovery = live
    ? await recover(repo, decisions, { pending: stored.pending, now: options.now, save: stored.ok ? list => writePending(repo, list) : null })
    : { done: [], pending: stored.pending, saved: true };
  const report = { repo, decisions, pending: recovery.pending, applied: recovery.done, pendingSaved: recovery.saved, readOnly: !live };
  console.log(JSON.stringify(report, null, 2));
  if (!stored.ok) {
    console.log(`::warning::${PENDING_VARIABLE} cannot be read, so no recovery is stored this sweep and the stored ones are left untouched.`);
  } else if (recovery.refused) {
    console.log(`::warning::${recovery.refused} stuck run(s) left to their own lease: ${STORE_UNAVAILABLE}.`);
  } else if (!recovery.saved) {
    console.log('::warning::A recovery could not be stored, so the next sweep will not finish it.');
  }
  for (const outcome of recovery.done.filter(entry => entry.action === 'drop')) {
    console.log(`::warning::run ${outcome.runId} was cancelled by this sweep and abandoned: ${outcome.reason}.`);
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
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

module.exports = { decide, finishedJob, holdsFailure, fresh, liveRun, plan, apply, resume, recover, pendingList, readPending, writePending, settleCancel, fixturePlan, STUCK_MINUTES, RECENT_MINUTES, PENDING_VARIABLE };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
