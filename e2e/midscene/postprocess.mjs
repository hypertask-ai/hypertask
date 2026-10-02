#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function isOpenTicket(task) {
  const section = typeof task.section === 'string' ? task.section : task.section?.title;
  if (typeof section !== 'string' || typeof task.status !== 'string') {
    throw new Error('Ticket lookup returned no section/status; refusing duplicate-prone filing');
  }
  return task.status === 'Normal' && !/^(done|completed|cancelled|canceled)$/i.test(section);
}

export function ticketPlan(result) {
  if (!result.failedStep || !result.screenshotPath || !existsSync(result.screenshotPath)) {
    throw new Error(`Flow ${result.flow} lacks a failing step or screenshot; refusing incomplete bug report`);
  }
  return {
    flow: result.flow,
    title: `Midscene nightly: ${result.flow} failing`,
    description: `<p><strong>The ${escapeHtml(result.flow)} nightly flow failed.</strong></p>` +
      `<p>Failing step: ${escapeHtml(result.failedStep)}</p>` +
      `<p>Error: ${escapeHtml(result.error || 'unknown')}</p>` +
      `<p>The attached screenshot shows the failure. Runtime: ${Number(result.durationMs) || 0}ms.</p>`,
    screenshotPath: result.screenshotPath,
  };
}

export function processResults(results, state, { listTickets, createTicket, ensureScreenshot = () => {}, dryRun = false, threshold = 1, log = console.log }) {
  const summaries = [];
  const errors = [];
  for (const result of results) {
    const entry = state[result.flow] || { consecutiveFails: 0, flakeCount: 0 };
    entry.consecutiveFails = result.ok ? 0 : entry.consecutiveFails + 1;
    entry.flakeCount += result.ok ? 0 : 1;
    try {
      if (!result.ok && entry.consecutiveFails >= threshold) {
        const plan = ticketPlan(result);
        // Check the board on every failure, including after a green night or a lost state file.
        const existing = listTickets(plan.title).find((task) => task.title === plan.title && isOpenTicket(task));
        if (existing || (dryRun && entry.dryRunPlanned)) {
          if (existing && !dryRun) ensureScreenshot(existing, plan);
          log(`SUPPRESSED: ${result.flow} already has one open${existing ? '' : ' simulated'} Bugs ticket`);
        } else if (dryRun) {
          log(`DRY RUN: would create ONE Bugs ticket on board 15: ${JSON.stringify(plan)}`);
          // Persist only in the separate dry-run state, never suppress real filing.
          entry.dryRunPlanned = true;
        } else {
          createTicket(plan);
          log(`FILED: ${result.flow} Bugs ticket with screenshot`);
        }
      }
    } catch (err) {
      errors.push(`${result.flow}: ${err.message}`);
      log(`REPORT FAILED: ${result.flow}: ${err.message}`);
    }
    state[result.flow] = entry;
    summaries.push(`${result.flow}=${result.ok ? 'pass' : `fail(${entry.consecutiveFails})`}`);
  }
  log(summaries.join(' '));
  if (errors.length) throw new Error(`Incident reporting failed: ${errors.join('; ')}`);
  return state;
}

function cliJson(args) {
  const output = execFileSync('vcc', [...args, '--json'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const payload = JSON.parse(output);
  if (payload.success === false) throw new Error('Board CLI returned failure');
  return payload;
}

function listTickets(title) {
  const tasks = [];
  for (let offset = 0; ; offset += 100) {
    // The list route is authoritative; vector-search indexing can lag a newly filed ticket.
    const payload = cliJson(['tasks', 'list', '--project', '15', '--status', 'Normal', '--query', title, '--limit', '100', '--offset', String(offset)]);
    if (!Array.isArray(payload.tasks)) throw new Error('Board CLI returned no tasks array');
    tasks.push(...payload.tasks);
    if (payload.tasks.length < 100) return tasks;
  }
}

export function main(argv) {
  const [statePath, resultsPath, thresholdArg, project, section, dryRunArg, runStartArg] = argv;
  const threshold = Number(thresholdArg);
  const runStartUnix = Number(runStartArg);
  if (!statePath || !resultsPath || !Number.isInteger(threshold) || threshold < 1 ||
      project !== '15' || section !== 'Bugs' || !['0', '1'].includes(dryRunArg) || !Number.isFinite(runStartUnix)) {
    throw new Error('Usage: postprocess.mjs <state> <results> <threshold> 15 Bugs <dryRun 0|1> <runStartUnix>');
  }
  const payload = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const startedAt = Date.parse(payload.startedAt) / 1000;
  if (!Number.isFinite(startedAt) || startedAt < runStartUnix - 5 || !Array.isArray(payload.results) || !payload.results.length) {
    throw new Error('Missing, invalid or STALE results; refusing to reprocess an earlier nightly run');
  }
  const dryRun = dryRunArg === '1';
  const targetState = dryRun ? `${statePath}.dry-run` : statePath;
  const state = existsSync(targetState) ? JSON.parse(readFileSync(targetState, 'utf8')) : {};
  try {
    processResults(payload.results, state, {
      threshold, dryRun, listTickets,
      ensureScreenshot: (existing, plan) => {
        const task = cliJson(['tasks', 'get', String(existing.id)]).tasks?.[0];
        if (!Array.isArray(task?.attachments)) throw new Error('Cannot verify existing failure screenshot');
        if (!task.attachments.some((attachment) => attachment.fileName?.startsWith(`${plan.flow}-`) && /\.png$/i.test(attachment.fileName))) {
          // A create can succeed before its attachment fails. Repair the same ticket, never create another.
          cliJson(['comment', 'add', String(existing.id), '--text', plan.description, '--attach', plan.screenshotPath]);
        }
      },
      createTicket: (plan) => cliJson(['tasks', 'create', '--project', '15', '--section', 'Bugs',
        '--title', plan.title, '--description', plan.description, '--attach', plan.screenshotPath]),
    });
  } finally {
    writeFileSync(targetState, JSON.stringify(state, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (err) { console.error(`postprocess: ${err.message}`); process.exitCode = 1; }
}
