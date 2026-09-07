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
  // A route-specific DOM selector that only exists once the real view has
  // rendered (not just an app shell). Verified against the actual component
  // source, see e2e/smoke/README.md#selectors — a shell that stalls before
  // reaching this element fails here even with a correct title/status.
  selector: string
  // Assert presence (toBeAttached) instead of visibility for selectors that
  // are display:none by design (the inbox's hidden marker span).
  attachedOnly?: boolean
}> = [
  // <ul id="users-list"> — src/app/all-tasks/AllTasks.tsx
  { name: 'board list', path: '/all-tasks', title: 'All tasks', selector: '#users-list' },
  // buildBoardRouteTitle: "<board> • Hypertask", bare "Hypertask" = no board data.
  // .kanban-column-title — src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx
  { name: 'kanban board', path: process.env.SMOKE_BOARD_PATH, requiresFixture: true, titlePattern: /• Hypertask$/, notTitle: /^Hypertask$/, selector: '.kanban-column-title' },
  // Task detail: "<ticket> <title> - Hypertask"; a missing task renders
  // "undefined undefined - Hypertask".
  // <textarea id="title-input"> — src/components/PageComponents/TaskDetail/TopRow/TaskTitle.tsx
  { name: 'task detail', path: process.env.SMOKE_TASK_PATH, requiresFixture: true, titlePattern: / - Hypertask$/, notTitle: /undefined/, selector: '#title-input' },
  // Hidden (display:none, aria-hidden) span the inbox flips to "true" once
  // its notifications query resolves — present regardless of empty/non-empty
  // state or viewport, so assert presence, not visibility.
  // src/app/inbox/Inbox.tsx
  { name: 'inbox', path: '/inbox', titlePattern: /^Inbox/, selector: '[data-tutorial-inbox-loaded="true"]', attachedOnly: true },
  // Desktop calendar toggle button, or the mobile calendar's root class —
  // src/components/PageComponents/Calendar/{calendar,MobileCalendar}.tsx
  { name: 'calendar', path: '/calendar', title: 'Calender', selector: '[aria-label="Toggle boards and filters panel"], .mobile-calendar' },
  // <input id="search-input"> — src/app/search/SearchComp.tsx
  { name: 'AI search', path: '/search', title: 'Search', selector: '#search-input' },
  // The sidebar's own search box, present whether or not a section is
  // selected and on both viewports — src/components/Modals/Settings/SettingsShell.tsx
  { name: 'settings', path: '/settings', title: 'Settings', selector: 'input[placeholder="Search settings"]' },
  // <div id="createTaskModal"> — src/components/Modals/CreateTaskGloballyModal/index.tsx
  { name: 'new-task modal', path: '/new', title: 'New', selector: '#createTaskModal' },
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
    await expect
      .poll(
        async () => (await page.locator('body').innerText()).trim().length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(30)
    await expect(page.locator('text=/^loading/i')).toHaveCount(0, { timeout: 15_000 })

    // The route-specific element from VIEWS: a shell that renders 30+ chars
    // of chrome (nav, header) without the actual view still needs to fail
    // here (round-4 review). Each selector is a real, verified element from
    // the view's own component, not a generic wrapper.
    const target = page.locator(view.selector).first()
    if (view.attachedOnly) {
      await expect(target, `${view.path} missing "${view.selector}"`).toBeAttached({ timeout: 15_000 })
    } else {
      await expect(target, `${view.path} missing "${view.selector}"`).toBeVisible({ timeout: 15_000 })
    }

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
