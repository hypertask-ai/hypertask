import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { withRealtime } from './lib/realtime'

const fixturePath = path.join(path.dirname(process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'), 'card-fixture.json')

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!process.env.BROWSER_SMOKE_PR && process.env.PREMERGE_LOCAL !== '1', 'isolated browser smoke fixtures only')
  await page.setViewportSize(testInfo.project.name === 'Mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 })
})

test('layout lock: comment composer is the end of the ticket thread', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { taskId: number; detailPath: string; flags: Record<string, boolean> }
  for (const entry of ['direct', 'board card']) {
    await test.step(entry, async () => {
      const flagsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/flags' && response.ok())
      await page.goto(withRealtime(entry === 'direct' ? fixture.detailPath : process.env.SMOKE_BOARD_PATH!), { waitUntil: 'load' })
      const { flags } = await (await flagsResponse).json() as { flags: Record<string, boolean> }
      for (const [key, enabled] of Object.entries(fixture.flags)) {
        expect(flags[key] === true, `layout lock flag ${key}`).toBe(enabled)
      }
      if (entry === 'board card') {
        await page.locator(`#task-${fixture.taskId} a[href="${fixture.detailPath}"]`).click()
        await expect(page).toHaveURL((url) => url.pathname === fixture.detailPath)
      }
      const composer = page.getByTestId('comment-composer')
      const comments = page.getByTestId('ticket-comment')
      await expect(composer).toBeVisible()
      // Bring the last virtualized rows into view, without moving a fixed phone composer.
      await composer.scrollIntoViewIfNeeded()
      await expect(comments).toHaveCount(2)
      await expect(comments.last()).toContainText('Last layout lock comment')
      if (page.viewportSize()?.width === 390) {
        await page.getByTestId('ticket-thread').evaluate((thread) => {
          for (let parent = thread.parentElement; parent; parent = parent.parentElement) {
            if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = parent.scrollHeight
          }
          document.scrollingElement?.scrollTo(0, document.scrollingElement.scrollHeight)
        })
      }
      await expect.poll(async () => {
        const last = await comments.last().boundingBox()
        const box = await composer.boundingBox()
        return last && box ? box.y - (last.y + last.height) : -1
      }, { message: 'layout lock: composer top must be below the last comment bottom' }).toBeGreaterThanOrEqual(0)
      const trailingContent = await page.getByTestId('ticket-thread').evaluate((thread) => {
        const composer = document.querySelector('[data-testid="comment-composer"]')!
        const comments = thread.querySelectorAll('[data-testid="ticket-comment"]')
        const bottom = comments[comments.length - 1].getBoundingClientRect().bottom
        const walker = document.createTreeWalker(thread, NodeFilter.SHOW_TEXT)
        const unexpected: string[] = []
        while (walker.nextNode()) {
          const node = walker.currentNode
          if (!node.textContent?.trim() || composer.contains(node) || node.parentElement?.closest('[aria-hidden="true"]')) continue
          const range = document.createRange()
          range.selectNodeContents(node)
          if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 && rect.top >= bottom)) {
            unexpected.push(node.textContent.trim())
          }
        }
        for (const control of thread.querySelectorAll('button, input, textarea, img, video, canvas, iframe, [role="button"], [contenteditable="true"]')) {
          const rect = control.getBoundingClientRect()
          if (!composer.contains(control) && rect.width > 0 && rect.height > 0 && rect.top >= bottom) unexpected.push(control.outerHTML)
        }
        return unexpected
      })
      expect(trailingContent, 'layout lock: only the composer area may follow the last comment').toEqual([])
    })
  }
})

test('layout lock: desktop New Task window stays narrow and inside the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Desktop', 'desktop window invariant')
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { flags: Record<string, boolean> }
  test.skip(!fixture.flags['htpr-6929-compose-task-writer'], 'New Task window is unavailable in this live-like flag mode')
  const flagsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/flags' && response.ok())
  await page.goto(withRealtime(process.env.SMOKE_BOARD_PATH!), { waitUntil: 'load' })
  const { flags } = await (await flagsResponse).json() as { flags: Record<string, boolean> }
  for (const [key, enabled] of Object.entries(fixture.flags)) {
    expect(flags[key] === true, `layout lock flag ${key}`).toBe(enabled)
  }
  await expect(page.locator('.kanban-column-title').first()).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.keyboard.press('Control+j')
  await expect(page.getByRole('textbox', { name: 'Describe the task' })).toBeVisible()
  const window = page.locator('.modal-dialog').filter({ has: page.locator('[data-compose-task-writer]:visible') })
  await expect(window).toBeVisible()
  const box = await window.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width, 'layout lock: New Task window must be no wider than 640px').toBeLessThanOrEqual(640)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440)
  expect(box!.y + box!.height).toBeLessThanOrEqual(900)
})
