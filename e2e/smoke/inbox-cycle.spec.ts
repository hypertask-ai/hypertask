import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { withRealtime } from './lib/realtime'

// YPER4-629 core release test: the inbox cycle (open, J, send a comment, E) must keep inboxFlow and move on.
// HTPR-7655: opening a row by mouse click lost ?inboxFlow=true, so sending a comment stayed on the ticket.
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

async function sendComment(page: Page, text: string) {
  const editor = page.locator('[data-comment-editor] .ProseMirror, .ProseMirror[contenteditable="true"]').last()
  await expect(editor).toBeVisible()
  await expect.poll(async () => {
    await editor.click()
    if (!(await editor.innerText()).includes(text)) await page.keyboard.insertText(text)
    return editor.innerText()
  }, { message: 'the comment text is in the current ticket comment box' }).toContain(text)
  await page.waitForTimeout(1000)
  await page.keyboard.press('Control+Enter')
}

test.beforeEach(async ({ page }) => {
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (/\/api\/(notifications|comments?|tasks\/comment)/i.test(pathname) && request.method() !== 'GET') console.log(`[inbox-cycle request] ${request.method()} ${pathname} on ${new URL(page.url()).pathname}`)
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

test('inbox cycle: open by Enter, send a comment, archive and go to the next message', async ({ page }) => {
  await openInbox(page, items[0])
  await page.waitForTimeout(1500)
  await page.keyboard.press('Enter')
  await expectOpenInFlow(page, items[0], /^1 \/ 5$/)

  await sendComment(page, 'Inbox cycle reply by keyboard')
  await expectOpenInFlow(page, items[1], /^2 \/ 5$/)
})

test('inbox cycle: open by click, J, send a comment, E all stay in the inbox flow', async ({ page }) => {
  await openInbox(page, items[1])
  await expect(page.getByText(items[0].title), 'sending a comment after Enter archived the message').toHaveCount(0)
  await page.getByText(items[1].title).first().click()
  await expectOpenInFlow(page, items[1], /^1 \/ 4$/)

  await pressOutsideEditor(page, 'j')
  await expectOpenInFlow(page, items[2], /^2 \/ 4$/)

  await sendComment(page, 'Inbox cycle reply')
  await expectOpenInFlow(page, items[3], /^\d+ \/ \d+$/)

  await pressOutsideEditor(page, 'e')
  await expectOpenInFlow(page, items[4], /^\d+ \/ \d+$/)

  await openInbox(page, items[1])
  await expect(page.getByText(items[4].title).first(), 'the last opened message stays in the inbox').toBeVisible()
  await expect(page.getByText(items[0].title), 'sending a comment after Enter archived the message').toHaveCount(0)
  await expect(page.getByText(items[2].title), 'sending a comment after a click archived the message').toHaveCount(0)
  await expect(page.getByText(items[3].title), 'E archived the message').toHaveCount(0)
})
