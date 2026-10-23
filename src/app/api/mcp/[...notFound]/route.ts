import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'
import {
  checkMcpRateLimit,
  mcpUnauthorizedResponse,
  validateMcpAuth,
} from '@/lib/mcp/auth'

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
