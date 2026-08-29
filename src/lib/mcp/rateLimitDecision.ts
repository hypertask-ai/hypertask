export const MCP_RATE_LIMIT_WINDOW_SECONDS = 60

/**
 * Pure fixed-window decision: given the request count already seen in the current
 * window, is this request over the limit, and if so how long until the window
 * resets. Kept dependency-free so it's cheap to unit test.
 */
export function decideMcpRateLimit(
  countInWindow: number,
  limit: number,
  windowStartSeconds: number,
  nowSeconds: number,
  windowSeconds: number = MCP_RATE_LIMIT_WINDOW_SECONDS
): { limited: boolean; retryAfterSeconds: number } {
  const limited = countInWindow > limit
  const retryAfterSeconds = Math.max(windowStartSeconds + windowSeconds - nowSeconds, 1)
  return { limited, retryAfterSeconds: limited ? retryAfterSeconds : 0 }
}
