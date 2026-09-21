import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
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

/**
 * GET /api/mcp/agents/analytics?project_id=&since=ISO
 * Per-agent throughput on a board: how many tasks each agent owns, split into
 * done (in a done-role column) vs still-open. Read-only over existing task data.
 * project_id is access-scoped.
 *
 * Note: fix-rate / revert-rate and cost-per-agent need richer history + per-agent
 * cost attribution that isn't recorded yet (tracked as follow-ups), so they are
 * intentionally not reported here rather than faked.
 */
export async function GET(request: NextRequest) {
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
      where: { id: projectId, ...getProjectWhere(ctx.user.id, ctx.agentId) },
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

    // One row per (agent, section) — bounded by agents x columns, so no unbounded
    // task load. Finished columns are resolved once from this board's sections.
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

    // Attach display names for the agents that appeared.
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
}
