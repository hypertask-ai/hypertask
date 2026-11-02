#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DAY = 24 * 3600000;
const NINE_IN_TEN = 0.9;
const NEEDED_DAYS = 7;
const PUSH_SLACK = 0.05;

export const WATCHES = [
  {
    workflow: 'production-watch.yml',
    label: 'production watch, chained',
    askedPerDay: 48,
    unit: 'links, one every 30 minutes, six five-minute passes inside each link',
    events: ['schedule', 'workflow_dispatch'],
    current: true,
  },
  {
    workflow: 'required-check-settings.yml',
    label: 'hourly settings check',
    askedPerDay: 24,
    unit: 'runs, one an hour',
    events: ['schedule', 'workflow_dispatch'],
    current: true,
  },
  {
    workflow: 'prod-health.yml',
    label: 'production watch, legacy cron',
    askedPerDay: 336,
    unit: 'scheduled runs, twelve five-minute passes and two thirty-minute checks an hour',
    events: ['schedule'],
    current: false,
  },
];

export const PUSH_WATCH = { workflow: 'prod-health.yml', branch: 'production' };

const usage = [
  'Usage: node scripts/watch-delivery.mjs [--days 7] [--since YYYY-MM-DD] [--until YYYY-MM-DD]',
  '       [--repo owner/name] [--only watches|pushes] [--baseline] [--json]',
  'Counts how many runs of the production watch and the hourly settings check really ran',
  'against how many the repository asks for, and how many production pushes still started',
  'the prod-health check. --baseline also measures the window just before this one, so the',
  'report says whether a fix held. It reads run history only; it dispatches and edits nothing.',
].join('\n');

const day = time => new Date(time).toISOString().slice(0, 10);
const percent = rate => `${Math.round(rate * 1000) / 10}%`;
const round = value => Math.round(value * 10) / 10;

export function countDelivered(runs, sinceMs, untilMs) {
  const inWindow = runs.filter(run => {
    const created = Date.parse(run.created_at ?? '');
    return Number.isFinite(created) && created >= sinceMs && created < untilMs;
  });
  const byDay = new Map();
  for (const run of inWindow) {
    const key = day(Date.parse(run.created_at));
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return {
    runs: inWindow.length,
    finished: inWindow.filter(run => run.status === 'completed').length,
    red: inWindow.filter(run => ['failure', 'timed_out', 'startup_failure', 'action_required'].includes(run.conclusion)).length,
    perDay: [...byDay].map(([name, runs]) => ({ day: name, runs })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export function watchRow(watch, { sinceMs, untilMs, runs }) {
  const inWindow = runs.filter(run => {
    const created = Date.parse(run.created_at ?? '');
    return Number.isFinite(created) && created >= sinceMs && created < untilMs;
  });
  const firstRunMs = inWindow.reduce((first, run) => Math.min(first, Date.parse(run.created_at)), untilMs);
  const coveredMs = Math.max(untilMs - Math.max(sinceMs, firstRunMs), 0);
  const delivered = countDelivered(runs, sinceMs, untilMs);
  const asked = Math.round((watch.askedPerDay * coveredMs) / DAY);
  return {
    label: watch.label,
    workflow: watch.workflow,
    unit: watch.unit,
    asked,
    delivered: delivered.runs,
    finished: delivered.finished,
    red: delivered.red,
    rate: asked ? delivered.runs / asked : 0,
    coveredDays: Math.round((coveredMs / DAY) * 10) / 10,
    enough: asked ? delivered.runs >= asked * NINE_IN_TEN && coveredMs >= NEEDED_DAYS * DAY : false,
    current: Boolean(watch.current),
    perDay: delivered.perDay,
  };
}

export function pushRow({ commits, runs, sinceMs, untilMs }) {
  const inWindow = runs.filter(run => {
    const created = Date.parse(run.created_at ?? '');
    return Number.isFinite(created) && created >= sinceMs && created < untilMs
      && run.head_branch === PUSH_WATCH.branch && run.event === 'push';
  });
  return {
    runs: inWindow.length,
    commits,
    rate: commits ? Math.min(1, inWindow.length / commits) : 1,
  };
}

function table(headers, rows) {
  const cell = value => String(value ?? '-').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\|/g, '\\|');
  return [headers, headers.map(() => '---'), ...rows].map(row => `| ${row.map(cell).join(' | ')} |`).join('\n');
}

export function formatWindow(label, window) {
  const lines = [
    `${label}: ${new Date(window.sinceMs).toISOString()} to ${new Date(window.untilMs).toISOString()}`,
    '',
    table(['Watch', 'Asked', 'Ran', 'Finished', 'Red', 'Rate', 'Nine in ten'], window.watches.map(row => [
      row.label, row.asked, row.delivered, row.finished, row.red, percent(row.rate), row.enough ? 'yes' : 'no',
    ])),
  ];
  for (const row of window.watches) {
    lines.push(`${row.label}: asked ${row.asked} (${row.unit}), ran ${row.delivered}, ${percent(row.rate)}, ${row.coveredDays} days of record.`);
    if (row.perDay.length) lines.push(`Per day: ${row.perDay.map(entry => `${entry.day} ${entry.runs}`).join(', ')}.`);
  }
  if (window.pushes) {
    lines.push('');
    lines.push(`Prod-health push runs: ${window.pushes.runs} against ${window.pushes.commits} commits landing on production, ${percent(window.pushes.rate)}.`);
  }
  return lines.join('\n');
}

export function compareWindows(after, before) {
  const rows = after.watches.map((row, index) => {
    const was = before?.watches?.[index];
    return {
      label: row.label,
      before: was ? was.rate : null,
      after: row.rate,
      enough: row.enough,
      coveredDays: row.coveredDays,
      current: row.current,
    };
  });
  const pushRegression = Boolean(after.pushes && before?.pushes && after.pushes.rate < before.pushes.rate - PUSH_SLACK);
  return {
    rows,
    pushes: after.pushes && before?.pushes
      ? { before: before.pushes.rate, after: after.pushes.rate, regression: pushRegression }
      : after.pushes ? { before: null, after: after.pushes.rate, regression: false } : null,
    short: rows.filter(row => row.current && !row.enough).map(row => ({
      label: row.label,
      reason: row.coveredDays < NEEDED_DAYS ? `${row.coveredDays} days of record, needs ${NEEDED_DAYS}` : `delivered ${percent(row.after)}`,
    })),
    pushesHeld: !pushRegression,
  };
}

export function verdictLines(comparison) {
  const lines = [];
  if (comparison.pushes) {
    const { before, after, regression } = comparison.pushes;
    const was = before === null ? 'no earlier window' : `was ${percent(before)}`;
    lines.push(regression
      ? `pushes lost their check: ${percent(after)} of production commits started a prod-health push run, ${was}.`
      : `pushes keep their check: ${percent(after)} of production commits started a prod-health push run, ${was}.`);
  }
  if (comparison.rows.some(row => row.current)) {
    const detail = comparison.rows.filter(row => row.current).map(row => `${row.label} ${percent(row.after)}${row.before === null ? '' : ` (was ${percent(row.before)})`}`).join(', ');
    lines.push(comparison.short.length
      ? `watch delivery is short: ${detail}, short of nine in ten or of seven days: ${comparison.short.map(row => `${row.label} (${row.reason})`).join(', ')}.`
      : `watch delivery measured: ${detail}, nine in ten held for seven days.`);
  }
  return lines.join('\n');
}

// A second page of a busy endpoint costs a minute or more at GitHub, and this host is
// throttled when it asks in parallel, so the window is sliced into days and one page
// is read per slice, one slice at a time. A day that delivers more than 100 runs of
// one workflow is counted as 100, which reads low, never high.
const SLICE_MS = DAY;
const SLICE_CONCURRENCY = 1;

export async function slicedWindow(sinceMs, untilMs, fetchPage) {
  const slices = [];
  for (let from = sinceMs; from < untilMs; from += SLICE_MS) slices.push([from, Math.min(from + SLICE_MS, untilMs)]);
  const rows = [];
  for (let index = 0; index < slices.length; index += SLICE_CONCURRENCY) {
    const wave = slices.slice(index, index + SLICE_CONCURRENCY);
    const batches = await Promise.all(wave.map(async ([from, to]) => {
      const batch = await fetchPage(new Date(from).toISOString(), new Date(to).toISOString(), 1);
      if (!Array.isArray(batch)) throw new Error('GitHub returned no list of runs');
      return batch;
    }));
    rows.push(...batches.flat());
  }
  return rows;
}

function ghJson(path) {
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`${String(stderr ?? '').trim() || error.message.split('\n')[0]} for ${path}`));
      try {
        return resolve(JSON.parse(stdout));
      } catch {
        return reject(new Error(`GitHub returned invalid JSON for ${path}`));
      }
    });
  });
}

export function gitCommits(repo, sinceMs, untilMs, dir = process.cwd()) {
  return new Promise((resolve, reject) => {
    execFile('git', ['log', `--since=${new Date(sinceMs).toISOString()}`, `--until=${new Date(untilMs).toISOString()}`, '--format=%H', `origin/${PUSH_WATCH.branch}`],
      { cwd: dir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 },
      (error, stdout, stderr) => (error
        ? reject(new Error(`cannot count production commits (${String(stderr ?? '').trim() || error.message.split('\n')[0]})`))
        : resolve(stdout.split('\n').filter(Boolean).length)));
  });
}

export async function measureWindow({ repo, sinceMs, untilMs, only, commits = gitCommits }, api = ghJson) {
  const runsFor = workflow => slicedWindow(sinceMs, untilMs, (from, to, page) => api(
    `/repos/${repo}/actions/workflows/${workflow}/runs?created=${from}..${to}&per_page=100&page=${page}`,
  ).then(payload => payload.workflow_runs ?? payload));
  const watches = [];
  const legs = [];
  if (only !== 'pushes') {
    for (const watch of WATCHES) {
      if (legs.some(leg => leg.workflow === watch.workflow)) continue;
      legs.push({ workflow: watch.workflow, rows: runsFor(watch.workflow) });
    }
  }
  if (only !== 'watches' && !legs.some(leg => leg.workflow === PUSH_WATCH.workflow)) {
    legs.push({ workflow: PUSH_WATCH.workflow, rows: runsFor(PUSH_WATCH.workflow) });
  }
  const [legRows, landed] = await Promise.all([
    Promise.all(legs.map(async leg => ({ workflow: leg.workflow, runs: await leg.rows }))),
    only !== 'watches' ? commits(repo, sinceMs, untilMs) : null,
  ]);
  const runsOf = workflow => legRows.find(leg => leg.workflow === workflow)?.runs ?? [];
  if (only !== 'pushes') {
    for (const watch of WATCHES) {
      watches.push(watchRow(watch, {
        sinceMs,
        untilMs,
        runs: runsOf(watch.workflow).filter(run => watch.events.includes(run.event)),
      }));
    }
  }
  const pushes = only === 'watches' ? null : pushRow({ commits: landed, runs: runsOf(PUSH_WATCH.workflow), sinceMs, untilMs });
  return { sinceMs, untilMs, watches, pushes };
}

export function parseArgs(args) {
  const options = { days: 7, repo: 'hypertask-ai/hypertask', only: null, json: false, out: null, baseline: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--days') { options.days = Number(value); index++; }
    else if (arg === '--since') { options.since = Date.parse(`${value}T00:00:00Z`); index++; }
    else if (arg === '--until') { options.until = Date.parse(`${value}T00:00:00Z`); index++; }
    else if (arg === '--repo') { options.repo = value; index++; }
    else if (arg === '--only') { options.only = value; index++; }
    else if (arg === '--out') { options.out = value; index++; }
    else if (arg === '--baseline') options.baseline = true;
    else if (arg === '--json') options.json = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isFinite(options.days) || options.days < 1 || options.days > 90) throw new Error('--days must be 1 to 90');
  if (options.only && !['watches', 'pushes'].includes(options.only)) throw new Error('--only takes watches or pushes');
  if ((options.since && Number.isNaN(options.since)) || (options.until && Number.isNaN(options.until))) throw new Error('--since and --until take YYYY-MM-DD');
  return options;
}

export async function report(options, api = ghJson) {
  const untilMs = options.until ?? Date.now();
  const sinceMs = options.since ?? untilMs - options.days * DAY;
  if (sinceMs >= untilMs) throw new Error('--since must be before --until');
  const after = await measureWindow({ repo: options.repo, sinceMs, untilMs, only: options.only, commits: options.commits }, api);
  const before = options.baseline
    ? await measureWindow({ repo: options.repo, sinceMs: sinceMs - (untilMs - sinceMs), untilMs: sinceMs, only: options.only, commits: options.commits }, api)
    : null;
  const comparison = compareWindows(after, before);
  return { after, before, comparison };
}

export async function main(args = process.argv.slice(2), api = ghJson) {
  if (args.includes('--help')) {
    console.log(usage);
    return;
  }
  const options = parseArgs(args);
  const result = await report(options, api);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const text = [
    formatWindow('Measured window', result.after),
    result.before ? `\n${formatWindow('Window before it', result.before)}` : '',
    '',
    verdictLines(result.comparison),
  ].filter(Boolean).join('\n');
  console.log(text);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`watch delivery: ${error.message}`);
    process.exitCode = 1;
  });
}
