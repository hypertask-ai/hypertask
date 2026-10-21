import { waitUntil } from '@vercel/functions'
import type { NextApiRequest } from 'next'
import { postHogClient } from './signupAnalytics'

export function reportLegacyRouteHit(route: string, req: NextApiRequest): void {
  try {
    console.warn(`legacy route hit: ${route}`)
    const client = postHogClient()
    if (!client) return

    const capture = client.captureImmediate({
      distinctId: `legacy-route:${route}`,
      event: 'legacy_route_hit',
      properties: {
        route,
        method: req.method ?? null,
        user_agent: req.headers['user-agent'] ?? null,
        referer: req.headers.referer ?? null,
        has_authorization: Boolean(req.headers.authorization),
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
        $process_person_profile: false,
      },
    }).catch(() => {
      console.warn('[legacy-route-analytics] PostHog capture failed')
    })
    waitUntil(capture)
  } catch {
    console.warn('[legacy-route-analytics] PostHog capture could not be scheduled')
  }
}
