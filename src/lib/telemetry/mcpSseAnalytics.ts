import { waitUntil } from '@vercel/functions'
import { randomUUID } from 'node:crypto'
import { postHogClient } from './signupAnalytics'

export function recordLegacyMcpRequest(
  request: Request,
  userId: number | undefined,
  timestamp: Date,
): void {
  try {
    const endpoint = new URL(request.url).pathname.replace(/\/$/, '')
    if (endpoint !== '/sse' && endpoint !== '/message') return
    const client = postHogClient()
    if (!client) return

    // Keep ingestion alive after the response without delaying the SSE stream.
    const capture = client.captureImmediate({
      distinctId: userId === undefined ? `mcp-sse-anonymous:${randomUUID()}` : String(userId),
      event: 'mcp_legacy_sse_request',
      timestamp,
      properties: {
        endpoint,
        user_id: userId ?? null,
        user_agent: request.headers.get('user-agent'),
        timestamp: timestamp.toISOString(),
        method: request.method,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
        $process_person_profile: false,
      },
    }).catch(() => {
      console.warn('[mcp-sse-analytics] PostHog capture failed')
    })
    waitUntil(capture)
  } catch {
    console.warn('[mcp-sse-analytics] PostHog capture could not be scheduled')
  }
}
