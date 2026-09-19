import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PREFLIGHT_FILE = path.join(__dirname, '.state', 'preflight.json')
const APPLICATION_FAILURE_FILE = path.join(__dirname, '.state', 'application-failure.json')
const FIXTURE_FILE = path.join(__dirname, '.state', 'fixture.json')
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

function fixturePath(key: 'boardPath' | 'taskPath'): string {
  try {
    const fixture = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Record<string, unknown>
    if (typeof fixture[key] === 'string' && fixture[key]) return fixture[key]
  } catch {
    // The preflight normally catches this; keep a later runner/file failure from authorizing rollback.
  }
  abortUnrunnable(`smoke fixture is missing ${key}`)
}

test.afterEach(({ page }, testInfo) => {
  if (page.url().includes(LOGIN_PATH)) {
    markUnrunnable(`smoke session redirected to ${LOGIN_PATH} during the view checks`)
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
  path: string | (() => string)
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
  { name: 'kanban board', path: () => fixturePath('boardPath'), titlePattern: /• Hypertask$/, notTitle: /^Hypertask$/, selector: '.kanban-column-title' },
  // Task detail: "<ticket> <title> - Hypertask"; a missing task renders
  // "undefined undefined - Hypertask".
  // <textarea id="title-input"> — src/components/PageComponents/TaskDetail/TopRow/TaskTitle.tsx
  { name: 'task detail', path: () => fixturePath('taskPath'), titlePattern: / - Hypertask$/, notTitle: /undefined/, selector: '#title-input' },
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
  test(`${view.name} loads`, async ({ page }, testInfo) => {
    const viewPath = typeof view.path === 'function' ? view.path() : view.path
    const pageErrors: Error[] = []
    page.on('pageerror', (err) => pageErrors.push(err))
    await page.addInitScript(() => {
      const mutations: string[] = []
      const summarizeNode = (node: Node) => {
        if (!(node instanceof Element)) return node.nodeName.toLowerCase()
        const id = node.id ? `#${node.id}` : ''
        const classes = Array.from(node.classList).slice(0, 4).map((name) => `.${name}`).join('')
        return `${node.tagName.toLowerCase()}${id}${classes}`
      }
      const summarizeRecord = (record: MutationRecord) => JSON.stringify({
        at: Math.round(performance.now()),
        readyState: document.readyState,
        target: summarizeNode(record.target),
        added: Array.from(record.addedNodes, summarizeNode),
        removed: Array.from(record.removedNodes, summarizeNode),
      })
      const observer = new MutationObserver((records) => {
        mutations.push(...records.map(summarizeRecord))
        if (mutations.length > 100) mutations.splice(0, mutations.length - 100)
      })
      observer.observe(document, { childList: true, subtree: true })
      window.addEventListener('error', (event) => {
        if (!/(?:Minified React error #418|Hydration failed)/i.test(event.message)) return
        const error = event.error as Error & { cause?: unknown; componentStack?: string; digest?: string }
        const pending = observer.takeRecords().map(summarizeRecord)
        ;(window as typeof window & { __htHydrationDiagnostic?: unknown }).__htHydrationDiagnostic = {
          message: event.message,
          stack: error?.stack,
          componentStack: error?.componentStack,
          digest: error?.digest,
          cause: error?.cause instanceof Error ? `${error.cause.message}\n${error.cause.stack ?? ''}` : String(error?.cause ?? ''),
          mutations: [...mutations, ...pending].slice(-100),
        }
      }, true)
    })

    try {
      let response
      try {
        response = await page.goto(viewPath, { waitUntil: 'load' })
      } catch (err) {
        if (isUnrunnableError(err)) {
          markUnrunnable(`navigation infrastructure failed on ${viewPath}`)
        }
        throw err
      }

      if (isBotChallenge(response)) {
        abortUnrunnable(`Vercel bot-challenged the runner IP on ${viewPath}`)
      }

      if (response && (response.status() === 401 || response.status() === 403)) {
        abortUnrunnable(`smoke session got HTTP ${response.status()} on ${viewPath}`)
      }
      if (page.url().includes(LOGIN_PATH)) {
        abortUnrunnable(`smoke session redirected to ${LOGIN_PATH} on ${viewPath}`)
      }

      expect(response, `no response for ${viewPath}`).toBeTruthy()
      expect(response!.status(), `${viewPath} returned ${response!.status()}`).toBeLessThan(400)

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
        await expect(target, `${viewPath} missing "${view.selector}"`).toBeAttached({ timeout: 15_000 })
      } else {
        await expect(target, `${viewPath} missing "${view.selector}"`).toBeVisible({ timeout: 15_000 })
      }

      // An auth redirect on one view means the session broke mid-run or the
      // route is misbehaving; either way this is not a passing check.
      expect(page.url(), `${viewPath} redirected to ${page.url()}`).not.toContain(LOGIN_PATH)

      const title = await page.title()
      if (view.title) {
        expect(title, `${viewPath} titled "${title}", expected "${view.title}"`).toBe(view.title)
      }
      if (view.titlePattern) {
        expect(title, `${viewPath} titled "${title}", expected it to match ${view.titlePattern}`).toMatch(view.titlePattern)
      }
      if (view.notTitle) {
        expect(title, `${viewPath} titled "${title}"`).not.toMatch(view.notTitle)
      }

      const bodyText = await page.locator('body').innerText()
      for (const marker of ERROR_MARKERS) {
        expect(bodyText, `${viewPath} rendered an error page`).not.toMatch(marker)
      }

      expect(pageErrors, `${viewPath} threw a page error: ${pageErrors[0]?.message}`).toHaveLength(0)
    } finally {
      if (pageErrors.some((error) => /(?:Minified React error #418|Hydration failed)/i.test(error.message))) {
        const diagnostic = await page.evaluate(() =>
          (window as typeof window & { __htHydrationDiagnostic?: unknown }).__htHydrationDiagnostic,
        )
        const diagnosticJson = JSON.stringify(diagnostic, null, 2)
        console.error(`HYDRATION_DIAGNOSTIC ${viewPath}\n${diagnosticJson}`)
        await testInfo.attach('hydration-diagnostic', {
          body: diagnosticJson,
          contentType: 'application/json',
        })
      }
    }
  })
}
