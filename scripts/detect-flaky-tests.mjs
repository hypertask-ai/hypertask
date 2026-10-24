#!/usr/bin/env node
/**
 * Detect flaky tests from GitHub Actions ci-tests workflow history.
 * 
 * A test is flaky when the same commit SHA both fails and passes on reruns.
 * This script:
 * 1. Fetches ci-tests runs from the last N days
 * 2. Groups by headSha to find same-SHA fail-then-pass patterns
 * 3. Downloads job logs for failed ci-tests jobs
 * 4. Extracts test names from Node.js test runner output
 * 5. Produces a ranked list with evidence links
 * 
 * Usage: node scripts/detect-flaky-tests.mjs [--days=N] [--limit=N]
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DAYS = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '14', 10);
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '2000', 10);
const CACHE_DIR = '.cache/flaky-tests';

function gh(args) {
  try {
    return execSync(`gh ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    if (err.stdout) return err.stdout;
    throw err;
  }
}

/**
 * Fetch ci-tests runs from history.
 */
async function fetchRuns() {
  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.error(`Fetching ci-tests runs since ${cutoff} (limit ${LIMIT})...`);
  
  const json = gh(`run list --workflow=ci-tests.yml --limit ${LIMIT} --json conclusion,headSha,createdAt,number,event,url,databaseId`);
  const all = JSON.parse(json);
  
  // Filter to the period and only success/failure/cancelled
  const runs = all.filter(r => {
    if (r.createdAt < cutoff) return false;
    if (!['success', 'failure', 'cancelled'].includes(r.conclusion)) return false;
    return true;
  });
  
  console.error(`Found ${runs.length} runs in period (${runs.filter(r => r.conclusion === 'failure').length} failed, ${runs.filter(r => r.conclusion === 'success').length} passed, ${runs.filter(r => r.conclusion === 'cancelled').length} cancelled)`);
  return runs;
}

/**
 * Group runs by headSha to find flaky patterns.
 * A SHA is flaky if it has at least one failure and at least one success.
 */
function groupBySha(runs) {
  const bysha = {};
  for (const run of runs) {
    if (!bysha[run.headSha]) {
      bysha[run.headSha] = { failures: [], successes: [], cancelled: [], all: [] };
    }
    bysha[run.headSha].all.push(run);
    if (run.conclusion === 'failure') {
      bysha[run.headSha].failures.push(run);
    } else if (run.conclusion === 'success') {
      bysha[run.headSha].successes.push(run);
    } else if (run.conclusion === 'cancelled') {
      bysha[run.headSha].cancelled.push(run);
    }
  }
  
  // Statistics
  const reruns = Object.values(bysha).filter(g => g.all.length >= 2);
  const flakyRuns = reruns.filter(g => g.failures.length > 0 && g.successes.length > 0);
  
  console.error(`\nStatistics:`);
  console.error(`  Total unique SHAs: ${Object.keys(bysha).length}`);
  console.error(`  SHAs with 2+ runs (reruns): ${reruns.length}`);
  if (reruns.length > 0) {
    console.error(`    - ${reruns.reduce((s, g) => s + g.failures.length, 0)} failure runs in reruns`);
    console.error(`    - ${reruns.reduce((s, g) => s + g.successes.length, 0)} success runs in reruns`);
    console.error(`  SHAs with both failures and successes (flaky): ${flakyRuns.length}\n`);
  }
  
  // Return flaky SHAs
  const flaky = Object.entries(bysha)
    .filter(([sha, { failures, successes }]) => failures.length > 0 && successes.length > 0)
    .map(([sha, { failures, successes }]) => ({ sha, failures, successes }));
  
  return flaky;
}

/**
 * Download logs for a job in a run using gh CLI.
 */
async function downloadJobLogs(runId, jobName) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const logFile = join(CACHE_DIR, `run-${runId}-${jobName}.log`);
  
  if (existsSync(logFile)) {
    return logFile;
  }
  
  console.error(`  Downloading ${jobName} logs for run ${runId}...`);
  
  try {
    const logs = gh(`run view ${runId} --log`);
    writeFileSync(logFile, logs, 'utf8');
    return logFile;
  } catch (err) {
    console.error(`  Failed to download logs for run ${runId}: ${err.message}`);
    return null;
  }
}

/**
 * Extract failing test names from ci-tests job logs.
 * Looks for Node.js test runner output patterns in the Test or Test full suite step.
 */
function extractFailedTests(logFile) {
  const content = readFileSync(logFile, 'utf8');
  const tests = new Set();
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Pattern 1: "not ok N - test name"
    const notOkMatch = line.match(/^\s*not ok \d+ - (.+)$/);
    if (notOkMatch) {
      const testName = notOkMatch[1].trim();
      if (testName && !testName.match(/npm|node|exit code|ELIFECYCLE/)) {
        tests.add(testName);
      }
      continue;
    }
    
    // Pattern 2: "✖ test name (duration)"
    const xMatch = line.match(/^\s*✖ (.+?) \(\d+(?:\.\d+)?m?s\)$/);
    if (xMatch) {
      const testName = xMatch[1].trim();
      if (testName && !testName.match(/npm|node/) && testName.length > 5) {
        tests.add(testName);
      }
      continue;
    }
    
    // Pattern 3: ci-tests job step output with test file paths
    if (line.includes('ci-tests') && line.match(/tests?\/.*\.test\.(cjs|ts|tsx|js)/) && line.includes('fail')) {
      const fileMatch = line.match(/(tests?\/[^\s]+\.test\.(cjs|ts|tsx|js))/);
      if (fileMatch) {
        tests.add(fileMatch[1]);
      }
    }
  }
  
  return Array.from(tests);
}

/**
 * Build flaky test inventory from same-SHA fail/pass runs.
 */
async function detectFlakyTests(flakyShas) {
  const flakyTests = {};
  
  for (const { sha, failures, successes } of flakyShas) {
    console.error(`\nAnalyzing SHA ${sha.slice(0, 8)} (${failures.length} failures, ${successes.length} successes):`);
    
    for (const failure of failures) {
      const logFile = await downloadJobLogs(failure.databaseId, 'ci-tests');
      if (!logFile) continue;
      
      const tests = extractFailedTests(logFile);
      console.error(`  Run ${failure.number}: ${tests.length} failed tests extracted`);
      
      for (const test of tests) {
        if (!flakyTests[test]) {
          flakyTests[test] = { count: 0, evidence: [] };
        }
        flakyTests[test].count++;
        flakyTests[test].evidence.push({
          sha: sha.slice(0, 8),
          fullSha: sha,
          failRun: failure.number,
          failUrl: failure.url,
          failTime: failure.createdAt,
          passRuns: successes.map(s => ({ number: s.number, time: s.createdAt }))
        });
      }
    }
  }
  
  return flakyTests;
}

/**
 * Output ranked list of flaky tests as markdown.
 */
function outputResults(flakyTests) {
  console.log('# Flaky Tests Report');
  console.log(`**Generated:** ${new Date().toISOString()}`);
  console.log(`**Period:** last ${DAYS} days`);
  console.log(`**Run limit:** ${LIMIT} most recent ci-tests runs\n`);
  
  const sorted = Object.entries(flakyTests).sort((a, b) => b[1].count - a[1].count);
  
  if (sorted.length === 0) {
    console.log('**Result:** No flaky tests detected.');
    console.log('');
    console.log('A test is considered flaky when the same commit SHA has both failed and successful ci-tests runs.');
    console.log('This analysis found no such patterns in the queried period.\n');
    return;
  }
  
  console.log(`**Found ${sorted.length} flaky test(s):**\n`);
  
  for (let i = 0; i < sorted.length; i++) {
    const [test, { count, evidence }] = sorted[i];
    console.log(`## ${i + 1}. \`${test}\``);
    console.log(`**Flaky occurrences:** ${count}\n`);
    console.log('**Evidence:**\n');
    for (const e of evidence) {
      console.log(`- **SHA \`${e.sha}\`** ([full: \`${e.fullSha}\`](https://github.com/hypertask-ai/hypertask/commit/${e.fullSha}))`);
      console.log(`  - Failed: [run ${e.failRun}](${e.failUrl}) at ${e.failTime}`);
      const passLines = e.passRuns.map(p => `run ${p.number} at ${p.time}`).join(', ');
      console.log(`  - Passed: ${passLines}\n`);
    }
  }
  
  console.log('---');
  console.log('');
  console.log('**Methodology:**');
  console.log('- Fetches ci-tests workflow runs from the specified period');
  console.log('- Groups by commit SHA to find same-SHA fail-then-pass patterns');
  console.log('- Downloads job logs for failed runs');
  console.log('- Extracts test names from Node.js test runner output');
  console.log('- A test appears flaky if it failed on a SHA that later passed');
}

// Main
const runs = await fetchRuns();
const flakyShas = groupBySha(runs);

if (flakyShas.length === 0) {
  console.error('No flaky runs detected (no SHAs with both failures and successes).');
  console.log('# Flaky Tests Report');
  console.log(`**Generated:** ${new Date().toISOString()}`);
  console.log(`**Period:** last ${DAYS} days`);
  console.log(`**Run limit:** ${LIMIT} most recent ci-tests runs\n`);
  console.log('**Result:** No flaky tests detected.\n');
  console.log('A test is considered flaky when the same commit SHA has both failed and successful ci-tests runs.');
  console.log('This analysis found no such patterns in the queried period.');
  process.exit(0);
}

const flakyTests = await detectFlakyTests(flakyShas);
outputResults(flakyTests);
