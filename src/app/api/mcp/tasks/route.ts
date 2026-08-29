import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit, mcpUnauthorizedResponse } from '@/lib/mcp/auth'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import type { McpAgentSummary } from '@/lib/mcp/agents'
import { mapMcpAgent, mcpAgentSelect } from '@/lib/mcp/agents'
import type { McpTaskAssignee } from '@/lib/mcp/tasks/types'
import {
  mapMcpTaskLabel,
  mapTaskAssignee,
  mapTaskDescriptionContent,
  mapTaskToMcpGetResponse,
  mcpTaskLabelSelect,
  taskMcpGetInclude,
} from '@/lib/mcp/tasks/mappers'
import { mcpTaskUserCommentCount } from '@/lib/mcp/tasks/mappers'
import { decodeCursor, encodeCursor } from '@/lib/mcp/pagination/cursor'
import prisma from '@/lib/prisma'

/** Minimal parent task info for MCP responses (when this task is a subtask). */
export interface ParentTaskSummary {
  id: number
  ticketNumber?: string
  title: string
  uniqueIndex: number
}

export interface TaskListItem {
  id: number
  ticketNumber?: string
  title: string
  description: string
  section: string
  sectionId?: number
  boardId: number
  boardTitle: string
  parent_id?: number
  parent_task?: ParentTaskSummary
  sub_tasks: ParentTaskSummary[]
  projectId: number
  status: 'Normal' | 'Archive' | 'Deleted'
  priority?: string
  dueDate?: string
  assignees: McpTaskAssignee[]
  assigneeCount: number
  labels: Array<{
    id: string | number
    name: string
  }>
  labelCount: number
  commentCount: number
  savedContent: Array<{ id: string; type: string }>
  createdAt: string
  updatedAt?: string
  agent?: McpAgentSummary
}

export interface ListTasksResponse {
  success: boolean
  tasks: TaskListItem[]
  total: number
  limit: number
  offset: number
  /**
   * Opaque cursor for the next page, or null when there are no more rows.
   * Only meaningful when the request passed `cursor=`; null otherwise.
   */
  nextCursor: string | null
  metadata?: {
    projectCount?: number
    sectionCount?: number
  }
}

/** Matches `Label.id` (Prisma `@default(uuid())`). Plain digits kept for backwards compatibility. */
const LABEL_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isLabelIdParam(raw: string): boolean {
  const l = raw.trim()
  return l.length > 0 && (/^\d+$/.test(l) || LABEL_ID_UUID_RE.test(l))
}

function parseIntegerParam(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null

  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

function validationError(message: string) {
  return NextResponse.json(
    {
      success: false,
      error: 'Validation error',
      message
    },
    { status: 400 }
  )
}

function parsePositiveIntegerParam(searchParams: URLSearchParams, name: string, aliases: readonly string[] = []): { ok: true; value: number | null } | { ok: false; response: NextResponse } {
  const raw = [name, ...aliases]
    .map((key) => searchParams.get(key))
    .find((value) => value !== null) ?? null
  if (raw === null) return { ok: true, value: null }

  const value = parseIntegerParam(raw)
  if (value === null || value <= 0) {
    return { ok: false, response: validationError(`${name} must be a positive integer`) }
  }

  return { ok: true, value }
}

function parseNonNegativeIntegerParam(searchParams: URLSearchParams, name: string, defaultValue: number): { ok: true; value: number } | { ok: false; response: NextResponse } {
  const raw = searchParams.get(name)
  if (raw === null) return { ok: true, value: defaultValue }

  const value = parseIntegerParam(raw)
  if (value === null) {
    return { ok: false, response: validationError(`${name} must be a non-negative integer`) }
  }

  return { ok: true, value }
}

/**
 * GET /api/mcp/tasks
 * 
 * Lists tasks with comprehensive filtering options.
 * Results are automatically limited to boards/projects the user has access to.
 * 
 * Also supports getting a single task by ticket_number:
 * GET /api/mcp/tasks?ticket_number=DEV-1&project_id=1
 */
export async function GET(request: NextRequest) {
  let userObj: {id: number, email: string} | null = null
  try {
    // Validate authentication
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return await mcpUnauthorizedResponse(request)
    }
    const user = ctx.user;
    userObj = user
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const query = Object.fromEntries(searchParams)
    console.log('[MCP] tasks', {
      user: { id: user.id, email: user.email },
      query,
    })

    // Accept the aliases used by the low-level ht helper and CLI. Canonical
    // snake_case wins when callers accidentally supply more than one form.
    const projectIdResult = parsePositiveIntegerParam(
      searchParams,
      'project_id',
      ['projectId', 'project'],
    )
    if (!projectIdResult.ok) return projectIdResult.response

    const boardIdResult = parsePositiveIntegerParam(searchParams, 'board_id', ['boardId'])
    if (!boardIdResult.ok) return boardIdResult.response

    const limitResult = parsePositiveIntegerParam(searchParams, 'limit')
    if (!limitResult.ok) return limitResult.response

    const offsetResult = parseNonNegativeIntegerParam(searchParams, 'offset', 0)
    if (!offsetResult.ok) return offsetResult.response

    // Opt-in cursor pagination. When `cursor=` is present it overrides `offset`
    // and `sort_by/order` (cursor mode always walks id-ascending). Absent =
    // existing offset behaviour, unchanged.
    const cursorParam = searchParams.get('cursor')
    const cursorId = cursorParam ? decodeCursor(cursorParam) : null
    if (cursorParam && cursorId === null) {
      return NextResponse.json(
        { success: false, error: 'cursor must be a valid task cursor' },
        { status: 400 }
      )
    }
    const usesCursor = cursorParam !== null

    // Check for different task identification methods
    const taskIdParam = searchParams.get('task_id')
    const taskIds = taskIdParam ? taskIdParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : null
    const ticketNumberParam = searchParams.get('ticket_number')
    const ticketNumbers = ticketNumberParam ? ticketNumberParam.split(',').map(t => t.trim()).filter(t => t.length > 0) : null
    const uniqueIndexParam = searchParams.get('unique_index')
    const uniqueIndex = uniqueIndexParam ? (isNaN(parseInt(uniqueIndexParam)) ? null : parseInt(uniqueIndexParam)) : null
    const projectIdForLookup = projectIdResult.value
    
    // Validate that only one identification method is used
    const methodCount = [!!taskIds, !!ticketNumbers, !!uniqueIndex].filter(Boolean).length
    if (methodCount === 0) {
      // Continue with list tasks logic (no single task lookup)
    } else if (methodCount > 1) {
      console.warn('[MCP] tasks', {
        reason: 'multiple_identification_methods',
        user: { id: user.id, email: user.email },
        query,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot provide multiple identification methods. Use either task_id, ticket_number, or (project_id + unique_index)'
        },
        { status: 400 }
      )
    } else if (uniqueIndex && !projectIdForLookup) {
      console.warn('[MCP] tasks', {
        reason: 'project_id_required_with_unique_index',
        user: { id: user.id, email: user.email },
        query,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'project_id is required when using unique_index'
        },
        { status: 400 }
      )
    }
    
    // Handle single task lookups (consolidated with OR)
    if (methodCount > 0) {
      const orConditions: any[] = []
      
      if (taskIds && taskIds.length > 0) {
        orConditions.push({ id: { in: taskIds } })
      }
      
      if (ticketNumbers && ticketNumbers.length > 0) {
        const ticketCondition: any = { ticketNumber: { in: ticketNumbers } }
        if (projectIdForLookup) {
          ticketCondition.projectId = projectIdForLookup
        }
        orConditions.push(ticketCondition)
      }
      
      // Handle legacy single ticket_number (not array)
      const legacyTicketNumber = searchParams.get('ticket_number')
      if (legacyTicketNumber && !ticketNumbers) {
        const ticketCondition: any = { ticketNumber: legacyTicketNumber }
        const legacyProjectId = projectIdForLookup
        if (legacyProjectId) {
          ticketCondition.projectId = legacyProjectId
        }
        orConditions.push(ticketCondition)
      }
      
      if (uniqueIndex !== null && projectIdForLookup !== null) {
        orConditions.push({
          projectId: projectIdForLookup,
          uniqueIndex,
          status: { not: 'Deleted' }
        })
      }

      if (orConditions.length > 0) {
        const where: any = {
          OR: orConditions,
          project: getProjectWhere(user.id, ctx.agentId)
        }

        const tasks = await prisma.task.findMany({
          where,
          include: {
            ...taskMcpGetInclude,
            savedContent: {
              where: { userId: ctx.agentId ? -1 : user.id, commentId: null, type: 'Private' },
              select: { id: true, type: true },
            },
          }
        })

        if (tasks.length === 0) {
          console.warn('[MCP] tasks', {
            reason: 'task_not_found_or_access_denied',
            user: { id: user.id, email: user.email },
            query,
          })
          return NextResponse.json(
            {
              success: false,
              error: 'Task not found or access denied'
            },
            { status: 404 }
          )
        }

        // Legacy format: if single ticket_number (not array), return single task object
        if (legacyTicketNumber && !ticketNumbers && tasks.length === 1) {
          return NextResponse.json({
            success: true,
            task: mapTaskToMcpGetResponse(tasks[0])
          })
        }

        return NextResponse.json({
          success: true,
          tasks: tasks.map(mapTaskToMcpGetResponse)
        })
      }
    }
    
    // Continue with list tasks logic
    const projectId = projectIdForLookup
    const boardId = boardIdResult.value
    const section = searchParams.get('section') || undefined
    const assignedTo = searchParams.get('assigned_to') || undefined
    const priorityParam = searchParams.get('priority')
    const hasDueDate = searchParams.get('has_due_date') ? searchParams.get('has_due_date') === 'true' : undefined
    const dueDateBefore = searchParams.get('due_date_before') || undefined
    const dueDateAfter = searchParams.get('due_date_after') || undefined
    const status = (searchParams.get('status') as 'Normal' | 'Archive' | 'Deleted') || 'Normal'
    const labelsParam = searchParams.getAll('labels')
    const createdBy = searchParams.get('created_by') ? parseInt(searchParams.get('created_by')!) : null
    const updatedSince = searchParams.get('updated_since') || undefined
    const createdSince = searchParams.get('created_since') || undefined
    const hasComments = searchParams.get('has_comments') ? searchParams.get('has_comments') === 'true' : undefined
    const hasAttachments = searchParams.get('has_attachments') ? searchParams.get('has_attachments') === 'true' : undefined
    const search = searchParams.get('search') || undefined
    const limit = Math.min(limitResult.value ?? 50, 100)
    const offset = offsetResult.value
    const sortBy = searchParams.get('sort_by') || 'updatedAt'
    const sortOrder = searchParams.get('sort_order') || 'desc'

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
        total: 0,
        limit,
        offset,
        nextCursor: null
      })
    }

    // Build where clause
    const where: any = {
      projectId: { in: accessibleProjectIds },
      status
    }

    // Filter by project/board
    if (projectId || boardId) {
      const targetId = projectId || boardId
      if (accessibleProjectIds.includes(targetId!)) {
        where.projectId = targetId
      } else {
        console.warn('[MCP] tasks', {
          reason: 'project_not_found_or_access_denied',
          user: { id: user.id, email: user.email },
          query,
          targetProjectId: targetId,
        })
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

    // Filter by assignee
    if (assignedTo) {
      if (assignedTo === 'me') {
        where.assignees = { some: { userId: user.id } }
      } else if (assignedTo === 'unassigned') {
        where.assignees = { none: {} }
      } else {
        const userIds = assignedTo.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
        if (userIds.length > 0) {
          where.assignees = { some: { userId: { in: userIds } } }
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
    if (dueDateBefore) {
      where.dueDate = { ...where.dueDate, lte: new Date(dueDateBefore) }
    }
    if (dueDateAfter) {
      where.dueDate = { ...where.dueDate, gte: new Date(dueDateAfter) }
    }

    // Filter by labels: ids match TaskLabel.labelId (numeric legacy + UUID Label.id); else label.value
    if (labelsParam.length > 0) {
      const trimmed = labelsParam.map(l => l.trim()).filter(l => l.length > 0)
      const labelIds = trimmed.filter(isLabelIdParam)
      const labelNames = trimmed.filter(l => !isLabelIdParam(l))

      if (labelIds.length > 0 || labelNames.length > 0) {
        where.taskLabels = {
          some: {
            OR: [
              ...(labelIds.length > 0 ? [{ labelId: { in: labelIds } }] : []),
              ...(labelNames.length > 0 ? [{ label: { value: { in: labelNames } } }] : [])
            ]
          }
        }
      }
    }

    // Filter by creator
    if (createdBy) {
      where.userId = createdBy
    }

    // Filter by updated/created since
    if (updatedSince) {
      where.updatedAt = { gte: new Date(updatedSince) }
    }
    if (createdSince) {
      where.createdAt = { gte: new Date(createdSince) }
    }

    // Filter by comments
    if (hasComments !== undefined) {
      if (hasComments) {
        where.comments = { some: {} }
      } else {
        where.comments = { none: {} }
      }
    }

    // Filter by attachments
    if (hasAttachments !== undefined) {
      if (hasAttachments) {
        where.attachments = { some: {} }
      } else {
        where.attachments = { none: {} }
      }
    }

    // Search filter
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description_: { content: { contains: search, mode: 'insensitive' } } },
        { ticketNumber: { contains: search, mode: 'insensitive' } }
      ]
    }

    // Build orderBy. Cursor mode forces a stable id-ascending walk so the
    // cursor (last seen id) yields a deterministic next page.
    const orderBy: any = {}
    if (usesCursor) {
      orderBy.id = 'asc'
    } else if (sortBy === 'createdAt') {
      orderBy.createdAt = sortOrder
    } else if (sortBy === 'updatedAt') {
      orderBy.updatedAt = sortOrder
    } else if (sortBy === 'dueDate') {
      orderBy.dueDate = sortOrder
    } else if (sortBy === 'priority') {
      orderBy.priority = { Priority_Value: sortOrder }
    } else if (sortBy === 'title') {
      orderBy.title = sortOrder
    } else {
      orderBy.updatedAt = 'desc'
    }

    // total is the full match set — counted BEFORE the cursor window so it stays
    // constant across a cursor walk. The cursor `gt` filter applies only to the
    // page fetch below.
    const total = await prisma.task.count({ where })
    const listWhere =
      usesCursor && cursorId !== null
        ? { ...where, id: { ...(where.id ?? {}), gt: cursorId } }
        : where

    // Get tasks
    const tasks = await prisma.task.findMany({
      where: listWhere,
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        section: true,
        description_:true,
        sectionId: true,
        parentTaskId: true,
        projectId: true,
        project: {
          select: {
            id: true,
            title: true,
            staleWarnDays: true,
            staleHotDays: true,
          }
        },
        parentTask: {
          select: {
            id: true,
            ticketNumber: true,
            title: true,
            uniqueIndex: true
          }
        },
        status: true,
        priority: {
          select: {
            Priority_Value: true
          }
        },
        dueDate: true,
        createdAt: true,
        updatedAt: true,
        sectionChangedAt: true,
        lastCommentAt: true,
        agent: {
          select: mcpAgentSelect,
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
              },
            },
            agent: { select: mcpAgentSelect },
            agentAssigner: { select: mcpAgentSelect },
          },
        },
        taskLabels: {
          select: {
            label: {
              select: mcpTaskLabelSelect,
            },
          },
        },
        savedContent: {
          where: { userId: ctx.agentId ? -1 : user.id, commentId: null, type: 'Private' },
          select: { id: true, type: true },
        },
        _count: {
          select: {
            assignees: true,
            taskLabels: true,
            comments: mcpTaskUserCommentCount,
          },
        },
        subTasks: {
          where: {
            status: {
              not: "Deleted",
            },
          },
          select:{
            id: true,
            ticketNumber: true,
            title: true,
            uniqueIndex: true
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy,
      take: limit,
      // Cursor mode pages via the id filter, not an offset window.
      skip: usesCursor ? 0 : offset
    })

    // Get metadata counts
    const uniqueProjects = new Set(tasks.map(t => t.projectId))
    const uniqueSections = new Set(tasks.map(t => t.section).filter(Boolean))

    // Transform to response format
    const taskList: TaskListItem[] = tasks.map(task => {
      const agent = mapMcpAgent(task.agent)
      return {
        id: task.id,
        ticketNumber: task.ticketNumber || undefined,
        title: task.title,
        description: mapTaskDescriptionContent(task),
        section: task.section,
        sectionId: task.sectionId || undefined,
        boardId: task.projectId,
        boardTitle: task.project.title || '',
        parent_id: task.parentTaskId || undefined,
        parent_task: task.parentTask
          ? {
              id: task.parentTask.id,
              ticketNumber: task.parentTask.ticketNumber || undefined,
              title: task.parentTask.title,
              uniqueIndex: task.parentTask.uniqueIndex
            }
          : undefined,
        sub_tasks: task.subTasks.map((st) => ({
          id: st.id,
          ticketNumber: st.ticketNumber || undefined,
          title: st.title,
          uniqueIndex: st.uniqueIndex
        })),
        projectId: task.projectId,
        status: task.status,
        priority: task.priority?.Priority_Value || undefined,
        dueDate: task.dueDate?.toISOString() || undefined,
        assignees: task.assignees.map(mapTaskAssignee),
        assigneeCount: task._count.assignees,
        labels: task.taskLabels.map(mapMcpTaskLabel),
        labelCount: task._count.taskLabels,
        commentCount: task._count.comments,
        savedContent: task.savedContent,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt?.toISOString() || undefined,
        ...(agent ? { agent } : {}),
      }
    })

    // A full page in cursor mode implies there may be more rows; hand back the
    // cursor for the last id so the caller can fetch the next page.
    const nextCursor =
      usesCursor && tasks.length === limit
        ? encodeCursor(tasks[tasks.length - 1].id)
        : null

    const response: ListTasksResponse = {
      success: true,
      tasks: taskList,
      total,
      limit,
      // Cursor mode ignores offset entirely, so report 0 rather than echoing a
      // value that was never applied.
      offset: usesCursor ? 0 : offset,
      nextCursor,
      metadata: {
        projectCount: uniqueProjects.size,
        sectionCount: uniqueSections.size
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[MCP] tasks', {
      user: userObj,
      error,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
