#!/usr/bin/env node
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
const fail = (message) => { console.error(message); process.exit(2); };
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) fail('ctrl-j drive refuses a non-loopback base: it drives a disposable seeded stack, never production');
if (!STATE) fail('ctrl-j drive needs --state <storageState.json> (or VERIFY_QA_STATE_FILE)');
const fixture = flag('board') ? {} : JSON.parse(await fs.readFile(path.join(root, 'e2e/smoke/.state/card-fixture.json'), 'utf8').catch(() => '{}'));
const BOARD = flag('board') || fixture.boardPath
  || (fixture.detailPath ? `/project?id=${/^\/detail\/project-(\d+)\//.exec(fixture.detailPath)?.[1]}&surface=board` : undefined);
if (!BOARD) fail('ctrl-j drive needs --board <board path> or the browser-smoke card fixture');

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
const createTask = writer.locator('[aria-label="Create task"]').first();
const visible = (locator) => locator.isVisible().catch(() => false);
const openBoard = async () => {
  await page.goto(BOARD, { waitUntil: 'domcontentloaded' });
  await page.locator('.kanban-column-title').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-ai-chat-ready="true"]').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
};
const pressCtrlJ = async () => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+j');
};
const deleteTask = async (id) => {
  await context.request.post('/api/queues/tasks/taskDeleteReminder', { data: { taskId: id } }).catch(() => {});
  await context.request.delete(`/api/tasks/deleteTask?taskId=${id}`).catch(() => {});
};
if (BROKEN === 'shortcut') {
  await page.addInitScript(() => window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true));
}

try {
  await openBoard();
  await pressCtrlJ();
  const opened = await popup.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(dir, '01-ctrl-j-opened.png') });
  step('ctrl-j-opens the New Task popup', opened && (await visible(composer)), { opened });

  await composer.focus();
  const marker = `Ctrl+J drive ${Date.now()}`;
  await page.keyboard.insertText(marker);
  step('the composer takes typed text', (await composer.inputValue()) === marker, { marker });

  const name = await createTask.getAttribute('aria-label').catch(() => null);
  step('the composer buttons have their hover names', (await visible(createTask)) && name === 'Create task', { name });

  const footer = (await writer.innerText().catch(() => '')).replace(/\s+/g, ' ').toLowerCase();
  const shortcut = /(ctrl|cmd) enter create/.test(footer) ? 'Control+Enter' : 'Enter';
  const createResponses = [];
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && response.url().includes('/api/tasks/create')) createResponses.push(response);
  });
  await composer.focus();
  await page.keyboard.press(shortcut);
  const createdTicket = await page.waitForURL(/\/detail\/project-\d+\/\d+/, { timeout: 120_000 }).then(() => true, () => false);
  let task = null;
  for (const response of createResponses) {
    const body = await response.json().catch(() => null);
    task = body?.newTask?.newTask ?? body?.newTask ?? body?.task ?? body;
    if (task?.id) break;
  }
  if (task?.id) result.created.push(task);
  const successes = createResponses.filter((response) => response.status() === 200).length;
  await page.screenshot({ path: path.join(dir, '02-ctrl-j-created.png') });
  step('the send shortcut creates exactly one task and opens it', createdTicket && successes === 1, {
    via: `shortcut ${shortcut}`,
    url: page.url(),
    creates: successes,
    uniqueIndex: task?.uniqueIndex ?? (/\/detail\/project-\d+\/(\d+)/.exec(page.url()) ?? [])[1] ?? null,
    footer: footer.slice(0, 120),
  });

  await openBoard();
  await pressCtrlJ();
  await popup.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  await page.keyboard.press('Escape');
  const escaped = await popup.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(dir, '03-ctrl-j-closed.png') });
  step('Escape closes the popup', escaped, {});
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
