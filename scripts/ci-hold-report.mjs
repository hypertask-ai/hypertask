#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULTS = { repo: 'hypertask-ai/hypertask', workflow: 'ci-tests.yml', branch: 'production', limit: 10, holdMinutes: 10 };
const PAGE_PART = 'browser-smoke-';
const SUMMARY_JOB = 'browser-smoke';
const usage = 'Usage: node scripts/ci-hold-report.mjs [--repo owner/name] [--workflow file] [--branch name] [--limit N] [--hold-minutes N]';

const epoch = (value) => {
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};

function positiveInteger(flag, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} needs a whole number of at least 1, got ${raw}`);
  return value;
}

export function parseArgs(argv) {
  const options = { ...DEFAULTS, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`);
      index += 1;
      return next;
    };
    if (flag === '--repo') options.repo = value();
    else if (flag === '--workflow') options.workflow = value();
    else if (flag === '--branch') options.branch = value();
    else if (flag === '--limit') options.limit = positiveInteger(flag, value());
    else if (flag === '--hold-minutes') options.holdMinutes = positiveInteger(flag, value());
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  return options;
}

export function formatDuration(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}

export function partHolds(jobs, holdSeconds) {
  const holds = [];
  for (const job of jobs ?? []) {
    const ends = (job.steps ?? []).map((step) => epoch(step.completed_at));
    const started = epoch(job.started_at);
    const done = epoch(job.completed_at);
    if (!ends.length || ends.includes(null) || started === null || done === null) continue;
    const waited = (done - Math.max(...ends, started)) / 1000;
    if (waited <= holdSeconds) continue;
    holds.push({ name: job.name ?? '', seconds: waited });
  }
  return holds.sort((left, right) => right.seconds - left.seconds);
}

export function checkWindow(jobs) {
  const list = jobs ?? [];
  const parts = list.filter((job) => (job.name ?? '').startsWith(PAGE_PART));
  const summary = list.find((job) => job.name === SUMMARY_JOB);
  const opening = parts.length ? parts : summary ? [summary] : [];
  const starts = opening.map((job) => epoch(job.started_at)).filter(Number.isFinite);
  const finishes = [summary, ...parts].map((job) => (job ? epoch(job.completed_at) : null)).filter(Number.isFinite);
  if (!starts.length || !finishes.length) return null;
  const summaryEnd = summary ? epoch(summary.completed_at) : null;
  const start = Math.min(...starts);
  const end = summaryEnd === null ? Math.max(...finishes) : summaryEnd;
  return { start, end, seconds: Math.max(0, (end - start) / 1000) };
}

export function pushLine(run, jobs, { repo, holdSeconds }) {
  const window = checkWindow(jobs);
  const holds = partHolds(jobs, holdSeconds);
  const head = window ? formatDuration(window.seconds) : run.status === 'completed' ? 'no browser check' : 'in progress';
  const held = holds.length ? ` — held: ${holds.map((hold) => `${hold.name} ${formatDuration(hold.seconds)}`).join(', ')}` : '';
  return `${head} — https://github.com/${repo}/actions/runs/${run.id}${held}`;
}

export function report(rows, options) {
  const lines = [];
  const heldPerPush = [];
  for (const row of rows) {
    lines.push(pushLine(row.run, row.jobs, options));
    const held = partHolds(row.jobs, options.holdSeconds).length;
    if (held) heldPerPush.push(held);
  }
  const pushes = `${rows.length} push${rows.length === 1 ? '' : 'es'} listed, newest first.`;
  const parts = heldPerPush.reduce((total, held) => total + held, 0);
  const summary = parts
    ? `${parts} ${parts === 1 ? 'part' : 'parts'} waited over ${options.holdMinutes}m after ${parts === 1 ? 'its' : 'their'} last step, on ${heldPerPush.length} of ${rows.length} pushes.`
    : `No part waited over ${options.holdMinutes}m after its last step on these ${rows.length} pushes.`;
  return { lines, pushes, summary };
}

function ghApi(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 }, (error, stdout) => {
      if (error) {
        reject(new Error(`gh api ${args.join(' ')} failed: ${String(error.message).split('\n')[0]}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`gh api ${args.join(' ')} returned invalid JSON`));
      }
    });
  });
}

async function runJobs(repo, runId) {
  const pages = await ghApi(['--paginate', '--slurp', `repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`]);
  const listed = Array.isArray(pages) ? pages : [pages];
  return listed.flatMap((page) => page?.jobs ?? []);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return 0;
  }
  const query = `repos/${options.repo}/actions/workflows/${options.workflow}/runs?branch=${encodeURIComponent(options.branch)}&event=push&per_page=${options.limit}`;
  const listed = await ghApi([query]);
  const runs = (listed.workflow_runs ?? []).slice(0, options.limit);
  if (!runs.length) {
    console.log(`No push run of ${options.workflow} on ${options.branch} in ${options.repo}.`);
    return 0;
  }
  const rows = [];
  for (const run of runs) rows.push({ run, jobs: await runJobs(options.repo, run.id) });
  const { lines, pushes, summary } = report(rows, { ...options, holdSeconds: options.holdMinutes * 60 });
  console.log(`Hypertask browser check — the ${rows.length} newest pushes to ${options.branch}, newest first`);
  for (const line of lines) console.log(line);
  console.log('');
  console.log(pushes);
  console.log(summary);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
