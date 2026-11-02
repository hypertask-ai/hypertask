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
// The core-actions probe walks the same fixture as the prod-health push job. The
// route serializes every caller on a Redis lock keyed by that fixture, so two
// probes never interleave; the probe still runs as the dedicated Health Check user
// (HTPR-6258) and this file skips it while a prod-health run is in flight, so the
// lock wait does not show up as a reported failure.
const FIXTURE_ENV = 'HYPERTASK_HEALTH_USER_TOKEN';
const PROBE_CHECKS = [
  { name: 'api-reachability', file: '.github/scripts/api-reachability.sh', args: [] },
  { name: 'core-actions', file: '.github/scripts/core-actions-smoke.mjs', args: ['run'], tokenEnv: FIXTURE_ENV },
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

// A check that touches the fixture carries its own token instead of the general
// one, the way prod-health.yml hands HYPERTASK_HEALTH_USER_TOKEN to core-actions.
function envFor(check, base) {
  if (!check.tokenEnv) return base;
  if (!base[check.tokenEnv]) return null;
  return { ...base, HYPERTASK_MCP_TOKEN: base[check.tokenEnv] };
}

function runCheck(check, { env = process.env, timeout = EXECUTE_TIMEOUT_MS } = {}) {
  const { file, args } = commandFor(check);
  const resolved = envFor(check, env);
  if (!resolved) {
    return Promise.reject(new Error(`${check.name} needs ${check.tokenEnv} and refuses to run as another identity`));
  }
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: resolved, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
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
    await execute({ name: 'core-actions-report', file: '.github/scripts/core-actions-smoke.mjs', args: ['report'], tokenEnv: FIXTURE_ENV });
  } catch (error) {
    log(`::warning::the core-actions report did not go out: ${String(error.message).slice(0, 120)}.`);
  }
}

function plan(index, { fixtureBusy = false } = {}) {
  // The drift check and the core-actions probe both lose their answer while a
  // prod-health run is live: drift would read a deploy still rolling out, and the
  // probe would walk the fixture that run is using.
  const blocked = new Set(fixtureBusy ? ['drift', 'core-actions'] : []);
  if (index !== WATCH_TICK) return PROBE_CHECKS.filter(check => !blocked.has(check.name));
  return [...WATCH_CHECKS, ...PROBE_CHECKS].filter(check => !blocked.has(check.name));
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
      if (blocked) log('::notice::a prod-health run is in flight, so this tick skips the drift check and the core-actions probe.');
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
        if (check.name === 'core-actions') await reportCoreActions({ execute, log });
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
  envFor,
  reportCoreActions,
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
