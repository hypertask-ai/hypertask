import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isPlatformGatewayAdmin } from '@/lib/auth/platformGatewayAdmin'
import { verifyOAuthTokens } from '@/lib/auth/oauthTokenSweep'
import { checkMcpRateLimit, extractBearerToken, isManagementKeyToken, validateManagementOrSessionAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const inputSchema = z.object({ mode: z.enum(['dry-run', 'verify']).default('dry-run') }).strict()

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) {
      rateLimited.headers.set('Cache-Control', 'no-store')
      return NextResponse.json({ error: 'rate_limited' }, { status: rateLimited.status, headers: rateLimited.headers })
    }
    const bearer = extractBearerToken(request.headers.get('authorization'))
    if (!bearer || !isManagementKeyToken(bearer)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
    }
    const ctx = await validateManagementOrSessionAuth(request, 'write')
    if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers })
    if (ctx.agentId || !ctx.management || ctx.management.teamId || !isPlatformGatewayAdmin(ctx.user)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403, headers })
    }
    const input = inputSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers })
    return NextResponse.json(await verifyOAuthTokens(prisma), { headers })
  } catch {
    return NextResponse.json({ error: 'oauth_token_verification_failed' }, { status: 500, headers })
  }
}
