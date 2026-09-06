import { test, expect } from '@playwright/test'

// HTPR-6199 — one check per main view, desktop + mobile (via the two
// projects in playwright.config.smoke.ts = 16 checks total). Read-only: no
// view here submits a form or creates data, per the ticket's explicit ask.
//
// Board/task paths point at the dedicated smoke account's seeded fixtures
// (see e2e/smoke/README.md) so "board with cards" and "task detail" have
// something real to open, instead of an empty state.
// Each view also asserts its document title: exact for static routes, a
// pattern for routes whose title is built from live data (board/task titles
// come from generateMetadata, so a data-less or wrong-route render falls back
// to a generic title and fails here). Together with the content checks below,
// this proves the right route rendered server-side AND client-side.
const VIEWS: Array<{
  name: string
  path: string | undefined
  requiresFixture?: boolean
  title?: string
  titlePattern?: RegExp
  notTitle?: RegExp
}> = [
  { name: 'board list', path: '/all-tasks', title: 'All tasks' },
  // buildBoardRouteTitle: "<board> • Hypertask", bare "Hypertask" = no board data.
  { name: 'kanban board', path: process.env.SMOKE_BOARD_PATH, requiresFixture: true, titlePattern: /• Hypertask$/, notTitle: /^Hypertask$/ },
  // Task detail: "<ticket> <title> - Hypertask"; a missing task renders
  // "undefined undefined - Hypertask".
  { name: 'task detail', path: process.env.SMOKE_TASK_PATH, requiresFixture: true, titlePattern: / - Hypertask$/, notTitle: /undefined/ },
  { name: 'inbox', path: '/inbox', titlePattern: /^Inbox/ },
  { name: 'calendar', path: '/calendar', title: 'Calender' },
  { name: 'AI search', path: '/search', title: 'Search' },
  { name: 'settings', path: '/settings', title: 'Settings' },
  { name: 'new-task modal', path: '/new', title: 'New' },
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
    // ponytail: content + title checks; the ceiling is a correctly-titled but
    // internally broken view passing. Upgrade path: one view-specific DOM
    // selector per VIEWS entry.
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

    const title = await page.title()
    if (view.title) {
      expect(title, `${view.path} titled "${title}", expected "${view.title}"`).toBe(view.title)
    }
    if (view.titlePattern) {
      expect(title, `${view.path} titled "${title}", expected it to match ${view.titlePattern}`).toMatch(view.titlePattern)
    }
    if (view.notTitle) {
      expect(title, `${view.path} titled "${title}"`).not.toMatch(view.notTitle)
    }

    const bodyText = await page.locator('body').innerText()
    for (const marker of ERROR_MARKERS) {
      expect(bodyText, `${view.path} rendered an error page`).not.toMatch(marker)
    }

    expect(pageErrors, `${view.path} threw a page error: ${pageErrors[0]?.message}`).toHaveLength(0)
  })
}
