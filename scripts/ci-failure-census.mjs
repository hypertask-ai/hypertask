#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';

const failed = conclusion => ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(conclusion);
const usage = 'Usage: node scripts/ci-failure-census.mjs --workflow ci-tests.yml --limit 100';

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

export function collectCensus({ workflow, limit, repo }, api) {
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
        logs[job.id] = api(`/actions/jobs/${job.id}/logs`, true);
      } catch {
        unavailableLogs++;
      }
    }
    rows.push(...failureRows(run, jobs, workflows.get(key), logs));
  }
  return `${repo}: ${workflow}\n${formatCensus(rows, runs.length)}\nUnavailable job logs: ${unavailableLogs}`;
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const options = { workflow: 'ci-tests.yml', limit: 100 };
  for (let index = 0; index < args.length; index += 2) {
    if (!['--workflow', '--limit'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(usage);
    options[args[index].slice(2)] = args[index + 1];
  }
  options.limit = Number(options.limit);
  if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('--limit must be a positive integer');
  options.repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8', timeout: 30000 }).trim();
  const api = (path, raw = false) => {
    const output = execFileSync('gh', ['api', '--method', 'GET', '--allow-escape-sequences', '-H', `Accept: ${raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'}`, `repos/${options.repo}${path}`], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return raw ? output : JSON.parse(output);
  };
  console.log(collectCensus(options, api));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message.startsWith('Command failed:') ? 'Census failed: gh request failed; check authentication and repository access.' : error.message);
    process.exitCode = 1;
  }
}
