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
const dir = positional[0] || path.join(os.tmpdir(), `ai-chat-drive-${Date.now()}`);
const fail = (message) => { console.error(message); process.exit(2); };
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) fail('ai-chat drive refuses a non-loopback base: it drives a disposable seeded stack, never production');
if (!STATE) fail('ai-chat drive needs --state <storageState.json> (or VERIFY_QA_STATE_FILE)');
const fixture = flag('board') ? {} : JSON.parse(await fs.readFile(path.join(root, 'e2e/smoke/.state/card-fixture.json'), 'utf8').catch(() => '{}'));
const BOARD = flag('board') || fixture.boardPath
  || (fixture.detailPath ? `/project?id=${/^\/detail\/project-(\d+)\//.exec(fixture.detailPath)?.[1]}&surface=board` : undefined);
if (!BOARD) fail('ai-chat drive needs --board <board path> or the browser-smoke card fixture');

await fs.mkdir(dir, { recursive: true });
const result = { base: BASE, board: BOARD, broken: BROKEN || null, steps: [] };
const step = (name, pass, detail) => {
  result.steps.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name} ${JSON.stringify(detail ?? '')}`);
};
const state = JSON.parse(await fs.readFile(STATE, 'utf8'));
const browser = await chromium.launch();
const newContext = async (init) => {
  const context = await browser.newContext({ baseURL: BASE, storageState: state, viewport: { width: 1440, height: 900 } });
  if (init) await context.addInitScript(init);
  return context;
};
const swallowChatShortcut = () => window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);
const context = await newContext(BROKEN === 'shortcut' ? swallowChatShortcut : undefined);
const page = await context.newPage();
const composer = page.locator('#ai-chat-tiptap-editor .ProseMirror:visible').first();
const sidebar = page.getByTestId('ai-sidebar');
const visible = (locator) => locator.isVisible().catch(() => false);
const closeSidebar = async () => {
  if (!(await visible(sidebar))) return;
  const chevron = sidebar.locator('button:has(svg.lucide-chevron-right)');
  if (await chevron.count()) return chevron.first().click();
  return page.getByRole('button', { name: 'Close AI chat', exact: true }).last().click();
};

try {
  await page.goto('/chat', { waitUntil: 'domcontentloaded' });
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  const composerRoot = page.locator('[data-ai-chat-composer-root]:not([inert])').last();
  const add = composerRoot.locator('summary[aria-label="Add"], button[aria-label="Add"]').first();
  const names = [];
  if (await visible(add)) {
    await add.click();
    for (const label of ['Attach file', 'Add context']) {
      const item = composerRoot.locator(`[aria-label="${label}"]`).first();
      if (await visible(item)) names.push(await item.getAttribute('aria-label'));
    }
    const dictation = composerRoot.locator('[aria-label="Start dictation"]').first();
    if (await visible(dictation)) names.push(await dictation.getAttribute('aria-label'));
    await add.click();
  }
  await page.screenshot({ path: path.join(dir, '01-full-page.png') });
  step('the full-page chat shows its composer and named buttons', (await visible(composer)) && names.length >= 2, { names });

  await composer.click();
  await page.keyboard.insertText(`AI chat drive ${Date.now()}`);
  await page.keyboard.press('Enter');
  const answered = await page.waitForFunction(
    () => document.querySelectorAll('.submessage-container.delivered [data-chat-content-html]').length >= 2,
    null, { timeout: 90_000 },
  ).then(() => true, () => false);
  const reply = answered ? (await page.locator('.submessage-container.delivered [data-chat-content-html]').last().innerText()).trim() : '';
  await page.screenshot({ path: path.join(dir, '02-chat-sent.png') });
  step('Enter sends the message and an assistant answer arrives', answered && reply.length > 0 && !/Premerge stubs require/.test(reply), { reply: reply.slice(0, 120) });

  await page.goto(BOARD, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-ai-chat-ready="true"]').waitFor({ state: 'attached', timeout: 30_000 });
  await closeSidebar();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+q');
  const opened = await sidebar.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(dir, '03-sidebar.png') });
  step('the chat shortcut opens the docked sidebar with its composer', opened && (await visible(composer)), { opened });
  await closeSidebar();
  const closed = await sidebar.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(dir, '04-sidebar-closed.png') });
  step('the close control hides the docked sidebar', closed, {});
} catch (error) {
  step('run', false, error.message.split('\n')[0]);
}

try {
  const floating = await newContext(() => {
    const saved = JSON.parse(localStorage.getItem('recoil-persist') || '{}');
    localStorage.setItem('recoil-persist', JSON.stringify({ ...saved, isAiChatSidebarMode: false, aiChatPinned: false, aiChatAutoOpenSuppressed: true }));
  });
  const floatingPage = await floating.newPage();
  await floatingPage.route('**/api/flags', async (route) => {
    const answer = await route.fetch();
    const body = await answer.json();
    Object.assign(body.flags, { 'htpr-8334-multi-chat-windows': false });
    await route.fulfill({ response: answer, json: body });
  });
  const windowPanel = floatingPage.locator('.chatwindow').first();
  await floatingPage.goto(BOARD, { waitUntil: 'domcontentloaded' });
  await floatingPage.locator('[data-ai-chat-ready="true"]').waitFor({ state: 'attached', timeout: 30_000 });
  if (await windowPanel.isVisible()) await floatingPage.getByRole('button', { name: 'Close AI chat', exact: true }).last().click();
  await floatingPage.evaluate(() => document.activeElement?.blur());
  await floatingPage.keyboard.press('Control+q');
  const shown = await windowPanel.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
  await floatingPage.screenshot({ path: path.join(dir, '05-floating-window.png') });
  step('the chat shortcut opens the floating window', shown && (await windowPanel.locator('[contenteditable="true"]').isVisible()), { shown });
  await floating.close();
} catch (error) {
  step('floating window', false, error.message.split('\n')[0]);
}

await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
await browser.close();
const failed = result.steps.filter((entry) => !entry.pass);
if (BROKEN) {
  const target = result.steps.find((entry) => entry.name === 'the chat shortcut opens the docked sidebar with its composer');
  const detected = Boolean(target) && !target.pass;
  console.log(`negative control ${detected ? 'ok' : 'FAIL'}: ${BROKEN} break ${detected ? 'failed the shortcut step' : 'was not detected'}`);
  process.exitCode = detected ? 0 : 1;
} else {
  console.log(failed.length ? `ai-chat drive FAIL: ${failed.map((entry) => entry.name).join('; ')}` : 'ai-chat drive ok');
  process.exitCode = failed.length ? 1 : 0;
}
