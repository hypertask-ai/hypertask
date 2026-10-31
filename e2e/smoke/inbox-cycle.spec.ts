import type { Page } from '@playwright/test'
import { test, expect } from './lib/appReady'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { withRealtime } from './lib/realtime'

const stateFile = process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'
test.use({ storageState: stateFile })
test.describe.configure({ mode: 'serial' })
test.skip(!process.env.BROWSER_SMOKE_PR, 'Writes only to GitHub disposable loopback fixtures')

type Item = { taskId: number; title: string; detailPath: string }
let items: Item[]

test.beforeAll(() => {
  expect(['127.0.0.1', 'localhost']).toContain(new URL(process.env.BASE_URL!).hostname)
  items = JSON.parse(readFileSync(path.join(path.dirname(stateFile), 'inbox-cycle-fixture.json'), 'utf8')).items
  expect(items).toHaveLength(5)
})

async function expectOpenInFlow(page: Page, item: Item, counter: RegExp) {
  await expect.poll(() => new URL(page.url()).pathname, { message: `${item.title} opens` }).toBe(item.detailPath)
  expect(new URL(page.url()).searchParams.get('inboxFlow'), `${item.title} keeps inboxFlow in the URL`).toBe('true')
  await expect(page.getByText(/^\d+ \/ \d+$/).first(), `${item.title} inbox counter`).toHaveText(counter)
  await expect(page.getByText(item.title).first(), `${item.title} ticket content is shown`).toBeVisible()
}

function archiveSettles(page: Page) {
  return page.waitForResponse((response) => /\/api\/notifications\/markAsDone/.test(response.url()), { timeout: 15_000 })
    .then(async (response) => {
      const body = await response.json().catch(() => null)
      const outcome = `${response.status()} ${body?.status ?? 'no status'}`
      console.log(`[inbox-cycle archive] ${new URL(response.url()).search} -> ${outcome}`)
      return outcome
    }, () => 'no archive response in 15s')
}

async function sendComment(page: Page, text: string) {
  const editor = page.getByTestId('comment-composer').locator('.ProseMirror[contenteditable="true"]')
  await expect(editor).toBeVisible()
  await expect.poll(async () => {
    await editor.click()
    if (!(await editor.innerText()).includes(text)) await page.keyboard.insertText(text)
    return editor.innerText()
  }, { message: 'the comment text is in the current ticket comment box' }).toContain(text)
  await expect(editor).toBeFocused()
  await editor.evaluate((element) => { element.setAttribute('data-inbox-cycle-typed', 'true') })
  const created = page.waitForRequest((request) => /\/api\/comments\/create/.test(request.url()) && request.method() === 'POST', { timeout: 5_000 }).then(() => true, () => false)
  await page.keyboard.press('Control+Enter')
  if (await created) return
  const editorText = await editor.innerText()
  const typedEditorStillMounted = await page.locator('[data-inbox-cycle-typed="true"]').count()
  const editorCount = await page.locator('.ProseMirror').count()
  const toasts = await page.locator('[role="status"]').allInnerTexts().catch(() => [])
  console.log(`[inbox-cycle] Control+Enter sent no comment on ${new URL(page.url()).pathname}; editor text: ${editorText}; typed editor still mounted: ${typedEditorStillMounted}; editors: ${editorCount}; toasts: ${JSON.stringify(toasts)}`)
  throw new Error(`Control+Enter in a focused comment box holding "${editorText}" sent no comment`)
}

test.beforeEach(async ({ page }) => {
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/api/') && (request.method() !== 'GET' || pathname.endsWith('/markAsDone'))) console.log(`[inbox-cycle request] ${request.method()} ${pathname} on ${new URL(page.url()).pathname}`)
  })
  page.on('console', (message) => {
    if (/Saving|blank|Could not|draft/i.test(message.text())) console.log(`[inbox-cycle console] ${message.text().slice(0, 200)}`)
  })
  page.on('response', async (response) => {
    if (!/\/api\/notifications\/getAll/.test(response.url())) return
    const body = await response.json().catch(() => null)
    const titles = (body?.notifications ?? []).map((row: { task?: { title?: string } }) => row.task?.title).filter((title: string | undefined) => title?.startsWith('Inbox cycle'))
    console.log(`[inbox-cycle getAll] ${response.status()} on ${new URL(page.url()).pathname}: ${JSON.stringify(titles)}`)
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) console.log(`[inbox-cycle url] ${new URL(frame.url()).pathname}${new URL(frame.url()).search}`)
  })
})

async function pressOutsideEditor(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press(key)
}

async function openInbox(page: Page, top: Item) {
  await page.goto(withRealtime('/inbox'), { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(top.title).first()).toBeVisible({ timeout: 30_000 })
}

test('inbox cycle: a full page load of an inbox ticket still knows its place in the inbox (cold click before hydration)', async ({ page }) => {
  await page.goto(withRealtime(`${items[0].detailPath}?inboxFlow=true`), { waitUntil: 'domcontentloaded' })
  await expectOpenInFlow(page, items[0], /^1 \/ 5$/)
})

test('inbox cycle: open by Enter, send a comment, archive and go to the next message', async ({ page }) => {
  await openInbox(page, items[0])
  await page.waitForTimeout(1500)
  await page.keyboard.press('Enter')
  await expectOpenInFlow(page, items[0], /^1 \/ 5$/)

  const keyboardReplyArchive = archiveSettles(page)
  await sendComment(page, 'Inbox cycle reply by keyboard')
  await expectOpenInFlow(page, items[1], /^2 \/ 5$/)
  expect(await keyboardReplyArchive, 'sending a comment after Enter archives the message').toBe('200 Archive')
})

test('inbox cycle: open by click, send a comment, J and E all stay in the inbox flow', async ({ page }) => {
  await openInbox(page, items[1])
  await expect(page.getByText(items[0].title), 'sending a comment after Enter archived the message').toHaveCount(0)
  await page.getByText(items[1].title).first().click()
  await expectOpenInFlow(page, items[1], /^1 \/ 4$/)

  const clickReplyArchive = archiveSettles(page)
  await sendComment(page, 'Inbox cycle reply')
  await expectOpenInFlow(page, items[2], /^\d+ \/ \d+$/)
  expect(await clickReplyArchive, 'sending a comment after a click archives the message').toBe('200 Archive')

  await pressOutsideEditor(page, 'j')
  await expectOpenInFlow(page, items[3], /^\d+ \/ \d+$/)

  const eArchive = archiveSettles(page)
  await pressOutsideEditor(page, 'e')
  await expectOpenInFlow(page, items[4], /^\d+ \/ \d+$/)
  expect(await eArchive, 'E archives the message').toBe('200 Archive')

  await openInbox(page, items[2])
  await expect(page.getByText(items[2].title).first(), 'J leaves the message in the inbox').toBeVisible()
  await expect(page.getByText(items[4].title).first(), 'the last opened message stays in the inbox').toBeVisible()
  await expect(page.getByText(items[1].title), 'sending a comment after a click archived the message').toHaveCount(0)
  await expect(page.getByText(items[3].title), 'E archived the message').toHaveCount(0)
})
