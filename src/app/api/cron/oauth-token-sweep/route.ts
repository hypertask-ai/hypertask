import { NextRequest, NextResponse } from 'next/server'
import { hasValidCronAuthorization } from '@/lib/cronAuthorization'
import { sweepOAuthTokens, verifyOAuthTokens } from '@/lib/auth/oauthTokenSweep'
import prisma from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function verifyWhenSwept(remaining: number) {
  if (remaining > 0) return 'pending'
  try {
    return await verifyOAuthTokens(prisma)
  } catch {
    return 'verification_failed'
  }
}

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!hasValidCronAuthorization(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
  }
  try {
    const sweep = await sweepOAuthTokens(prisma)
    console.log('oauth_token_sweep', JSON.stringify({ ...sweep, verify: await verifyWhenSwept(sweep.remaining) }))
    return NextResponse.json(sweep, { headers })
  } catch {
    console.log('oauth_token_sweep', JSON.stringify({ error: 'oauth_token_sweep_failed' }))
    return NextResponse.json({ error: 'oauth_token_sweep_failed' }, { status: 500, headers })
  }
}
