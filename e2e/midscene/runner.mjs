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
import { api, prepareQa, createFixtureTask, findCreatedTask, cleanupQaAfterFlow, observeFixtures, uploadFixture, resolveStep, APP_ORIGIN } from './qa-session.mjs';

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

async function runStep(page, agent, step, fixture) {
  switch (step.action) {
    case 'click':
      if (step.optional && !(await page.$(step.arg))) return;
      await page.waitForSelector(step.arg, { visible: true, timeout: 30_000 });
      return page.click(step.arg);
    case 'createFixtureTask':
      return createFixtureTask(page, fixture);
    case 'saveTask': {
      const saved = page.waitForResponse((res) => /\/api\/tasks\/(create|createGlobally)$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST', { timeout: 30_000 });
      const [response] = await Promise.all([saved, page.locator('::-p-text(Save & close)').click()]);
      if (!response.ok()) throw new Error(`Task save failed: HTTP ${response.status()}`);
      return;
    }
    case 'verifyCreatedTask':
      if ((await findCreatedTask(page, fixture)).length !== 1) throw new Error('Expected one persisted QA task');
      return;
    case 'moveToInbox':
      return api(page, '/api/notifications/moveTaskToInbox', 'POST', { taskId: fixture.tasks[0], projectId: fixture.project.id });
    case 'uploadFile':
      return uploadFixture(page, fixture, step.arg);
    case 'postAttachmentComment': {
      const saved = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/comments/create' && res.request().method() === 'POST', { timeout: 30_000 });
      const [response] = await Promise.all([saved, (async () => {
        await page.click('#comment-input');
        await page.keyboard.down('Control');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Control');
      })()]);
      if (!response.ok()) throw new Error('Attachment comment failed to save');
      return;
    }
    case 'verifyUpload': {
      await Promise.all(fixture.pending);
      if (!fixture.uploads.length) throw new Error('No cleanup-capable direct upload grant captured');
      const comments = await api(page, `/api/comments/getByTask?taskId=${fixture.tasks[0]}`);
      const urls = fixture.uploads.flatMap((upload) => upload.urls);
      if (!urls.some((url) => JSON.stringify(comments.comments).includes(url))) throw new Error('Uploaded file was not linked to a saved comment');
      const bytes = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return res.ok ? await res.text() : null;
      }, urls[0]);
      if (!bytes?.includes(`Nightly QA upload: ${fixture.title}`)) throw new Error('Uploaded attachment bytes did not match');
      return;
    }
    case 'verifyReminder': {
      const reminders = await api(page, '/api/reminders/getAll');
      if (!reminders.some((r) => r.taskId === fixture.tasks[0] && Date.parse(r.remindAt) > Date.now())) {
        throw new Error('Future QA reminder was not persisted');
      }
      return;
    }
    case 'verifyChatAnswer': {
      const chats = await api(page, '/api/ai-chat/all-sessions');
      const chat = chats.sessions?.find((session) => session.id === fixture.sessionId);
      if (!chat?.messages.some((message) => message.role === 'assistant' && /(^|\D)42(\D|$)/.test(message.content))) {
        throw new Error('No persisted assistant answer in the isolated QA chat');
      }
      return;
    }
    case 'createChat': {
      const chat = await api(page, '/api/ai-chat/create-session', 'POST', {});
      fixture.sessionId = chat.session?.id;
      if (!fixture.sessionId) throw new Error('Chat create returned no session id');
      fixture.values.chatUrl = `${APP_ORIGIN}/chat/${fixture.sessionId}`;
      return;
    }
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
  const result = { flow: flow.id, ok: false, error: null, failedStep: null, durationMs: 0, reportPath: null, screenshotPath: null, resolvedUrl: null };
  const context = flow.signedIn ? await browser.createBrowserContext() : null;
  const page = context ? await context.newPage() : await browser.newPage();
  let fixture;
  let stopObserving;
  let agent;
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    result.failedStep = 'QA sign-in and private board ownership check';
    if (flow.signedIn) {
      fixture = await prepareQa(page, flow);
      stopObserving = observeFixtures(page, fixture);
    }
    agent = new PuppeteerAgent(page);

    for (const [index, template] of flow.steps.entries()) {
      const step = resolveStep(template, fixture?.values || {});
      result.failedStep = `${index + 1}. ${step.action}: ${step.arg}`;
      const output = await runStep(page, agent, step, fixture);
      if (process.argv.includes('--force-failure') && process.argv[process.argv.indexOf('--force-failure') + 1] === flow.id) {
        throw new Error('Forced failure for reporter dry-run verification');
      }
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
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(async (err) => {
        console.warn(`[${flow.id}] Full-page screenshot failed: ${err.message}; capturing viewport`);
        await page.screenshot({ path: screenshotPath });
      });
      result.screenshotPath = screenshotPath;
    } catch {
      // best effort -- a screenshot failure must not mask the real error
    }
  } finally {
    if (fixture) {
      const beforeCleanup = !result.screenshotPath ? await page.screenshot({ fullPage: true }).catch(() => null) : null;
      try {
        await cleanupQaAfterFlow(page, fixture, stopObserving);
        console.log(`[${flow.id}] QA cleanup passed`);
      } catch (err) {
        if (result.ok) result.failedStep = 'QA fixture cleanup';
        result.ok = false;
        result.error = [result.error, err.message].filter(Boolean).join('; ');
        if (!result.screenshotPath) {
          await mkdir(SCREENSHOT_DIR, { recursive: true });
          result.screenshotPath = path.join(SCREENSHOT_DIR, `${flow.id}-${Date.now()}.png`);
          if (beforeCleanup) await writeFile(result.screenshotPath, beforeCleanup);
          else await page.screenshot({ path: result.screenshotPath, fullPage: true }).catch(() => { result.screenshotPath = null; });
        }
      }
    }
    stopObserving?.();
    result.reportPath = agent?.reportFile || null;
    if (result.ok) result.failedStep = null;
    if (context) await context.close();
    else await page.close();
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
  console.log(`\nAll flows passed. (${results.length}/${results.length})`);
}

main().catch((err) => {
  console.error('RUNNER FAILED:', err?.message || err);
  process.exit(1);
});
