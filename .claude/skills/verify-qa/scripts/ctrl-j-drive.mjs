#!/usr/bin/env node
// Hands-free drive for the Ctrl+J New Task popup. Prints PASS or FAIL per step.
// Runs only against a disposable loopback stack (the browser-smoke seed), never production.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright');

const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(`--${name}`); return at === -1 ? undefined : args[at + 1]; };
const positional = args.filter((arg, index) => !arg.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--')));
const BASE = flag('base') || process.env.VERIFY_QA_BASE || '';
const STATE = flag('state') || process.env.VERIFY_QA_STATE_FILE || '';
const BROKEN = flag('break');
const dir = positional[0] || path.join(os.tmpdir(), `ctrl-j-drive-${Date.now()}`);
const cardFixture = path.join(root, 'e2e/smoke/.state/card-fixture.json');

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error('ctrl-j drive refuses a non-loopback base: it drives a disposable seeded stack, never production');
  process.exit(2);
}
if (!STATE) {
  console.error('ctrl-j drive needs --state <storageState.json> (or VERIFY_QA_STATE_FILE)');
  process.exit(2);
}
const fixture = flag('board') ? {} : JSON.parse(await fs.readFile(cardFixture, 'utf8').catch(() => '{}'));
const seededBoard = fixture.boardPath
  || (fixture.detailPath ? `/project?id=${/^\/detail\/project-(\d+)\//.exec(fixture.detailPath)?.[1]}&surface=board` : undefined);
const BOARD = flag('board') || seededBoard;
if (!BOARD) {
  console.error('ctrl-j drive needs --board <board path> or the browser-smoke card fixture');
  process.exit(2);
}

await fs.mkdir(dir, { recursive: true });
const result = { base: BASE, board: BOARD, broken: BROKEN || null, steps: [], created: [] };
const step = (name, pass, detail) => {
  result.steps.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name} ${JSON.stringify(detail ?? '')}`);
};
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: BASE, storageState: STATE, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const popup = page.locator('#htc').first();
const composer = page.locator('[aria-label="Describe the task"]').first();
const writer = page.locator('[data-compose-task-writer]').first();
const deleteTask = async (id) => {
  await context.request.post('/api/queues/tasks/taskDeleteReminder', { data: { taskId: id } }).catch(() => {});
  await context.request.delete(`/api/tasks/deleteTask?taskId=${id}`).catch(() => {});
};
const blurAndPress = async (key) => { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press(key); };

if (BROKEN === 'shortcut') {
  await page.addInitScript(() => {
    window.addEventListener('keydown', (event) => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  });
}

try {
  await page.goto(BOARD, { waitUntil: 'domcontentloaded' });
  await page.locator('.kanban-column-title').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-ai-chat-ready="true"]').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});

  await blurAndPress('Control+j');
  const opened = await popup.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(dir, '01-ctrl-j-opened.png') });
  step('ctrl-j-opens the New Task popup', opened && (await composer.isVisible()), { opened });

  await composer.click();
  const marker = `Ctrl+J drive ${Date.now()}`;
  await page.keyboard.insertText(marker);
  step('the composer takes typed text', (await composer.inputValue()) === marker, { marker });

  const create = writer.locator('[aria-label="Create task"]');
  const named = await create.isVisible().catch(() => false);
  const name = named ? await create.getAttribute('aria-label') : null;
  step('the composer buttons have their hover names', named && name === 'Create task', { name });

  const footerText = (await writer.innerText().catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
  const shortcut = /(ctrl|cmd) enter create/.test(footerText) ? 'Control+Enter' : 'Enter';
  const waitForCreate = (ms) => page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/tasks/create', { timeout: ms }).catch(() => null);
  const sentTask = async (response) => {
    if (!response) return { task: null, body: null };
    const body = await response.json().catch(() => null);
    return { task: body?.newTask?.newTask ?? body?.newTask ?? body?.task ?? body, body };
  };
  let via = `shortcut ${shortcut}`;
  let sent = waitForCreate(90_000);
  await composer.click();
  await page.keyboard.press(shortcut);
  let response = await sent;
  if (!response) {
    via = 'Create button after the shortcut sent nothing';
    sent = waitForCreate(90_000);
    await writer.locator('[aria-label="Create task"]').first().click();
    response = await sent;
  }
  const { task, body } = await sentTask(response);
  if (task?.id) result.created.push({ id: task.id, uniqueIndex: task.uniqueIndex });
  const closed = await popup.waitFor({ state: 'hidden', timeout: 20_000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(dir, '02-ctrl-j-created.png') });
  step('the send shortcut creates one task and closes the popup', Boolean(task?.id) && closed, {
    status: response?.status() ?? null,
    url: response?.url() ?? null,
    via,
    closed,
    body: JSON.stringify(body ?? null).slice(0, 300),
    footer: footerText.slice(0, 120),
  });

  await page.goto(BOARD, { waitUntil: 'domcontentloaded' });
  await page.locator('.kanban-column-title').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-ai-chat-ready="true"]').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await blurAndPress('Control+j');
  await popup.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  step('Escape closes the popup', await popup.isHidden(), {});
} catch (error) {
  step('run', false, error.message.split('\n')[0]);
} finally {
  for (const task of result.created) await deleteTask(task.id);
  await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  await browser.close();
}

const failed = result.steps.filter((entry) => !entry.pass);
if (BROKEN) {
  const target = result.steps.find((entry) => entry.name === 'ctrl-j-opens the New Task popup');
  const detected = Boolean(target) && !target.pass;
  console.log(`negative control ${detected ? 'ok' : 'FAIL'}: ${BROKEN} break ${detected ? 'failed the shortcut step' : 'was not detected'}`);
  process.exitCode = detected ? 0 : 1;
} else {
  console.log(failed.length ? `ctrl-j drive FAIL: ${failed.map((entry) => entry.name).join('; ')}` : 'ctrl-j drive ok');
  process.exitCode = failed.length ? 1 : 0;
}
