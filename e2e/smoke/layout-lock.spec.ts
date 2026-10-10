// Rewrite only for a ticket-requested layout change, quoting Valentin in the PR:
// LAYOUT_LOCK_UPDATE=1 LAYOUT_LOCK_SOURCE_COMMIT=$(git rev-parse origin/production) \
//   npx playwright test -c playwright.config.smoke.ts e2e/smoke/layout-lock.spec.ts --workers=1 --retries=0
// Run the origin/production build with the CI live-like seed, never --all-flags-on.
// After scripts/premerge-local.sh up, restore those modes in its disposable DB:
// node scripts/seed-browser-smoke.mjs --live-like-control (using its local env/state).
// Desktop: 1440x900. Phone: 390x844. Positions: 24px; sizes: max(24px, 10%).
// Content-dependent heights lock their top/left/right edges and vertical order instead.
import { test, expect, type Page } from '@playwright/test'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { layoutDifferences, validateFlagChanges, verticalOrder, LAYOUT_CHANGE_MESSAGE, type Box, type Screen, type FlagChange } from './lib/layout-lock'
import { FEATURE_FLAG_KEYS } from '../../src/lib/flags'
import path from 'node:path'
import { withRealtime } from './lib/realtime'

const fixturePath = path.join(path.dirname(process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'), 'card-fixture.json')

const baselinePath = path.join(__dirname, 'layout-lock.baseline.json')
const update = process.env.LAYOUT_LOCK_UPDATE === '1'
const flagChanges = JSON.parse(readFileSync(path.join(__dirname, 'layout-lock.flag-changes.json'), 'utf8')) as FlagChange[]
test.use({ storageState: process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json' })

type Baseline = {
  sourceCommit: string
  flagMode: 'live-like'
  flagSnapshotSha256: string
  viewports: Record<string, { viewport: { width: number; height: number }; screens: Record<string, Screen> }>
}
type Targets = Record<string, { selector: string; contentHeight?: boolean }>

test.beforeAll(() => {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline
  const screens = Object.fromEntries(Object.entries(baseline.viewports).flatMap(([device, viewport]) =>
    Object.entries(viewport.screens).map(([screen, value]) => [`${screen}/${device}`, value]),
  ))
  expect(validateFlagChanges(flagChanges, FEATURE_FLAG_KEYS, screens), 'layout flag change ratchet must shrink when flags retire').toEqual([])
})

const target = (selector: string, contentHeight = false) => ({ selector, ...(contentHeight ? { contentHeight } : {}) })

function landmarks(screen: string, phone: boolean): Targets {
  switch (screen) {
    case 'ticket': return {
      title: target('#title-input'),
      description: target('[data-testid="ticket-description"]', true),
      'first-comment': target(':nth-match([data-testid="ticket-comment"], 1)', true),
      'last-comment': target(':nth-match([data-testid="ticket-comment"], 2)', true),
      composer: target('[data-testid="comment-composer"]'),
      properties: target('[data-task-properties-rail]', true),
    }
    case 'board': return {
      toolbar: target(phone ? '[data-testid="mobile-top-bar"]' : 'div:has(> [aria-label="Filter board"])'),
      'todo-column': target('.section-container:has([data-title="To do"])', true),
      'done-column': target('.section-container:has([data-title="Done"])', true),
      'column-title': target('[data-title="To do"] .kanban-column-title'),
      card: target('[data-title="To do"] [id^="task-"]:has(a[href^="/detail/"])', true),
    }
    case 'inbox': return {
      panel: target('[data-testid="inbox-panel"]'),
      list: target('[data-testid="inbox-list"]:visible', true),
      splits: target(phone ? 'nav[aria-label="Inbox splits"]' : '.inbox-text-left'),
      search: target(phone ? '[aria-label="Commands"]' : '.app-shell-rail [aria-label="Search"]'),
    }
    case 'my-tasks': return {
      panel: target('[data-testid="my-tasks-panel"]'),
      title: target('[data-testid="my-tasks-title"]'),
      toolbar: target('[data-testid="my-tasks-toolbar"]'),
      list: target('[data-testid="my-tasks-list"]'),
      splits: target(phone ? '[data-testid="my-tasks-splits-phone"]' : '[data-testid="my-tasks-splits-desktop"]'),
    }
    case 'new-task': return {
      window: target('#createTaskModal .modal-content'),
      title: target('#title-input-container-create-task-modal', true),
      description: target('#description-container-create-task-modal', true),
      properties: target('[data-task-properties-rail]', true),
      ...(phone ? {} : { back: target('[data-testid="new-task-back"]') }),
    }
    case 'app-shell': return phone ? {
      toolbar: target('[data-testid="mobile-top-bar"]'),
      'board-switch': target('[aria-label="Switch board"]'),
      search: target('[aria-label="Commands"]'),
      navigation: target('nav[aria-label="Primary navigation"]'),
      'search-link': target('nav[aria-label="Primary navigation"] a[href="/search"]'),
    } : {
      navigation: target('.app-shell-rail'),
      'board-switch': target('[aria-label="Your Kanban boards"]'),
      inbox: target('[aria-label="Go to inbox"]'),
      search: target('.app-shell-rail [aria-label="Search"]'),
      settings: target('[data-testid="app-shell-settings"]'),
    }
    default: throw new Error(`Unknown layout screen: ${screen}`)
  }
}

async function measure(page: Page, targets: Targets): Promise<Record<string, Box | null>> {
  const boxes: Record<string, Box | null> = {}
  for (const [name, { selector }] of Object.entries(targets)) {
    const locator = page.locator(selector)
    const box = await locator.count() === 1 && await locator.isVisible() ? await locator.boundingBox() : null
    boxes[name] = box && Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value)])) as Box | null
  }
  return boxes
}

const screens = ['ticket', 'board', 'inbox', 'my-tasks', 'new-task', 'app-shell']
for (const name of [...screens, 'ticket from board card']) {
  const fromBoard = name === 'ticket from board card'
  const screen = fromBoard ? 'ticket' : name
  test(`layout baseline: ${name}`, async ({ page }, testInfo) => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { taskId: number; detailPath: string; flags: Record<string, boolean>; allFlagsOn?: boolean }
    const phone = testInfo.project.name === 'Mobile'
    const route = screen === 'ticket' ? fixture.detailPath
      : screen === 'new-task' ? '/new'
      : screen === 'my-tasks' ? '/my-tasks?view=all'
      : screen === 'inbox' || (screen === 'app-shell' && !phone) ? '/inbox'
      : process.env.SMOKE_BOARD_PATH!
    const flagsResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/flags' && response.ok())
    await page.goto(withRealtime(fromBoard ? process.env.SMOKE_BOARD_PATH! : route), { waitUntil: 'load' })
    const { flags } = await (await flagsResponse).json() as { flags: Record<string, boolean> }
    for (const [key, enabled] of Object.entries(fixture.flags)) expect(flags[key] === true, `layout flag ${key}`).toBe(enabled)
    if (fromBoard) {
      await page.locator(`#task-${fixture.taskId} a[href="${fixture.detailPath}"]`).click()
      await expect(page).toHaveURL(url => url.pathname === fixture.detailPath)
    }
    if (screen === 'ticket') {
      await expect(page.locator('#title-input')).toHaveValue('Browser smoke board fixture')
      await expect(page.getByTestId('ticket-comment')).toHaveCount(2)
      // HTPR-7074: the comment box appears once the thread has settled; measure after it is there.
      await expect(page.getByTestId('comment-composer')).toBeVisible()
      // Seen-state can collapse old comments between visits; compare the expanded thread.
      if (!phone) {
        await page.getByTestId('ticket-comment').first().click()
        await page.getByTestId('ticket-comment').last().click()
        await expect(page.locator('[data-testid="ticket-comment"] .comment-body')).toHaveCount(2)
      }
    } else if (screen === 'board' || (screen === 'app-shell' && phone)) {
      await expect(page.locator('.kanban-column-title')).toHaveCount(2)
    } else if (screen === 'inbox' || screen === 'app-shell') {
      await expect(page.locator('[data-tutorial-inbox-loaded="true"]')).toBeAttached()
    } else if (screen === 'new-task') {
      await expect(page.locator('#createTaskModal')).toBeVisible()
      await expect(page.locator('#create-task-tiptap-description').first()).toBeVisible()
    } else {
      await expect(page.getByTestId('my-tasks-title')).toBeVisible()
    }
    await page.evaluate(() => document.fonts.ready)
    const targets = landmarks(screen, phone)
    // Measure one settled viewport, never scroll individual landmarks into view.
    let previous = ''
    let actual: Record<string, Box | null> = {}
    await expect.poll(async () => {
      actual = await measure(page, targets)
      const next = JSON.stringify(actual)
      const stable = previous === next
      previous = next
      return stable
    }, { intervals: [100, 200, 400], timeout: 10_000 }).toBe(true)
    await testInfo.attach('layout-measurement', { body: JSON.stringify({ screen: `${name}/${testInfo.project.name}`, actual, flags }), contentType: 'application/json' })
    if (update && !fromBoard) {
      expect(testInfo.config.workers, 'baseline updates must be serial (--workers=1)').toBe(1)
      expect(process.env.LAYOUT_LOCK_SOURCE_COMMIT, 'record the origin/production source commit').toMatch(/^[a-f0-9]{40}$/)
      const snapshot = readFileSync(path.join(__dirname, 'production-flag-modes.json'), 'utf8')
      const { modes } = JSON.parse(snapshot) as { modes: Record<string, string> }
      for (const [key, enabled] of Object.entries(fixture.flags)) {
        expect(enabled, `baseline update requires live-like flags, not all-flags-on: ${key}`).toBe(modes[key] === 'EVERYONE')
      }
      for (const [name, box] of Object.entries(actual)) expect(box, `${screen}: ${name} must exist when recording`).not.toBeNull()
      const baseline: Baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : { sourceCommit: '', flagMode: 'live-like', flagSnapshotSha256: '', viewports: {} }
      baseline.sourceCommit = process.env.LAYOUT_LOCK_SOURCE_COMMIT!
      baseline.flagMode = 'live-like'
      baseline.flagSnapshotSha256 = createHash('sha256').update(snapshot).digest('hex')
      baseline.viewports[testInfo.project.name] ??= { viewport: page.viewportSize()!, screens: {} }
      baseline.viewports[testInfo.project.name].screens[screen] = {
        landmarks: Object.fromEntries(Object.entries(targets).map(([name, definition]) => [name, { ...definition, box: actual[name]! }])),
        order: verticalOrder(actual as Record<string, Box>),
      }
      writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    } else {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline
      const expected = baseline.viewports[testInfo.project.name]
      expect(page.viewportSize()).toEqual(expected.viewport)
      expect(Object.keys(expected.screens[screen].landmarks).sort(), 'baseline must cover every declared landmark').toEqual(Object.keys(targets).sort())
      expect(layoutDifferences(`${screen}/${testInfo.project.name}`, expected.screens[screen], actual, fixture.allFlagsOn
        ? { entries: flagChanges, registry: FEATURE_FLAG_KEYS, flags }
        : undefined)).toEqual([])
    }
  })
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!process.env.BROWSER_SMOKE_PR && process.env.PREMERGE_LOCAL !== '1', 'isolated browser smoke fixtures only')
  await page.setViewportSize(testInfo.project.name === 'Mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 })
})

test('layout lock: comment composer is the end of the ticket thread', async ({ page }) => {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { taskId: number; detailPath: string; flags: Record<string, boolean>; allFlagsOn?: boolean }
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
      }, { message: `ticket: composer: baseline=below last comment actual=overlapping thread. layout lock: composer top must be below the last comment bottom. ${LAYOUT_CHANGE_MESSAGE}` }).toBeGreaterThanOrEqual(0)
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

test('layout lock: phone New Task title has a real height and accepts a tap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Mobile', 'phone title invariant')
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { flags: Record<string, boolean> }
  test.skip(!fixture.flags['htpr-6970-phone-new-task-title'], 'phone title fix is off')
  const flagsResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/flags' && response.ok())
  await page.goto(withRealtime(process.env.SMOKE_BOARD_PATH!), { waitUntil: 'load' })
  const { flags } = await (await flagsResponse).json() as { flags: Record<string, boolean> }
  for (const [key, enabled] of Object.entries(fixture.flags)) expect(flags[key] === true, `phone title flag ${key}`).toBe(enabled)
  await expect(page.locator('.kanban-column-title').first()).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.keyboard.press('c')
  await expect(page.locator('#createTaskModal')).toBeVisible()
  const expand = page.getByRole('button', { name: /^Title:/ })
  if (await expand.count()) await expand.tap()
  const title = page.locator('#title-input-modal')
  // Assert the field itself, outside the htpr-6556 landmark allowance.
  await expect.poll(async () => (await title.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24)
  expect(await title.evaluate(field => {
    const box = field.getBoundingClientRect()
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === field
  }), 'phone title centre must hit the textarea, not an overlay or its wrapper').toBe(true)
  await title.tap()
  await expect(title).toBeFocused()
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

// HTPR-7074: a cold ticket open must not shove the comment box (or anything else) down the page.
const CLS_BUDGET = 0.05
type ShiftSource = { node: string; previous: number[]; current: number[] }
type ShiftEntry = { value: number; startTime: number; sources: ShiftSource[] }

// Largest session window: shifts less than 1s apart, a window at most 5s long.
function largestSessionWindow(shifts: ShiftEntry[]) {
  let best = { value: 0, shifts: [] as ShiftEntry[] }
  let current = { value: 0, shifts: [] as ShiftEntry[] }
  for (const shift of shifts) {
    const last = current.shifts[current.shifts.length - 1]
    if (last && (shift.startTime - last.startTime >= 1000 || shift.startTime - current.shifts[0].startTime >= 5000)) {
      current = { value: 0, shifts: [] }
    }
    current.value += shift.value
    current.shifts.push(shift)
    if (current.value > best.value) best = { value: current.value, shifts: [...current.shifts] }
  }
  return best
}

test('layout lock: ticket page first load stays under the CLS budget', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { longThreadDetailPath: string }
  const phone = testInfo.project.name === 'Mobile'
  if (phone) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.addInitScript(() => {
    const describe = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement
      if (!element) return 'removed node'
      const testId = element.closest('[data-testid]')?.getAttribute('data-testid')
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${testId ? `[data-testid=${testId}]` : ''} "${(element.textContent ?? '').trim().slice(0, 40)}"`
    }
    const rect = (r: DOMRectReadOnly) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
    const shifts: unknown[] = []
    ;(window as unknown as { __shifts: unknown[] }).__shifts = shifts
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number; startTime: number; sources: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) {
        if (entry.hadRecentInput) continue
        shifts.push({ value: entry.value, startTime: entry.startTime, sources: entry.sources.map((s) => ({ node: describe(s.node), previous: rect(s.previousRect), current: rect(s.currentRect) })) })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await page.goto(withRealtime(fixture.longThreadDetailPath), { waitUntil: 'load' })
  await expect(page.getByTestId('ticket-comment').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('comment-composer')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.getByTestId('ticket-comment').count(), { message: 'the long thread must render its comments', timeout: 30_000 }).toBeGreaterThanOrEqual(6)
  // Sample the box's own place for a while once it is visible: it may not move more than 24px (phone and desktop).
  const tops: number[] = []
  for (let sample = 0; sample < 15; sample += 1) {
    tops.push(await page.getByTestId('comment-composer').evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY)))
    await page.waitForTimeout(100)
  }
  expect(Math.max(...tops) - Math.min(...tops), `layout lock: the comment box moved after it was visible (${testInfo.project.name}), tops ${tops.join(',')}`).toBeLessThanOrEqual(24)
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: ShiftEntry[] }).__shifts)
  const worst = largestSessionWindow(shifts)
  const detail = worst.shifts.map((shift) => `  ${shift.value.toFixed(4)} at ${Math.round(shift.startTime)}ms\n${shift.sources.map((s) => `    ${s.node} [x,y,w,h] ${s.previous.join(',')} -> ${s.current.join(',')}`).join('\n')}`).join('\n')
  await testInfo.attach('cls-shifts', { body: JSON.stringify(shifts, null, 2), contentType: 'application/json' })
  // The score alone is small for a short comment box in a tall window, so also pin the box itself:
  // once visible it may not move more than the 24px layout lock tolerance.
  const composerJumps = shifts.flatMap((shift) => shift.sources.filter((s) => s.node.includes('[data-testid=comment-composer]') && Math.abs(s.current[1] - s.previous[1]) > 24).map((s) => `top ${s.previous[1]} -> ${s.current[1]}`))
  expect(composerJumps, `layout lock: the comment box moved after it was visible (${testInfo.project.name}). Shifts:\n${detail}`).toEqual([])
  expect(worst.value, `layout lock: ticket first load CLS ${worst.value.toFixed(4)} exceeds ${CLS_BUDGET} (${testInfo.project.name}). Shifts:\n${detail}`).toBeLessThanOrEqual(CLS_BUDGET)
})
