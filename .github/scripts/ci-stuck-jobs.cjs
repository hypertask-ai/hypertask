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

function ghApi(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, (error, stdout) =>
      error ? reject(new Error(`gh api ${args[0]} failed: ${String(error.message).slice(0, 200)}`)) : resolve(stdout));
  });
}

async function json(path, method = 'GET') {
  const args = method === 'GET' ? [path] : ['-X', 'POST', path];
  const stdout = await ghApi(args);
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

async function apply(repo, decisions, { api = json, settle = settleCancel } = {}) {
  const done = [];
  for (const decision of decisions.filter(entry => entry.action === 'cancel')) {
    await api(`/repos/${repo}/actions/runs/${decision.runId}/cancel`, 'POST');
    if (!(await settle(repo, decision.runId, api))) {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: 'cancel did not settle' });
      continue;
    }
    const jobs = await jobsOf(repo, decision.runId, api);
    if (jobs.some(holdsFailure)) {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: 'a genuine failure appeared' });
      continue;
    }
    const cutOff = jobs.filter(job => job.conclusion === 'cancelled').map(job => job.name);
    if (!cutOff.length) {
      done.push({ runId: decision.runId, action: 'cancel', rerun: false, reason: 'no job left cancelled' });
      continue;
    }
    await api(`/repos/${repo}/actions/runs/${decision.runId}/rerun-failed-jobs`, 'POST');
    done.push({ runId: decision.runId, action: 'recover', rerun: true, jobs: cutOff });
  }
  return done;
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
  const applied = applyChanges && !fixture ? await apply(repo, decisions) : [];
  const report = { repo, decisions, applied, readOnly: !applyChanges || Boolean(fixture) };
  console.log(JSON.stringify(report, null, 2));
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

module.exports = { decide, finishedJob, holdsFailure, fresh, liveRun, plan, apply, settleCancel, fixturePlan, STUCK_MINUTES, RECENT_MINUTES };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
