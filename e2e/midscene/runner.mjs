// HTPR-5720: generic runner for the declarative flow pack in flows/.
// Extends the HTPR-5715 scaffold (run.mjs) -- same puppeteer setup, dedicated
// user-data-dir, proxy env handling, and browser close in finally -- but
// loads flow modules and executes their `steps` data instead of hardcoding
// one flow.
//
// Usage (always through guarded-run.sh, see README):
//   node runner.mjs --flow <id>   run one flow
//   node runner.mjs --all         run every flow sequentially, continue on failure
//
// Writes midscene_run/results-latest.json: { startedAt, results: [...] }
// where each result is { flow, ok, error, durationMs, reportPath,
// screenshotPath, resolvedUrl }. startedAt lets nightly.sh's postprocessor
// detect a stale (previous run's) results file if this run crashes or times
// out before writing. Exits non-zero if any flow failed.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { PuppeteerAgent } from '@midscene/web/puppeteer';
import { flows, getFlow } from './flows/index.mjs';

const RESULTS_DIR = 'midscene_run';
const RESULTS_FILE = path.join(RESULTS_DIR, 'results-latest.json');
const SCREENSHOT_DIR = path.join(RESULTS_DIR, 'screenshots');

const USER_DATA_DIR = process.env.MIDSCENE_PROFILE_DIR || `/tmp/midscene-profile-${process.pid}`;

// See run.mjs (HTPR-5715): Midscene's own SOCKS proxy config only affects its
// AI gateway calls. Strip generic proxy vars from the browser subprocess so
// Chrome doesn't try to route page navigation through the same tunnel.
const browserEnv = { ...process.env };
delete browserEnv.ALL_PROXY;
delete browserEnv.HTTP_PROXY;
delete browserEnv.HTTPS_PROXY;
delete browserEnv.http_proxy;
delete browserEnv.https_proxy;

function parseArgs(argv) {
  const flowIdx = argv.indexOf('--flow');
  return {
    flowId: flowIdx >= 0 ? argv[flowIdx + 1] : null,
    all: argv.includes('--all'),
  };
}

// A fallback URL only stands in for the primary when the primary domain
// itself is unreachable (DNS or connection refused) -- e.g. hypertask.ai not
// resolving. Any other failure (a real 404/500 page, a timeout, an assertion
// failure) must fail the flow, not silently swap in a different page.
const DNS_OR_CONNECTION_ERROR = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED/;

async function runStep(page, agent, step) {
  switch (step.action) {
    case 'goto': {
      try {
        await page.goto(step.arg, { waitUntil: 'networkidle2', timeout: 60_000 });
        return { resolvedUrl: step.arg };
      } catch (err) {
        const message = err?.message || String(err);
        if (!step.fallback || !DNS_OR_CONNECTION_ERROR.test(message)) throw err;
        await page.goto(step.fallback, { waitUntil: 'networkidle2', timeout: 60_000 });
        return { resolvedUrl: step.fallback };
      }
    }
    case 'aiWaitFor':
      return agent.aiWaitFor(step.arg, { timeoutMs: step.timeoutMs || 30_000 });
    case 'aiAssert':
      return agent.aiAssert(step.arg);
    case 'aiTap':
      return agent.aiTap(step.arg);
    case 'aiInput':
      return agent.aiInput(step.value, step.arg);
    case 'aiKeyboardPress':
      return agent.aiKeyboardPress(step.arg, step.locate);
    case 'aiQuery': {
      const result = await agent.aiQuery(step.arg);
      if (step.expect?.contains) {
        const missing = step.expect.contains.filter((v) => !Array.isArray(result) || !result.includes(v));
        if (missing.length > 0) {
          throw new Error(`aiQuery result ${JSON.stringify(result)} is missing expected values ${JSON.stringify(missing)}`);
        }
      }
      return result;
    }
    default:
      throw new Error(`Unknown step action: ${step.action}`);
  }
}

async function runFlow(browser, flow) {
  const start = Date.now();
  const result = { flow: flow.id, ok: false, error: null, durationMs: 0, reportPath: null, screenshotPath: null, resolvedUrl: null };

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    const agent = new PuppeteerAgent(page);

    for (const step of flow.steps) {
      const output = await runStep(page, agent, step);
      if (step.action === 'goto') {
        result.resolvedUrl = output.resolvedUrl;
        if (output.resolvedUrl !== step.arg) {
          console.log(`[${flow.id}] goto ${step.arg} unreachable, used fallback ${output.resolvedUrl}`);
        }
      } else {
        console.log(`[${flow.id}] ${step.action} ${step.arg}${output !== undefined ? ` -> ${JSON.stringify(output)}` : ''}`);
      }
    }

    result.ok = true;
    result.reportPath = agent.reportFile || null;
  } catch (err) {
    result.error = err?.message || String(err);
    try {
      await mkdir(SCREENSHOT_DIR, { recursive: true });
      const screenshotPath = path.join(SCREENSHOT_DIR, `${flow.id}-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshotPath = screenshotPath;
    } catch {
      // best effort -- a screenshot failure must not mask the real error
    }
  } finally {
    await page.close();
    result.durationMs = Date.now() - start;
  }
  return result;
}

async function main() {
  const startedAt = new Date().toISOString();
  const { flowId, all } = parseArgs(process.argv.slice(2));

  let targets;
  if (all) {
    targets = flows;
  } else if (flowId) {
    const flow = getFlow(flowId);
    if (!flow) {
      console.error(`Unknown flow id: ${flowId}. Known flows: ${flows.map((f) => f.id).join(', ')}`);
      process.exit(1);
    }
    targets = [flow];
  } else {
    console.error('Usage: node runner.mjs --flow <id> | --all');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: USER_DATA_DIR,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    env: browserEnv,
  });

  const results = [];
  try {
    for (const flow of targets) {
      console.log(`\n=== running flow: ${flow.id} (${flow.area}) ===`);
      const result = await runFlow(browser, flow);
      results.push(result);
      console.log(result.ok ? `[${flow.id}] PASSED` : `[${flow.id}] FAILED: ${result.error}`);
    }
  } finally {
    await browser.close();
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(RESULTS_FILE, JSON.stringify({ startedAt, results }, null, 2));

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} flow(s) failed: ${failed.map((f) => f.flow).join(', ')}`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} flow(s) passed.`);
}

main().catch((err) => {
  console.error('RUNNER FAILED:', err?.message || err);
  process.exit(1);
});
