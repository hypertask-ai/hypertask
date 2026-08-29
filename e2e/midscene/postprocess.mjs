#!/usr/bin/env node
// HTPR-5720 nightly hardening: pulled out of nightly.sh's inline `node -`
// heredoc (ESM imports there can parse as CommonJS) into a real, testable
// file. Tracks per-flow consecutive failures in flake-state.json and files
// one Hypertask bug ticket the first time a flow crosses the threshold.
//
// Usage: node postprocess.mjs <statePath> <resultsPath> <threshold> <project>
//        <section> <dryRun 0|1> <runStartUnixSeconds>
//
// Exits nonzero (without touching flake-state.json) if the results file is
// missing, unparseable, or stale (its embedded startedAt is older than this
// nightly run started) -- a crashed/timed-out runner must never cause the
// previous run's results to be silently reprocessed as fresh.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [, , statePath, resultsPath, thresholdArg, project, section, dryRunArg, runStartArg] = process.argv;
const threshold = Number(thresholdArg);
const dryRun = dryRunArg === '1';
const runStartUnix = Number(runStartArg);

if (!existsSync(resultsPath)) {
  console.error(`postprocess: results file ${resultsPath} not found.`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(readFileSync(resultsPath, 'utf8'));
} catch (err) {
  console.error(`postprocess: could not parse ${resultsPath}: ${err.message}`);
  process.exit(1);
}

const { startedAt, results } = payload;
if (!startedAt || !Array.isArray(results)) {
  console.error(`postprocess: ${resultsPath} is missing startedAt/results -- refusing to process a results file from an older runner.mjs.`);
  process.exit(1);
}

// A few seconds of slack for clock/IO jitter between nightly.sh recording
// its own start time and runner.mjs recording its own.
const STALE_TOLERANCE_SECONDS = 5;
const resultsStartUnix = Date.parse(startedAt) / 1000;
if (resultsStartUnix < runStartUnix - STALE_TOLERANCE_SECONDS) {
  console.error(`postprocess: STALE results -- ${resultsPath} was started at ${startedAt}, before this nightly run began. Treating as a failed run.`);
  process.exit(1);
}

const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const summaryParts = [];

for (const r of results) {
  const entry = state[r.flow] || { consecutiveFails: 0, flakeCount: 0, ticketFiled: false };

  if (r.ok) {
    entry.consecutiveFails = 0;
    entry.ticketFiled = false;
  } else {
    entry.consecutiveFails += 1;
    entry.flakeCount += 1;

    if (entry.consecutiveFails >= threshold && !entry.ticketFiled) {
      const title = `Midscene nightly: ${r.flow} failing`;
      const description = `<p><strong>Flow "${r.flow}" has failed ${entry.consecutiveFails} nights in a row.</strong></p>` +
        `<p>Error: ${escapeHtml(r.error || 'unknown')}</p>` +
        `<p>Duration: ${r.durationMs}ms</p>`;
      const args = ['tasks', 'create', '--project', project, '--section', section, '--title', title, '--description', description];
      if (r.screenshotPath && existsSync(r.screenshotPath)) {
        args.push('--attach', r.screenshotPath);
      }

      if (dryRun) {
        // Dry run never marks ticketFiled -- it must be retried for real next time.
        console.log(`DRY RUN: hypertask ${args.map(quote).join(' ')}`);
      } else {
        try {
          execFileSync('hypertask', args, { stdio: 'inherit' });
          entry.ticketFiled = true;
        } catch (err) {
          // Leave ticketFiled false so the next failing night retries filing.
          console.error(`Failed to file ticket for ${r.flow}: ${err.message}`);
        }
      }
    }
  }

  state[r.flow] = entry;
  summaryParts.push(`${r.flow}=${r.ok ? 'pass' : `fail(${entry.consecutiveFails})`}`);
}

writeFileSync(statePath, JSON.stringify(state, null, 2));
console.log(summaryParts.join(' '));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function quote(a) {
  return /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}
