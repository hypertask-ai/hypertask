import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, mcpUnauthorizedResponse, validateMcpAuth } from '@/lib/mcp/auth'
import { findTaskByIdentifier, TaskIdentifierAmbiguityError } from '@/lib/mcp/tasks/resolveTask'
import { isFeatureEnabled } from '@/lib/flags'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const noStore = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return await mcpUnauthorizedResponse(request)
    if (!(await isFeatureEnabled('yper4-123-board-check', ctx.user.id))) {
      return noStore({ success: false, error: 'Not found' }, 404)
    }

    const identifier = (await params).taskId.trim()
    const rawLimit = request.nextUrl.searchParams.get('limit') ?? '20'
    const limit = Number(rawLimit)
    if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit < 1) {
      return noStore({ success: false, error: 'limit must be a positive integer' }, 400)
    }
    const numericId = Number(identifier)
    const ticketNumber = /^[A-Za-z][A-Za-z0-9_-]*-\d+$/.test(identifier)
    if (!ticketNumber && (!/^\d+$/.test(identifier) || !Number.isSafeInteger(numericId) || numericId < 1)) {
      return noStore({ success: false, error: 'Invalid task identifier' }, 400)
    }
    const task = await findTaskByIdentifier(
      ctx.user,
      ticketNumber ? { ticket_number: identifier.toUpperCase() } : { task_id: numericId },
      ctx.agentId,
    )
    if (!task) return noStore({ success: false, error: 'Task not found or access denied' }, 404)

    const agentId = request.nextUrl.searchParams.get('agent_id')
    if (agentId !== null && !agentId.trim()) {
      return noStore({ success: false, error: 'agent_id must not be empty' }, 400)
    }
    const rows = await prisma.agentRunActivity.findMany({
      where: { run: { taskId: task.id, ...(agentId ? { agentId } : {}) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(limit, 100),
      select: {
        runId: true,
        type: true,
        text: true,
        createdAt: true,
        run: { select: { agentId: true, agent: { select: { displayName: true } } } },
      },
    })
    return noStore({
      success: true,
      activities: rows.map((row) => ({
        agentId: row.run.agentId,
        agentName: row.run.agent.displayName,
        runId: row.runId,
        type: row.type.toLowerCase(),
        text: row.text,
        createdAt: row.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof TaskIdentifierAmbiguityError) {
      return noStore({ success: false, error: error.message }, 400)
    }
    console.error('[MCP] task agent activity read failed', error)
    return noStore({ success: false, error: 'Failed to read task agent activity' }, 500)
  }
}
