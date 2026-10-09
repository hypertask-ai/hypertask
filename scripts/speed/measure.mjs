#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const STATE = path.join(os.homedir(), '.local/state/speed');
export const PATHS = ['board', 'ticket-cold', 'ticket-warm', 'search', 'my-tasks', 'ctrl-j', 'page-navigation'];
export const METRICS = ['contentMs', 'requestCount', 'bytes', 'longTaskMs'];
const BASE = 'https://app.hypertask.ai';
const BOARD = '/project?id=6859';
const TASK = '/detail/project-6859/43';
const TITLE = 'QA 6667 Enter verification';
const PROTOCOL = 1;

export function stats(values) {
  if (!values.length || values.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid samples');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, p90: sorted[Math.ceil(sorted.length * 0.9) - 1], min: sorted[0], max: sorted.at(-1) };
}

export function summarize(samples) {
  const groups = {};
  for (const sample of samples) (groups[`${sample.profile}:${sample.path}`] ||= []).push(sample);
  return Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, {
    count: rows.length,
    ...Object.fromEntries(METRICS.map(metric => [metric, stats(rows.map(row => row[metric]))])),
  }]));
}

export function compare(run, history) {
  const start = Date.parse(`${run.started.slice(0, 10)}T00:00:00Z`);
  const previous = history.filter(old => old.status === 'complete' && Date.parse(old.started) < start && Date.parse(old.started) >= start - 7 * 86400000 && isDeepStrictEqual(old.conditions, run.conditions));
  return Object.entries(run.groups).flatMap(([cohort, group]) => METRICS.map(metric => {
    // One vote per UTC day, so an investigator's repeat runs do not outweigh the daily timer.
    const days = new Map();
    for (const old of [...previous].sort((a, b) => Date.parse(a.started) - Date.parse(b.started))) {
      if (old.groups[cohort]) days.set(old.started.slice(0, 10), old.groups[cohort][metric].median);
    }
    const baseline = days.size ? stats([...days.values()]).median : null;
    const current = group[metric].median;
    const percent = baseline === null ? null : baseline === 0 ? (current === 0 ? 0 : null) : (current / baseline - 1) * 100;
    return { cohort, metric, current, baseline, days: days.size, percent, regression: baseline !== null && current > baseline + baseline * 0.15 };
  }));
}

export function appendHistory(file, run) {
  const history = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  if (!Array.isArray(history)) throw new Error('Invalid history');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify([...history, run], null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function requestFailed(request) {
  return !request.blocked && (request.status >= 400 || request.failed && !request.canceled);
}

export function verifyRun(run) {
  if (run.status !== 'complete' || run.schema !== PROTOCOL || !/^[a-f0-9]{40}$/.test(run.productionCommit) || run.productionCommit !== run.productionCommitEnd || run.accountId !== 2343 || run.base !== BASE || !Number.isFinite(Date.parse(run.started))) throw new Error('Incomplete live run');
  for (const profile of ['desktop', 'phone']) for (const surface of PATHS) {
    const rows = run.samples.filter(sample => sample.profile === profile && sample.path === surface);
    if (rows.length !== run.conditions.samples) throw new Error('Missing live path');
    for (const row of rows) {
      if (!METRICS.every(metric => Number.isFinite(row[metric]) && row[metric] >= 0) || !Array.isArray(row.requests) || !Array.isArray(row.longTasks) || row.requests.some(requestFailed)) throw new Error('Invalid live metric');
      const allowed = row.requests.filter(request => !request.blocked);
      if (row.requestCount !== allowed.length || row.bytes !== allowed.reduce((sum, request) => sum + request.bytes, 0) || row.longTaskMs !== row.longTasks.reduce((sum, task) => sum + task.durationMs, 0)) throw new Error('Incorrect metric totals');
    }
  }
  if (!isDeepStrictEqual(summarize(run.samples), run.groups)) throw new Error('Invalid live summary');
}

export function printSummary(run, history) {
  console.log(`${run.started} production ${run.productionCommit}; QA 2343; ${run.conditions.samples} samples/path/profile; ${run.status}`);
  console.log(`Host load ${run.hostLoad.map(n => n.toFixed(1)).join('/')}, ${run.cpus} CPUs. Phone: 390x844, 4x CPU, 150ms RTT, 1.6Mbps. Desktop: 1440x900, unthrottled.`);
  const comparisons = compare(run, history);
  for (const [cohort, group] of Object.entries(run.groups)) {
    const comparison = comparisons.find(row => row.cohort === cohort && row.metric === 'contentMs');
    const baseline = comparison.baseline === null ? 'no matching 7-day baseline' : `${comparison.percent === null ? 'new nonzero value' : `${comparison.percent >= 0 ? '+' : ''}${comparison.percent.toFixed(1)}%`} vs ${Math.round(comparison.baseline)}ms (${comparison.days} days)`;
    console.log(`${cohort}: ${Math.round(group.contentMs.median)}ms median, ${Math.round(group.contentMs.p90)}ms p90 [${Math.round(group.contentMs.min)}-${Math.round(group.contentMs.max)}]; ${group.requestCount.median} requests, ${Math.round(group.bytes.median / 1024)}KiB wire, ${Math.round(group.longTaskMs.median)}ms long tasks; ${baseline}${comparison.regression ? ' REGRESSION >15%' : ''}`);
  }
  for (const row of comparisons.filter(row => row.regression && row.metric !== 'contentMs')) console.log(`REGRESSION >15% ${row.cohort} ${row.metric}: ${row.current} vs ${row.baseline}`);
  if (run.conditions.samples < 5) console.log('Provisional harness run, not before/after speed proof (fewer than five samples).');
}

export function browserObserver() {
  window.__analyst = { longTasks: [], start: 0 };
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) window.__analyst.longTasks.push({ startMs: entry.startTime, durationMs: entry.duration });
  }).observe({ type: 'longtask', buffered: true });
  for (const event of ['click', 'keydown']) document.addEventListener(event, () => { window.__analyst.start = performance.now(); }, { capture: true });
}

export async function ready(page, surface) {
  return page.evaluate(async ({ surface, task, title }) => {
    const visible = element => {
      if (!element) return false;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight) return false;
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const test = () => {
      if (surface === 'board' || surface === 'page-navigation') return visible(document.querySelector(`a[href="${task}"]`)) && document.body.textContent.includes('QA Sandbox');
      if (surface.startsWith('ticket-')) return [...document.querySelectorAll('textarea')].some(element => visible(element) && element.value === title) && visible(document.querySelector('[data-testid="ticket-description"]')) && !!document.querySelector('[data-task-detail-primary-actions="true"]');
      if (surface === 'search') return [...document.querySelectorAll('#tasks-list li')].some(element => visible(element) && element.textContent.includes('QASA-43') && [...element.querySelectorAll('span')].some(span => span.textContent.trim() === title));
      if (surface === 'my-tasks') return visible(document.querySelector('[data-testid="my-tasks-title"]')) && visible(document.querySelector('[data-testid="my-tasks-list"] .table-view-header'));
      if (surface === 'ctrl-j') return [...document.querySelectorAll('[data-compose-task-writer] textarea, [data-compose-task-writer] [contenteditable="true"], .modal-dialog textarea, #createTaskModal [contenteditable="true"], [data-mobile-task-writer-field] textarea')].some(visible);
      return false;
    };
    const deadline = performance.now() + 60000;
    while (performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!test()) continue;
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (test()) return performance.now();
    }
    throw new Error('Readiness unavailable');
  }, { surface, task: TASK, title: TITLE });
}

export function collectNetwork(cdp, permitted, safePath, blocked) {
  const requests = new Map();
  const onRequest = event => requests.set(event.requestId, { path: safePath(event.request.url), method: event.request.method, type: event.type, wall: event.wallTime * 1000, start: event.timestamp, status: null, bytes: 0, failed: false, blocked: !permitted(event.request.method, event.request.url), serverTiming: [] });
  const onResponse = event => {
    const row = requests.get(event.requestId);
    if (!row) return;
    row.status = event.response.status;
    row.ttfbMs = (event.timestamp - row.start) * 1000;
    // Header descriptions can contain private strings. Persist only metric names and numeric durations.
    const header = Object.entries(event.response.headers).find(([name]) => name.toLowerCase() === 'server-timing')?.[1];
    row.serverTiming = String(header || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).flatMap(metric => {
      const name = metric.trim().match(/^([\w-]+)/)?.[1];
      const duration = metric.match(/;\s*dur\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1];
      return name ? [{ name, durationMs: duration === undefined ? null : Number(duration) }] : [];
    });
  };
  const onFinished = event => {
    const row = requests.get(event.requestId);
    if (row) { row.bytes = event.encodedDataLength; row.durationMs = (event.timestamp - row.start) * 1000; }
  };
  const onFailed = event => {
    const row = requests.get(event.requestId);
    if (row) { row.failed = true; row.canceled = event.canceled === true; row.errorCode = /^net::ERR_[A-Z0-9_]+$/.test(event.errorText || '') ? event.errorText : null; row.durationMs = (event.timestamp - row.start) * 1000; }
  };
  const onPaused = async event => {
    try {
      if (permitted(event.request.method, event.request.url)) await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
      else {
        blocked.push({ method: event.request.method, path: safePath(event.request.url) });
        const row = requests.get(event.networkId);
        if (row) row.blocked = true;
        await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      }
    } catch { /* A page can close with an intercepted request queued. */ }
  };
  const onData = event => { const row = requests.get(event.requestId); if (row) row.bytes += event.encodedDataLength; };
  const handlers = { 'Network.dataReceived': onData, 'Network.requestWillBeSent': onRequest, 'Network.responseReceived': onResponse, 'Network.loadingFinished': onFinished, 'Network.loadingFailed': onFailed, 'Fetch.requestPaused': onPaused };
  for (const [event, handler] of Object.entries(handlers)) cdp.on(event, handler);
  return { requests, stop() { for (const [event, handler] of Object.entries(handlers)) cdp.off(event, handler); } };
}

async function measure(shared, browser, profile, index, run) {
  const mobile = profile === 'phone';
  for (const phase of ['board', 'other']) {
    const context = await shared.setup(browser, mobile);
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const cdp = await context.newCDPSession(page);
    const blocked = [];
    const net = collectNetwork(cdp, shared.permitted, shared.safePath, blocked);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    if (mobile) {
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1600000 / 8, uploadThroughput: 750000 / 8, connectionType: 'cellular4g' });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    await page.addInitScript(browserObserver);

    let surface = phase;
    const navigate = route => shared.action(page, () => page.goto(BASE + route, { waitUntil: 'domcontentloaded' }), run.actions, 'document', route);
    const sample = async (measuredSurface, operation, document = true) => {
      surface = measuredSurface;
      net.requests.clear();
      blocked.length = 0;
      await page.evaluate(() => { if (window.__analyst) window.__analyst.start = performance.now(); });
      await operation();
      const contentAt = await ready(page, surface);
      const origin = document ? 0 : await page.evaluate(() => window.__analyst.start);
      // Same two-second observation tail as speed-check; not part of content-visible timing.
      await page.waitForTimeout(2000);
      const metrics = await page.evaluate(({ origin, contentAt }) => {
        const longTasks = window.__analyst.longTasks.filter(task => task.startMs >= origin && task.startMs <= contentAt + 2000);
        return { contentMs: contentAt - origin, longTasks, longTaskMs: longTasks.reduce((sum, task) => sum + task.durationMs, 0), actionEpoch: performance.timeOrigin + origin };
      }, { origin, contentAt });
      const requests = [...net.requests.values()].filter(row => row.wall >= metrics.actionEpoch).map(({ wall, start, ...row }) => ({ ...row, startMs: wall - metrics.actionEpoch }));
      delete metrics.actionEpoch;
      const row = { profile, path: surface, index, ...metrics, requestCount: requests.filter(request => !request.blocked).length, bytes: requests.filter(request => !request.blocked).reduce((sum, request) => sum + request.bytes, 0), requests, blocked: [...blocked] };
      run.samples.push(row);
      if (row.requests.some(requestFailed)) throw new Error('Measured request failed');
      console.log(`Measured ${profile}:${surface} ${index}: ${Math.round(row.contentMs)}ms`);
    };
    try {
      if (phase === 'board') {
        await sample('board', () => navigate(BOARD));
        continue;
      }
      // Direct ticket is cold in a fresh context; the board primes only the warm click below.
      await sample('ticket-cold', () => navigate(TASK));
      await navigate(BOARD);
      await ready(page, 'board');
      await sample('ticket-warm', () => shared.action(page, () => page.locator(`a[href="${TASK}"]`).first().click(), run.actions, 'client', TASK), false);
      await navigate('/search');
      await page.locator('#search-input').waitFor({ state: 'visible' });
      await page.locator('#search-input').fill(TITLE);
      await sample('search', () => shared.action(page, () => page.keyboard.press('Enter'), run.actions, 'client', '/search'), false);
      await sample('my-tasks', () => navigate('/my-tasks'));
      await page.evaluate(() => document.activeElement?.blur());
      await sample('page-navigation', () => shared.action(page, async () => { await page.keyboard.press('g'); await page.keyboard.press('b'); }, run.actions, 'client', BOARD), false);
      // Plain QA uses the existing board Ctrl+J writer, not the Owner + QA palette on My Tasks.
      await page.locator('.section-container').first().click({ position: { x: 2, y: 2 } });
      await page.locator('.section-container').first().focus();
      await sample('ctrl-j', () => shared.action(page, () => page.keyboard.press('Control+j'), run.actions, 'client', BOARD), false);
      await page.keyboard.press('Escape');
    } catch {
      run.failure = { profile, surface, route: new URL(page.url()).pathname, requests: [...net.requests.values()].map(({ wall, start, ...row }) => row), blocked: [...blocked] };
      throw new Error('Path unavailable');
    } finally { net.stop(); await context.close(); }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) return console.log('Usage: node scripts/speed/measure.mjs [--samples 1..5 | --latest | --verify-history]\nHistory: ~/.local/state/speed/history.json. Live QA-normal only. No board writes.');
  const file = path.join(STATE, 'history.json');
  if (argv.length === 1 && ['--latest', '--verify-history'].includes(argv[0])) {
    const history = JSON.parse(fs.readFileSync(file, 'utf8'));
    const run = history.at(-1);
    if (argv[0] === '--verify-history') { verifyRun(run); console.log('LIVE HISTORY VERIFIED'); }
    else printSummary(run, history.slice(0, -1));
    return;
  }
  const samples = argv.length === 0 ? 5 : argv.length === 2 && argv[0] === '--samples' && /^[1-5]$/.test(argv[1]) ? Number(argv[1]) : NaN;
  if (!Number.isInteger(samples)) throw new Error('Invalid options');
  fs.mkdirSync(STATE, { recursive: true, mode: 0o700 });
  const lock = path.join(STATE, 'measure.lock');
  const handle = fs.openSync(lock, 'wx', 0o600);
  let browser;
  const run = { schema: PROTOCOL, started: new Date().toISOString(), base: BASE, accountId: 2343, status: 'failed', hostLoad: os.loadavg(), cpus: os.availableParallelism(), samples: [], groups: {}, actions: [] };
  try {
    const company = process.env.COMPANY_SKILLS_DIR || path.join(os.homedir(), 'projects/company-skills');
    const shared = await import(pathToFileURL(path.join(company, 'skills/speed-check/scripts/common.mjs')).href);
    // Reviewed read-only additions: bootstrap, My Tasks and keyword search. Never allow AI prompts or task writes.
    shared.readPosts.add('/api/app-shell/bootstrap');
    shared.readGets.add('/api/my-tasks');
    shared.readPosts.add('/api/search/document');
    shared.readGets.add('/api/search/values');
    browser = await shared.playwright().chromium.launch({ headless: true });
    run.conditions = { protocol: PROTOCOL, node: process.version, browser: browser.version(), samples, fixture: 'qa-normal-2343-project-6859-task-43', profiles: ['desktop-unthrottled-1440x900', 'phone-4g-4x-390x844'], observationTailMs: 2000, serviceWorkers: 'blocked' };
    const doctor = await shared.setup(browser, false);
    try {
      const identity = await doctor.request.post(BASE + '/api/app-shell/bootstrap');
      const payload = identity.ok() ? await identity.json() : null;
      if (String(payload?.slices?.user?.data?.id) !== '2343') throw new Error('QA doctor failed');
      const version = await doctor.request.get(BASE + '/api/version');
      run.productionCommit = (await version.json()).buildId;
      if (!version.ok() || !/^[a-f0-9]{40}$/.test(run.productionCommit)) throw new Error('Production identity unavailable');
    } finally { await doctor.close(); }
    for (const profile of ['desktop', 'phone']) for (let index = 1; index <= samples; index++) await measure(shared, browser, profile, index, run);
    const response = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(15000) });
    run.productionCommitEnd = (await response.json()).buildId;
    if (!response.ok() || run.productionCommitEnd !== run.productionCommit) throw new Error('Production changed during run');
    run.groups = summarize(run.samples);
    run.status = 'complete';
    verifyRun(run);
  } catch (error) {
    run.status = 'failed';
    const reasons = ['Incomplete live run', 'Missing live path', 'Invalid live metric', 'Incorrect metric totals', 'Invalid live summary', 'Production changed during run', 'Production identity unavailable', 'QA doctor failed', 'Path unavailable'];
    const reason = reasons.includes(error.message) ? error.message : 'Tool, auth or selector unavailable';
    run.failure = { ...run.failure, reason };
    console.error(`Cannot verify: ${reason}`);
    throw new Error('Cannot verify run');
  } finally {
    run.finished = new Date().toISOString();
    try { run.groups = summarize(run.samples); } catch { run.groups = {}; run.status = 'failed'; }
    try { appendHistory(file, run); } finally {
      try { if (browser) await browser.close(); } finally {
        fs.closeSync(handle);
        fs.unlinkSync(lock);
      }
    }
  }
  const history = JSON.parse(fs.readFileSync(file, 'utf8'));
  printSummary(run, history.slice(0, -1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Browser/JSON exceptions can contain cookies or private response bodies.
    console.error('Speed measurement cannot verify. Check QA-normal login, shared speed-check, selectors and private history. No credentials logged.');
    process.exitCode = 1;
  });
}
