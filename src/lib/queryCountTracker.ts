import { AsyncLocalStorage } from "node:async_hooks"

export const N1_QUERY_WARNING_THRESHOLD = 10

type QueryCountState = { count: number; origin: string }

const queryCountStorage = new AsyncLocalStorage<QueryCountState>()

function callSiteOrigin(): string {
  const frames = (new Error().stack ?? "").split("\n").slice(1)
  const frame = frames.find(
    (line) => !line.includes("node_modules") && !line.includes("queryCountTracker"),
  )
  return frame?.trim() ?? "unknown"
}

export function trackPrismaQuery(model: string | undefined): void {
  let state = queryCountStorage.getStore()
  if (!state) {
    state = { count: 0, origin: callSiteOrigin() }
    queryCountStorage.enterWith(state)
  }
  state.count += 1
  if (state.count === N1_QUERY_WARNING_THRESHOLD + 1) {
    console.warn(
      `[n+1-detector] ${state.count}+ Prisma queries in one request chain (model=${model ?? "?"}) from ${state.origin}`,
    )
  }
}
