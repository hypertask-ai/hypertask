import { test, expect } from '@playwright/test'

// HTPR-6199 — one check per main view, desktop + mobile (via the two
// projects in playwright.config.smoke.ts = 16 checks total). Read-only: no
// view here submits a form or creates data, per the ticket's explicit ask.
//
// Board/task paths point at the dedicated smoke account's seeded fixtures
// (see tests/smoke/README.md) so "board with cards" and "task detail" have
// something real to open, instead of an empty state.
const VIEWS: Array<{ name: string; path: string }> = [
  { name: 'board list', path: '/all-tasks' },
  { name: 'kanban board', path: process.env.SMOKE_BOARD_PATH || '/all-tasks' },
  { name: 'task detail', path: process.env.SMOKE_TASK_PATH || '/all-tasks' },
  { name: 'inbox', path: '/inbox' },
  { name: 'calendar', path: '/calendar' },
  { name: 'AI search', path: '/search' },
  { name: 'settings', path: '/settings' },
  { name: 'new-task modal', path: '/new' },
]

const ERROR_MARKERS = [/something went wrong/i, /application error/i, /internal server error/i]

for (const view of VIEWS) {
  test(`${view.name} loads`, async ({ page }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (err) => pageErrors.push(err))

    const response = await page.goto(view.path, { waitUntil: 'domcontentloaded' })

    expect(response, `no response for ${view.path}`).toBeTruthy()
    expect(response!.status(), `${view.path} returned ${response!.status()}`).toBeLessThan(400)

    const bodyText = await page.locator('body').innerText()
    for (const marker of ERROR_MARKERS) {
      expect(bodyText, `${view.path} rendered an error page`).not.toMatch(marker)
    }

    expect(pageErrors, `${view.path} threw a page error: ${pageErrors[0]?.message}`).toHaveLength(0)
  })
}
