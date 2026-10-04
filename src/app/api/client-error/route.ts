import { NextRequest, NextResponse } from 'next/server'
import { reportError } from '@/lib/errors/reportError'
import { redactErrorText, safeErrorUrl } from '@/lib/telemetry/errorSanitization'

export const runtime = 'nodejs'

const cap = (v: unknown, n: number) =>
  typeof v === 'string' ? redactErrorText(v, n) : undefined

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const message = cap(body?.message, 500)
    if (message) {
      await reportError({
        message,
        source: 'client',
        stack: cap(body?.stack, 2000),
        url: safeErrorUrl(cap(body?.url, 2048)),
        extra: {
          route: 'client-error',
          digest: cap(body?.digest, 60) ?? null,
          stage: cap(body?.source, 40) ?? 'unknown',
        },
      })
    }
  } catch {
    // Crash beacons must never affect the client response.
  }
  return new NextResponse(null, { status: 204 })
}
