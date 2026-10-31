import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { assertLayout, waitForTicketInitialScroll } from '../layout.js'

const statePath = process.env.BROWSER_SMOKE_STATE_FILE || '../smoke/.state/smoke-state.json'
const fixture = JSON.parse(readFileSync(path.join(path.dirname(statePath), 'card-fixture.json'), 'utf8'))
const realtime = path => `${path}${path.includes('?') ? '&' : '?'}realtime=on`

async function authenticate(browser) {
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  if (state.origins.length) throw new Error('Pilot cannot restore local storage')
  await browser.setCookies(state.cookies)
}

async function assertFlags(browser) {
  const flags = await browser.evaluate(async () => (await (await fetch('/api/flags')).json()).flags)
  for (const [key, enabled] of Object.entries(fixture.flags)) if ((flags[key] === true) !== enabled) throw new Error(`Unexpected flag ${key}`)
}

async function act(agent, goal) {
  const result = await agent.act(goal)
  if (process.env.PILOT_RECORD !== '1') {
    if (result.modelCalls !== 0 || result.cache?.mode !== 'self-finalized' || result.cache.replayedActions < 1) throw new Error('Expected a complete model-free replay')
    appendFileSync(process.env.PILOT_REPLAY_LOG, JSON.stringify({ modelCalls: result.modelCalls, mode: result.cache.mode, replayedActions: result.cache.replayedActions }) + '\n')
  }
}

async function ready(browser) {
  await expect(browser.locator('#title-input')).toHaveValue('Browser smoke board fixture')
  await expect(browser.locator('[data-testid="ticket-comment"]')).toHaveCount(2)
  await expect(browser.locator('[data-testid="comment-composer"]')).toBeVisible()
  await expect(browser.locator('[data-ticket-initial-scroll-ready="true"]')).toBeAttached()
  await waitForTicketInitialScroll(browser)
}

async function parkPointer(browser) {
  await browser.mouse.move(0, 0)
  await expect(browser.locator('[data-testid="ticket-comment"] [aria-haspopup="dialog"][aria-expanded="true"]')).toHaveCount(0)
}

test('ticket layout after AI board card entry', async ({ app, agent, browser }) => {
  await authenticate(browser)
  await app.open(realtime(process.env.SMOKE_BOARD_PATH))
  await assertFlags(browser)
  await act(agent, 'Open the board card named Browser smoke board fixture')
  await expect(browser).toHaveURL(new RegExp(`${fixture.detailPath}(?:\\?.*)?$`))
  await ready(browser)
  await parkPointer(browser)
  await browser.locator('[data-testid="ticket-comment"]').first().tap()
  await browser.locator('[data-testid="ticket-comment"]').last().tap()
  await expect(browser.locator('[data-testid="ticket-comment"] .comment-body')).toHaveCount(2)
  await assertLayout(browser)
})

test('ticket layout after AI hovercard and comment expansion', async ({ app, agent, browser }) => {
  await authenticate(browser)
  await app.open(realtime(process.env.SMOKE_BOARD_PATH))
  await assertFlags(browser)
  await browser.locator(`#task-${fixture.taskId} a[href="${fixture.detailPath}"]`).tap()
  await expect(browser).toHaveURL(new RegExp(`${fixture.detailPath}(?:\\?.*)?$`))
  await ready(browser)
  const author = browser.locator('[data-testid="ticket-comment"] [aria-haspopup="dialog"]').first()
  await author.hover()
  await expect(author).toHaveAttribute('aria-expanded', 'true')
  await act(agent, 'Move the pointer away from any open author hovercard, wait for it to close, then expand both comments in the ticket thread')
  await expect(browser.locator('[data-testid="ticket-comment"] [aria-haspopup="dialog"][aria-expanded="true"]')).toHaveCount(0)
  await expect(browser.locator('[data-testid="ticket-comment"] .comment-body')).toHaveCount(2)
  await assertLayout(browser)
})
