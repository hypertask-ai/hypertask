import { withoutAuth } from "#with-auth";
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

export const GET = withoutAuth(notFound)
export const POST = withoutAuth(notFound)
export const PUT = withoutAuth(notFound)
export const PATCH = withoutAuth(notFound)
export const DELETE = withoutAuth(notFound)
export const HEAD = withoutAuth(notFound)
export const OPTIONS = withoutAuth(notFound)
