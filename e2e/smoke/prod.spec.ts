import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { withRealtime } from './lib/realtime'
import { tieredId } from './lib/tier'

const PREFLIGHT_FILE = path.join(__dirname, '.state', 'preflight.json')
const APPLICATION_FAILURE_FILE = path.join(__dirname, '.state', 'application-failure.json')
const LOGIN_PATH = '/login'

const RUNNER_ERROR_MARKERS = [
  /net::ERR_/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/i,
  /browser (?:has been closed|disconnected)/i,
  /target page, context or browser has been closed/i,
  /Vercel bot-challenged/i,
  /smoke session (?:got HTTP|redirected)/i,
]

function markUnrunnable(reason: string) {
  writeFileSync(PREFLIGHT_FILE, JSON.stringify({ ok: false, reason }))
}

function preflightAllowsRollback(): boolean {
  try {
    return JSON.parse(readFileSync(PREFLIGHT_FILE, 'utf8')).ok === true
  } catch {
    return false
  }
}

function abortUnrunnable(reason: string): never {
  markUnrunnable(reason)
  const error = new Error(reason)
  error.name = 'UnrunnableSmokeError'
  throw error
}

function isUnrunnableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'UnrunnableSmokeError')) ||
    RUNNER_ERROR_MARKERS.some((marker) => marker.test(message))
}

test.afterEach(({ page }, testInfo) => {
  if (page.url().includes(LOGIN_PATH)) {
    markUnrunnable(`not tested: QA login missing/expired (redirected to ${LOGIN_PATH} during the view checks)`)
  } else if (testInfo.status === 'timedOut' || (testInfo.error && isUnrunnableError(testInfo.error))) {
    markUnrunnable(`browser runner failed during ${testInfo.title}`)
  } else if (testInfo.status === 'failed' && testInfo.retry === testInfo.project.retries && preflightAllowsRollback()) {
    // Only a final failed retry writes this marker. A first-attempt flake that
    // passes its retry cannot authorize rollback.
    writeFileSync(APPLICATION_FAILURE_FILE, JSON.stringify({ view: testInfo.title }))
  }
})

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
  // are hidden by design or can be zero-height in a valid empty state.
  attachedOnly?: boolean
}> = [
  // <ul id="users-list"> — src/app/all-tasks/AllTasks.tsx. A fresh user has no
  // matching tasks, so the rendered list is intentionally empty and zero-height.
  { name: 'board list', path: '/all-tasks', title: 'All tasks', selector: '#users-list', attachedOnly: Boolean(process.env.BROWSER_SMOKE_PR) },
  // buildBoardRouteTitle: "<board> • Hypertask", bare "Hypertask" = no board data.
  // .kanban-column-title — src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx
  { name: 'kanban board', path: process.env.SMOKE_BOARD_PATH, requiresFixture: true, titlePattern: /• Hypertask$/, notTitle: /^Hypertask$/, selector: '.kanban-column-title' },
  // /demo itself provisions a guest (a write); use a pre-seeded demo board in PR CI.
  ...(process.env.BROWSER_SMOKE_PR ? [{ name: 'demo board', path: process.env.SMOKE_DEMO_BOARD_PATH, titlePattern: /• Hypertask$/, notTitle: /^Hypertask$/, selector: '.kanban-column-title' }] : []),
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
  // Target the fixture board instead of a stale previousBoard login cookie.
  // <div id="createTaskModal"> — src/components/Modals/CreateTaskGloballyModal/index.tsx
  { name: 'new-task modal', path: process.env.SMOKE_POSTDEPLOY === '1' ? `/new?board=${process.env.SMOKE_TASK_PATH?.match(/^\/detail\/project-(\d+)\//)?.[1]}` : '/new', title: 'New', selector: '#createTaskModal' },
]

test('My Tasks Tab keeps the chosen split without server navigation', async ({ page }, testInfo) => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'isolated PR fixtures only')
  await page.setViewportSize(testInfo.project.name === 'Mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 })
  const boards = [process.env.SMOKE_BOARD_PATH!, process.env.SMOKE_DEMO_BOARD_PATH!].map((boardPath, index) => ({
    id: Number(new URL(boardPath, 'http://localhost').searchParams.get('id')),
    title: index === 0 ? 'Browser smoke board' : 'Browser smoke demo board',
    sections: [], labels: [], members: [],
  }))
  // Exercise unreleased flags without changing the seed's production-mode snapshot.
  await page.route('**/api/flags', (route) => route.fulfill({ json: { flags: {
    'htpr-6421-my-tasks-shortcuts-width': true,
    'htpr-6455-my-tasks-time-group': true,
    'htpr-6458-my-tasks-live-updates': true,
  } } }))
  await page.route('**/api/my-tasks?*', (route) => route.fulfill({ json: {
    sections: [], tabs: ['All'], boards, accessibleProjectIds: boards.map((board) => board.id),
  } }))
  const listResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/my-tasks')
  await page.goto('/my-tasks?view=all', { waitUntil: 'load' })
  await listResponse
  const splits = page.locator('.footer_tags_main:visible')
  const selected = splits.locator('.font-semibold > span.footer_tags')
  await expect(splits).toHaveCount(3)
  await expect(selected).toHaveText('All')
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())

  let serverNavigations = 0
  let releaseNavigation!: () => void
  const navigationHeld = new Promise<void>((resolve) => { releaseNavigation = resolve })
  // A slow RSC response exposes a stale split immediately, rather than relying on network timing.
  await page.route('**/my-tasks?*', async (route) => {
    if (route.request().headers().rsc !== '1') return route.continue()
    serverNavigations++
    await navigationHeld
    await route.continue().catch(() => {})
  })
  const assertSplit = async (index: number) => {
    const title = index === 0 ? 'All' : boards[index - 1].title
    await expect(selected, 'Tab must keep the chosen split').toHaveText(title)
    await expect(page.locator('body'), 'Tab must not move focus into an unrelated control').toBeFocused()
    await expect(page).toHaveURL((url) => url.searchParams.get('board') === (index === 0 ? null : String(boards[index - 1].id)))
    // Keep observing after React effects and any delayed navigation have had time to run.
    expect(await page.evaluate(async () => {
      const samples: string[] = []
      const until = performance.now() + 250
      while (performance.now() < until) {
        samples.push(document.querySelector('.footer_tags_main .font-semibold > span.footer_tags')?.textContent ?? '')
        await new Promise(requestAnimationFrame)
      }
      return [...new Set(samples)]
    })).toEqual([title])
  }
  try {
    for (const index of [1, 2, 0, 1, 2]) {
      await page.keyboard.press('Tab')
      await assertSplit(index)
    }
    await page.keyboard.press('Shift+Tab')
    await assertSplit(1)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await assertSplit(1)
    releaseNavigation()
    await assertSplit(1)
    expect(serverNavigations, 'split selection must not request a server redraw').toBe(0)
  } finally {
    releaseNavigation()
  }
})

test('seeded board card opens a ticket and stays open', { tag: ['@id:board-card-click'] }, async ({ page }, testInfo) => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'isolated PR fixtures only')
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '.state', 'card-fixture.json'), 'utf8')) as {
    taskId: number; title: string; description: string; detailPath: string; flags: Record<string, boolean>
  }
  await page.setViewportSize(testInfo.project.name === 'Mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 })
  // Optional pages must never gate the title or description, even if their request never settles.
  await page.route('**/api/pages/list?*', () => {})
  // Wait for the app's own flag read, not a separate API request that could race hydration.
  const flagsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/flags' && response.ok())
  await page.goto(withRealtime(process.env.SMOKE_BOARD_PATH!), { waitUntil: 'load' })
  const { flags } = await (await flagsResponse).json() as { flags: Record<string, boolean> }
  for (const [key, enabled] of Object.entries(fixture.flags)) {
    expect(flags[key] === true, `seeded flag ${key} must match the production mode`).toBe(enabled)
  }
  const card = page.locator(`#task-${fixture.taskId} a[href="${fixture.detailPath}"]`)
  await expect(card).toContainText(fixture.title)
  await expect(card).toBeVisible()
  // A full navigation could conceal a failed instant-open attempt. Observe from before the click.
  let documentRequests = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++
  })
  await card.click()
  await expect(page).toHaveURL((url) => url.pathname === fixture.detailPath, { timeout: 10_000 })
  const title = page.locator('#title-input')
  const description = page.getByText(fixture.description, { exact: true })
  await expect(title, 'card click must reveal the ticket title').toBeVisible({ timeout: 10_000 })
  await expect(title).toHaveValue(fixture.title)
  await expect(description, 'card click must reveal the ticket description').toBeVisible()
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    expect(new URL(page.url()).pathname, 'ticket must stay on its detail route').toBe(fixture.detailPath)
    expect(await title.isVisible(), 'ticket title disappeared after opening').toBe(true)
    expect(await title.inputValue()).toBe(fixture.title)
    expect(await description.isVisible(), 'ticket description disappeared after opening').toBe(true)
    expect(documentRequests, 'card click must not reload the document').toBe(0)
    await page.waitForTimeout(Math.min(100, Math.max(0, deadline - Date.now())))
  }
  expect(new URL(page.url()).pathname).toBe(fixture.detailPath)
  expect(await title.isVisible()).toBe(true)
  expect(await title.inputValue()).toBe(fixture.title)
  expect(await description.isVisible()).toBe(true)
  expect(documentRequests, 'card click must not reload the document').toBe(0)
})

const ERROR_MARKERS = [/something went wrong/i, /application error/i, /internal server error/i]

// A Vercel bot challenge on the runner's IP is not a broken view — the health
// job in prod-health.yml treats the same signal as unrunnable, never a
// failure. Mirrored here so a challenge can't read as 16 real failures.
function isBotChallenge(response: import('@playwright/test').Response | null): boolean {
  return response?.headers()['x-vercel-mitigated'] === 'challenge'
}

for (const view of VIEWS) {
  // HTPR-6636 phase 2: hypertask-qa-runner now runs this suite once per
  // tier account, so the same view check needs a tier-scoped dedup id (or
  // two tiers failing the same view would share one ticket) , see
  // lib/process-report.mjs in the runner repo, which reads this tag.
  const idTag = `@id:${tieredId(`view-${view.name.replace(/\s+/g, '-')}`)}`
  test(`${view.name} loads`, { tag: [idTag] }, async ({ page }, testInfo) => {
    test.skip(view.requiresFixture === true && !view.path, `no seeded fixture (${view.name} not opened)`)

    const pageErrors: Error[] = []
    const realtimeSubscriptions = new Set<string>()
    page.on('pageerror', (err) => pageErrors.push(err))
    if (process.env.BROWSER_SMOKE_PR) {
      page.on('websocket', (socket) => {
        if (new URL(socket.url()).host !== '127.0.0.1:6001') return
        socket.on('framereceived', ({ payload }) => {
          try {
            const frame = JSON.parse(String(payload)) as { event?: string; channel?: string }
            if (frame.event === 'pusher_internal:subscription_succeeded' && frame.channel) {
              realtimeSubscriptions.add(frame.channel)
            }
          } catch {
            // Ignore non-JSON protocol frames; Pusher subscription frames are JSON.
          }
        })
      })
    }
    let loads = 0
    const boardFetches = new Map<string, number>()
    let lastBoardFetchAt = 0
    if (process.env.BROWSER_SMOKE_PR) {
      page.on('load', () => { loads++ })
      page.on('request', (request) => {
        if (loads === 0) return
        const pathname = new URL(request.url()).pathname
        if (pathname === '/api/projects/getAll' || pathname === '/api/projects/boardTasks') {
          boardFetches.set(pathname, (boardFetches.get(pathname) ?? 0) + 1)
          lastBoardFetchAt = Date.now()
        }
      })
    }

    let response
    try {
      response = await page.goto(withRealtime(view.path!), { waitUntil: 'load' })
    } catch (err) {
      if (isUnrunnableError(err)) {
        markUnrunnable(`navigation infrastructure failed on ${view.path}`)
      }
      throw err
    }

    const loadedAt = Date.now()
    if (isBotChallenge(response)) {
      abortUnrunnable(`Vercel bot-challenged the runner IP on ${view.path}`)
    }

    if (response && (response.status() === 401 || response.status() === 403)) {
      abortUnrunnable(`not tested: QA login missing/expired (HTTP ${response.status()} on ${view.path})`)
    }
    if (page.url().includes(LOGIN_PATH)) {
      abortUnrunnable(`not tested: QA login missing/expired (redirected to ${LOGIN_PATH} on ${view.path})`)
    }

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

    if (process.env.BROWSER_SMOKE_PR && (view.name === 'kanban board' || view.name === 'demo board')) {
      const projectId = new URL(view.path!, 'http://127.0.0.1').searchParams.get('id')
      expect(projectId, `${view.name} has no project id`).toBeTruthy()
      await expect
        .poll(
          () => realtimeSubscriptions.has(`private-project-${projectId}`),
          { message: `${view.name} did not subscribe to local realtime`, timeout: 15_000 },
        )
        .toBe(true)
    }

    // An auth redirect on one view means the session broke mid-run or the
    // route is misbehaving; either way this is not a passing check.
    expect(page.url(), `${view.path} redirected to ${page.url()}`).not.toContain(LOGIN_PATH)

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

    if (process.env.BROWSER_SMOKE_PR) {
      if (view.name === 'kanban board' || view.name === 'demo board') {
        const columns = page.locator('.kanban-column-title')
        // The initial route data and the first confirmed realtime subscription
        // can each trigger one legitimate catch-up fetch. Start loop detection
        // only after that bootstrap traffic has been quiet for a full second.
        await expect
          .poll(
            () => lastBoardFetchAt === 0 ? 1_000 : Date.now() - lastBoardFetchAt,
            { message: `${view.name} bootstrap requests did not settle`, timeout: 15_000 },
          )
          .toBeGreaterThanOrEqual(1_000)
        const initialColumnCount = await columns.count()
        expect(initialColumnCount, `${view.name} has no columns`).toBeGreaterThan(0)
        boardFetches.clear()
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          expect(await columns.count(), `${view.name} lost board columns`).toBeGreaterThanOrEqual(initialColumnCount)
          expect(await columns.first().isVisible(), `${view.name} hid board columns`).toBe(true)
          await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())))
        }
        for (const [pathname, requests] of boardFetches) {
          expect(requests, `${view.name} requested ${pathname} ${requests} times after load`).toBeLessThanOrEqual(1)
        }
      } else {
        await page.waitForTimeout(Math.max(0, 30_000 - (Date.now() - loadedAt)))
      }
      expect(loads, `${view.name} loaded ${loads} times`).toBeLessThanOrEqual(1)
    }
    if (process.env.SMOKE_POSTDEPLOY === '1' && view.name === 'kanban board') {
      const taskPath = process.env.SMOKE_TASK_PATH!
      const link = page.locator(`[id^="task-"] a[href="${taskPath}"]`).first()
      await expect(link, 'configured QA ticket card is missing from the real board').toBeVisible()
      const cardTitle = (await link.locator('p.whitespace-pre-line').innerText()).trim()
      expect(cardTitle, 'QA card has no title').not.toBe('')
      let reloads = 0
      page.on('load', () => { reloads++ })
      await link.click()
      const titleInput = page.locator('#title-input')
      await expect(titleInput).toBeVisible({ timeout: 15_000 })
      await expect(titleInput).toHaveValue(cardTitle)
      await expect(page.locator('#description-input')).toBeAttached({ timeout: 15_000 })
      // The missed regression briefly opened the ticket, then dismissed it.
      // Observe continuously, not just once after a delay, and never reload.
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        expect(new URL(page.url()).pathname, 'card opened the wrong ticket or returned to the board').toBe(taskPath)
        expect(await titleInput.isVisible(), 'clicked ticket disappeared').toBe(true)
        expect(await titleInput.inputValue(), 'clicked ticket changed').toBe(cardTitle)
        expect(await page.locator('#description-input').count(), 'ticket body disappeared').toBeGreaterThan(0)
        expect(reloads, 'card navigation reloaded the page').toBe(0)
        await page.waitForTimeout(250)
      }
      console.log(`${testInfo.project.name}: QA board card opened ${taskPath} and stayed open for 10 seconds without reload`)
    }
    expect(pageErrors, `${view.path} threw a page error: ${pageErrors[0]?.message}`).toHaveLength(0)
  })
}
