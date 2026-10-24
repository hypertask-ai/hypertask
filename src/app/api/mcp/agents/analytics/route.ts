import { isFeatureEnabled, isFeatureFlagOwnerUserId } from '@/lib/flags'
import { HTPR_7742_AGENT_CHAT_ALL_FLAG } from '@/lib/flags/definitions/htpr-7742-agent-chat-all'
import { AGENT_CHAT_HEARTBEAT_MAX_AGE_MS } from '@/lib/agents/chatAvailability'
import { noStore } from '@/lib/flags/http'
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import { doneColumnTitles, isDoneColumn } from '@/lib/doneColumns'
import { columnRole } from '@/lib/mcp/boards/columnRole'

const mcpDoneNameFallback = (title: string) => columnRole(title) === 'done'

function validationError(message: string, field?: string) {
  return NextResponse.json(
    { success: false, error: message, code: 'invalid_field', ...(field ? { field } : {}) },
    { status: 400 }
  )
}

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
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

    const sp = request.nextUrl.searchParams
    if (sp.get('chat') === 'true') {
      if (ctx.agentId || ctx.management || !(await isFeatureFlagOwnerUserId(ctx.user.id))) {
        return noStore({ success: false, error: 'Forbidden' }, 403)
      }
      if (!(await isFeatureEnabled(HTPR_7742_AGENT_CHAT_ALL_FLAG, ctx.user.id))) {
        return noStore({ success: false, error: 'Chat measurement is not enabled' }, 404)
      }
      const now = new Date()
      const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const [activeWebhookWithoutChat, freshHeartbeat, unanswered] = await Promise.all([
        prisma.agent.count({ where: {
          revokedAt: null, archivedAt: null,
          agentWebhookSubscription: { is: { active: true, NOT: { events: { has: 'chat.message' } } } },
        } }),
        prisma.agent.count({ where: {
          revokedAt: null, archivedAt: null,
          heartbeatAt: { gt: new Date(now.getTime() - AGENT_CHAT_HEARTBEAT_MAX_AGE_MS) },
        } }),
        prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count
          FROM "ChatMessage" message
          JOIN "ChatSession" session ON session.id = message."sessionId"
          WHERE session."agentId" IS NOT NULL
            AND message.role = 'human'::"ChatRole"
            AND message."createdAt" >= ${since}
            AND NOT EXISTS (
              SELECT 1 FROM "ChatMessage" reply WHERE reply."replyToMessageId" = message.id
            )
        `,
      ])
      return noStore({ success: true, activeWebhookWithoutChat, freshHeartbeat,
        unansweredLast7Days: Number(unanswered[0].count), since: since.toISOString(), asOf: now.toISOString() })
    }
    const projectId = Number(sp.get('project_id'))
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      return validationError('project_id is required', 'project_id')
    }
    let since: Date | undefined
    const sinceRaw = sp.get('since')
    if (sinceRaw) {
      const d = new Date(sinceRaw)
      if (Number.isNaN(d.getTime())) return validationError('since must be an ISO date', 'since')
      since = d
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, ...getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
      select: {
        id: true,
        section: {
          where: { deleted: false },
          select: { section_title: true, isDone: true },
        },
      },
    })
    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    const rows = await prisma.task.groupBy({
      by: ['agentId', 'section'],
      where: {
        projectId,
        agentId: { not: null },
        status: { not: 'Deleted' },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _count: { _all: true },
    })

    const resolvedDoneTitles = doneColumnTitles(project.section, mcpDoneNameFallback)
    const perAgent = new Map<string, { agentId: string; tasksTotal: number; tasksDone: number; tasksOpen: number }>()
    for (const r of rows) {
      const agentId = r.agentId
      if (!agentId) continue
      const count = r._count._all
      const done = isDoneColumn(r.section, resolvedDoneTitles, mcpDoneNameFallback)
      const a = perAgent.get(agentId) ?? { agentId, tasksTotal: 0, tasksDone: 0, tasksOpen: 0 }
      a.tasksTotal += count
      if (done) a.tasksDone += count
      else a.tasksOpen += count
      perAgent.set(agentId, a)
    }

    const agentIds = [...perAgent.keys()]
    const agents = agentIds.length
      ? await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, displayName: true },
        })
      : []
    const nameById = new Map(agents.map((a) => [a.id, a.displayName]))

    const fleet = [...perAgent.values()]
      .map((a) => ({ ...a, displayName: nameById.get(a.agentId) ?? null }))
      .sort((x, y) => y.tasksDone - x.tasksDone || y.tasksTotal - x.tasksTotal)

    return NextResponse.json({
      success: true,
      projectId,
      agentCount: fleet.length,
      fleet,
    })
  } catch (error) {
    console.error('[MCP Agent Analytics] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }

  })(request)
}
