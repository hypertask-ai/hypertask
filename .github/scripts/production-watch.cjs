#!/usr/bin/env node
// YPER4-984. The scheduled production watch asked GitHub for 336 runs a day and
// got 67 in a week, because a cron is not a tick on a repository this busy. This
// link runs the same checks from one runner: one link holds six ticks five
// minutes apart and then starts the next link, so runner startup is paid once per
// half hour instead of once per tick.
//
// The checks are the ones prod-health.yml already runs on a push: the live
// endpoint reachability guard, the core-actions write probe, and - once per link,
// on the same thirty-minute cadence the drift cron asked for - the deploy drift
// check and the Pusher status page. Nothing here mutates production and nothing
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
  { name: 'core-actions', file: '.github/scripts/core-actions-smoke.mjs', args: ['run'] },
];
const WATCH_CHECKS = [
  { name: 'drift', file: '.github/scripts/production-drift.sh', args: [] },
  { name: 'pusher', file: '.github/scripts/pusher-status.sh', args: [] },
];
const EXECUTE_TIMEOUT_MS = 9 * 60 * 1000;

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

// A core-actions failure has already written its result file, and the report is
// what turns it into a ticket comment and an alert. The prod-health push job runs
// the same pair, so a red watch tick says as much as a red push run does.
async function reportCoreActions({ execute = runCheck, log = console.log } = {}) {
  try {
    await execute({ name: 'core-actions-report', file: '.github/scripts/core-actions-smoke.mjs', args: ['report'] });
  } catch (error) {
    log(`::warning::the core-actions report did not go out: ${String(error.message).slice(0, 120)}.`);
  }
}

function plan(index, { driftBlocked = false } = {}) {
  if (index !== WATCH_TICK) return PROBE_CHECKS;
  return [...(driftBlocked ? WATCH_CHECKS.filter(check => check.name !== 'drift') : WATCH_CHECKS), ...PROBE_CHECKS];
}

async function ticks({
  sweeps = TICKS_PER_LINK,
  gapMs = TICK_GAP_MS,
  execute = runCheck,
  driftBusy = null,
  sleep = wait,
  log = console.log,
} = {}) {
  const failures = [];
  for (let index = 0; index < Math.max(1, sweeps); index++) {
    if (index > 0) await sleep(gapMs);
    let driftBlocked = false;
    if (index === WATCH_TICK && driftBusy) {
      try {
        driftBlocked = Boolean(await driftBusy());
      } catch {
        driftBlocked = false;
      }
      if (driftBlocked) log('::notice::a prod-health run is in flight, so this link skips the drift check and the next link reads it.');
    }
    for (const check of plan(index, { driftBlocked })) {
      try {
        await execute(check);
      } catch (error) {
        failures.push({ tick: index, check: check.name, error: String(error.message).slice(0, 120) });
        if (check.name === 'core-actions') await reportCoreActions({ execute, log });
      }
    }
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
  const failures = await ticks({
    sweeps,
    gapMs,
    driftBusy: () => runInFlight(repo, DRIFT_WORKFLOW),
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
  reportCoreActions,
  TICK_GAP_MS,
  TICKS_PER_LINK,
  WATCH_TICK,
  PROBE_CHECKS,
  WATCH_CHECKS,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
