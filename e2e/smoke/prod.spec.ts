import { test, expect } from './lib/appReady'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { errorPageHeading } from './lib/errorPage'
import { withRealtime } from './lib/realtime'
import { tieredId } from './lib/tier'
import { BOARD_DISPLAY_COOKIE, parseBoardDisplay } from '../../src/lib/firstScreen/boardDisplay'

const PREFLIGHT_FILE = path.join(__dirname, '.state', 'preflight.json')
const APPLICATION_FAILURE_FILE = path.join(__dirname, '.state', 'application-failure.json')
const LOGIN_PATH = '/login'
const BOARD_SWITCH_TIMEOUT = 15_000

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
    writeFileSync(APPLICATION_FAILURE_FILE, JSON.stringify({ view: testInfo.title }))
  }
})

const VIEWS: Array<{
  name: string
  path: string | undefined
  requiresFixture?: boolean
  title?: string
  titlePattern?: RegExp
  notTitle?: RegExp
  selector: string
  attachedOnly?: boolean
}> = [
  { name: 'board list', path: '/all-tasks', title: 'All tasks', selector: '#users-list', attachedOnly: Boolean(process.env.BROWSER_SMOKE_PR) },
  { name: 'kanban board', path: process.env.SMOKE_BOARD_PATH, requiresFixture: true, titlePattern: /• Hypertask$/, notTitle: /^Hypertask$/, selector: '.kanban-column-title' },
  ...(process.env.BROWSER_SMOKE_PR ? [{ name: 'demo board', path: process.env.SMOKE_DEMO_BOARD_PATH, titlePattern: /• Hypertask$/, notTitle: /^Hypertask$/, selector: '.kanban-column-title' }] : []),
  { name: 'task detail', path: process.env.SMOKE_TASK_PATH, requiresFixture: true, titlePattern: / - Hypertask$/, notTitle: /undefined/, selector: '#title-input' },
  { name: 'inbox', path: '/inbox', titlePattern: /^Inbox/, selector: '[data-tutorial-inbox-loaded="true"]', attachedOnly: true },
  { name: 'calendar', path: '/calendar', title: 'Calender', selector: '[aria-label="Toggle boards and filters panel"], .mobile-calendar' },
  { name: 'AI search', path: '/search', title: 'Search', selector: '#search-input' },
  { name: 'settings', path: '/settings', title: 'Settings', selector: 'input[placeholder="Search settings"]' },
  { name: 'new-task modal', path: process.env.SMOKE_POSTDEPLOY === '1' ? `/new?board=${process.env.SMOKE_TASK_PATH?.match(/^\/detail\/project-(\d+)\//)?.[1]}` : '/new', title: 'New', selector: '#createTaskModal' },
]

for (const groupBy of ['time', 'board'] as const) {
test(`My Tasks Tab keeps the chosen split without server navigation (${groupBy} grouping)`, async ({ page }, testInfo) => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'isolated PR fixtures only')
  await page.setViewportSize(testInfo.project.name === 'Mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 })
  const boards = [process.env.SMOKE_BOARD_PATH!, process.env.SMOKE_DEMO_BOARD_PATH!].map((boardPath, index) => ({
    id: Number(new URL(boardPath, 'http://localhost').searchParams.get('id')),
    title: index === 0 ? 'Browser smoke board' : 'Browser smoke demo board',
    sections: [], labels: [], members: [],
  }))
  boards.push(...[91001, 91002].map((id) => ({
    id, title: `Browser smoke board ${id}`, sections: [], labels: [], members: [],
  })))
  const sections = boards.map((board) => ({
    id: board.id, projectId: board.id, section_title: board.title, items: [],
  }))
  await page.route('**/api/flags', (route) => route.fulfill({ json: { flags: {
    'htpr-6455-my-tasks-time-group': true,
  } } }))
  await page.route('**/api/my-tasks?*', (route) => route.fulfill({ json: {
    sections, tabs: ['All', ...boards.map((board) => board.title)], boards, accessibleProjectIds: boards.map((board) => board.id),
  } }))
  const listResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/my-tasks')
  await page.goto('/my-tasks?view=all', { waitUntil: 'load' })
  await listResponse
  if (groupBy === 'board') {
    if (testInfo.project.name === 'Mobile') await page.evaluate(() => window.dispatchEvent(new Event('my-tasks-group-picker')))
    else await page.getByRole('button', { name: 'Group My Tasks', exact: true }).click()
    await page.locator('[id^="option-picker-"]', { hasText: /^Board$/ }).click()
    await expect(page.locator('[id^="option-picker-"]'), 'Group picker must close and hand focus back before the Tab checks').toHaveCount(0)
  }
  const splits = page.locator('.footer_tags_main:visible:not(.table-hscroll .footer_tags_main)')
  const selected = splits.locator('.font-semibold > span.footer_tags')
  await expect(splits).toHaveCount(boards.length + 1)
  await expect(selected).toHaveText('All')
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(page.locator('body'), 'the page body must hold focus before the first Tab').toBeFocused()

  let serverNavigations = 0
  let releaseNavigation!: () => void
  const navigationHeld = new Promise<void>((resolve) => { releaseNavigation = resolve })
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
    for (const index of [1, 2, 3, 4, 0, 1, 2]) {
      await page.keyboard.press('Tab')
      await assertSplit(index)
    }
    await page.keyboard.press('Shift+Tab')
    await assertSplit(1)
    let index = 1
    for (const count of [3, 6]) {
      for (const direction of [1, -1]) {
        for (let press = 0; press < count; press++) {
          await page.keyboard.press(direction === 1 ? 'Tab' : 'Shift+Tab')
          await page.waitForTimeout(80)
          index = (index + direction + boards.length + 1) % (boards.length + 1)
          const title = index === 0 ? 'All' : boards[index - 1].title
          expect(await selected.textContent(), `rapid press ${press + 1} must select ${title}`).toBe(title)
          expect(new URL(page.url()).searchParams.get('board')).toBe(index === 0 ? null : String(boards[index - 1].id))
        }
        await assertSplit(index)
      }
    }
    releaseNavigation()
    await assertSplit(1)
    expect(serverNavigations, 'split selection must not request a server redraw').toBe(0)
  } finally {
    releaseNavigation()
  }
})
}

test.describe('docked board scope', () => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'isolated PR fixtures only')
  test.use({ storageState: async ({}, applyState, info) => {
    const stateFile = process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'
    await applyState(path.join(path.dirname(stateFile), `board-scope-${info.project.name}-state.json`))
  } })

test('docked AI chat follows the viewed board and keeps hand picks board-local', { tag: ['@id:chat-follows-board'] }, async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'Mobile'
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
  const stateFile = process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'
  const boards = z.array(z.object({ path: z.string(), id: z.number().int().positive(), title: z.string() })).length(2)
    .parse(JSON.parse(readFileSync(path.join(path.dirname(stateFile), 'board-scope-fixture.json'), 'utf8')))
  const [a, b] = boards
  for (const board of boards) expect(Number(new URL(board.path, 'http://localhost').searchParams.get('id'))).toBe(board.id)
  expect(a.id).toBeGreaterThan(0)
  expect(b.id).toBeGreaterThan(0)
  expect(a.id).not.toBe(b.id)
  await page.addInitScript((boardId) => {
    const saved = JSON.parse(localStorage.getItem('recoil-persist') || '{}')
    localStorage.setItem('recoil-persist', JSON.stringify({ ...saved, dockedChatScope: boardId }))
  }, b.id)
  const sidebar = page.getByTestId('ai-sidebar')
  const chip = sidebar.locator('[data-ai-chat-scope]:visible > button').first()
  const renderedBoard = (board: typeof a) =>
    page.locator(`[data-board-id="${board.id}"][data-board-tasks-hydrated="true"]`)
  const openChat = async () => {
    if (await sidebar.isVisible()) return
    await page.getByRole('button', { name: mobile ? 'AI' : 'Open AI chat', exact: true }).click()
    await expect(sidebar).toBeVisible()
  }
  const assertScope = async (board: typeof a) => {
    await expect(renderedBoard(board)).toBeAttached({ timeout: BOARD_SWITCH_TIMEOUT })
    await expect(page.locator('.kanban-column-title').first()).toBeVisible()
    await page.locator('[data-ai-chat-ready="true"]').waitFor({ state: 'attached' })
    await openChat()
    await expect(sidebar).toBeVisible()
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('title', board.title)
    await expect(chip).toContainText(board.title)
  }
  const switchBoard = async (board: typeof a) => {
    if (mobile) {
      await page.getByRole('button', { name: 'Close AI chat', exact: true }).click()
      await expect(sidebar).toBeHidden()
      await page.getByRole('button', { name: 'Switch board', exact: true }).click()
      await page.locator(`#mobile-board-option-${board.id}`).click()
    } else {
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
      const entry = page.locator(`#project-${board.id}:visible`)
      if (!(await entry.count())) {
        await page.keyboard.press('Control+b')
        await expect(entry).toBeVisible({ timeout: 5_000 })
      }
      await entry.click({ timeout: 5_000 })
    }
    await expect(page).toHaveURL((url) => url.pathname === '/project' && url.searchParams.get('id') === String(board.id), { timeout: BOARD_SWITCH_TIMEOUT })
    await expect(renderedBoard(board), 'the switch did not render the board the rail asked for').toBeAttached({ timeout: BOARD_SWITCH_TIMEOUT })
    await expect(page).toHaveTitle(`${board.title} • Hypertask`, { timeout: BOARD_SWITCH_TIMEOUT })
    await expect(page.locator('[id^="task-"]').filter({ hasText: `${board.title} fixture` }).first()).toBeVisible({ timeout: BOARD_SWITCH_TIMEOUT })
  }
  await page.goto(withRealtime(a.path), { waitUntil: 'load' })
  await assertScope(a)
  let documentRequests = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++
  })
  await switchBoard(b)
  await assertScope(b)
  await chip.click()
  await page.locator('#option-picker').getByText(a.title, { exact: true }).click()
  await expect(chip).toHaveAttribute('title', a.title)
  await expect(chip).toContainText(a.title)
  await switchBoard(a)
  await assertScope(a)
  await switchBoard(b)
  await assertScope(b)
  expect(documentRequests, 'board switches must preserve client state rather than reload it').toBe(0)
})
})

for (const mode of ['sidebar', 'floating'] as const) {
test(`AI chat ${mode} opens by button, shortcut and fullscreen exit`, { tag: [`@id:chat-${mode}-surfaces`] }, async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'Mobile'
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
  const boardPath = process.env.SMOKE_BOARD_PATH || '/my-tasks'
  const autoOpenOff = { aiChatOpenNewTickets: false, aiChatOpenTickets: false, aiChatOpenBoards: false }
  await page.route('**/api/app-shell/bootstrap', async route => {
    const response = await route.fetch()
    const body = await response.json()
    if (body.slices?.preferences?.data) Object.assign(body.slices.preferences.data, autoOpenOff)
    await route.fulfill({ response, json: body })
  })
  await page.route('**/api/users/preferences', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    if (body.settings) Object.assign(body.settings, autoOpenOff)
    await route.fulfill({ response, json: body })
  })
  await page.addInitScript(sidebar => {
    const saved = JSON.parse(localStorage.getItem('recoil-persist') || '{}')
    localStorage.setItem('recoil-persist', JSON.stringify({ ...saved, isAiChatSidebarMode: sidebar, aiChatPinned: false, aiChatAutoOpenSuppressed: true, aiChatAutoOpenPreferences: {} }))
  }, mode === 'sidebar')
  const panel = mode === 'sidebar' ? page.getByTestId('ai-sidebar') : page.locator('.chatwindow')
  const composer = panel.locator('[contenteditable="true"]')
  const closeChat = async () => {
    if (!mobile && mode === 'sidebar') {
      await panel.locator('button:has(svg.lucide-chevron-right)').click()
      return
    }
    if (!mobile) await panel.locator('button:has(svg.lucide-minus)').click()
    await page.getByRole('button', { name: 'Close AI chat', exact: true }).last().click()
  }
  await page.goto(boardPath, { waitUntil: 'load' })
  await page.locator('[data-ai-chat-ready="true"]').waitFor({ state: 'attached' })
  if (await panel.isVisible()) await closeChat()
  await page.getByRole('button', { name: mobile ? 'AI' : 'Open AI chat', exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(composer).toBeVisible()
  await closeChat()
  await expect(panel).toBeHidden()
  await page.keyboard.press('Control+q')
  await expect(panel).toBeVisible()
  await expect(composer).toBeVisible()
  await page.goto(`/chat?return_to=${encodeURIComponent(boardPath)}`, { waitUntil: 'load' })
  const exit = page.getByRole('button', { name: 'Exit full-screen AI chat', exact: true })
  await expect(exit).toBeVisible()
  await expect(page.locator('main [contenteditable="true"]')).toBeVisible()
  await exit.click()
  await expect(page).toHaveURL(url => `${url.pathname}${url.search}` === boardPath)
  await expect(panel).toBeVisible()
  await expect(composer).toBeVisible()
  await closeChat()
  await expect(panel).toBeHidden()
})
}

test('seeded board card opens a ticket and stays open', { tag: ['@id:board-card-click'] }, async ({ page }, testInfo) => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'isolated PR fixtures only')
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '.state', 'card-fixture.json'), 'utf8')) as {
    taskId: number; title: string; description: string; detailPath: string; flags: Record<string, boolean>
  }
  await page.setViewportSize(testInfo.project.name === 'Mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 })
  await page.route('**/api/pages/list?*', () => {})
  const flagsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/flags' && response.ok())
  await page.goto(withRealtime(process.env.SMOKE_BOARD_PATH!), { waitUntil: 'load' })
  const { flags } = await (await flagsResponse).json() as { flags: Record<string, boolean> }
  for (const [key, enabled] of Object.entries(fixture.flags)) {
    expect(flags[key] === true, `seeded flag ${key} must match the production mode`).toBe(enabled)
  }
  const card = page.locator(`#task-${fixture.taskId} a[href="${fixture.detailPath}"]`)
  await expect(card).toContainText(fixture.title)
  await expect(card).toBeVisible()
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

test('chat opener waits for hydration before accepting its first click', { tag: ['@id:chat-open-hydration'] }, async ({ page }, testInfo) => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'isolated PR fixtures only')
  const mobile = testInfo.project.name === 'Mobile'
  const flags = await (await page.request.get('/api/flags')).json()
  expect(flags.flags['htpr-8038-chat-opener-ready']).toBe(true)
  await page.goto(withRealtime(process.env.SMOKE_BOARD_PATH!), { waitUntil: 'load' })
  await page.locator('[data-ai-chat-ready="true"]').waitFor({ state: 'attached' })
  const opener = page.getByRole('button', { name: mobile ? 'AI' : 'Open AI chat', exact: true })
  const user = await (await page.request.get('/api/users/getById')).json()
  await expect.poll(async () => (await page.context().cookies()).some(cookie => cookie.name === BOARD_DISPLAY_COOKIE)).toBe(true)
  const cookie = (await page.context().cookies()).find(cookie => cookie.name === BOARD_DISPLAY_COOKIE)
  if (!cookie) throw new Error('Missing warm-user display cookie')
  const display = parseBoardDisplay(decodeURIComponent(cookie.value), Number(user.id), { desktopChat: true })
  if (!display) throw new Error('Invalid warm-user display cookie')
  await page.context().addCookies([{ ...cookie, value: encodeURIComponent(JSON.stringify({ ...display,
    board: { ...display.board, openChat: false, chatSuppressed: true, chatPinned: false },
  })) }])
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('recoil-persist') || '{}')
    localStorage.setItem('recoil-persist', JSON.stringify({ ...saved,
      aiChatAutoOpenSuppressed: true, aiChatPinned: false, openAiChatByDefault: false,
    }))
    document.addEventListener('click', event => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest('button')
      if (!button || (button.getAttribute('aria-label') !== 'Open AI chat' && button.textContent?.trim() !== 'AI')) return
      const key = Reflect.ownKeys(button).find(key => String(key).startsWith('__reactProps$'))
      const props = key ? Reflect.get(button, key) : undefined
      document.documentElement.dataset.chatOpenerClicks = String(Number(document.documentElement.dataset.chatOpenerClicks ?? '0') + 1)
      document.documentElement.dataset.chatOpenerHandler = String(typeof props?.onClick === 'function')
      document.documentElement.dataset.chatOpenerRoute = location.pathname + location.search
    }, true)
  })
  const bootstrap = Promise.withResolvers<void>()
  await page.route('**/_next/static/**', async route => {
    if (route.request().resourceType() === 'script') await bootstrap.promise
    await route.continue()
  })
  try {
    await page.goto(withRealtime(process.env.SMOKE_BOARD_PATH!), { waitUntil: 'commit' })
    await expect(opener).toBeVisible({ timeout: 15_000 })
    await expect(opener).toBeDisabled()
    await expect(opener).toHaveAttribute('aria-busy', 'true')
    const clicked = opener.click()
    bootstrap.resolve()
    await clicked
    const click = await page.evaluate(() => ({ count: document.documentElement.dataset.chatOpenerClicks, handler: document.documentElement.dataset.chatOpenerHandler }))
    expect(click).toEqual({ count: '1', handler: 'true' })
    const scope = page.getByTestId('ai-sidebar').locator('[data-ai-chat-scope]:visible > button').first()
    await expect(scope).toBeVisible()
    await scope.click()
    await expect(page.locator('#option-picker')).toBeVisible()
  } finally {
    bootstrap.resolve()
    if (!page.isClosed()) {
      const startup = await page.evaluate(() => ({ route: location.pathname + location.search,
        clickRoute: document.documentElement.dataset.chatOpenerRoute,
        clicks: document.documentElement.dataset.chatOpenerClicks,
        handler: document.documentElement.dataset.chatOpenerHandler,
        sidebar: document.querySelector('[data-testid="ai-sidebar"]') !== null,
      })).catch(() => null)
      console.log('[chat opener startup]', JSON.stringify(startup))
    }
  }
})

test('error-screen check catches real error pages and ignores quoted error text', { tag: ['@id:error-page-detector'] }, async ({ page }) => {
  const screens = [
    '<h1>500</h1><h2>Internal Server Error.</h2>',
    '<h2>Application error: a client-side exception has occurred (see the browser console for more information).</h2>',
    '<h1>Something went wrong</h1><p>Try again</p>',
  ]
  for (const html of screens) {
    await page.setContent(html)
    expect(await errorPageHeading(page), html).toBeDefined()
  }

  await page.setContent('<h1>All Tasks</h1><h2>Fix the Get announcements 500</h2><p>Last error came back as an HTML page titled "500: Internal Server Error" instead of data.</p>')
  expect(await errorPageHeading(page)).toBeUndefined()
})

function isBotChallenge(response: import('@playwright/test').Response | null): boolean {
  return response?.headers()['x-vercel-mitigated'] === 'challenge'
}

for (const view of VIEWS) {
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

    await expect
      .poll(
        async () => (await page.locator('body').innerText()).trim().length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(30)
    await expect(page.locator('text=/^loading/i')).toHaveCount(0, { timeout: 15_000 })

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

    expect(page.url(), `${view.path} redirected to ${page.url()}`).not.toContain(LOGIN_PATH)

    if (view.title) {
      await expect(page, `${view.path} has the expected title`).toHaveTitle(view.title, { timeout: 15_000 })
    }
    if (view.titlePattern) {
      await expect(page, `${view.path} has the expected title pattern`).toHaveTitle(view.titlePattern, { timeout: 15_000 })
    }
    if (view.notTitle) {
      await expect(page, `${view.path} has no fallback title`).not.toHaveTitle(view.notTitle, { timeout: 15_000 })
    }

    expect(await errorPageHeading(page), `${view.path} rendered an error page`).toBeUndefined()

    if (process.env.BROWSER_SMOKE_PR) {
      if (view.name === 'kanban board' || view.name === 'demo board') {
        const columns = page.locator('.kanban-column-title')
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

test.describe('Pages fixtures', () => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'isolated PR fixtures only')
  test.use({ storageState: async ({}, applyState, info) => {
    const stateFile = process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'
    await applyState(path.join(path.dirname(stateFile), `pages-${info.project.name}-state.json`))
  } })

test('Pages list creates a document, links a ticket, persists, unlinks and separates archived pages', async ({ page }, testInfo) => {
  test.skip(!process.env.BROWSER_SMOKE_PR, 'Writes only to disposable PR fixtures')
  const stateFile = process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'
  const fixture = JSON.parse(readFileSync(path.join(path.dirname(stateFile), 'card-fixture.json'), 'utf8'))
  test.skip(!fixture.flags['htpr-7298-standalone-pages'] || !fixture.flags['htpr-7309-pages-screens'], 'Pages screens are off in this flag mode')
  const pageFixture = fixture.pages[testInfo.project.name]
  const boardId = pageFixture.projectId
  const title = `Pages smoke ${testInfo.project.name} ${Date.now()}`
  await page.goto(withRealtime(`/project?id=${boardId}&surface=board`))
  await page.goto(withRealtime(`/pages?project_id=${boardId}`))
  await expect(page.getByRole('main', { name: 'Pages', exact: true })).toBeVisible()
  await page.keyboard.press('Control+k')
  const commandInput = page.getByPlaceholder('Type a command or search...')
  await expect(commandInput).toHaveCount(1)
  await commandInput.fill('New page')
  await page.getByRole('dialog').getByText('New page', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeVisible()
  const publicId = new URL(page.url()).pathname.split('/').pop()!
  console.log(`[pages] created ${publicId}`)
  try {
    const created = await page.request.get(`/api/pages/${publicId}`)
    expect((await created.json()).page.projectId).toBe(boardId)
    await page.getByRole('textbox', { name: 'Page title', exact: true }).fill(title)
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(title)
    await expect(page.getByRole('button', { name: 'Back to Pages', exact: true })).toBeVisible()
    console.log('[pages] title saved and reloaded')
    const linked = await page.request.post(`/api/pages/${publicId}/links`, { data: { task_id: pageFixture.taskId } })
    expect(linked.ok()).toBe(true)
    await page.reload()
    await expect(page.getByText('Linked tickets (1)', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to task', exact: true })).toBeVisible()
    console.log('[pages] ticket linked')
    await page.getByRole('textbox', { name: 'Page title', exact: true }).fill(`${title} pending`)
    await page.getByRole('region', { name: 'Linked tickets', exact: true }).getByRole('link').click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(pageFixture.detailPath)
    await page.goto(`/page/${publicId}`)
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(`${title} pending`)
    await page.getByRole('textbox', { name: 'Page title', exact: true }).fill(title)
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Unlink / }).click()
    await expect(page.getByText('Linked tickets (0)', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to Pages', exact: true })).toBeVisible()
    console.log('[pages] pending save persisted and ticket unlinked')
    await page.goto(pageFixture.detailPath)
    await expect(page.locator('#title-input')).toBeVisible({ timeout: 15_000 })
    const linkPageCommand = page.getByRole('dialog').getByText('Link page', { exact: true })
    const pagePicker = page.locator('#option-picker input')
    for (let attempt = 1; ; attempt++) {
      await page.keyboard.press('Control+k')
      await page.getByPlaceholder('Type a command or search...').fill('Link page')
      await linkPageCommand.click()
      try {
        await expect(pagePicker, 'the Link page command did not open the chooser').toBeVisible({ timeout: 3_000 })
        break
      } catch (error) {
        if (attempt === 5) throw error
      }
    }
    await page.locator('#option-picker input').fill(title)
    await page.locator('#option-picker').getByText(title, { exact: true }).click()
    await expect(page.locator(`a[href="/page/${publicId}"]`)).toBeVisible()
    const unlinked = await page.request.delete(`/api/pages/${publicId}/links`, { data: { task_id: pageFixture.taskId } })
    expect(unlinked.ok()).toBe(true)
    await page.goto(`/page/${publicId}`)
    await page.getByRole('button', { name: 'Back to Pages', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search pages' }).fill(title)
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    console.log('[pages] task-context Link page and list search verified')
    const archived = await page.request.post(`/api/pages/${publicId}/archive`)
    expect(archived.ok()).toBe(true)
    await page.reload()
    await page.getByRole('textbox', { name: 'Search pages' }).fill(title)
    await expect(page.getByText('No pages found.', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: /^Archived pages/ }).click()
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
  } catch (error) {
    console.error(`[pages] failed on ${page.url()}: ${error}`)
    console.error(`[pages] dialog text: ${(await page.getByRole('dialog').allInnerTexts().catch(() => [])).join(' | ').slice(0, 600)}`)
    throw error
  } finally {
    await page.request.post(`/api/pages/${publicId}/archive`, { timeout: 5000 }).catch(() => {})
  }
})

})
