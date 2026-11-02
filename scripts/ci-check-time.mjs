#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const APPS = [
  { name: 'hypertask', label: 'Hypertask', repo: 'hypertask-ai/hypertask', factory: 'Hypertask' },
  { name: 'postbox', label: 'Postbox', repo: 'valentinyeo/postbox', factory: 'Software Factory' },
  { name: 'multiprompt', label: 'Multiprompt', repo: 'valentinyeo/multiprompt', factory: 'Software Factory' },
  { name: 'multiprompt-android', label: 'Multiprompt Android', repo: 'valentinyeo/multiprompt-android', factory: 'Software Factory' },
];

const SETUP = /set ?up job|setup|checkout|cache|restore|install|npm ci|yarn install|pnpm install|build|compile|bundle|download|acquire|prepare/i;
const TESTS = /test|lint|typecheck|type check|tsc|playwright|vitest|jest|mocha|smoke|check|guard|audit|eval|verify|drive|prove|proof|journey/i;
const usage = 'Usage: node scripts/ci-check-time.mjs [--repos owner/name,...] [--limit 150] [--fixture file] [--json] [--markdown] [--out file]';

export function classifyStep(name = '') {
  if (SETUP.test(name)) return 'setup';
  if (TESTS.test(name)) return 'tests';
  return 'other';
}

const seconds = (from, to) => {
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : null;
};

function mergeIntervals(intervals) {
  const sorted = intervals.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let current = null;
  for (const [start, end] of sorted) {
    if (!current || start > current[1]) {
      if (current) total += current[1] - current[0];
      current = [start, end];
    } else if (end > current[1]) {
      current[1] = end;
    }
  }
  if (current) total += current[1] - current[0];
  return total / 1000;
}

export function decomposeRun(run, jobs = []) {
  const waiting = seconds(run.created_at, run.run_started_at);
  const wall = seconds(run.run_started_at, run.updated_at);
  if (waiting === null || wall === null) return null;
  const buckets = { setup: 0, tests: 0, other: 0 };
  const intervals = [];
  let clipped = false;
  for (const job of jobs) {
    const span = seconds(job.started_at, job.completed_at);
    if (span !== null) intervals.push([Date.parse(job.started_at), Date.parse(job.completed_at)]);
    let measured = 0;
    for (const step of job.steps ?? []) {
      const length = seconds(step.started_at, step.completed_at);
      if (length === null) continue;
      buckets[classifyStep(step.name)] += length;
      measured += length;
    }
    if (span !== null && measured > span + 1) clipped = true;
  }
  const covered = mergeIntervals(intervals);
  const runStart = Date.parse(run.run_started_at);
  return {
    id: run.id,
    attempt: run.run_attempt ?? 1,
    sha: run.head_sha ?? '',
    workflow: run.name ?? run.path ?? '',
    conclusion: run.conclusion ?? '',
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    waiting,
    wall,
    setup: buckets.setup,
    tests: buckets.tests,
    other: buckets.other,
    gap: Math.max(0, wall - covered),
    clipped: clipped || covered > wall + 1,
    total: waiting + wall,
    startedAt: runStart,
  };
}

export function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function percentile(values, share) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
}

const RED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
export const TARGET_SECONDS = 600;
const IDLE = new Set(['skipped', 'cancelled']);

export function commitRuns(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.sha) continue;
    const group = groups.get(row.sha) ?? [];
    group.push({ conclusion: row.conclusion, createdAt: row.createdAt, updatedAt: row.updatedAt, unreadable: Boolean(row.unreadable) });
    groups.set(row.sha, group);
  }
  return groups;
}

function pushToGreen(groups, excluded = new Set()) {
  const greens = [];
  for (const [sha, runs] of groups) {
    if (excluded.has(sha)) continue;
    if (runs.some(run => run.unreadable || run.status && run.status !== 'completed')) continue;
    if (!runs.some(run => run.conclusion === 'success')) continue;
    if (runs.some(run => RED.has(run.conclusion))) continue;
    const scored = runs.filter(run => !IDLE.has(run.conclusion));
    if (!scored.length) continue;
    const first = Math.min(...scored.map(run => Date.parse(run.createdAt)));
    const last = Math.max(...scored.map(run => Date.parse(run.updatedAt)));
    greens.push((last - first) / 1000);
  }
  return greens;
}

function groups(entries, key, value) {
  const found = new Map();
  for (const entry of entries) {
    const name = key(entry);
    const length = value(entry);
    if (!name || !Number.isFinite(length)) continue;
    const list = found.get(name) ?? [];
    list.push(length);
    found.set(name, list);
  }
  return [...found.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([work, list]) => ({ work, samples: list.length, median: median(list) }))
    .sort((left, right) => right.median - left.median);
}

export function summarize(app, allRows, jobsByRun = new Map(), { excluded = new Set(), commits = null } = {}) {
  const rows = allRows.filter(row => row);
  const measured = rows.filter(row => !IDLE.has(row.conclusion) && !row.unreadable);
  const jobEntries = [];
  const stepEntries = [];
  for (const row of measured) {
    for (const job of jobsByRun.get(row.id) ?? []) {
      if (IDLE.has(job.conclusion ?? '')) continue;
      jobEntries.push({ work: `${row.workflow} / ${job.name}`, seconds: seconds(job.started_at, job.completed_at) });
      for (const step of job.steps ?? []) {
        if (IDLE.has(step.conclusion ?? '')) continue;
        stepEntries.push({ work: `${job.name} / ${step.name}`, seconds: seconds(step.started_at, step.completed_at), bucket: classifyStep(step.name) });
      }
    }
  }
  const greens = pushToGreen(commits ?? commitRuns(rows), excluded);
  const completed = measured;
  const pick = field => completed.map(row => row[field]);
  return {
    name: app.name,
    label: app.label,
    repo: app.repo,
    factory: app.factory,
    runs: completed.length,
    skipped: rows.filter(row => row && IDLE.has(row.conclusion)).length,
    greenPushes: greens.length,
    clipped: completed.filter(row => row.clipped).length,
    unreadable: rows.filter(row => row.unreadable).length,
    pushToGreen: {
      median: median(greens),
      p90: percentile(greens, 0.9),
      withinTarget: greens.filter(value => value <= TARGET_SECONDS).length,
      share: greens.length ? Math.round((100 * greens.filter(value => value <= TARGET_SECONDS).length) / greens.length) : 0,
    },
    median: {
      waiting: median(pick('waiting')),
      wall: median(pick('wall')),
      worker: median(completed.map(row => row.setup + row.tests + row.other)),
      setup: median(pick('setup')),
      tests: median(pick('tests')),
      other: median(pick('other')),
      gap: median(pick('gap')),
    },
    p90: { waiting: percentile(pick('waiting'), 0.9), wall: percentile(pick('wall'), 0.9) },
    slowSpots: groups(jobEntries, entry => entry.work, entry => entry.seconds).slice(0, 3),
    setupSteps: groups(stepEntries.filter(entry => entry.bucket === 'setup'), entry => entry.work, entry => entry.seconds).slice(0, 3),
  };
}

export function appFromFixture(entry, limit = Infinity) {
  const rows = entry.runs.map(run => decomposeRun(run, entry.jobs?.[String(run.id)] ?? [])).filter(Boolean);
  const jobsByRun = new Map(entry.runs.map(run => [run.id, entry.jobs?.[String(run.id)] ?? []]));
  const excluded = new Set(entry.runs.filter(run => run.status && run.status !== 'completed').map(run => run.head_sha));
  return summarize(entry, rows.slice(0, limit), jobsByRun, { excluded, commits: commitRuns(rows) });
}

function fetchJson(repo, path) {
  return new Promise((done, fail) => {
    execFile('gh', ['api', '-H', 'Accept: application/vnd.github+json', `repos/${repo}${path}`], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000,
    }, (error, stdout) => {
      if (error) return fail(new Error(`gh api failed for ${repo}${path}`));
      try {
        return done(JSON.parse(stdout));
      } catch {
        return fail(new Error(`gh api returned non-JSON for ${repo}${path}`));
      }
    });
  });
}

async function pages(gh, repo, path, key = 'workflow_runs') {
  const found = [];
  for (let page = 1; ; page++) {
    const payload = await gh(repo, `${path}&page=${page}`);
    const batch = payload[key] ?? [];
    found.push(...batch);
    if (batch.length < 100) return found;
  }
}

async function pool(tasks, width = 8) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker));
  return results;
}

export async function collectApp(app, { limit, gh = fetchJson }) {
  const all = [];
  for (let page = 1; ; page++) {
    const payload = await gh(app.repo, `/actions/runs?per_page=100&page=${page}`);
    const batch = payload.workflow_runs ?? [];
    all.push(...batch);
    if (batch.length < 100 || all.filter(run => run.status === 'completed').length > limit) break;
  }
  const completed = all.filter(run => run.status === 'completed');
  const kept = completed.slice(0, limit);
  const excluded = new Set([
    ...all.filter(run => run.status !== 'completed').map(run => run.head_sha),
    ...completed.slice(limit).map(run => run.head_sha),
  ].filter(Boolean));
  const shas = [...new Set(kept.map(run => run.head_sha).filter(Boolean))];
  const coverage = await pool(shas.map(sha => () => pages(gh, app.repo, `/actions/runs?head_sha=${sha}&per_page=100`).catch(() => null)));
  const commits = new Map();
  shas.forEach((sha, index) => {
    const runs = coverage[index];
    if (!runs || !runs.length) {
      excluded.add(sha);
      return;
    }
    commits.set(sha, runs.map(run => ({
      conclusion: run.conclusion ?? '', status: run.status ?? '', createdAt: run.created_at, updatedAt: run.updated_at, unreadable: false,
    })));
  });
  const fetched = await pool(kept.map(run => () => pages(gh, app.repo, `/actions/runs/${run.id}/attempts/${run.run_attempt ?? 1}/jobs?per_page=100`, 'jobs')
    .then(jobs => ({ jobs })).catch(() => ({ jobs: null }))));
  const jobsByRun = new Map(kept.map((run, index) => [run.id, fetched[index].jobs ?? []]));
  const rows = kept.map((run, index) => fetched[index].jobs === null
    ? { id: run.id, sha: run.head_sha ?? '', unreadable: true, conclusion: run.conclusion ?? '' }
    : decomposeRun(run, fetched[index].jobs)).filter(Boolean);
  for (const row of rows) if (row.unreadable && row.sha) excluded.add(row.sha);
  const newest = all[0]?.head_sha;
  if (newest) excluded.add(newest);
  return { app, rows, jobsByRun, excluded, commits };
}

export function fmt(value) {
  if (value === null || value === undefined) return '-';
  if (value < 90) return `${value.toFixed(0)}s`;
  return `${(value / 60).toFixed(1)}m`;
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\\': '&#92;', '|': '&#124;' };
const escape = text => String(text ?? '').replace(/[&<>"'\\|]/g, character => ENTITIES[character]);

export function formatHtml(summaries, { limit, generatedAt = new Date().toISOString(), command }) {
  const cell = (row, value) => `<td${row === 'push-to-green' ? ' class="lead"' : ''}>${escape(fmt(value))}</td>`;
  const appTable = summaries.map(summary => `
    <h2>${escape(summary.label)} <span class="meta">${escape(summary.factory)} · ${escape(summary.repo)} · ${summary.runs} runs measured${summary.skipped ? ` · ${summary.skipped} skipped` : ''}${summary.unreadable ? ` · ${summary.unreadable} unreadable` : ''}</span></h2>
    <table>
      <tr><th>Measure</th><th>Median</th><th>p90</th></tr>
      <tr class="lead"><td>push to all green</td><td>${escape(fmt(summary.pushToGreen.median))}</td><td>${escape(fmt(summary.pushToGreen.p90))}</td></tr>
      <tr><td>green pushes inside ${TARGET_SECONDS / 60} minutes</td><td>${summary.pushToGreen.withinTarget} of ${summary.greenPushes} (${summary.pushToGreen.share}%)</td><td>-</td></tr>
      ${[['waiting (queue)', summary.median.waiting, summary.p90.waiting], ['run wall clock', summary.median.wall, summary.p90.wall]]
    .map(([name, middle, tail]) => `<tr><td>${escape(name)}</td>${cell('m', middle)}${cell('m', tail)}</tr>`).join('')}
      ${[['setup (worker time)', summary.median.setup], ['tests (worker time)', summary.median.tests], ['other work (worker time)', summary.median.other], ['run time outside jobs', summary.median.gap]]
    .map(([name, middle]) => `<tr><td>${escape(name)}</td>${cell('m', middle)}<td>-</td></tr>`).join('')}
    </table>
    <table class="spots">
      <tr><th>Slow spot (median)</th><th>Median</th><th>Samples</th></tr>
      ${[...summary.slowSpots, ...summary.setupSteps].map(spot => `<tr><td>${escape(spot.work)}</td><td>${escape(fmt(spot.median))}</td><td>${spot.samples}</td></tr>`).join('')}
    </table>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Where check time goes</title>
<style>
:root{--bg-pageBackground:#0e0e0e;--bg-containerBackground:#212429;--color-white-black:#ffffff;--color-text-light-gray:#8e9093;--border-light-gray-thin:#33373e}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;margin:0;padding:32px;background:var(--bg-pageBackground);color:var(--color-white-black)}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}.meta{color:var(--color-text-light-gray);font-size:13px;font-weight:400}
table{border-collapse:collapse;margin:0 0 8px;min-width:520px}th,td{text-align:left;padding:6px 14px 6px 0;border-bottom:1px solid var(--border-light-gray-thin)}
th{color:var(--color-text-light-gray);font-weight:600;font-size:13px}.lead td{font-weight:700;color:var(--color-white-black)}.spots td:first-child{color:var(--color-white-black)}
p.def{color:var(--color-text-light-gray);font-size:13px;max-width:820px}code{background:var(--bg-containerBackground);padding:2px 6px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>Where check time goes</h1>
<p class="def">Last ${limit} completed check runs per app, generated ${escape(generatedAt)}. Waiting is the queue from a run being created to a runner starting it. Setup covers checkout, installs and builds; tests covers the checks themselves. Both sum step time across every job, so parallel jobs add up to more than the wall clock. Run time outside jobs is wall clock no job was executing. Push to all green counts commits with no failed, timed-out or action-required run, from the first run created for that commit to the last one finishing; skipped runs from path filters never block it.</p>
${appTable}
<p class="def">Rerun any time: <code>${escape(command)}</code>. Every number comes from GitHub Actions timestamps: <code>created_at</code>, <code>run_started_at</code>, <code>updated_at</code> and each step's <code>started_at</code>/<code>completed_at</code>.</p>
</body></html>`;
}

export function formatMarkdown(summaries, { limit, generatedAt = new Date().toISOString(), command }) {
  const rows = summary => [
    `| Push to all green | ${fmt(summary.pushToGreen.median)} | ${fmt(summary.pushToGreen.p90)} |`,
    `| Waiting (queue) | ${fmt(summary.median.waiting)} | ${fmt(summary.p90.waiting)} |`,
    `| Run wall clock | ${fmt(summary.median.wall)} | ${fmt(summary.p90.wall)} |`,
    `| Setup (worker time) | ${fmt(summary.median.setup)} | - |`,
    `| Tests (worker time) | ${fmt(summary.median.tests)} | - |`,
    `| Other work (worker time) | ${fmt(summary.median.other)} | - |`,
    `| Run time outside jobs | ${fmt(summary.median.gap)} | - |`,
    `| Green pushes inside ${TARGET_SECONDS / 60} minutes | ${summary.pushToGreen.withinTarget} of ${summary.greenPushes} (${summary.pushToGreen.share}%) | - |`,
  ].join('\n');
  const spots = summary => [...summary.slowSpots, ...summary.setupSteps]
    .map(spot => `| ${escape(spot.work)} | ${fmt(spot.median)} | ${spot.samples} |`).join('\n');
  return [
    '# Where check time goes',
    '',
    `Last ${limit} completed check runs per app, generated ${generatedAt}.`,
    '',
    'Waiting is the queue from a run being created to a runner starting it. Setup covers checkout, installs and builds; tests covers the checks themselves. Both are summed across every job, so parallel jobs add up to more than the wall clock. Run time outside jobs is wall clock no job was executing. Push to all green counts commits with no failed, timed-out or action-required run, from the first run created for that commit to the last one finishing; skipped runs never block it.',
    '',
    ...summaries.flatMap(summary => [
      `## ${escape(summary.label)} (${escape(summary.factory)})`,
      '',
      `${escape(summary.repo)}. ${summary.runs} runs measured, ${summary.skipped} skipped, ${summary.greenPushes} green commits${summary.unreadable ? `, ${summary.unreadable} unreadable runs left out` : ''}.`,
      '',
      '| Measure | Median | p90 |',
      '|---|---|---|',
      rows(summary),
      '',
      '**Slowest spots**',
      '',
      '| Spot | Median | Samples |',
      '|---|---|---|',
      spots(summary),
      '',
    ]),
    `Rerun: \`${command}\``,
  ].join('\n');
}

export function formatText(summaries, { limit }) {
  const lines = [`Check time, last ${limit} completed runs per app`];
  for (const summary of summaries) {
    lines.push('');
    lines.push(`${summary.label} (${summary.repo}, ${summary.runs} runs measured, ${summary.skipped} skipped, ${summary.greenPushes} green commits${summary.unreadable ? `, ${summary.unreadable} unreadable left out` : ''})`);
    lines.push(`  push to all green: median ${fmt(summary.pushToGreen.median)}, p90 ${fmt(summary.pushToGreen.p90)}`);
    lines.push(`  green pushes inside ${TARGET_SECONDS / 60} minutes: ${summary.pushToGreen.withinTarget} of ${summary.greenPushes} (${summary.pushToGreen.share}%)`);
    lines.push(`  waiting ${fmt(summary.median.waiting)} | wall ${fmt(summary.median.wall)}`);
    lines.push(`  worker time: setup ${fmt(summary.median.setup)} | tests ${fmt(summary.median.tests)} | other ${fmt(summary.median.other)} | outside jobs ${fmt(summary.median.gap)}`);
    for (const spot of summary.slowSpots) lines.push(`  slow: ${spot.work} ${fmt(spot.median)} (${spot.samples})`);
    for (const spot of summary.setupSteps) lines.push(`  setup: ${spot.work} ${fmt(spot.median)} (${spot.samples})`);
  }
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log(usage);
    return;
  }
  const options = { limit: 150, json: false, markdown: false, out: null, fixture: null, repos: null };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--json') options.json = true;
    else if (value === '--markdown') options.markdown = true;
    else if (value === '--out') options.out = args[++index];
    else if (value === '--fixture') options.fixture = args[++index];
    else if (value === '--repos') options.repos = args[++index];
    else if (value === '--limit') options.limit = Number(args[++index]);
    else throw new Error(usage);
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('--limit must be a positive integer');
  const apps = options.repos
    ? options.repos.split(',').map(repo => repo.trim()).filter(Boolean).map(repo => {
      const known = APPS.find(app => app.repo === repo);
      return known ?? { name: repo.split('/').pop(), label: repo.split('/').pop(), repo, factory: 'Other' };
    })
    : APPS;
  const summaries = [];
  if (options.fixture) {
    const payload = JSON.parse(readFileSync(options.fixture, 'utf8'));
    const wanted = new Set(apps.map(app => app.repo));
    summaries.push(...(payload.apps ?? [])
      .filter(entry => wanted.has(entry.repo))
      .map(entry => appFromFixture(entry, options.limit)));
  } else {
    for (const app of apps) {
      const { rows, jobsByRun, excluded, commits } = await collectApp(app, { limit: options.limit });
      summaries.push(summarize(app, rows, jobsByRun, { excluded, commits }));
    }
  }
  const command = `node scripts/ci-check-time.mjs --limit ${options.limit}${options.repos ? ` --repos ${options.repos}` : ''} --out ci-check-time.html`;
  if (options.json) {
    console.log(JSON.stringify({ limit: options.limit, apps: summaries, clipped: summaries.reduce((sum, summary) => sum + summary.clipped, 0) }, null, 2));
    return;
  }
  if (options.out) {
    const write = options.markdown ? formatMarkdown : formatHtml;
    writeFileSync(options.out, write(summaries, { limit: options.limit, command }));
    console.log(`Wrote ${options.out}`);
    console.log(formatText(summaries, { limit: options.limit }));
    return;
  }
  console.log(formatText(summaries, { limit: options.limit }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
