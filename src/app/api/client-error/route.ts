import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const cap = (v: unknown, n: number) =>
  typeof v === 'string' ? v.slice(0, n) : undefined

// Receives client crash beacons and logs them into Vercel's runtime logs.
// Search the Vercel dashboard (or `vercel logs`) for "[client-crash]".
// ponytail: log-only. Add a DB table / Sentry if we need retention or alerting.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    let userId: number | undefined
    try {
      const raw = req.cookies.get('nookies_user')?.value
      if (raw) userId = JSON.parse(raw)?.id
    } catch {
      // ignore malformed cookie
    }
    console.error(
      '[client-crash]',
      JSON.stringify({
        source: cap(body?.source, 40) ?? 'unknown',
        message: cap(body?.message, 500),
        url: cap(body?.url, 300),
        userId,
        digest: cap(body?.digest, 60),
        ua: req.headers.get('user-agent')?.slice(0, 200),
        stack: cap(body?.stack, 2000),
        componentStack: cap(body?.componentStack, 2000),
      })
    )
  } catch {
    // never let telemetry throw
  }
  return new NextResponse(null, { status: 204 })
}
