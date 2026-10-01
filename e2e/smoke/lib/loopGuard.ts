import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

// Same counting approach as HTPR-6620's browser-smoke check (open PR #744,
// hypertask-ai/hypertask, not merged as of this writing, ported here
// directly rather than depending on that PR landing first, since the app
// repo's ci-tests.yml isn't touched by this change).
//
// - Count main-frame `load` events, not `framenavigated` (which also fires
//   for history/hash changes that aren't a real reload).
// - After the first load, count requests to each of the two board-data
//   endpoints; more than one refetch of either means something is looping.
//   The live app refetches getAll and boardTasks once each right after
//   hydration (checked on the first real run, HTPR-6636), which is one
//   refetch, not a loop.
// - Sample the kanban column titles every 250ms for a window to catch
//   columns disappearing and reappearing (a symptom of a refetch loop even
//   when the final DOM state looks fine).
export type LoopGuard = {
  loads: number
  boardFetches: number
  fetchesByPath: Record<string, number>
  stop: () => void
}

const BOARD_DATA_PATHS = new Set(['/api/projects/getAll', '/api/projects/boardTasks'])
const TASKS_HYDRATED_SELECTOR = '[data-board-tasks-hydrated="true"]'
const HIDDEN_EMPTY_COLUMNS_HEADING = /^All columns are empty and hidden$/

export function watchForLoops(page: Page): LoopGuard {
  const guard: LoopGuard = { loads: 0, boardFetches: 0, fetchesByPath: {}, stop: () => {} }

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
    if (!BOARD_DATA_PATHS.has(pathname)) return
    guard.fetchesByPath[pathname] = (guard.fetchesByPath[pathname] ?? 0) + 1
    guard.boardFetches = Math.max(...Object.values(guard.fetchesByPath))
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
  readinessTimeoutMs = 20_000,
): Promise<void> {
  const columns = page.locator(columnSelector)
  const tasksHydrated = page.locator(TASKS_HYDRATED_SELECTOR)
  const hiddenEmptyState = page.getByRole('heading', { name: HIDDEN_EMPTY_COLUMNS_HEADING }).first()

  let hydratedColumnCount = 0
  let isIntentionalEmptyBoard = false
  await expect.poll(
    async () => {
      if ((await tasksHydrated.count()) === 0) return false

      hydratedColumnCount = await columns.count()
      isIntentionalEmptyBoard =
        hydratedColumnCount === 0 && await hiddenEmptyState.isVisible()
      return hydratedColumnCount > 0 || isIntentionalEmptyBoard
    },
    {
      message: `board did not render "${columnSelector}" columns or its intentional empty state`,
      timeout: readinessTimeoutMs,
    },
  ).toBe(true)

  // The empty-state heading may briefly coexist with attached columns.
  // Treat it as valid only when there are no columns to hide.
  if (isIntentionalEmptyBoard) {
    const emptyStateDeadline = Date.now() + durationMs
    while (Date.now() < emptyStateDeadline) {
      expect(await columns.count(), 'hidden empty board unexpectedly rendered columns').toBe(0)
      expect(await hiddenEmptyState.isVisible(), 'hidden empty board lost its empty state').toBe(true)
      await page.waitForTimeout(Math.min(250, Math.max(0, emptyStateDeadline - Date.now())))
    }
    return
  }

  const initialCount = hydratedColumnCount
  expect(await columns.first().isVisible(), 'board columns became hidden').toBe(true)

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
  expect(
    guard.boardFetches,
    `${label} refetched board data after load ${JSON.stringify(guard.fetchesByPath)} (expected at most 1 per endpoint)`,
  ).toBeLessThanOrEqual(1)
}
