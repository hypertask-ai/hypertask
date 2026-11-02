#!/usr/bin/env node
// YPER4-984. A cron is not a tick on this repository. In the seven days to
// 2026-11-02T04:17Z prod-health delivered 67 of the 2352 runs its two crons ask
// for (2.8%: median gap 130 minutes, worst 6.5 hours) and the hourly
// required-check-settings delivered 30 of 168 (17.9%), so a bad deploy could sit
// unseen for hours. A workflow_dispatch is not throttled, so a monitor run now
// starts the next one itself: one link is always either checking or waiting, and
// the cron only restarts a chain that died.
//
// The gap is measured from GitHub's own run record for this link, not from when
// this step started, so a link whose checks ran long waits less and the cadence
// holds. The dispatch is skipped while another link of the same workflow is
// queued or running, so a cron landing on a live chain never starts a second one.
const { execFile } = require('node:child_process');

const CHAIN_REF = 'production';
// A link that gave way waits for the link it found instead of dropping the
// chain, because that link may be a cron backstop that stands down.
const HANDOFF_TRIES = 4;
const RETRY_GAP_MS = 60 * 1000;
const BACKSTOP_EVENTS = new Set(['schedule', 'push']);
const LIVE = new Set(['in_progress', 'queued']);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ghApi(args, fields, env = process.env) {
  const body = fields ? Object.entries(fields).flatMap(([key, value]) => ['-f', `${key}=${value}`]) : [];
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', ...args, ...body], { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 }, (error, stdout) =>
      error ? reject(new Error(`gh api ${args[0]} failed: ${String(error.message).slice(0, 200)}`)) : resolve(stdout));
  });
}

async function request(path, method = 'GET', fields = undefined, env = process.env) {
  const args = method === 'GET' ? [path] : ['-X', method, path];
  const stdout = await ghApi(args, fields, env);
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return {};
  }
}

// The only clock two links of one chain share.
async function linkStart(repo, ownRunId, api = request) {
  const run = await api(`/repos/${repo}/actions/runs/${ownRunId}`);
  const started = Date.parse(run.run_started_at ?? run.created_at ?? '');
  return Number.isNaN(started) ? null : started;
}

async function runInFlight(repo, workflowFile, ownRunId = null, api = request) {
  const payload = await api(`/repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=30`);
  const live = (payload.workflow_runs ?? []).filter(run => LIVE.has(run.status));
  return live.find(run => String(run.id) !== String(ownRunId)) ?? null;
}

// A cron or a push only restarts a chain that died. While another link is queued
// or running the backstop stands down, so it never starts a second chain; it has
// still run its own pass, which is the one useful thing it can add.
async function standDown(repo, { workflowFile, ownRunId = null, api = request } = {}) {
  try {
    return await runInFlight(repo, workflowFile, ownRunId, api);
  } catch {
    return null;
  }
}

async function handOff(repo, {
  workflowFile,
  ref = CHAIN_REF,
  ownRunId = null,
  gapMs = 0,
  startMs = null,
  tries = HANDOFF_TRIES,
  retryMs = RETRY_GAP_MS,
  api = request,
  sleep = wait,
  now = Date.now,
} = {}) {
  const rest = startMs === null ? 0 : startMs + gapMs - now();
  if (rest > 0) await sleep(rest);
  for (let attempt = 1; attempt <= Math.max(1, tries); attempt++) {
    let busy;
    try {
      busy = await runInFlight(repo, workflowFile, ownRunId, api);
    } catch (error) {
      return { dispatched: false, reason: `the run list could not be read: ${String(error.message).slice(0, 80)}` };
    }
    if (!busy) {
      try {
        await api(`/repos/${repo}/actions/workflows/${workflowFile}/dispatches`, 'POST', { ref });
        return { dispatched: true, ref };
      } catch (error) {
        return { dispatched: false, reason: `the next link was not dispatched: ${String(error.message).slice(0, 80)}` };
      }
    }
    if (attempt === Math.max(1, tries)) return { dispatched: false, reason: `another link is still ${busy.status} after ${tries} tries` };
    await sleep(retryMs);
  }
  return { dispatched: false, reason: 'no dispatch was attempted' };
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.find(argument => !argument.startsWith('--')) ?? 'hand-off';
  const workflowFile = argValue(argv, '--workflow') ?? process.env.WATCH_WORKFLOW;
  if (command !== 'hand-off') {
    console.error(`unknown command ${command}`);
    process.exit(2);
  }
  if (!workflowFile) {
    console.error('--workflow <file.yml> is required');
    process.exit(2);
  }
  const repo = argValue(argv, '--repo') ?? process.env.REPO ?? process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error('REPO is not set');
    process.exit(2);
  }
  const ref = argValue(argv, '--ref') ?? CHAIN_REF;
  const gapMs = Math.max(0, Number(argValue(argv, '--gap-minutes') ?? 0)) * 60 * 1000;
  const ownRunId = process.env.GITHUB_RUN_ID ?? null;
  const backstop = BACKSTOP_EVENTS.has(process.env.GITHUB_EVENT_NAME ?? '');

  if (backstop) {
    const busy = await standDown(repo, { workflowFile, ownRunId });
    if (busy) {
      console.log(`::notice::this backstop stood down: link ${busy.id} is already ${busy.status}.`);
      return;
    }
  }
  const startMs = gapMs > 0 && ownRunId ? await linkStart(repo, ownRunId).catch(() => null) : null;
  const next = await handOff(repo, { workflowFile, ref, ownRunId, gapMs, startMs });
  if (next.dispatched) {
    console.log(`::notice::the next ${workflowFile} link is dispatched on ${next.ref}.`);
    return;
  }
  console.log(`::warning::the chain stopped: ${next.reason}. The backstop cron restarts it.`);
  process.exitCode = 1;
}

module.exports = {
  handOff,
  standDown,
  linkStart,
  runInFlight,
  request,
  CHAIN_REF,
  HANDOFF_TRIES,
  RETRY_GAP_MS,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
