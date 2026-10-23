import { NextRequest, NextResponse } from 'next/server'
import { hasValidCronAuthorization } from '@/lib/cronAuthorization'
import { sweepOAuthTokens } from '@/lib/auth/oauthTokenSweep'
import prisma from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!hasValidCronAuthorization(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
  }
  try {
    return NextResponse.json(await sweepOAuthTokens(prisma), { headers })
  } catch {
    return NextResponse.json({ error: 'oauth_token_sweep_failed' }, { status: 500, headers })
  }
}
