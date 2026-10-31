#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { failureRows } from './ci-failure-census.mjs';
import { testFile } from './flaky-log.mjs';

const WORKFLOW = 'ci-tests.yml';
const PROJECT_ID = Number(process.env.CI_FAILURE_LOG_PROJECT_ID || 11514);
const SECTION_ID = Number(process.env.CI_FAILURE_LOG_SECTION_ID || 32923);
const APP_URL = (process.env.CI_FAILURE_LOG_APP_URL || 'https://app.hypertask.ai').replace(/\/$/, '');
const MIN_LINES = 2;
const LOG_PATH = 'ci-failure-log.jsonl';
const LOG_BRANCH = 'ci-failure-log';
const failed = conclusion => ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(conclusion);
const usage = 'Usage: node scripts/ci-failure-log.mjs --seed <days>|--report <file>|--file <file>|--append --run <id>|--print-fixture <file>';

function slug(value, limit = 60) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[0-9a-f]{7,40}/g, 'sha')
    .replace(/\d+(?:\.\d+)?/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit)
    .replace(/-+$/g, '');
}

export function causeKey(entry) {
  const text = String(entry.error ?? '')
    .toLowerCase()
    .replace(/[0-9a-f]{7,40}/g, 'sha')
    .replace(/\d+(?:\.\d+)?/g, 'n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return [slug(entry.step, 40), slug(entry.job, 40), slug(text, 80)].filter(Boolean).join('|');
}

export function entryFor(run, rows) {
  const primary = rows.find(row => row.cascade !== true) ?? rows[0];
  if (!primary) return null;
  const entry = {
    at: run.created_at ?? new Date().toISOString(),
    run: run.id,
    attempt: run.run_attempt ?? 1,
    sha: run.head_sha ?? '',
    branch: run.head_branch ?? '',
    pr: run.pull_requests?.[0]?.number ?? null,
    job: primary.job,
    step: primary.step,
    error: primary.error,
    cascade: primary.cascade === true,
  };
  const test = testFile(entry.error);
  if (test) entry.test = test;
  entry.cause = causeKey(entry);
  return entry;
}

export function appendEntry(text, entry) {
  const key = `${entry.run}:${entry.attempt}`;
  const present = parseLog(text).some(item => `${item.run}:${item.attempt}` === key);
  if (present) return { text, added: false };
  const line = JSON.stringify(entry);
  return { text: text && !text.endsWith('\n') ? `${text}\n${line}\n` : `${text ?? ''}${line}\n`, added: true };
}

export function parseLog(text) {
  return String(text ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        const entry = JSON.parse(line);
        return entry && typeof entry.run === 'number' ? [entry] : [];
      } catch {
        return [];
      }
    });
}

export function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const cause = entry.cause || causeKey(entry);
    const group = groups.get(cause) ?? {
      cause, lines: 0, runs: [], branches: [], errors: [], tests: [], prs: [], flaky: false, first: entry.at, last: entry.at,
    };
    group.lines += 1;
    group.runs.push(entry.run);
    if (entry.branch && !group.branches.includes(entry.branch)) group.branches.push(entry.branch);
    if (entry.error && !group.errors.includes(entry.error)) group.errors.push(entry.error);
    if (entry.test && !group.tests.includes(entry.test)) group.tests.push(entry.test);
    if (entry.pr && !group.prs.includes(entry.pr)) group.prs.push(entry.pr);
    if (entry.flaky) group.flaky = true;
    if (String(entry.at) < String(group.first)) group.first = entry.at;
    if (String(entry.at) > String(group.last)) group.last = entry.at;
    groups.set(cause, group);
  }
  return [...groups.values()].sort((a, b) => b.lines - a.lines || a.cause.localeCompare(b.cause));
}

export function markFlaky(entries, greenRuns) {
  const green = new Map();
  for (const run of greenRuns) {
    const key = `${run.head_sha}:${run.head_branch}`;
    green.set(key, Math.max(green.get(key) ?? 0, Date.parse(run.created_at ?? 0) || 0));
  }
  return entries.map(entry => {
    const passed = green.get(`${entry.sha}:${entry.branch}`) ?? 0;
    const redAt = Date.parse(entry.at) || 0;
    return passed && redAt && passed > redAt ? { ...entry, flaky: true } : entry;
  });
}

export function ticketPlan(groups, existing = new Map()) {
  const create = [];
  const comment = [];
  for (const group of groups) {
    if (group.lines < MIN_LINES) continue;
    if (existing.has(group.cause)) comment.push({ group, task: existing.get(group.cause) });
    else create.push(group);
  }
  return { create, comment };
}

export function ticketTitle(group) {
  const [step, job] = group.cause.split('|');
  return `[INFRA] CI failure cause: ${step.replace(/-/g, ' ')} in ${job.replace(/-/g, ' ')}`.slice(0, 140);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ticketHtml(group, repo = 'hypertask-ai/hypertask') {
  const runLink = id => `<li><a href="https://github.com/${repo}/actions/runs/${id}">run ${id}</a></li>`;
  return [
    `<p><strong>Repeated CI cause.</strong> ${group.lines} red runs share this cause.</p>`,
    `<ul>`,
    `<li><strong>Cause:</strong> <code>${escapeHtml(group.cause)}</code></li>`,
    `<li><strong>Step:</strong> ${escapeHtml(group.cause.split('|')[0])}</li>`,
    `<li><strong>First error:</strong> <code>${escapeHtml(group.errors[0] ?? 'unknown')}</code></li>`,
    `<li><strong>Lines:</strong> ${group.lines}</li>`,
    `<li><strong>Flaky (failed then passed on the same code):</strong> ${group.flaky ? 'yes' : 'no'}</li>`,
    `<li><strong>First seen:</strong> ${escapeHtml(group.first)}</li>`,
    `<li><strong>Last seen:</strong> ${escapeHtml(group.last)}</li>`,
    `<li><strong>Branches:</strong> ${escapeHtml(group.branches.join(', '))}</li>`,
    `<li><strong>Tests:</strong> ${escapeHtml(group.tests.join(', ') || 'none')}</li>`,
    `</ul>`,
    `<p>Runs:</p><ul>${group.runs.map(runLink).join('')}</ul>`,
    `<p>Auto-filed by the CI failure log job. Fix the shared cause, not one change at a time.</p>`,
    `<!-- ci-failure-cause:${escapeHtml(group.cause)} -->`,
  ].join('');
}

export function commentHtml(group, repo = 'hypertask-ai/hypertask') {
  return [
    `<p><strong>Seen again.</strong> ${group.lines} red runs share this cause. Last seen ${escapeHtml(group.last)}.</p>`,
    `<ul>`,
    `<li><strong>First error:</strong> <code>${escapeHtml(group.errors[0] ?? 'unknown')}</code></li>`,
    `<li><strong>Flaky:</strong> ${group.flaky ? 'yes' : 'no'}</li>`,
    `<li><strong>Branches:</strong> ${escapeHtml(group.branches.join(', '))}</li>`,
    `</ul>`,
    `<ul>${group.runs.map(id => `<li><a href="https://github.com/${repo}/actions/runs/${id}">run ${id}</a></li>`).join('')}</ul>`,
  ].join('');
}

async function jsonRequest(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return body;
}

function mcpHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function fileTickets(groups, config) {
  const { create, comment } = ticketPlan(groups, config.existing ?? new Map());
  const limit = config.limit ?? create.length;
  const created = [];
  const commented = [];
  for (const group of create.slice(0, limit)) {
    const marker = `ci-failure-cause:${group.cause}`;
    const search = await jsonRequest(
      `${APP_URL}/api/mcp/tasks?project_id=${PROJECT_ID}&search=${encodeURIComponent(marker)}&limit=10`,
      { headers: mcpHeaders(config.token) },
      'CI failure cause search',
    );
    const found = (search.tasks ?? []).find(task => String(task.description ?? '').includes(marker));
    if (found) {
      commented.push({ group, task: found });
      continue;
    }
    const body = await jsonRequest(
      `${APP_URL}/api/mcp/tasks/create`,
      {
        method: 'POST',
        headers: { ...mcpHeaders(config.token), 'Idempotency-Key': `ci-failure-log-${group.cause}` },
        body: JSON.stringify({
          project_id: PROJECT_ID,
          section_id: SECTION_ID,
          title: ticketTitle(group),
          description: ticketHtml(group, config.repo),
          content_type: 'html',
          label_names: ['CI', 'Hypertask CI'],
        }),
      },
      'CI failure cause ticket creation',
    );
    created.push({ group, task: body.task });
  }
  for (const { group, task } of [...comment, ...commented]) {
    if (!task?.id) continue;
    await jsonRequest(
      `${APP_URL}/api/mcp/comments`,
      {
        method: 'POST',
        headers: { ...mcpHeaders(config.token), 'Idempotency-Key': `ci-failure-log-${group.cause}-${task.id}` },
        body: JSON.stringify({ task_id: task.id, text: commentHtml(group, config.repo), content_type: 'html', kind: 'agent' }),
      },
      'CI failure cause comment',
    );
  }
  return { created, commented: [...commented, ...comment] };
}

export function formatReport(groups) {
  const eligible = groups.filter(group => group.lines >= MIN_LINES);
  const rows = groups.map(group => [
    group.lines,
    group.flaky ? 'flaky' : 'repeats',
    group.first.slice(0, 10),
    group.last.slice(0, 10),
    group.cause,
    group.errors[0] ?? '',
  ]);
  const cell = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').slice(0, 160);
  const table = [['Lines', 'Kind', 'First', 'Last', 'Cause', 'First error'], ['---', '---', '---', '---', '---', '---'], ...rows]
    .map(row => `| ${row.map(cell).join(' | ')} |`)
    .join('\n');
  return [
    `CI failure log: ${groups.reduce((total, group) => total + group.lines, 0)} lines in ${groups.length} causes; ${eligible.length} causes have 2 or more lines.`,
    table,
    `groups=${groups.length} eligible=${eligible.length} ineligible=${groups.length - eligible.length}`,
  ].join('\n');
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 }).trim();
}

function apiClient() {
  return (path, raw = false) => {
    const output = gh(['api', '--method', 'GET', '--allow-escape-sequences', '-H', `Accept: ${raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'}`, `repos/${repoName()}${path}`]);
    return raw ? output : JSON.parse(output);
  };
}

let cachedRepo = '';
function repoName() {
  if (!cachedRepo) cachedRepo = process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  return cachedRepo;
}

let cachedToken = '';
function githubToken() {
  if (!cachedToken) cachedToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || gh(['auth', 'token']);
  return cachedToken;
}

export function jobLog(jobId) {
  return execFileSync('curl', ['-sL', '-H', `Authorization: Bearer ${githubToken()}`, `https://api.github.com/repos/${repoName()}/actions/jobs/${jobId}/logs`], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000,
  });
}

function ghApi(args, input) {
  return execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, timeout: 120000 }).trim();
}

function isNotFound(error) {
  return /HTTP 404|Not Found/i.test(error instanceof Error ? error.message : String(error));
}

function readLogRef() {
  try {
    return JSON.parse(ghApi([`repos/${repoName()}/contents/${LOG_PATH}?ref=${LOG_BRANCH}`]));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export function readLogFromBranch() {
  const current = readLogRef();
  return current ? Buffer.from(current.content ?? '', 'base64').toString('utf8') : '';
}

export function ensureLogBranch() {
  try {
    ghApi([`repos/${repoName()}/branches/${LOG_BRANCH}`]);
    return false;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const head = JSON.parse(ghApi([`repos/${repoName()}/git/ref/heads/${process.env.CI_FAILURE_LOG_BASE || 'production'}`]));
  ghApi(['--method', 'POST', `repos/${repoName()}/git/refs`, '--input', '-'],
    JSON.stringify({ ref: `refs/heads/${LOG_BRANCH}`, sha: head.object.sha }));
  return true;
}

export function publishEntry(entry) {
  ensureLogBranch();
  const current = readLogRef();
  const previous = current ? Buffer.from(current.content ?? '', 'base64').toString('utf8') : '';
  const { text, added } = appendEntry(previous, entry);
  const sha = current?.sha;
  if (!added) return { added: false, lines: parseLog(text).length };
  const payload = {
    message: `CI failure log: run ${entry.run} (${entry.branch})`,
    content: Buffer.from(text).toString('base64'),
    branch: LOG_BRANCH,
  };
  if (sha) payload.sha = sha;
  ghApi(['--method', 'PUT', `repos/${repoName()}/contents/${LOG_PATH}`, '--input', '-'], JSON.stringify(payload));
  return { added: true, lines: parseLog(text).length };
}

function runRows(run, api) {
  const jobs = [];
  for (let page = 1; ; page++) {
    const batch = api(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`).jobs;
    jobs.push(...batch);
    if (batch.length < 100) break;
  }
  if (!jobs.some(job => failed(job.conclusion))) return null;
  const path = run.path.split('@')[0].split('/').map(encodeURIComponent).join('/');
  const workflow = api(`/contents/${path}?ref=${run.head_sha}`, true);
  const logs = {};
  for (const job of jobs.filter(job => failed(job.conclusion))) {
    try {
      logs[job.id] = jobLog(job.id);
    } catch {
      logs[job.id] = null;
    }
  }
  return failureRows(run, jobs, workflow, logs);
}

export function applyFlaky(entries, api, workflow = WORKFLOW) {
  if (!entries.length) return entries;
  const since = entries.reduce((min, entry) => (String(entry.at) < min ? String(entry.at) : min), String(entries[0].at));
  const greens = [];
  for (let page = 1; page <= 10; page++) {
    const batch = api(`/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=100&page=${page}`).workflow_runs;
    greens.push(...batch.filter(run => run.conclusion === 'success'));
    if (batch.length < 100 || Date.parse(batch.at(-1).created_at) < Date.parse(since)) break;
  }
  return markFlaky(entries, greens);
}

export function seedEntries({ days, workflow = WORKFLOW, maxRuns = 80 }, api, now = Date.now(), progress = () => {}) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const runs = [];
  for (let page = 1; page <= 20; page++) {
    const batch = api(`/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=100&page=${page}`).workflow_runs;
    runs.push(...batch);
    if (batch.length < 100 || Date.parse(batch.at(-1).created_at) < cutoff) break;
  }
  const window = runs.filter(run => Date.parse(run.created_at) >= cutoff);
  const entries = [];
  const red = window.filter(run => failed(run.conclusion)).slice(0, maxRuns);
  for (const run of red) {
    const rows = runRows(run, api);
    const entry = rows && entryFor(run, rows);
    if (entry) entries.push(entry);
    progress(entries.length, red.length);
  }
  return { entries: markFlaky(entries, window.filter(run => run.conclusion === 'success')), runs: window.length };
}

export function appendRun({ runId }, api) {
  const run = api(`/actions/runs/${runId}`);
  const rows = runRows(run, api);
  return rows && entryFor(run, rows);
}

export function fixtureEntries(fixture) {
  return fixture.runs
    .filter(run => failed(run.conclusion))
    .flatMap(run => {
      const rows = failureRows(run, fixture.jobs[run.id] ?? [], fixture.workflow, fixture.logs ?? {});
      const entry = entryFor(run, rows);
      return entry ? [entry] : [];
    });
}

export async function main(args = process.argv.slice(2)) {
  const option = name => {
    const index = args.indexOf(name);
    return index === -1 ? '' : args[index + 1] ?? '';
  };
  if (args.includes('--help')) {
    console.log(usage);
    return;
  }
  if (args.includes('--print-fixture')) {
    const fixture = JSON.parse(readFileSync(option('--print-fixture'), 'utf8'));
    const entries = fixtureEntries(fixture);
    let text = '';
    for (const entry of entries) text = appendEntry(text, entry).text;
    const replay = entries.reduce((state, entry) => appendEntry(state, entry).text, text);
    const replayed = entries.reduce((added, entry) => added || appendEntry(replay, entry).added, false);
    console.log(`entryHashes=${entries.length} duplicateAppendRejected=${replayed ? 'no' : 'yes'}`);
    return;
  }
  if (args.includes('--report')) {
    const raw = readFileSync(option('--report'), 'utf8');
    let entries = parseLog(raw);
    let existing = new Map();
    if (!entries.length) {
      const parsed = JSON.parse(raw);
      entries = parsed.entries ?? [];
      existing = new Map((parsed.existing ?? []).map(task => [task.cause, task]));
    }
    const groups = groupEntries(entries);
    const plan = ticketPlan(groups, existing);
    console.log(formatReport(groups));
    if (existing.size || plan.create.length || plan.comment.length) console.log(`create=${plan.create.length} comment=${plan.comment.length}`);
    return;
  }
  const api = apiClient();
  if (args.includes('--seed')) {
    const days = Number(option('--seed')) || 14;
    const maxRuns = option('--max-runs') ? Number(option('--max-runs')) : 80;
    const { entries, runs } = seedEntries({ days, maxRuns }, api, Date.now(), (done, total) => {
      process.stderr.write(`\rseeded ${done}/${total} red runs`);
    });
    let text = '';
    for (const entry of entries) text = appendEntry(text, entry).text;
    const target = option('--log');
    if (target && !args.includes('--print-only')) writeFileSync(target, text);
    let published = 0;
    if (args.includes('--publish')) {
      for (const entry of entries) if (publishEntry(entry).added) published += 1;
    }
    console.log(`runsSeeded=${entries.length} runsScanned=${runs} published=${published}`);
    console.log(formatReport(groupEntries(entries)));
    return;
  }
  if (args.includes('--append')) {
    const entry = appendRun({ runId: option('--run') || process.env.CI_FAILURE_RUN_ID }, api);
    if (!entry) {
      console.log('added=none reason=no-failing-row');
      return;
    }
    if (args.includes('--publish')) {
      const result = publishEntry(entry);
      console.log(`added=${result.added ? 'yes' : 'no'} cause=${entry.cause} run=${entry.run} lines=${result.lines}`);
      return;
    }
    const target = option('--log') || LOG_PATH;
    let previous = '';
    try {
      previous = readFileSync(target, 'utf8');
    } catch {
      previous = '';
    }
    const { text, added } = appendEntry(previous, entry);
    if (added) writeFileSync(target, text);
    console.log(`added=${added ? 'yes' : 'no'} cause=${entry.cause} run=${entry.run}`);
    return;
  }
  if (args.includes('--file')) {
    const source = args.includes('--from-branch') ? readLogFromBranch() : readFileSync(option('--file'), 'utf8');
    const entries = parseLog(source);
    if (!entries.length) throw new Error(`No CI failure lines found in ${args.includes('--from-branch') ? LOG_BRANCH : option('--file')}`);
    const groups = groupEntries(applyFlaky(entries, api));
    if (args.includes('--dry-run')) {
      const plan = ticketPlan(groups);
      console.log(`dryRun=yes create=${plan.create.length} comment=${plan.comment.length}`);
      for (const group of plan.create) console.log(`wouldFile lines=${group.lines} cause=${group.cause}`);
      return;
    }
    const token = process.env.HYPERTASK_MCP_TOKEN;
    if (!token) throw new Error('HYPERTASK_MCP_TOKEN is not configured');
    const limit = option('--limit') ? Number(option('--limit')) : undefined;
    const { created, commented } = await fileTickets(groups, { token, repo: repoName(), limit });
    console.log(`created=${created.length} commented=${commented.length}`);
    for (const { group, task } of created) console.log(`filed HYCI-${task?.uniqueIndex ?? task?.id} lines=${group.lines} cause=${group.cause}`);
    for (const { group, task } of commented) console.log(`commented HYCI-${task?.uniqueIndex ?? task?.id} lines=${group.lines} cause=${group.cause}`);
    return;
  }
  throw new Error(usage);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
