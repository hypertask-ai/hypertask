import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

// Same counting approach as HTPR-6620's browser-smoke check (open PR #744,
// hypertask-ai/hypertask, not merged as of this writing, ported here
// directly rather than depending on that PR landing first, since the app
// repo's ci-tests.yml isn't touched by this change).
//
// - Count main-frame `load` events, not `framenavigated` (which also fires
//   for history/hash changes that aren't a real reload).
// - After the first load, count requests to the two board-data endpoints;
//   more than one refetch means something is looping.
// - Sample the kanban column titles every 250ms for a window to catch
//   columns disappearing and reappearing (a symptom of a refetch loop even
//   when the final DOM state looks fine).
export type LoopGuard = {
  loads: number
  boardFetches: number
  stop: () => void
}

const BOARD_DATA_PATHS = new Set(['/api/projects/getAll', '/api/projects/boardTasks'])

export function watchForLoops(page: Page): LoopGuard {
  const guard: LoopGuard = { loads: 0, boardFetches: 0, stop: () => {} }

  const onLoad = () => {
    guard.loads++
  }
  const onRequest = (request: import('@playwright/test').Request) => {
    if (guard.loads === 0) return
    let pathname: string
    try {
      pathname = new URL(request.url()).pathname
    } catch {
      return
    }
    if (BOARD_DATA_PATHS.has(pathname)) guard.boardFetches++
  }

  page.on('load', onLoad)
  page.on('request', onRequest)
  guard.stop = () => {
    page.off('load', onLoad)
    page.off('request', onRequest)
  }
  return guard
}

// Samples a selector's count/visibility every 250ms for `durationMs`,
// failing fast the moment a board that had columns loses them. Used for
// journeys that open a real kanban board (open-board, switch-boards).
export async function assertColumnsStayVisible(
  page: Page,
  columnSelector: string,
  durationMs: number,
): Promise<void> {
  const columns = page.locator(columnSelector)
  const initialCount = await columns.count()
  expect(initialCount, `no "${columnSelector}" columns present to watch`).toBeGreaterThan(0)

  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    const count = await columns.count()
    expect(count, `board lost columns (had ${initialCount}, now ${count})`).toBeGreaterThanOrEqual(initialCount)
    if (count > 0) {
      expect(await columns.first().isVisible(), 'board columns became hidden').toBe(true)
    }
    await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())))
  }
}

export function assertNoLoop(guard: LoopGuard, label: string): void {
  expect(guard.loads, `${label} reloaded ${guard.loads} times (expected at most 1)`).toBeLessThanOrEqual(1)
  expect(guard.boardFetches, `${label} refetched board data ${guard.boardFetches} times after load (expected at most 1)`).toBeLessThanOrEqual(1)
}
