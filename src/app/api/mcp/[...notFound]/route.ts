import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'
import {
  checkMcpRateLimit,
  mcpUnauthorizedResponse,
  validateMcpAuth,
} from '@/lib/mcp/auth'

// Catch-all for unmatched /api/mcp/* paths. Without this, an unknown path (e.g.
// /api/mcp/tasks/3960, which is not a real route) falls through to the page
// renderer and returns the app HTML with a 200 — which looks like a bot
// challenge to API clients. Next matches static and named-dynamic routes before
// this catch-all, so every real MCP endpoint is unaffected. (HTPR-4487)
async function notFound(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited

  const ctx = await validateMcpAuth(request)
  if (!ctx) return await mcpUnauthorizedResponse(request)

  return NextResponse.json({ error: 'not found' }, { status: 404 })
}

export const GET = wrapMcpRoute(notFound)
export const POST = wrapMcpRoute(notFound)
export const PUT = wrapMcpRoute(notFound)
export const PATCH = wrapMcpRoute(notFound)
export const DELETE = wrapMcpRoute(notFound)
export const HEAD = wrapMcpRoute(notFound)
export const OPTIONS = wrapMcpRoute(notFound)
