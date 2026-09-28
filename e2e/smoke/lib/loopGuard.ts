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
// - Sample the rendered board every 250ms for a window to catch it going
//   blank after its tasks hydrate. Before hydration, project metadata can
//   briefly render columns with no task data and then replace them.
export type LoopGuard = {
  loads: number
  boardFetches: number
  fetchesByPath: Record<string, number>
  stop: () => void
}

export type BoardVisibilityState = {
  columnCount: number
  firstColumnVisible: boolean
  hiddenEmptyStateVisible: boolean
}

export function isVisibleBoardState(state: BoardVisibilityState): boolean {
  return state.hiddenEmptyStateVisible || (state.columnCount > 0 && state.firstColumnVisible)
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

// Samples a board every 250ms for `durationMs`, failing fast if neither its
// columns nor its deliberate empty-state UI is visible. Used for journeys
// that open a real kanban board (open-board, switch-boards).
export async function assertColumnsStayVisible(
  page: Page,
  columnSelector: string,
  durationMs: number,
): Promise<void> {
  const columns = page.locator(columnSelector)
  const tasksHydrated = page.locator(TASKS_HYDRATED_SELECTOR)
  const hiddenEmptyState = page.getByRole('heading', { name: HIDDEN_EMPTY_COLUMNS_HEADING }).first()
  const readState = async (): Promise<BoardVisibilityState> => {
    const columnCount = await columns.count()
    return {
      columnCount,
      firstColumnVisible: columnCount > 0 && await columns.first().isVisible(),
      hiddenEmptyStateVisible: await hiddenEmptyState.isVisible(),
    }
  }

  await expect.poll(
    async () => (await tasksHydrated.count()) > 0,
    { message: 'board tasks did not finish hydrating', timeout: 15_000 },
  ).toBe(true)

  await expect.poll(
    async () => isVisibleBoardState(await readState()),
    { message: `hydrated board rendered neither "${columnSelector}" columns nor its hidden-empty-columns state`, timeout: 15_000 },
  ).toBe(true)

  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    const state = await readState()
    expect(
      isVisibleBoardState(state),
      state.columnCount > 0
        ? 'board columns became hidden'
        : 'board hid all columns without the expected hidden-empty-columns state',
    ).toBe(true)
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
