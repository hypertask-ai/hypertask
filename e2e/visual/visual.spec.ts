import { test, expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const fixture = JSON.parse(readFileSync(path.join(path.dirname(process.env.BROWSER_SMOKE_STATE_FILE!), 'card-fixture.json'), 'utf8')) as {
  taskId: number
  title: string
  description: string
  detailPath: string
  boardPath: string
  visualNow: string
  flags: Record<string, boolean>
}
const screens = ['board', 'task-detail', 'comment-box', 'ctrl-j', 'inbox'] as const

async function navigate(page: Page, route: string) {
  const url = new URL(route, 'http://127.0.0.1:3100')
  url.searchParams.set('realtime', 'off')
  const flagsResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/flags' && response.ok())
  await page.goto(url.toString(), { waitUntil: 'load' })
  const { flags } = await (await flagsResponse).json() as { flags: Record<string, boolean> }
  for (const [key, enabled] of Object.entries(fixture.flags)) expect(flags[key] === true, `visual flag ${key}`).toBe(enabled)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'porcelain')
}

async function board(page: Page) {
  await navigate(page, fixture.boardPath)
  await expect(page.locator('.kanban-column-title')).toHaveCount(2)
  await expect(page.locator('[data-title="To do"] .kanban-column-title')).toHaveText('To do')
  await expect(page.locator('[data-title="Done"] .kanban-column-title')).toHaveText('Done')
  const card = page.locator(`#task-${fixture.taskId} a[href="${fixture.detailPath}"]`)
  await expect(card).toBeVisible()
  await expect(page.locator(`#task-${fixture.taskId}`)).toContainText(fixture.title)
  return card
}

async function taskDetail(page: Page) {
  const card = await board(page)
  await card.click()
  await expect(page).toHaveURL(url => url.pathname === fixture.detailPath)
  await expect(page.locator('#title-input')).toHaveValue(fixture.title)
  await expect(page.getByTestId('ticket-description')).toContainText(fixture.description)
  const thread = page.getByTestId('ticket-thread')
  await expect(thread, 'one seeded ticket thread').toHaveCount(1)
  const comments = thread.getByTestId('ticket-comment')
  await expect(comments, 'both seeded comments must be mounted').toHaveCount(2)
  await expect(comments.first()).toContainText('First layout lock comment')
  await expect(comments.last()).toContainText('Last layout lock comment')
  await expect(page.getByTestId('comment-composer'), 'one desktop or phone composer').toHaveCount(1)
  await expect(page.getByTestId('comment-composer'), 'seeded ticket composer must be visible').toBeVisible()
  await expect(page.getByRole('dialog'), 'no popup may cover the ticket').toHaveCount(0)
}

async function settled(page: Page, landmarks: Locator[]) {
  await page.mouse.move(1, 1)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'porcelain')
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(Array.from(document.images).filter(image => image.currentSrc).map(image => image.decode()))
  })
  let previous = ''
  let equalSamples = 0
  await expect.poll(async () => {
    const boxes = []
    for (const landmark of landmarks) {
      if (await landmark.count() !== 1 || !await landmark.isVisible()) return false
      const box = await landmark.boundingBox()
      if (!box || box.width <= 0 || box.height <= 0) return false
      boxes.push(box)
    }
    const next = JSON.stringify(boxes)
    equalSamples = next === previous ? equalSamples + 1 : 1
    previous = next
    return equalSamples >= 3
  }, { intervals: [150], timeout: 10_000, message: 'three equal landmark geometry samples' }).toBe(true)
}

test.beforeEach(async ({ page, context }) => {
  expect(fixture.visualNow).toBe('2026-10-01T12:00:00Z')
  await page.clock.setFixedTime(new Date(fixture.visualNow))
  await page.addInitScript(() => {
    let seed = 0x7a5e1550
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    window.localStorage.setItem('ht_inbox_notif_nudge_dismissed', 'true')
  })
  await context.addCookies([{ name: 'theme', value: 'porcelain', domain: '127.0.0.1', path: '/', sameSite: 'Lax' }])
})

for (const screen of screens) {
  test(screen, async ({ page }, testInfo) => {
    let landmarks: Locator[]
    const lastComment = page.getByTestId('ticket-thread').getByTestId('ticket-comment').filter({ hasText: 'Last layout lock comment' })
    const composer = page.getByTestId('comment-composer')
    if (screen === 'board') {
      await board(page)
      landmarks = [page.locator('[data-title="To do"] .kanban-column-title'), page.locator('[data-title="Done"] .kanban-column-title'), page.locator(`#task-${fixture.taskId}`)]
    } else if (screen === 'task-detail' || screen === 'comment-box') {
      await test.step('open seeded ticket with its comments', async () => {
        await taskDetail(page)
        await expect(lastComment, 'exactly one last seeded comment in the ticket thread').toHaveCount(1)
        await expect(lastComment, 'last seeded comment must be visible').toBeVisible()
      }, { timeout: 15_000 })
      if (screen === 'comment-box') {
        await test.step('scroll last seeded comment and composer into view', async () => {
          await lastComment.evaluate(comment => comment.scrollIntoView({ behavior: 'instant', block: 'center' }), undefined, { timeout: 15_000 })
          if (testInfo.project.name === 'desktop') {
            await composer.evaluate(element => element.scrollIntoView({ behavior: 'instant', block: 'nearest' }), undefined, { timeout: 15_000 })
          }
          await expect(lastComment, 'last seeded comment must remain in viewport after scrolling').toBeInViewport({ timeout: 15_000 })
          await expect(composer, 'comment composer must be in viewport after scrolling').toBeInViewport({ timeout: 15_000 })
        }, { timeout: 15_000 })
      }
      landmarks = [page.locator('#title-input'), lastComment, composer]
    } else if (screen === 'ctrl-j') {
      await board(page)
      const writer = page.locator('[data-compose-task-writer]:visible')
      await expect(async () => {
        if (await writer.count() === 0) {
          await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
          await page.keyboard.press('Control+j')
        }
        await expect(writer, 'Ctrl+J must open the task writer once flags and shortcuts are ready').toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      await expect(page.getByRole('textbox', { name: 'Describe the task' })).toBeVisible()
      landmarks = [writer, page.getByRole('textbox', { name: 'Describe the task' })]
    } else {
      await navigate(page, '/inbox')
      await expect(page.locator('[data-tutorial-inbox-loaded="true"]')).toBeAttached()
      landmarks = [page.getByTestId('inbox-panel'), page.locator('[data-testid="inbox-list"]:visible')]
    }
    await test.step('assets loaded and landmark geometry settled', async () => {
      await settled(page, landmarks)
    }, { timeout: 15_000 })
    await expect(page).toHaveScreenshot(`${screen}.png`)
    if (testInfo.project.name === 'desktop' && (screen === 'task-detail' || screen === 'comment-box')) {
      await test.step('desktop composer follows the last seeded comment', async () => {
        const lastCommentBox = await lastComment.boundingBox({ timeout: 15_000 })
        const composerBox = await composer.boundingBox({ timeout: 15_000 })
        expect(lastCommentBox, 'last seeded comment must have a bounding box').not.toBeNull()
        expect(composerBox, 'desktop composer must have a bounding box').not.toBeNull()
        expect(composerBox!.y, 'desktop composer must follow the last comment').toBeGreaterThanOrEqual(lastCommentBox!.y + lastCommentBox!.height)
      }, { timeout: 15_000 })
    }
  })
}
