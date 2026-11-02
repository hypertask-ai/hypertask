#!/usr/bin/env node
// YPER4-984. The scheduled production watch asked GitHub for 336 runs a day and
// got 67 in a week, because a cron is not a tick on a repository this busy. This
// link runs the same checks from one runner: one link holds six ticks five
// minutes apart and then starts the next link, so runner startup is paid once per
// half hour instead of once per tick.
//
// The passes are the reachability guard prod-health.yml runs on a push, and once
// per link - the cadence the drift cron asked for - the deploy drift check and the
// Pusher status page. The core-actions write probe is a job of its own in this
// workflow, because it walks a fixture the push job also owns and only the shared
// fixture group can serialize the two. Nothing here mutates production and nothing
// here rolls back; the rollback path stays push-only in prod-health.yml.
//
// The drift check is skipped while a prod-health run is in flight. prod-health
// keeps drift and health in one concurrency group for exactly that reason: a live
// deploy still serving the previous commit would be reported as drift, which is a
// false alarm, never a real one.
const { execFile } = require('node:child_process');
const { runInFlight } = require('./schedule-chain.cjs');

const TICK_GAP_MS = 5 * 60 * 1000;
const TICKS_PER_LINK = 6;
// The thirty-minute half runs on the first tick of each link.
const WATCH_TICK = 0;
const DRIFT_WORKFLOW = 'prod-health.yml';
const PROBE_CHECKS = [
  { name: 'api-reachability', file: '.github/scripts/api-reachability.sh', args: [] },
];
const WATCH_CHECKS = [
  { name: 'drift', file: '.github/scripts/production-drift.sh', args: [] },
  { name: 'pusher', file: '.github/scripts/pusher-status.sh', args: [] },
];
const EXECUTE_TIMEOUT_MS = 9 * 60 * 1000;
// No check is given less than this when the link is running out of time, so a
// starved check reports a real answer instead of a false timeout.
const MIN_CHECK_MS = 2 * 60 * 1000;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function commandFor(check) {
  if (check.args.length) return { file: process.execPath, args: [check.file, ...check.args] };
  return { file: 'bash', args: [check.file] };
}

function runCheck(check, { env = process.env, timeout = EXECUTE_TIMEOUT_MS } = {}) {
  const { file, args } = commandFor(check);
  return new Promise((resolve, reject) => {
    execFile(file, args, { env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) reject(new Error(`${check.name} exited ${error.code ?? error.signal ?? 'unknown'}`));
      else resolve(stdout);
    });
  });
}

function plan(index, { fixtureBusy = false } = {}) {
  // Drift loses its answer while a prod-health run is live: it would read a deploy
  // still rolling out as drift. The core-actions probe is a job of its own, under
  // that run's fixture group, so it needs no guard here.
  const watch = fixtureBusy ? WATCH_CHECKS.filter(check => check.name !== 'drift') : WATCH_CHECKS;
  if (index !== WATCH_TICK) return PROBE_CHECKS;
  return [...watch, ...PROBE_CHECKS];
}

async function ticks({
  sweeps = TICKS_PER_LINK,
  gapMs = TICK_GAP_MS,
  execute = runCheck,
  fixtureBusy = null,
  sleep = wait,
  log = console.log,
  deadlineMs = null,
  now = Date.now,
} = {}) {
  const failures = [];
  const started = now();
  const budget = () => (deadlineMs === null ? Infinity : deadlineMs - now());
  let outOfTime = false;
  for (let index = 0; index < Math.max(1, sweeps); index++) {
    if (index > 0) {
      // Each tick is due at a deadline from the link start, never from the end of
      // the last check, so a slow check cannot stretch the five-minute cadence.
      if (budget() < gapMs + MIN_CHECK_MS) {
        log(`::notice::the link is out of time after ${index} ticks, so the rest of the passes moved to the next link.`);
        break;
      }
      const due = started + index * gapMs;
      if (due > now()) await sleep(due - now());
    }
    let blocked = false;
    if (fixtureBusy) {
      // Asked on every tick: a prod-health run can start between two passes, and it
      // holds the same fixture the probe walks.
      try {
        blocked = Boolean(await fixtureBusy());
      } catch {
        blocked = false;
      }
      if (blocked) log('::notice::a prod-health run is in flight, so this tick skips the drift check.');
    }
    for (const check of plan(index, { fixtureBusy: blocked })) {
      const remaining = budget();
      if (remaining < MIN_CHECK_MS) {
        log(`::notice::${check.name} moved to the next link: fewer than ${Math.round(MIN_CHECK_MS / 60000)} minutes of this link are left.`);
        outOfTime = true;
        break;
      }
      try {
        await execute(check, { timeout: Math.min(EXECUTE_TIMEOUT_MS, remaining) });
      } catch (error) {
        failures.push({ tick: index, check: check.name, error: String(error.message).slice(0, 120) });
      }
    }
    if (outOfTime) break;
  }
  return failures;
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const repo = argValue(argv, '--repo') ?? process.env.REPO ?? process.env.GITHUB_REPOSITORY;
  const sweeps = Math.max(1, Number(argValue(argv, '--ticks') ?? TICKS_PER_LINK));
  const gapMs = Number(argValue(argv, '--gap-ms') ?? TICK_GAP_MS);
  const deadlineMinutes = Number(argValue(argv, '--deadline-minutes') ?? 0);
  const failures = await ticks({
    sweeps,
    gapMs,
    deadlineMs: deadlineMinutes > 0 ? Date.now() + deadlineMinutes * 60 * 1000 : null,
    fixtureBusy: () => runInFlight(repo, DRIFT_WORKFLOW),
  });
  for (const failure of failures) {
    console.log(`::error::tick ${failure.tick} ${failure.check} failed: ${failure.error}.`);
  }
  if (failures.length) {
    process.exitCode = 1;
    return;
  }
  console.log(`::notice::${sweeps} tick(s) done, every check green.`);
}

module.exports = {
  ticks,
  plan,
  runCheck,
  TICK_GAP_MS,
  TICKS_PER_LINK,
  WATCH_TICK,
  EXECUTE_TIMEOUT_MS,
  MIN_CHECK_MS,
  PROBE_CHECKS,
  WATCH_CHECKS,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
