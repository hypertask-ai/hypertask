import { logger as htLogger } from "#logger";
import { withoutAuth } from "#with-auth";
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
  normalizeTaskStatus,
  parseAssigneeFilter,
  parseNumericCursor,
  parseUpdatedSince,
  projectRows,
  resolveListLimit,
  withTaskPresentation,
} from '@/lib/mcp/listQuery'
import { readEnabledListQuery } from '@/lib/mcp/readListQuery'

const SEARCH_SORT_FIELDS = ['id', 'createdAt', 'updatedAt', 'title', 'dueDate', 'ticketNumber'] as const
type SearchSortField = (typeof SEARCH_SORT_FIELDS)[number]

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
  url?: string
  link?: {
    url: string
    format: string
    example: string
  }
}

export interface SearchTasksResponse {
  success: boolean
  tasks: TaskSearchItem[]
  total: number
  boardId?: number
  nextCursor?: string | null
}

/**
 * GET /api/mcp/tasks/search
 *
 * Searches for tasks by name, description, or ticket number. Uses Turbopuffer
 * when available for full-text ranking, with Prisma fallback.
 * Results are limited to boards/projects the user has access to.
 */
async function GETHandler(request: NextRequest) {
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
    const parsedListQuery = readEnabledListQuery(listQueryEnabled, searchParams)
    if (parsedListQuery.error) return parsedListQuery.error
    const listQuery = parsedListQuery.listQuery
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
    if (listQuery?.filter.status) {
      const normalizedStatus = normalizeTaskStatus(listQuery.filter.status)
      if (!normalizedStatus || normalizedStatus === 'Deleted') {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation error',
            message: 'filter.status must be open, Normal, or Archive',
          },
          { status: 400 },
        )
      }
      status = normalizedStatus
    }
    if (listQuery) limit = resolveListLimit(listQuery, limit, 50)
    const labelsParam = listQuery?.filter.label
      ? Array.isArray(listQuery.filter.label)
        ? listQuery.filter.label
        : [listQuery.filter.label]
      : []
    const updatedSince = listQuery?.filter.updated_since
    const cursorId = listQuery?.cursor ? parseNumericCursor(listQuery.cursor) : null
    if (listQuery?.cursor && cursorId === null) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'cursor must be a previous nextCursor value',
        },
        { status: 400 },
      )
    }
    const sortField = listQuery?.sortBy
    if (sortField && !SEARCH_SORT_FIELDS.includes(sortField as SearchSortField)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: `sort must be one of ${SEARCH_SORT_FIELDS.join(', ')}`,
        },
        { status: 400 },
      )
    }
    const sortOrder = listQuery?.sortOrder ?? 'asc'

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
      const since = parseUpdatedSince(updatedSince)
      if (!since) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation error',
            message: 'filter.updated_since must be an ISO datetime',
          },
          { status: 400 },
        )
      }
      where.updatedAt = { gte: since }
    }
    if (listQuery?.filter.has_pr) {
      const prWhere = hasPrWhere(listQuery.filter.has_pr)
      if (!prWhere) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation error',
            message: 'filter.has_pr must be red, failing, true, false, open, green, or merged',
          },
          { status: 400 },
        )
      }
      Object.assign(where, prWhere)
    }

    // Filter by assignee
    if (assignedTo) {
      if (listQuery) {
        const assignee = parseAssigneeFilter(assignedTo)
        if (!assignee.ok) {
          return NextResponse.json(
            { success: false, error: 'Validation error', message: assignee.error },
            { status: 400 },
          )
        }
        if (assignee.kind === 'me') {
          where.assignees = { some: { userId: user.id } }
        } else if (assignee.kind === 'unassigned') {
          where.assignees = { none: {} }
        } else {
          // @ts-expect-error kind is ids after me/unassigned
          where.assignees = { some: { userId: { in: assignee.userIds } } }
        }
      } else if (assignedTo === 'me') {
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

    // Prefer Turbopuffer for full-text ranking. Extra filters and explicit
    // sort must run in Prisma so matching rows outside the candidate window
    // are not dropped, and requested order is honored.
    const extraFilters = Boolean(
      section ||
        labelsParam.length > 0 ||
        updatedSince ||
        listQuery?.filter.has_pr ||
        listQuery?.filter.assignee !== undefined,
    )
    const turbopufferIds = await turbopufferSearchTaskIds({
      searchQuery: query,
      projectIds: accessibleProjectIds,
      status,
      projectId: targetProjectId ?? undefined,
      perPage: Math.min(limit * 5, 100),
    })
    const useTurbopufferWindow =
      turbopufferIds.length > 0 && !extraFilters && !sortField

    if (useTurbopufferWindow) {
      where.id = { in: turbopufferIds }
    } else {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { ticketNumber: { contains: query, mode: 'insensitive' } }
      ]
    }

    // Count the complete filtered candidate set before applying a cursor window.
    const total = await prisma.task.count({ where })
    if (useTurbopufferWindow && cursorId) {
      const start = turbopufferIds.indexOf(cursorId)
      if (start < 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation error',
            message: 'cursor must be a previous nextCursor value',
          },
          { status: 400 },
        )
      }
      where.id = { in: turbopufferIds.slice(start + 1) }
    }

    const orderBy = sortField
      ? [{ [sortField]: sortOrder }, { id: 'asc' as const }]
      : useTurbopufferWindow
        ? undefined
        : [{ updatedAt: 'desc' as const }, { id: 'asc' as const }]

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
        updatedAt: true,
        agent: {
          select: mcpVisibleAgentSelect(user.id),
        },
      },
      ...(orderBy ? { orderBy } : {}),
      ...(useTurbopufferWindow
        ? {}
        : {
            take: limit,
            skip: cursorId ? 1 : 0,
            ...(cursorId ? { cursor: { id: cursorId } } : {}),
          }),
    })

    const orderedTasks = useTurbopufferWindow
      ? turbopufferIds
          .map((id) => tasks.find((task) => task.id === id))
          .filter((task): task is NonNullable<typeof task> => task != null)
          .slice(0, limit)
      : tasks

    const nextCursor =
      orderedTasks.length === limit
        ? String(orderedTasks[orderedTasks.length - 1]?.id ?? '')
        : null

    // Transform to response format
    const taskList: TaskSearchItem[] = orderedTasks.map(task => {
      const agent = mapVisibleMcpAgent(task.agent, user.id, task.projectId)
      const item: TaskSearchItem = {
        id: task.id,
        ticketNumber: task.ticketNumber || undefined,
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
      return listQueryEnabled
        ? withTaskPresentation({ ...item, uniqueIndex: task.uniqueIndex })
        : item
    })

    const response: SearchTasksResponse = {
      success: true,
      tasks: (listQuery?.fields.length
        // @ts-expect-error TaskSearchItem has no string index signature
        ? projectRows(taskList as Array<Record<string, unknown>>, listQuery.fields)
        : taskList) as TaskSearchItem[],
      total,
      boardId: boardId || projectId || undefined,
      ...(listQueryEnabled ? { nextCursor: nextCursor || null } : {}),
    }

    return NextResponse.json(response)
  } catch (error) {
    htLogger.error('Error searching tasks:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}

export const GET = withoutAuth(GETHandler);
