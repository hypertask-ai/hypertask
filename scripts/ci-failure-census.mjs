#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { classifyActionsLog } from './flaky-log.mjs';

const RED = ['failure', 'timed_out', 'startup_failure', 'action_required'];
const failed = conclusion => RED.includes(conclusion);
const usage = [
  'Usage: node scripts/ci-failure-census.mjs --workflow ci-tests.yml --limit 100',
  '       node scripts/ci-failure-census.mjs --classes --since YYYY-MM-DD [--day YYYY-MM-DD] [--branch production] [--out report.md]',
].join('\n');

export function firstError(log, step) {
  let command = false;
  for (const raw of log.split('\n')) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/^\uFEFF/, '');
    const match = line.match(/^(\d{4}-\d\d-\d\dT\S+Z)\s(.*)$/);
    const text = (match?.[2] ?? line).trim();
    if (text.startsWith('##[group]Run ')) command = true;
    if (text.startsWith('##[endgroup]')) command = false;
    if (command) continue;
    if (match && step?.started_at && step?.completed_at) {
      const time = Date.parse(match[1]);
      if (time < Date.parse(step.started_at) || time >= Date.parse(step.completed_at) + 1000) continue;
    }
    if (/##\[error\]|\b(?:AssertionError|TypeError|ReferenceError|SyntaxError|Error):|\berror TS\d+|\brate limit (?:exceeded|wait cap exceeded)|^gh:.*\(HTTP [45]\d\d\)|^\s*(?:fatal:|error\b|not ok\b|FAIL\b|npm (?:ERR!|error)\b|[✖×❌])/i.test(text)) {
      return text.replace(/^##\[error\]/, '').trim();
    }
  }
  return 'No error line found';
}

export function failureRows(run, jobs, workflow, logs = {}) {
  let definitions = [];
  try {
    definitions = Object.entries(load(workflow)?.jobs ?? {});
  } catch (error) {
    if (error.name !== 'YAMLException') throw error;
  }
  const jobId = job => definitions.find(([id, definition]) => {
    const name = String(definition.name ?? id);
    return job.name === name || job.name.startsWith(`${name} (`);
  })?.[0];
  const failedIds = new Set(jobs.filter(job => failed(job.conclusion)).map(jobId).filter(Boolean));
  return jobs.filter(job => failed(job.conclusion)).flatMap(job => {
    const definition = definitions.find(([id]) => id === jobId(job))?.[1];
    const needs = definition?.needs ?? [];
    const cascade = definition ? (Array.isArray(needs) ? needs : [needs]).some(id => failedIds.has(id)) : null;
    const steps = (job.steps ?? []).filter(step => failed(step.conclusion));
    return (steps.length ? steps : [{ name: '(no failing step reported)' }]).map(step => ({
      run: run.id,
      event: run.event,
      branch: run.head_branch,
      job: job.name,
      step: step.name,
      error: logs[job.id] == null ? 'Log unavailable' : firstError(logs[job.id], step),
      cascade,
    }));
  });
}

export function stepCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const count = counts.get(row.step) ?? { step: row.step, failures: 0, cascades: 0 };
    count.failures++;
    if (row.cascade) count.cascades++;
    counts.set(row.step, count);
  }
  return [...counts.values()].sort((a, b) => b.failures - a.failures || a.step.localeCompare(b.step));
}

function table(headers, rows) {
  const cell = value => String(value ?? '-').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\|/g, '\\|');
  return [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.map(cell).join(' | ')} |`).join('\n');
}

export function formatCensus(rows, runCount) {
  return [
    `Scanned ${runCount} runs; ${new Set(rows.map(row => row.run)).size} failing runs; ${rows.length} failing steps.`,
    table(['Run', 'Event', 'Branch', 'Failing job', 'Failing step', 'First error'], rows.map(row => {
      let job = row.job;
      if (row.cascade === null) job += ' (cascade unknown)';
      else if (row.cascade) job += ' (cascade)';
      return [row.run, row.event, row.branch, job, row.step, row.error];
    })),
    `Cascade classification unavailable for ${rows.filter(row => row.cascade === null).length} failing steps (invalid workflow YAML or unmatched job name).`,
    '\nCounts per step (includes cascades; counts failing step occurrences, not unique runs)',
    table(['Step', 'Failures', 'Cascades'], stepCounts(rows).map(count => [count.step, count.failures, count.cascades])),
  ].join('\n');
}

export function collectCensus({ workflow, limit, repo }, api, loadLog = (run, job) => api(`/actions/jobs/${job}/logs`, true)) {
  const runs = [];
  const perPage = Math.min(100, limit);
  for (let page = 1; runs.length < limit; page++) {
    const batch = api(`/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=${perPage}&page=${page}`).workflow_runs;
    runs.push(...batch.slice(0, limit - runs.length));
    if (batch.length < perPage) break;
  }
  const workflows = new Map();
  const rows = [];
  let unavailableLogs = 0;
  for (const run of runs.filter(run => failed(run.conclusion))) {
    const jobs = [];
    for (let page = 1; ; page++) {
      const batch = api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`).jobs;
      jobs.push(...batch);
      if (batch.length < 100) break;
    }
    if (!jobs.some(job => failed(job.conclusion))) {
      rows.push({ run: run.id, event: run.event, branch: run.head_branch, job: '(no failing job reported)', step: '(no failing step reported)', error: `Run conclusion: ${run.conclusion}; no failing job returned by GitHub`, cascade: null });
      continue;
    }
    const key = `${run.head_sha}:${run.path}`;
    if (!workflows.has(key)) {
      const path = run.path.split('@')[0].split('/').map(encodeURIComponent).join('/');
      workflows.set(key, api(`/contents/${path}?ref=${run.head_sha}`, true));
    }
    const logs = {};
    for (const job of jobs.filter(job => failed(job.conclusion))) {
      try {
        logs[job.id] = loadLog(run.id, job.id);
      } catch {
        unavailableLogs++;
      }
    }
    rows.push(...failureRows(run, jobs, workflows.get(key), logs));
  }
  return `${repo}: ${workflow}\n${formatCensus(rows, runs.length)}\nUnavailable job logs: ${unavailableLogs}`;
}

export function redClass({ conclusion, kind, rerunPassed, prGreen, prSeen }) {
  if (['startup_failure', 'action_required'].includes(conclusion) || kind === 'infra') return 'infra';
  if (rerunPassed) return 'flaky';
  if (prGreen) return 'production-only';
  if (prSeen) return 'break';
  return 'unattributed';
}

const HOUR = 3600000;
const day = time => new Date(time).toISOString().slice(0, 10);

export function redWindows(runs) {
  const greens = runs.filter(run => run.conclusion === 'success');
  const latest = runs.reduce((last, run) => Math.max(last, Date.parse(run.updated_at ?? run.created_at)), 0);
  const windows = [];
  for (const run of runs) {
    const start = Date.parse(run.created_at);
    if (failed(run.conclusion)) {
      const end = greens.map(green => Date.parse(green.updated_at)).filter(time => time > start).sort((a, b) => a - b)[0] ?? latest;
      windows.push({ class: run.class ?? 'break', start, end });
    } else if (run.conclusion === 'success' && run.recovered) {
      windows.push({ class: 'flaky', start, end: Date.parse(run.updated_at) });
    }
  }
  return windows.filter(window => window.end > window.start).sort((a, b) => a.start - b.start || a.end - b.end);
}

export function redSegments(windows) {
  const points = [...new Set(windows.flatMap(window => [window.start, window.end]))].sort((a, b) => a - b);
  const segments = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    const covering = windows.filter(window => window.start <= start && window.end >= end);
    if (covering.length) segments.push({ class: covering.reduce((first, window) => (window.start < first.start ? window : first)).class, start, end });
  }
  return segments;
}

export function hoursByWindow(windows) {
  const segments = redSegments(windows);
  const byClass = new Map();
  const byDay = new Map();
  const add = (map, key, hours) => map.set(key, (map.get(key) ?? 0) + hours);
  for (const window of segments) {
    let cursor = window.start;
    while (cursor < window.end) {
      const nextDay = Date.parse(`${day(cursor)}T00:00:00Z`) + 24 * HOUR;
      const end = Math.min(window.end, nextDay);
      add(byClass, window.class, (end - cursor) / HOUR);
      add(byDay, day(cursor), (end - cursor) / HOUR);
      cursor = end;
    }
  }
  return {
    byClass: [...byClass].map(([name, hours]) => ({ class: name, hours })).sort((a, b) => b.hours - a.hours || a.class.localeCompare(b.class)),
    byDay: [...byDay].map(([name, hours]) => ({ day: name, hours })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

function round(hours) {
  return Math.round(hours * 100) / 100;
}

export function formatClasses({ workflow, branch, since, runs, evidence }) {
  const reds = runs.filter(run => failed(run.conclusion));
  const recovered = runs.filter(run => run.conclusion === 'success' && run.recovered);
  const { byClass, byDay } = hoursByWindow(redWindows(runs.map(run => ({
    ...run,
    class: evidence.find(item => item.run.id === run.id)?.class,
  }))));
  const byJob = [...evidence.reduce((counts, item) => {
    const entry = counts.get(item.job) ?? { job: item.job, reds: 0, classes: new Set() };
    entry.reds++;
    entry.classes.add(item.class);
    return counts.set(item.job, entry);
  }, new Map()).values()].sort((a, b) => b.reds - a.reds || a.job.localeCompare(b.job)).map(entry => [entry.job, entry.reds, [...entry.classes].sort().join(', ')]);
  const cells = [
    `# Production CI reds by class`,
    ``,
    `${workflow} on ${branch}, since ${since}. ${runs.length} runs, ${reds.length} red, ${recovered.length} red then green on rerun.`,
    ``,
    `## Red hours lost per class`,
    ``,
    table(['Class', 'Hours', 'Share'], byClass.map(row => [row.class, round(row.hours), `${Math.round((row.hours / byClass.reduce((sum, item) => sum + item.hours, 0)) * 100)}%`])),
    ``,
    `## Red hours per day`,
    ``,
    table(['Day', 'Hours'], byDay.map(row => [row.day, round(row.hours)])),
    ``,
    `## Red hours per failing job`,
    ``,
    table(['Failing job', 'Reds', 'Classes'], byJob),
    ``,
    `## Every red run`,
    ``,
    table(['Run', 'Started', 'Class', 'Failing job', 'Failing step', 'Evidence'], evidence.map(item => [
      item.run.id,
      item.run.created_at,
      item.class,
      item.job,
      item.step,
      item.evidenceLine,
    ])),
    ``,
    `## Red then green on rerun`,
    ``,
    table(['Run', 'Started', 'Branch', 'Attempts'], recovered.map(run => [run.id, run.created_at, run.head_branch, run.run_attempt])),
  ];
  return cells.join('\n');
}

async function parallelMap(items, limit, load) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await load(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function collectClasses(options, api, logs) {
  const workflow = encodeURIComponent(options.workflow);
  const runs = [];
  for (let page = 1; ; page++) {
    const query = `/actions/workflows/${workflow}/runs?per_page=100&branch=${encodeURIComponent(options.branch)}&created=${encodeURIComponent(`>=${options.since}T00:00:00Z`)}&page=${page}`;
    const batch = (await api(query)).workflow_runs;
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  await parallelMap(runs.filter(run => run.conclusion === 'success' && Number(run.run_attempt) > 1), 6, async run => {
    run.recovered = false;
    if (!run.previous_attempt_url) return run;
    try {
      const { jobs } = await api(`/actions/runs/${run.id}/attempts/1/jobs?per_page=100`);
      run.recovered = jobs.some(job => failed(job.conclusion));
    } catch {
      run.recovered = Boolean(run.previous_attempt_url);
    }
    return run;
  });
  const evidence = await parallelMap(runs.filter(run => failed(run.conclusion)), 6, async run => {
    const jobs = [];
    try {
      for (let page = 1; ; page++) {
        const batch = (await api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`)).jobs;
        jobs.push(...batch);
        if (batch.length < 100) break;
      }
    } catch (error) {
      return { run, job: '(jobs unavailable)', step: '(unknown)', evidenceLine: `GitHub refused this run: ${error.message}`, rerunPassed: false, prGreen: false, prSeen: false, class: redClass({ conclusion: run.conclusion }) };
    }
    const failing = jobs.filter(job => failed(job.conclusion));
    const logged = [];
    for (const job of failing) {
      let log = '';
      try {
        log = await withRetry(() => logs(run.id, job.id));
      } catch {
        log = '';
      }
      const step = (job.steps ?? []).find(candidate => failed(candidate.conclusion));
      logged.push({ job: job.name, step: step?.name ?? '(no failing step reported)', ...classifyActionsLog(log) });
    }
    const infra = logged.find(item => item.kind === 'infra');
    const kind = infra ? 'infra' : logged.find(item => item.kind === 'test') ? 'test' : 'other';
    const evidenceLine = (infra ?? logged.find(item => item.kind === 'test') ?? logged[0])?.evidenceLine ?? 'No error line found';
    const rerunPassed = runs.some(other => other.id !== run.id && other.head_sha === run.head_sha && other.conclusion === 'success' && Date.parse(other.created_at) > Date.parse(run.created_at));
    let prGreen = false;
    let prSeen = false;
    if (!infra) {
      try {
        const pull = (await api(`/commits/${run.head_sha}/pulls`)).find(candidate => candidate.merged_at);
        if (pull) {
          const head = await api(`/actions/workflows/${workflow}/runs?head_sha=${pull.head.sha}&per_page=1`);
          const latest = head.workflow_runs[0]?.conclusion;
          prGreen = latest === 'success';
          prSeen = failed(latest);
        }
      } catch {
        prSeen = false;
      }
    }
    const evidenceItem = infra ?? logged.find(item => item.kind === 'test') ?? logged[0];
    return {
      run,
      job: evidenceItem?.job ?? '(no failing job reported)',
      step: evidenceItem?.step ?? '(no failing step reported)',
      evidenceLine,
      rerunPassed,
      prGreen,
      class: redClass({ conclusion: run.conclusion, kind, rerunPassed, prGreen, prSeen }),
    };
  });
  return formatClasses({ workflow: options.workflow, branch: options.branch, since: options.since, runs, evidence });
}

const FLAGS = ['--workflow', '--limit', '--since', '--branch', '--out'];

export function parseArgs(args) {
  const options = { workflow: 'ci-tests.yml', limit: 100, branch: 'production' };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--classes') {
      options.classes = true;
      continue;
    }
    const value = args[index + 1];
    if (!FLAGS.includes(args[index]) || !value || value.startsWith('--')) throw new Error(usage);
    options[args[index].slice(2)] = value;
    index++;
  }
  options.limit = Number(options.limit);
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('--limit must be a positive integer');
  if (options.classes && !/^\d{4}-\d\d-\d\d$/.test(options.since ?? '')) throw new Error('--classes needs --since YYYY-MM-DD');
  return options;
}

const failedLogArgs = (repo, run, job) => ['run', 'view', String(run), '-R', repo, '--log-failed', '--job', String(job)];

const ghArgs = (repo, path, raw = false) => ['api', '--method', 'GET', '--allow-escape-sequences', '-H', `Accept: ${raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'}`, `repos/${repo}${path}`];

const transient = /HTTP 5\d\d|Server Error|rate limit (?:exceeded|wait cap exceeded)/i;

async function withRetry(load, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await load();
    } catch (error) {
      if (attempt >= attempts || !transient.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** (attempt - 1)));
    }
  }
}

function asyncApi(repo) {
  const request = (path, raw = false) => new Promise((resolve, reject) => {
    const child = spawn('gh', ghArgs(repo, path, raw));
    let output = '';
    let error = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`${error.trim() || `gh exited ${code}`} for ${path}`));
      return resolve(raw ? output : JSON.parse(output));
    });
  });
  return (path, raw = false) => withRetry(() => request(path, raw));
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const options = parseArgs(args);
  options.repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8', timeout: 30000 }).trim();
  const text = options.classes
    ? await collectClasses(options, asyncApi(options.repo), (run, job) => new Promise((resolve, reject) => {
      const child = spawn('gh', failedLogArgs(options.repo, run, job));
      let output = '';
      let error = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', reject);
      child.on('close', code => (code === 0 ? resolve(output) : reject(new Error(error.trim() || `gh exited ${code}`))));
    }))
    : collectCensus(options, (path, raw = false) => {
      const result = execFileSync('gh', ghArgs(options.repo, path, raw), {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      return raw ? result : JSON.parse(result);
    }, (run, job) => execFileSync('gh', failedLogArgs(options.repo, run, job), {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    }));
  if (options.out) writeFileSync(options.out, `${text}\n`);
  console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message.startsWith('Command failed:') ? 'Census failed: gh request failed; check authentication and repository access.' : error.message);
    process.exitCode = 1;
  });
}
