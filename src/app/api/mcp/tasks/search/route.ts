import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import type { McpAgentSummary } from '@/lib/mcp/agents'
import { mapVisibleMcpAgent, mcpVisibleAgentSelect } from '@/lib/mcp/agents'
import prisma from '@/lib/prisma'
import { turbopufferSearchTaskIds } from '@/utils/controllers/search/document'
import { HTPR_6530_MCP_LIST_QUERY_FLAG, isFeatureEnabled } from '@/lib/flags'
import {
  hasPrWhere,
  parseListQueryFromSearchParams,
  projectRows,
  taskUrlFromListItem,
} from '@/lib/mcp/listQuery'

export interface TaskSearchItem {
  id: number
  ticketNumber?: string
  uniqueIndex?: number
  title: string
  description: string
  boardId: number
  boardTitle: string
  projectId: number
  section: string
  dueDate?: string
  createdAt: string
  agent?: McpAgentSummary
}

export interface SearchTasksResponse {
  success: boolean
  tasks: TaskSearchItem[]
  total: number
  boardId?: number
}

/**
 * GET /api/mcp/tasks/search
 *
 * Searches for tasks by name, description, or ticket number. Uses Turbopuffer
 * when available for full-text ranking, with Prisma fallback.
 * Results are limited to boards/projects the user has access to.
 */
export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.'
        },
        { status: 401 }
      )
    }
    const user = ctx.user;
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const listQueryEnabled = await isFeatureEnabled(HTPR_6530_MCP_LIST_QUERY_FLAG, user.id)
    const listQuery = listQueryEnabled ? parseListQueryFromSearchParams(searchParams) : null
    const query = searchParams.get('q') ?? searchParams.get('query') ?? listQuery?.query
    const boardId = searchParams.get('board_id') ? parseInt(searchParams.get('board_id')!) : null
    const projectId = searchParams.get('project_id') ? parseInt(searchParams.get('project_id')!) : null
    let assignedTo = searchParams.get('assigned_to') || undefined
    const priorityParam = searchParams.get('priority')
    let section = searchParams.get('section') || undefined
    const hasDueDate = searchParams.get('has_due_date') ? searchParams.get('has_due_date') === 'true' : undefined
    let status = (searchParams.get('status') as 'Normal' | 'Archive') || 'Normal'
    let limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)
    if (listQuery?.filter.section) section = listQuery.filter.section
    if (listQuery?.filter.assignee !== undefined) assignedTo = String(listQuery.filter.assignee)
    if (listQuery?.filter.status) status = listQuery.filter.status as typeof status
    if (listQuery?.limit) limit = listQuery.limit
    const labelsParam = listQuery?.filter.label
      ? Array.isArray(listQuery.filter.label)
        ? listQuery.filter.label
        : [listQuery.filter.label]
      : []
    const updatedSince = listQuery?.filter.updated_since

    if (!query || query.length > 200) {
      return NextResponse.json(
        {
          success: false,
          error: 'Search query is required and must be 200 characters or less'
        },
        { status: 400 }
      )
    }

    // Get user's accessible projects
    const accessibleProjects = await prisma.project.findMany({
      where: {
        status: 'Normal',
        ...getProjectWhere(user.id, ctx.agentId),
      },
      select: { id: true }
    })
    const accessibleProjectIds = accessibleProjects.map(p => p.id)

    if (accessibleProjectIds.length === 0) {
      return NextResponse.json({
        success: true,
        tasks: [],
        total: 0
      })
    }

    // Build where clause
    const where: any = {
      projectId: { in: accessibleProjectIds },
      status
    }

    // Filter by project/board
    const targetProjectId = projectId ?? boardId
    if (targetProjectId != null) {
      if (accessibleProjectIds.includes(targetProjectId)) {
        where.projectId = targetProjectId
      } else {
        return NextResponse.json({
          success: false,
          error: 'Project not found or access denied'
        }, { status: 403 })
      }
    }

    // Filter by section
    if (section) {
      where.section = section
    }
    if (labelsParam.length > 0) {
      where.taskLabels = {
        some: {
          label: { value: { in: labelsParam } },
        },
      }
    }
    if (updatedSince) {
      const since = new Date(updatedSince)
      if (!Number.isNaN(since.getTime())) {
        where.updatedAt = { gte: since }
      }
    }
    if (listQuery?.filter.has_pr) {
      const prWhere = hasPrWhere(listQuery.filter.has_pr)
      if (prWhere) Object.assign(where, prWhere)
    }

    // Filter by assignee
    if (assignedTo) {
      if (assignedTo === 'me') {
        where.assignees = { some: { userId: user.id } }
      } else if (assignedTo === 'unassigned') {
        where.assignees = { none: {} }
      } else {
        const userId = parseInt(assignedTo)
        if (!isNaN(userId)) {
          where.assignees = { some: { userId } }
        }
      }
    }

    // Filter by priority
    if (priorityParam) {
      const priorities = Array.isArray(priorityParam) ? priorityParam : [priorityParam]
      where.priority = {
        Priority_Value: { in: priorities }
      }
    }

    // Filter by due date
    if (hasDueDate !== undefined) {
      if (hasDueDate) {
        where.dueDate = { not: null }
      } else {
        where.dueDate = null
      }
    }

    // Prefer Turbopuffer for full-text search (relevance, description)
    const turbopufferIds = await turbopufferSearchTaskIds({
      searchQuery: query,
      projectIds: accessibleProjectIds,
      status,
      projectId: targetProjectId ?? undefined,
      perPage: Math.min(limit * 5, 100),
    })

    if (turbopufferIds.length > 0) {
      where.id = { in: turbopufferIds }
    } else {
      // Fallback: Prisma-only text search when Turbopuffer is unavailable or returns nothing
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { ticketNumber: { contains: query, mode: 'insensitive' } }
      ]
    }

    // Get total count
    const total = await prisma.task.count({ where })

    // Get tasks (preserve Turbopuffer order when applicable)
    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        ticketNumber: true,
        uniqueIndex: true,
        title: true,
        description: true,
        section: true,
        projectId: true,
        project: {
          select: {
            id: true,
            title: true
          }
        },
        dueDate: true,
        createdAt: true,
        agent: {
          select: mcpVisibleAgentSelect(user.id),
        },
      },
      ...(turbopufferIds.length > 0
        ? {}
        : { orderBy: { updatedAt: 'desc' as const }, take: limit }),
    })

    const orderedTasks =
      turbopufferIds.length > 0
        ? turbopufferIds
            .map((id) => tasks.find((t) => t.id === id))
            .filter((t): t is NonNullable<typeof t> => t != null)
            .slice(0, limit)
        : tasks

    // Transform to response format
    const taskList: TaskSearchItem[] = orderedTasks.map(task => {
      const agent = mapVisibleMcpAgent(task.agent, user.id, task.projectId)
      return {
        id: task.id,
        ticketNumber: task.ticketNumber || undefined,
        uniqueIndex: task.uniqueIndex,
        title: task.title,
        description: task.description,
        boardId: task.projectId,
        boardTitle: task.project.title || '',
        projectId: task.projectId,
        section: task.section,
        dueDate: task.dueDate?.toISOString() || undefined,
        createdAt: task.createdAt.toISOString(),
        ...(agent ? { agent } : {}),
      }
    })

    if (listQueryEnabled) {
      for (const task of taskList) {
        const url = taskUrlFromListItem(task)
        if (url) (task as TaskSearchItem & { url?: string }).url = url
      }
    }

    const response: SearchTasksResponse = {
      success: true,
      tasks: (listQuery?.fields.length
        ? projectRows(taskList as Array<Record<string, unknown>>, listQuery.fields)
        : taskList) as TaskSearchItem[],
      total,
      boardId: boardId || projectId || undefined
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error searching tasks:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
