import { NextRequest, NextResponse } from 'next/server'
import { createUnauthorizedResponse } from '@/lib/mcp/auth'
import { getFeatureCatalog } from '@/lib/mcp/featureCatalog'
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import {
  wrapMcpRoute,
  validateMcpRouteAuth as validateMcpAuth,
  checkMcpRouteRateLimit as checkMcpRateLimit,
} from '@/lib/mcp/routeWrapper'

export const GET = wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return createUnauthorizedResponse('Invalid or missing authentication token.', 'invalid_token')

    return NextResponse.json({
      success: true,
      scope: 'Available product features with verified destinations; not an exhaustive list of capabilities. Availability is for the authenticated user, not a mentioned recipient.',
      features: await getFeatureCatalog(ctx.user.id),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[MCP Features] Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
})
