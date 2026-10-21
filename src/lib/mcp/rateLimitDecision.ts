export const MCP_RATE_LIMIT_WINDOW_SECONDS = 60

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
