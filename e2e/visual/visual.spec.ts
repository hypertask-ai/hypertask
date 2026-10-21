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
  const comments = page.getByTestId('ticket-comment')
  await expect(comments).toHaveCount(2)
  await expect(comments.first()).toContainText('First layout lock comment')
  await expect(comments.last()).toContainText('Last layout lock comment')
  await expect(page.getByTestId('comment-composer')).toHaveCount(1)
  await expect(page.getByTestId('comment-composer')).toBeVisible()
  if (page.viewportSize()!.width === 1440) {
    for (const comment of await comments.all()) {
      if (await comment.locator('.comment-body').count() === 0) await comment.click()
    }
    await expect(page.locator('[data-testid="ticket-comment"] .comment-body')).toHaveCount(2)
  }
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
  await context.addCookies([{ name: 'theme', value: 'porcelain', domain: '127.0.0.1', path: '/', sameSite: 'Lax' }])
})

for (const screen of screens) {
  test(screen, async ({ page }, testInfo) => {
    let landmarks: Locator[]
    if (screen === 'board') {
      await board(page)
      landmarks = [page.locator('[data-title="To do"] .kanban-column-title'), page.locator('[data-title="Done"] .kanban-column-title'), page.locator(`#task-${fixture.taskId}`)]
    } else if (screen === 'task-detail' || screen === 'comment-box') {
      await taskDetail(page)
      const composer = page.getByTestId('comment-composer')
      if (screen === 'comment-box') {
        await composer.scrollIntoViewIfNeeded()
        await page.getByTestId('ticket-thread').evaluate(thread => {
          for (let parent = thread.parentElement; parent; parent = parent.parentElement) {
            if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = parent.scrollHeight
          }
          document.scrollingElement?.scrollTo(0, document.scrollingElement.scrollHeight)
        })
        await composer.scrollIntoViewIfNeeded()
        await expect(page.getByTestId('ticket-comment').last()).toBeInViewport()
        await expect(composer).toBeInViewport()
      }
      landmarks = [page.locator('#title-input'), page.getByTestId('ticket-comment').last(), composer]
    } else if (screen === 'ctrl-j') {
      await board(page)
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
      await page.keyboard.press('Control+j')
      const writer = page.locator('[data-compose-task-writer]:visible')
      await expect(writer).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Describe the task' })).toBeVisible()
      landmarks = [writer, page.getByRole('textbox', { name: 'Describe the task' })]
    } else {
      await navigate(page, '/inbox')
      await expect(page.locator('[data-tutorial-inbox-loaded="true"]')).toBeAttached()
      landmarks = [page.getByTestId('inbox-panel'), page.locator('[data-testid="inbox-list"]:visible')]
    }
    await settled(page, landmarks)
    await expect(page).toHaveScreenshot(`${screen}.png`)
    if (testInfo.project.name === 'desktop' && (screen === 'task-detail' || screen === 'comment-box')) {
      const lastComment = await page.getByTestId('ticket-comment').last().boundingBox()
      const composer = await page.getByTestId('comment-composer').boundingBox()
      expect(lastComment).not.toBeNull()
      expect(composer).not.toBeNull()
      expect(composer!.y, 'desktop composer must follow the last comment').toBeGreaterThanOrEqual(lastComment!.y + lastComment!.height)
    }
  })
}
