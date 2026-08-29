import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import { deliverWebhook } from '@/lib/mcp/webhooks/delivery'

/**
 * POST /api/mcp/webhooks/{id}/test
 * Send a signed test ping to a subscription's URL and report whether the
 * receiver answered 2xx. Access-scoped by board. Awaits delivery (unlike the
 * fire-and-forget event emit) so the caller gets an immediate result.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    }

    const sub = await prisma.webhookSubscription.findFirst({
      where: { id, project: getProjectWhere(ctx.user.id, ctx.agentId) },
      select: { id: true, url: true, secret: true, projectId: true, active: true },
    })
    if (!sub) {
      return NextResponse.json(
        { success: false, error: 'Subscription not found or access denied' },
        { status: 404 }
      )
    }

    const delivered = await deliverWebhook(sub, {
      event: 'ping',
      data: {
        projectId: sub.projectId,
        message: 'Test ping from Hypertask',
      },
    })

    return NextResponse.json({ success: true, delivered })
  } catch (error) {
    console.error('[MCP Webhooks] test error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
