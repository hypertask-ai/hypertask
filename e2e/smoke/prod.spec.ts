import { test, expect } from '@playwright/test'

// HTPR-6199 — one check per main view, desktop + mobile (via the two
// projects in playwright.config.smoke.ts = 16 checks total). Read-only: no
// view here submits a form or creates data, per the ticket's explicit ask.
//
// Board/task paths point at the dedicated smoke account's seeded fixtures
// (see e2e/smoke/README.md) so "board with cards" and "task detail" have
// something real to open, instead of an empty state.
const VIEWS: Array<{ name: string; path: string | undefined; requiresFixture?: boolean }> = [
  { name: 'board list', path: '/all-tasks' },
  { name: 'kanban board', path: process.env.SMOKE_BOARD_PATH, requiresFixture: true },
  { name: 'task detail', path: process.env.SMOKE_TASK_PATH, requiresFixture: true },
  { name: 'inbox', path: '/inbox' },
  { name: 'calendar', path: '/calendar' },
  { name: 'AI search', path: '/search' },
  { name: 'settings', path: '/settings' },
  { name: 'new-task modal', path: '/new' },
]

const ERROR_MARKERS = [/something went wrong/i, /application error/i, /internal server error/i]

// A Vercel bot challenge on the runner's IP is not a broken view — the health
// job in prod-health.yml treats the same signal as unrunnable, never a
// failure. Mirrored here so a challenge can't read as 16 real failures.
function isBotChallenge(response: import('@playwright/test').Response | null): boolean {
  return response?.headers()['x-vercel-mitigated'] === 'challenge'
}

for (const view of VIEWS) {
  test(`${view.name} loads`, async ({ page }) => {
    test.skip(view.requiresFixture === true && !view.path, `no seeded fixture (${view.name} not opened)`)

    const pageErrors: Error[] = []
    page.on('pageerror', (err) => pageErrors.push(err))

    const response = await page.goto(view.path!, { waitUntil: 'load' })

    test.skip(isBotChallenge(response), `Vercel bot-challenged the runner IP on ${view.path}`)

    expect(response, `no response for ${view.path}`).toBeTruthy()
    expect(response!.status(), `${view.path} returned ${response!.status()}`).toBeLessThan(400)

    // A 2xx response alone doesn't prove the view rendered — a blank or
    // loading-only shell must fail too (PR #366 review). Wait until the body
    // carries real content and the "Loading..." Suspense fallback is gone.
    // ponytail: generic content check; the ceiling is a broken-but-nonempty
    // shell passing. Upgrade path: one view-specific selector per VIEWS entry.
    await expect
      .poll(
        async () => (await page.locator('body').innerText()).trim().length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(30)
    await expect(page.locator('text=/^loading/i')).toHaveCount(0, { timeout: 15_000 })

    // An auth redirect on one view means the session broke mid-run or the
    // route is misbehaving; either way this is not a passing check.
    expect(page.url(), `${view.path} redirected to ${page.url()}`).not.toContain('/login')

    const bodyText = await page.locator('body').innerText()
    for (const marker of ERROR_MARKERS) {
      expect(bodyText, `${view.path} rendered an error page`).not.toMatch(marker)
    }

    expect(pageErrors, `${view.path} threw a page error: ${pageErrors[0]?.message}`).toHaveLength(0)
  })
}
