import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes"
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, mcpRouteUnauthorizedResponse as mcpUnauthorizedResponse, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { findTaskByIdentifier, taskIdentifierErrorResponse } from '@/lib/mcp/tasks/resolveTask'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const cursorSchema = z.tuple([z.string().datetime(), z.string().uuid()])

const noStore = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return await mcpUnauthorizedResponse(request)

    const identifier = (await params).taskId.trim()
    const rawLimit = request.nextUrl.searchParams.get('limit') ?? '20'
    const limit = Number(rawLimit)
    if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit < 1) {
      return noStore({ success: false, error: 'limit must be a positive integer' }, 400)
    }
    const rawCursor = request.nextUrl.searchParams.get('cursor')
    let cursor: z.infer<typeof cursorSchema> | null = null
    if (rawCursor !== null) {
      try {
        if (rawCursor.length > 512) throw new Error('Cursor too long')
        cursor = cursorSchema.parse(JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')))
      } catch {
        return noStore({ success: false, error: 'Invalid activity cursor' }, 400)
      }
    }
    const numericId = Number(identifier)
    const ticketNumber = /^[A-Za-z][A-Za-z0-9_-]*-\d+$/.test(identifier)
    if (!ticketNumber && (!/^\d+$/.test(identifier) || !Number.isSafeInteger(numericId) || numericId < 1)) {
      return noStore({ success: false, error: 'Invalid task identifier' }, 400)
    }
    const task = await findTaskByIdentifier(
      ctx.user,
      ticketNumber ? { ticket_number: identifier.toUpperCase() } : { task_id: numericId },
      ctx.agentId, undefined, ctx.teamScope
    )
    if (!task) return noStore({ success: false, error: 'Task not found or access denied' }, 404)

    const agentId = request.nextUrl.searchParams.get('agent_id')
    if (agentId !== null && !agentId.trim()) {
      return noStore({ success: false, error: 'agent_id must not be empty' }, 400)
    }
    const pageSize = Math.min(limit, 100)
    const rows = await prisma.agentRunActivity.findMany({
      where: { ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor[0]) } },
        { createdAt: new Date(cursor[0]), id: { lt: cursor[1] } }] } : {}), run: { taskId: task.id, ...(ctx.teamScope != null ? { task: { project: projectContentAccessWhere(ctx.user.id, ctx.agentId, ctx.teamScope) } } : {}), ...(agentId ? { agentId } : {}) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      select: {
        id: true,
        runId: true,
        type: true,
        text: true,
        createdAt: true,
        run: { select: { agentId: true, agent: { select: { displayName: true } } } },
      },
    })
    const page = rows.slice(0, pageSize)
    const last = page.at(-1)
    return noStore({
      success: true,
      nextCursor: rows.length > pageSize && last
        ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url')
        : null,
      activities: page.map((row) => ({
        id: row.id,
        agentId: row.run.agentId,
        agentName: row.run.agent.displayName,
        runId: row.runId,
        type: row.type.toLowerCase(),
        text: row.text,
        createdAt: row.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    const identifierResponse = taskIdentifierErrorResponse(error)
    if (identifierResponse) {
      identifierResponse.headers.set('Cache-Control', 'private, no-store')
      return identifierResponse
    }
    console.error('[MCP] task agent activity read failed', error)
    return noStore({ success: false, error: 'Failed to read task agent activity' }, 500)
  }

  })(request)
}
