import { readFileSync } from 'node:fs'
import { expect } from 'e2e'
import { layoutDifferences } from '../smoke/lib/layout-lock.ts'
import { waitForStableScroll } from '../smoke/lib/layout-lock-matrix.ts'
import taskDetailConfig from '../../src/lib/configs/taskDetail.config.ts'

const baseline = JSON.parse(readFileSync(new URL('../smoke/layout-lock.baseline.json', import.meta.url), 'utf8')).viewports.Desktop
const selectors = {
  title: '#title-input',
  description: '[data-testid="ticket-description"]',
  'first-comment': ':nth-match([data-testid="ticket-comment"], 1)',
  'last-comment': ':nth-match([data-testid="ticket-comment"], 2)',
  composer: '[data-testid="comment-composer"]',
  properties: '[data-task-properties-rail]',
}

export async function waitForTicketInitialScroll(browser) {
  await browser.evaluate(waitForStableScroll, {})
  const delay = Math.max(taskDetailConfig.delays.defaultCommentFocus, taskDetailConfig.delays.mobileFocusComment, taskDetailConfig.delays.scrollToElement)
  await browser.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), delay)
  await browser.evaluate(waitForStableScroll, {})
}

export async function assertLayout(browser) {
  const screen = baseline.screens.ticket
  if (JSON.stringify(Object.keys(selectors).sort()) !== JSON.stringify(Object.keys(screen.landmarks).sort())) throw new Error('Ticket landmark coverage changed')
  for (const [name, selector] of Object.entries(selectors)) if (screen.landmarks[name].selector !== selector) throw new Error(`Ticket selector changed: ${name}`)
  await waitForTicketInitialScroll(browser)
  await browser.evaluate(waitForStableScroll, { baselineLayout: 'desktop' })
  for (const selector of Object.values(selectors)) await expect(browser.locator(selector)).toBeVisible()
  const measured = await browser.evaluate(async () => {
    await document.fonts.ready
    const read = () => {
      const elements = {
        title: document.querySelectorAll('#title-input'),
        description: document.querySelectorAll('[data-testid="ticket-description"]'),
        'first-comment': document.querySelectorAll('[data-testid="ticket-comment"]:nth-of-type(1)'),
        'last-comment': document.querySelectorAll('[data-testid="ticket-comment"]:nth-of-type(2)'),
        composer: document.querySelectorAll('[data-testid="comment-composer"]'),
        properties: document.querySelectorAll('[data-task-properties-rail]'),
      }
      const comments = document.querySelectorAll('[data-testid="ticket-comment"]')
      elements['first-comment'] = comments.length >= 1 ? [comments[0]] : []
      elements['last-comment'] = comments.length >= 2 ? [comments[1]] : []
      return Object.fromEntries(Object.entries(elements).map(([name, nodes]) => {
        if (nodes.length !== 1 || !nodes[0].getClientRects().length) return [name, null]
        const rect = nodes[0].getBoundingClientRect()
        if (getComputedStyle(nodes[0]).visibility !== 'visible' || rect.width <= 0 || rect.height <= 0) return [name, null]
        return [name, Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, Math.round(rect[k])]))]
      }))
    }
    let previous = ''
    const end = Date.now() + 10000
    while (Date.now() < end) {
      const actual = read(), current = JSON.stringify(actual)
      if (current === previous) return { actual, viewport: { width: innerWidth, height: innerHeight } }
      previous = current
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw new Error('Layout did not settle')
  })
  if (JSON.stringify(measured.viewport) !== JSON.stringify(baseline.viewport)) throw new Error('Unexpected viewport')
  const differences = layoutDifferences('ticket/Desktop', screen, measured.actual)
  if (differences.length) throw new Error(differences.join('\n'))
}
