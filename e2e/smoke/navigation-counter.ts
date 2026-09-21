export const NAVIGATION_WATCH_MS = 30_000

export function reloadCount(navigationCount: number): number {
  return Math.max(0, navigationCount - 1)
}
