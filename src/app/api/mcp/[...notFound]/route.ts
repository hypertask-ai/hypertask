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

export const GET = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound
export const HEAD = notFound
export const OPTIONS = notFound
