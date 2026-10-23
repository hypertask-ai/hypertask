#!/usr/bin/env node
// YPER4-629 live inbox cycle as QA 985 on app.hypertask.ai: open by click and by Enter, J, send a comment, E.
// Usage: node .claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <evidence dir> [--phone]
// Prints "inbox-cycle ok" or "inbox-cycle FAIL: <reason>" and writes result.json plus screenshots.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const { chromium, devices } = createRequire(path.join(root, 'package.json'))('playwright');
const [dir = path.join(os.tmpdir(), `inbox-cycle-${Date.now()}`)] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const phone = process.argv.includes('--phone');
const BASE = 'https://app.hypertask.ai';
const QA = 985;
const BOARD = 7049;
const SECTION = 19409;
const STATE = process.env.QA_STATE || path.join(os.homedir(), '.config/hypertask-videos/storageState-qa.json');

await fs.mkdir(dir, { recursive: true });
const result = { phone, steps: [], created: [] };
const step = (name, pass, detail) => { result.steps.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}: ${name} ${JSON.stringify(detail ?? '')}`); };
const browser = await chromium.launch();
const context = await browser.newContext({ ...(phone ? devices['iPhone 13'] : { viewport: { width: 1440, height: 900 } }), baseURL: BASE, storageState: STATE });
const page = await context.newPage();
const api = async (method, url, data) => {
  const response = await context.request.fetch(url, { method, ...(data === undefined ? {} : { data }) });
  const body = await response.json().catch(() => null);
  if (!response.ok()) throw new Error(`${method} ${url}: HTTP ${response.status()}`);
  return body;
};
const inboxTaskIds = async () => new Set(((await api('GET', '/api/notifications/getAll')).notifications ?? []).filter((n) => n.status === 'Normal').map((n) => n.taskId));
const counter = () => page.getByText(/^\d+ \/ \d+$/).first().textContent({ timeout: 10_000 }).catch(() => null);
const openedTask = () => result.created.find((task) => new URL(page.url()).pathname === `/detail/project-${BOARD}/${task.uniqueIndex}`);
const inFlow = () => new URL(page.url()).searchParams.get('inboxFlow') === 'true';
const waitForMove = (from) => page.waitForURL((url) => url.pathname !== from, { timeout: 15_000 }).then(() => true, () => false);
const blurAndPress = async (key) => { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press(key); };
async function send(text) {
  const editor = page.getByTestId('comment-composer').locator('.ProseMirror[contenteditable="true"]');
  await editor.click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Control+Enter');
}

try {
  const me = await api('POST', '/api/app-shell/bootstrap');
  if (me.slices?.user?.data?.id !== QA) throw new Error('storage state is not QA 985');
  if ((await api('GET', '/api/users/preferences')).settings?.inboxAdvanceOnSend === false) throw new Error('QA 985 has advance-on-send off');
  const stamp = Date.now();
  for (let index = 1; index <= 3; index++) {
    const body = await api('POST', '/api/tasks/create', { title: `[qa-runner] inbox cycle ${index} ${stamp}`, projectId: BOARD, sectionId: SECTION, userId: QA });
    const task = body?.newTask?.newTask ?? body?.newTask ?? body?.task ?? body;
    if (task?.projectId !== BOARD) throw new Error('created task is not on QA Sandbox');
    result.created.push({ id: task.id, uniqueIndex: task.uniqueIndex, title: `[qa-runner] inbox cycle ${index} ${stamp}` });
  }
  const remindAt = new Date(Date.now() + 20_000).toISOString();
  for (const task of result.created) await api('POST', '/api/queues/inboxReminder', { taskId: task.id, projectId: BOARD, remindAt, reminderOption: 'DurationComplete' });
  const deadline = Date.now() + 180_000;
  for (let ids = await inboxTaskIds(); !result.created.every((task) => ids.has(task.id)); ids = await inboxTaskIds()) {
    if (Date.now() > deadline) throw new Error('reminders did not reach the inbox in 3 minutes');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  await page.goto('/inbox?realtime=on', { waitUntil: 'domcontentloaded' });
  const first = result.created[0];
  await page.getByText(first.title).first().waitFor({ timeout: 60_000 });
  await page.screenshot({ path: path.join(dir, '01-inbox.png') });
  await page.getByText(first.title).first().click();
  await page.waitForURL(/\/detail\/project-\d+\/\d+/, { timeout: 30_000 });
  step('open by click keeps inboxFlow', inFlow() && openedTask()?.id === first.id, { url: page.url(), counter: await counter() });

  const clicked = new URL(page.url()).pathname;
  await send(`QA inbox cycle reply ${stamp}`);
  const moved = await waitForMove(clicked);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, '02-after-send.png') });
  step('send a comment archives and opens the next message', moved && inFlow() && !(await inboxTaskIds()).has(first.id), { url: page.url(), counter: await counter() });

  const current = openedTask();
  if (current) {
    const before = new URL(page.url()).pathname;
    await blurAndPress('j');
    step('J opens the next message and keeps inboxFlow', (await waitForMove(before)) && inFlow() && (await inboxTaskIds()).has(current.id), { url: page.url() });
    await page.goto(`/detail/project-${BOARD}/${current.uniqueIndex}?inboxFlow=true`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await blurAndPress('e');
    step('E archives and opens the next message', (await waitForMove(`/detail/project-${BOARD}/${current.uniqueIndex}`)) && !(await inboxTaskIds()).has(current.id), { url: page.url() });
  } else step('J and E on our own seeded message', false, 'the next message after send was not one of ours; rerun');

  await page.goto('/inbox?realtime=on', { waitUntil: 'domcontentloaded' });
  await page.getByText(/^\[qa-runner\]|inbox cycle/).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/detail\/project-\d+\/\d+/, { timeout: 30_000 }).catch(() => {});
  step('open by Enter keeps inboxFlow', inFlow(), { url: page.url(), counter: await counter() });
  await page.screenshot({ path: path.join(dir, '03-enter-open.png') });
} catch (error) {
  step('run', false, error.message.split('\n')[0]);
} finally {
  for (const task of result.created) {
    await api('POST', '/api/queues/tasks/taskDeleteReminder', { taskId: task.id }).catch(() => {});
    await api('GET', `/api/notifications/markAsDone?taskId=${task.id}&userId=${QA}`).catch(() => {});
  }
  await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  await browser.close();
}
const failed = result.steps.filter((s) => !s.pass);
console.log(failed.length ? `inbox-cycle FAIL: ${failed.map((s) => s.name).join('; ')}` : 'inbox-cycle ok');
process.exitCode = failed.length ? 1 : 0;
