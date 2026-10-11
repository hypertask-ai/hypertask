// YPER4-252 layout lock matrix: the main parts of the key pages must not move at any window width.
// Pages x widths x (AI sidebar open/closed, left sidebar collapsed/expanded). Each page opens once per
// sidebar state and the window is resized through the widths, so the whole matrix stays fast.
// Rewrite the baseline only for a ticket-requested layout change that Valentin approved:
// LAYOUT_LOCK_MATRIX_UPDATE=1 LAYOUT_LOCK_SOURCE_COMMIT=$(git rev-parse origin/production) \
//   npx playwright test -c playwright.config.smoke.ts e2e/smoke/layout-lock-matrix.spec.ts --workers=1 --retries=0
// Run it against the origin/production build with live-like flags, never --all-flags-on, then add the
// changed page to "approvedIn" in the baseline (see .github/scripts/layout-lock-approval.mjs).
// Failures save an "after" screenshot with the baseline boxes outlined to LAYOUT_LOCK_MATRIX_OUT
// (default test-results/layout-lock-matrix); an update run saves the "before" screenshots there too.
import { test, expect, type Page } from '@playwright/test'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Box } from './lib/layout-lock'
import {
  MATRIX_CHANGE_MESSAGE, MATRIX_STATES, MATRIX_WIDTHS, composerFollowsComments, describeCombo, matrixDifferences,
  stateKey, validateMatrixFlagChanges, type Anchor, type Anchors, type MatrixFlagChange, type MatrixState,
} from './lib/layout-lock-matrix'
import { FEATURE_FLAG_KEYS } from '../../src/lib/flags'
import { createTask } from './lib/api'
import { withRealtime } from './lib/realtime'

const stateFile = process.env.BROWSER_SMOKE_STATE_FILE || 'e2e/smoke/.state/smoke-state.json'
const fixturePath = path.join(path.dirname(stateFile), 'card-fixture.json')
const baselinePath = path.join(__dirname, 'layout-lock-matrix.baseline.json')
const flagChangesPath = path.join(__dirname, 'layout-lock-matrix.flag-changes.json')
const outDir = process.env.LAYOUT_LOCK_MATRIX_OUT || 'test-results/layout-lock-matrix'
const update = process.env.LAYOUT_LOCK_MATRIX_UPDATE === '1'
test.use({ storageState: stateFile, actionTimeout: 15_000 })

type Fixture = { taskId: number; detailPath: string; flags: Record<string, boolean>; allFlagsOn?: boolean }
type Baseline = {
  sourceCommit: string
  flagMode: 'live-like'
  flagSnapshotSha256: string
  approvedIn?: Record<string, string>
  pages: Record<string, Record<string, Record<string, Anchors>>>
}
type Target = { selector: string; contentHeight?: boolean; flowY?: boolean | 'phone' }
type PageDefinition = { name: string; targets: Record<string, Target>; thread?: boolean; route: (fixture: Fixture, longPath: string) => string; ready: (page: Page) => Promise<void> }

const target = (selector: string, contentHeight = false): Target => ({ selector, ...(contentHeight ? { contentHeight } : {}) })
const frame = {
  'left-sidebar': target('.app-shell-rail'),
  'ai-sidebar': target('[data-testid="ai-sidebar"], [data-ai-chat-panel]'),
}
// On a phone the ticket opens scrolled and the comment box is fixed at the bottom, so the scrolling parts
// are compared by x, width and relations only. A long thread also makes the desktop comment box content-dependent.
const ticketTargets = (long: boolean): Record<string, Target> => ({
  title: { ...target('#title-input'), ...(long ? { flowY: 'phone' as const } : {}) },
  description: { ...target('[data-testid="ticket-description"]', true), flowY: 'phone' },
  'comment-list': { ...target('[data-testid="ticket-thread"]', true), flowY: 'phone' },
  'comment-box': { ...target('[data-testid="comment-composer"]'), ...(long ? { flowY: true } : {}) },
  'properties-panel': { ...target('[data-task-properties-rail]', true), flowY: 'phone' },
  ...frame,
})
const ticketReady = async (page: Page) => {
  await expect(page.locator('#title-input')).not.toHaveValue('')
  await expect(page.getByTestId('ticket-comment').first()).toBeVisible()
  await expect(page.getByTestId('comment-composer')).toBeVisible()
}
const PAGES: PageDefinition[] = [
  { name: 'ticket-short-thread', targets: ticketTargets(false), thread: true, route: fixture => fixture.detailPath, ready: ticketReady },
  { name: 'ticket-long-thread', targets: ticketTargets(true), thread: true, route: (_fixture, longPath) => longPath, ready: ticketReady },
  {
    name: 'board',
    targets: {
      toolbar: target('[data-testid="mobile-top-bar"]:visible, div:has(> [aria-label="Filter board"]):visible'),
      'todo-column': target('.section-container:has([data-title="To do"])', true),
      'done-column': target('.section-container:has([data-title="Done"])', true),
      'column-title': target('[data-title="To do"] .kanban-column-title'),
      ...frame,
    },
    route: () => process.env.SMOKE_BOARD_PATH!,
    ready: async page => { await expect(page.locator('.kanban-column-title')).toHaveCount(2) },
  },
  {
    name: 'inbox',
    targets: {
      panel: target('[data-testid="inbox-panel"]'),
      list: target('[data-testid="inbox-list"]:visible', true),
      splits: target('nav[aria-label="Inbox splits"]:visible, .inbox-text-left:visible'),
      ...frame,
    },
    route: () => '/inbox',
    ready: async page => { await expect(page.locator('[data-tutorial-inbox-loaded="true"]')).toBeAttached() },
  },
  {
    name: 'search',
    targets: { panel: target('div.global-view-width.search-input', true), 'search-box': target('#search-input'), ...frame },
    route: () => '/search',
    ready: async page => { await expect(page.locator('#search-input')).toBeVisible() },
  },
]
const only = process.env.LAYOUT_LOCK_MATRIX_PAGES?.split(',')
const selected = PAGES.filter(definition => !only || only.includes(definition.name))

const readBaseline = () => JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline
const flagChanges = JSON.parse(readFileSync(flagChangesPath, 'utf8')) as MatrixFlagChange[]

test.beforeAll(() => {
  expect(validateMatrixFlagChanges(flagChanges, FEATURE_FLAG_KEYS, PAGES.map(definition => definition.name)), 'matrix flag change ratchet must shrink when flags retire').toEqual([])
})
test.beforeEach(async ({ page }) => {
  test.skip(!process.env.BROWSER_SMOKE_PR && process.env.PREMERGE_LOCAL !== '1', 'isolated browser smoke fixtures only')
  await page.setViewportSize({ width: 1440, height: 900 })
})

// On a phone the AI chat is a sheet over the page that scrolls the page behind it, so with it open no vertical position counts.
const anchorOf = (definition: Target, width: number, state: MatrixState, box: Box): Anchor => {
  const { flowY, ...rest } = definition
  const phone = width < 768
  return { ...rest, ...(flowY === true || (phone && (flowY === 'phone' || state.ai === 'open')) ? { flowY: true } : {}), box }
}
const round = (box: Box) => Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value)])) as Box
async function measure(page: Page, targets: Record<string, Target>): Promise<Record<string, Box | null>> {
  const boxes: Record<string, Box | null> = {}
  for (const [name, { selector }] of Object.entries(targets)) {
    // Hidden copies (phone and desktop variants) are not layout; exactly one visible match is the anchor.
    const visible = page.locator(selector).locator('visible=true')
    const box = await visible.count() === 1 ? await visible.boundingBox() : null
    boxes[name] = box && round(box)
  }
  return boxes
}
// Why an anchor has no box: printed with the failure so CI-only misses can be diagnosed from the log.
const describeMissing = (page: Page, targets: Record<string, Target>, actual: Record<string, Box | null>) =>
  Promise.all(Object.entries(actual).filter(([, box]) => box === null).map(async ([name]) => {
    const all = page.locator(targets[name].selector)
    return `${name}: ${await all.count()} found, ${await all.locator('visible=true').count()} visible`
  }))
const lastCommentBottom = (page: Page) => page.evaluate(() => {
  const comments = [...document.querySelectorAll('[data-testid="ticket-comment"]')]
  return comments.length ? Math.round(Math.max(...comments.map(comment => comment.getBoundingClientRect().bottom))) : null
})

// Scroll offsets differ between a fresh load and a resize; every comparison starts from the top.
const scrollToTop = (page: Page) => page.evaluate(() => {
  for (const element of document.querySelectorAll('*')) if (element.scrollTop > 0) element.scrollTop = 0
  window.scrollTo(0, 0)
})

// Two animation frames, then the same boxes twice in a row: the layout has stopped changing.
// Parts the baseline expects must be on the page first: the phone top bar mounts lazily and the phone
// comment box waits for the thread to settle, so "missing twice in a row" is not "settled". A part that
// stays missing for the whole 8s still fails as missing.
async function settle(page: Page, targets: Record<string, Target>, required: string[] = []) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined)
  let previous = ''
  let actual: Record<string, Box | null> = {}
  let stable = false
  const deadline = Date.now() + 8_000
  while (!stable && Date.now() < deadline) {
    actual = await measure(page, targets)
    const next = JSON.stringify(actual)
    stable = previous === next && required.every(name => actual[name])
    previous = next
    if (!stable) await page.waitForTimeout(120)
  }
  return { actual, stable }
}

// A first visit shows comments expanded, later visits collapse the seen ones; start every state from the expanded thread.
async function expandComments(page: Page) {
  const comments = page.getByTestId('ticket-comment')
  for (let index = 0; index < await comments.count(); index++) {
    const comment = comments.nth(index)
    if (await comment.locator('.comment-body').count() === 0) await comment.click()
  }
  await expect(page.locator('[data-testid="ticket-comment"] .comment-body')).toHaveCount(await comments.count())
}

async function applyState(page: Page, state: MatrixState) {
  const rail = page.locator('.app-shell-rail button[aria-label$=" sidebar"]')
  const wantRail = state.rail === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar'
  if (await rail.getAttribute('aria-label') !== wantRail) await rail.click()
  await expect(rail).toHaveAttribute('aria-label', wantRail)
  // The rail's "AI Chat" button toggles the sidebar in both directions on desktop widths.
  const ai = page.locator('[data-testid="ai-sidebar"], [data-ai-chat-panel]')
  if (await ai.count() > 0 !== (state.ai === 'open')) await page.locator('.app-shell-rail button[aria-label="AI Chat"]').click()
  if (state.ai === 'open') await expect(ai).toBeVisible()
  else await expect(ai).toHaveCount(0)
}

async function outline(page: Page, baseline: Anchors) {
  await page.evaluate(anchors => {
    const layer = document.createElement('div')
    layer.id = 'layout-lock-baseline-outline'
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
    for (const [name, { box }] of Object.entries(anchors)) {
      const rectangle = document.createElement('div')
      rectangle.style.cssText = `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;outline:2px dashed #e5484d;font:11px monospace;color:#e5484d`
      rectangle.textContent = `baseline ${name}`
      layer.appendChild(rectangle)
    }
    document.body.appendChild(layer)
  }, baseline)
}
const removeOutline = (page: Page) => page.evaluate(() => document.getElementById('layout-lock-baseline-outline')?.remove())
const slug = (text: string) => text.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

function serialize(baseline: Baseline) {
  const anchors = (value: Anchors) => `{\n${Object.entries(value).map(([name, anchor]) => `          ${JSON.stringify(name)}: ${JSON.stringify(anchor)}`).join(',\n')}\n        }`
  const states = (value: Record<string, Record<string, Anchors>>) => Object.entries(value).map(([key, widths]) =>
    `      ${JSON.stringify(key)}: {\n${Object.entries(widths).map(([width, value]) => `        ${JSON.stringify(width)}: ${anchors(value)}`).join(',\n')}\n      }`).join(',\n')
  const { pages, approvedIn, ...meta } = baseline
  const head = Object.entries(meta).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`).join('')
  const approvals = approvedIn ? `  "approvedIn": ${JSON.stringify(approvedIn, null, 2).replace(/\n/g, '\n  ')},\n` : ''
  const body = Object.entries(pages).map(([name, value]) => `    ${JSON.stringify(name)}: {\n${states(value)}\n    }`).join(',\n')
  return `{\n${head}${approvals}  "pages": {\n${body}\n  }\n}\n`
}

async function createLongThread(page: Page): Promise<string> {
  const cookies = JSON.parse(readFileSync(stateFile, 'utf8')).cookies as Array<{ name: string; value: string }>
  const userId = Number(JSON.parse(decodeURIComponent(cookies.find(cookie => cookie.name === 'nookies_user')!.value)).id)
  const projectId = Number(/[?&]id=(\d+)/.exec(process.env.SMOKE_DEMO_BOARD_PATH!)?.[1])
  // The demo board is not under test elsewhere, so this task never changes the board page.
  const task = await createTask(page.request, { title: 'Layout lock long thread', projectId, userId })
  for (let index = 1; index <= 14; index++) {
    const text = `Comment ${index} of the layout lock long thread. ${'This sentence only adds realistic text so the comment wraps over more than one line in a narrow column. '.repeat(1 + (index % 3))}`
    const response = await page.request.post('/api/comments/create', { data: { text: `<p>${text}</p><p>Second paragraph ${index}.</p>`, creatorId: userId, taskId: task.id, ownerId: userId } })
    expect(response.ok(), `long thread comment ${index} (HTTP ${response.status()})`).toBe(true)
  }
  return `/detail/project-${projectId}/${task.uniqueIndex}`
}

for (const definition of selected) {
  test(`layout lock matrix: ${definition.name}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000)
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture
    const longPath = definition.name === 'ticket-long-thread' ? await createLongThread(page) : ''
    const baseline = update && !existsSync(baselinePath) ? undefined : readBaseline()
    const recorded: Record<string, Record<string, Anchors>> = {}
    const failures: string[] = []
    let shots = 0
    mkdirSync(outDir, { recursive: true })

    for (const state of MATRIX_STATES) {
      const flagsResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/flags' && response.ok())
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(withRealtime(definition.route(fixture, longPath)), { waitUntil: 'load' })
      const { flags } = await (await flagsResponse).json() as { flags: Record<string, boolean> }
      for (const [key, enabled] of Object.entries(fixture.flags)) expect(flags[key] === true, `layout flag ${key}`).toBe(enabled)
      await definition.ready(page)
      if (definition.name === 'ticket-short-thread') await expandComments(page)
      await applyState(page, state)
      for (const width of MATRIX_WIDTHS) {
        const label = describeCombo(definition.name, width, state)
        await page.setViewportSize({ width, height: 900 })
        await scrollToTop(page)
        const expected = baseline?.pages[definition.name]?.[stateKey(state)]?.[String(width)]
        const found: string[] = []
        // HTPR-7074 hides the comment box until the thread settles (2s hard stop). Still hidden after 3s is a real failure.
        const slot = page.locator('[data-composer-slot-settled]').first()
        if (definition.thread && await slot.count() > 0 && !await expect(slot).toHaveAttribute('data-composer-slot-settled', 'true', { timeout: 3_000 }).then(() => true, () => false)) {
          found.push(`${label}: comment box still hidden 3s after the window changed width`)
        }
        const required = Object.keys(expected ?? {}).filter(name => width >= 768 || name !== 'ai-sidebar')
        const { actual, stable } = await settle(page, definition.targets, required)
        // On a phone the AI chat is an animated sheet over the page, not part of the layout.
        if (width < 768) actual['ai-sidebar'] = null
        if (!stable) found.push(`${label}: layout never settled within 8s`)
        if (update) {
          recorded[stateKey(state)] ??= {}
          recorded[stateKey(state)][String(width)] = Object.fromEntries(Object.entries(actual).filter(([, box]) => box).map(([name, box]) => [name, anchorOf(definition.targets[name], width, state, box!)]))
          await page.screenshot({ path: path.join(outDir, 'before', `${slug(label)}.png`) })
          continue
        }
        if (!expected) found.push(`${label}: no baseline recorded. ${MATRIX_CHANGE_MESSAGE}`)
        else {
          found.push(...matrixDifferences(label, definition.name, expected, actual, fixture.allFlagsOn ? { entries: flagChanges, registry: FEATURE_FLAG_KEYS, flags } : undefined))
          const composer = actual['comment-box']
          if (definition.thread && width >= 768 && composer && expected['comment-box']) found.push(...composerFollowsComments(label, composer.y, await lastCommentBottom(page)))
        }
        if (found.length) {
          const missing = await describeMissing(page, definition.targets, Object.fromEntries(Object.entries(actual).filter(([name]) => width >= 768 || name !== 'ai-sidebar')))
          failures.push(...found, ...(missing.length ? [`${label}: missing anchors (${missing.join('; ')})`] : []))
          if (shots++ < 28) {
            if (expected) await outline(page, expected)
            await page.screenshot({ path: path.join(outDir, 'after', `${slug(label)}.png`) })
            await removeOutline(page)
          }
        }
      }
    }
    await testInfo.attach('layout-matrix', { body: JSON.stringify({ page: definition.name, failures }), contentType: 'application/json' })

    if (update) {
      expect(testInfo.config.workers, 'baseline updates must be serial (--workers=1)').toBe(1)
      expect(process.env.LAYOUT_LOCK_SOURCE_COMMIT, 'record the origin/production source commit').toMatch(/^[a-f0-9]{40}$/)
      const snapshot = readFileSync(path.join(__dirname, 'production-flag-modes.json'), 'utf8')
      const { modes } = JSON.parse(snapshot) as { modes: Record<string, string> }
      for (const [key, enabled] of Object.entries(fixture.flags)) expect(enabled, `baseline update requires live-like flags, not all-flags-on: ${key}`).toBe(key in modes ? modes[key] === 'EVERYONE' : enabled)
      const next: Baseline = baseline ?? { sourceCommit: '', flagMode: 'live-like', flagSnapshotSha256: '', pages: {} }
      next.sourceCommit = process.env.LAYOUT_LOCK_SOURCE_COMMIT!
      next.flagSnapshotSha256 = createHash('sha256').update(snapshot).digest('hex')
      next.pages[definition.name] = recorded
      writeFileSync(baselinePath, serialize(next))
      return
    }
    expect(failures.slice(0, 60), `${failures.length} layout lock matrix failure(s), first 60 shown. Screenshots: ${outDir}/after. ${MATRIX_CHANGE_MESSAGE}`).toEqual([])
  })
}
