import { test as base, expect, type Page } from '@playwright/test'

export { expect }

const QUIET_MS = 400
const MAX_WAIT_MS = 5_000
const HYDRATION_SCAN_LIMIT = 300

type ReadyWindow = Window & {
  __htAppReady?: { since: number; quietMs: number }
}

export async function waitForAppReady(page: Page): Promise<void> {
  try {
    await page.evaluate((quietMs) => {
      const state = { since: performance.now(), quietMs }
      ;(window as ReadyWindow).__htAppReady = state
      new MutationObserver(() => {
        state.since = performance.now()
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    }, QUIET_MS)
  } catch {
    return
  }
  await page
    .waitForFunction(
      (limit) => {
        const state = (window as ReadyWindow).__htAppReady
        if (!state || document.readyState !== 'complete') return false
        if (performance.now() - state.since < state.quietMs) return false
        const nodes = Array.from(document.body.querySelectorAll('*')).slice(0, limit)
        return nodes.some((node) =>
          Object.keys(node).some((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$')),
        )
      },
      HYDRATION_SCAN_LIMIT,
      { timeout: MAX_WAIT_MS, polling: 100 },
    )
    .catch(() => undefined)
}

async function settleAfter<T>(page: Page, navigate: () => Promise<T>): Promise<T> {
  const result = await navigate()
  await waitForAppReady(page)
  return result
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page)
    const reload = page.reload.bind(page)
    const goBack = page.goBack.bind(page)
    const goForward = page.goForward.bind(page)
    page.goto = (url, options) => settleAfter(page, () => goto(url, options))
    page.reload = (options) => settleAfter(page, () => reload(options))
    page.goBack = (options) => settleAfter(page, () => goBack(options))
    page.goForward = (options) => settleAfter(page, () => goForward(options))
    await provide(page)
  },
})
