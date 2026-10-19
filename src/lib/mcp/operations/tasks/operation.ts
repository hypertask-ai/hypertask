import { stripForeignTaskRelations } from "@/lib/tasks/sameBoardRelations";
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit, mcpRouteUnauthorizedResponse as mcpUnauthorizedResponse } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import type { McpAgentSummary } from '@/lib/mcp/agents'
import { mapVisibleMcpAgent, mcpVisibleAgentSelect } from '@/lib/mcp/agents'
import { accessibleAgentWhere } from '@/lib/agents/visibility'
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
import { findTaskByIdentifier, TaskIdentifierAmbiguityError } from '@/lib/mcp/tasks/resolveTask'
import { decodeCursor, encodeCursor } from '@/lib/mcp/pagination/cursor'
import prisma from '@/lib/prisma'
import {
  hasPrWhere,
  normalizeTaskStatus,
  parseTaskStatusParam,
  parseAssigneeFilter,
  parseNumericCursor,
  parseUpdatedSince,
  projectRows,
  resolveListLimit,
  withTaskPresentation,
} from '@/lib/mcp/listQuery'
import { readListQuery } from '@/lib/mcp/readListQuery'
import { parsePriorityFilter } from '@/lib/mcp/priorityFilter'
import { findParamWithNulByte, parseSortOrderParam } from '@/lib/mcp/listParams'

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
  permanentlyDeleteAt: string | null
  agent?: McpAgentSummary
  uniqueIndex?: number
  url?: string
  link?: {
    url: string
    format: string
    example: string
  }
}

export interface ListTasksResponse {
  success: boolean
  tasks: TaskListItem[]
  total: number
  limit: number
  offset: number
  nextCursor: string | null
  metadata?: {
    projectCount?: number
    sectionCount?: number
  }
}

const LABEL_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function findInvalidDateParam(params: Record<string, string | undefined>): string | null {
  for (const [name, value] of Object.entries(params)) {
    if (value && !parseUpdatedSince(value)) return name
  }
  return null
}

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

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  let userObj: {id: number, email: string} | null = null
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return await mcpUnauthorizedResponse(request)
    }
    const user = ctx.user;
    userObj = user
    const searchParams = request.nextUrl.searchParams
    const query = Object.fromEntries(searchParams)
    console.log('[MCP] tasks', {
      user: { id: user.id, email: user.email },
      query,
    })

    const paramWithNulByte = findParamWithNulByte(searchParams)
    if (paramWithNulByte !== null) return validationError(`${paramWithNulByte} must not contain a NUL character`)

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

    const cursorParam = searchParams.get('cursor')
    const cursorId = cursorParam
      ? decodeCursor(cursorParam) ?? parseNumericCursor(cursorParam)
      : null
    if (cursorParam && cursorId === null) {
      return NextResponse.json(
        { success: false, error: 'cursor must be a valid task cursor' },
        { status: 400 }
      )
    }
    const usesCursor = cursorParam !== null

    const taskIdParam = searchParams.get('task_id')
    const taskIds = taskIdParam ? taskIdParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : null
    const ticketNumberParam = searchParams.get('ticket_number')
    const ticketNumbers = ticketNumberParam ? ticketNumberParam.split(',').map(t => t.trim()).filter(t => t.length > 0) : null
    const uniqueIndexParam = searchParams.get('unique_index')
    const uniqueIndex = uniqueIndexParam ? (isNaN(parseInt(uniqueIndexParam)) ? null : parseInt(uniqueIndexParam)) : null
    const projectIdForLookup = projectIdResult.value

    const methodCount = [!!taskIds, !!ticketNumbers, !!uniqueIndex].filter(Boolean).length
    if (methodCount === 0) {
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

        const include = {
          ...taskMcpGetInclude(user.id),
          savedContent: {
            where: { userId: ctx.agentId ? -1 : user.id, commentId: null, type: 'Private' as const },
            select: { id: true, type: true },
          },
        }
        const tasks = await prisma.task.findMany({ where, include })
        const requestedTickets = ticketNumbers ?? (legacyTicketNumber ? [legacyTicketNumber] : [])
        const missingTickets = requestedTickets.filter(number => !tasks.some(task => task.ticketNumber === number))
        const aliasTargets = await Promise.all([
          ...missingTickets.map(ticket_number => findTaskByIdentifier(
            user, { ticket_number, project_id: projectIdForLookup }, ctx.agentId
          )),
          ...(uniqueIndex !== null && projectIdForLookup !== null && tasks.length === 0
            ? [findTaskByIdentifier(user, { unique_index: uniqueIndex, project_id: projectIdForLookup }, ctx.agentId)]
            : []),
        ])
        const aliasIds = aliasTargets.flatMap(task => task && !tasks.some(live => live.id === task.id) ? [task.id] : [])
        if (aliasIds.length) {
          tasks.push(...await prisma.task.findMany({
            where: { id: { in: aliasIds }, status: { not: 'Deleted' }, project: getProjectWhere(user.id, ctx.agentId) },
            include,
          }))
        }

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

        if (legacyTicketNumber && !ticketNumbers && tasks.length === 1) {
          return NextResponse.json({
            success: true,
            task: mapTaskToMcpGetResponse(tasks[0], user.id)
          })
        }

        return NextResponse.json({
          success: true,
          tasks: tasks.map((task) => mapTaskToMcpGetResponse(task, user.id))
        })
      }
    }

    const projectId = projectIdForLookup
    const boardId = boardIdResult.value

    const parsedListQuery = readListQuery(searchParams)
    if (parsedListQuery.error) return parsedListQuery.error
    const listQuery = parsedListQuery.listQuery
    const sectionIdParam = parsePositiveIntegerParam(searchParams, 'section_id')
    if (!sectionIdParam.ok) return sectionIdParam.response
    let section = searchParams.get('section') || undefined
    let assignedTo = searchParams.get('assigned_to') || undefined
    const priorityFilter = parsePriorityFilter(searchParams.getAll('priority'))
    if (!priorityFilter) {
      return NextResponse.json(
        { success: false, error: 'Invalid priority. Use urgent, high, medium, low, none or 0-4.' },
        { status: 400 },
      )
    }
    const hasDueDate = searchParams.get('has_due_date') ? searchParams.get('has_due_date') === 'true' : undefined
    const dueDateBefore = searchParams.get('due_date_before') || undefined
    const dueDateAfter = searchParams.get('due_date_after') || undefined
    const statusParam = parseTaskStatusParam(searchParams.get('status'), ['Normal', 'Archive', 'Deleted'])
    if (!statusParam) return validationError('status must be open, Normal, Archive, or Deleted')
    let status = statusParam
    let labelsParam = searchParams.getAll('labels')
    const createdBy = searchParams.get('created_by') ? parseInt(searchParams.get('created_by')!) : null
    let updatedSince = searchParams.get('updated_since') || undefined
    const createdSince = searchParams.get('created_since') || undefined
    const hasComments = searchParams.get('has_comments') ? searchParams.get('has_comments') === 'true' : undefined
    const hasAttachments = searchParams.get('has_attachments') ? searchParams.get('has_attachments') === 'true' : undefined
    let search = searchParams.get('search') || undefined
    let limit = Math.min(limitResult.value ?? 50, 100)
    const offset = offsetResult.value
    let sortBy = searchParams.get('sort_by') || 'updatedAt'
    const sortOrderParam = parseSortOrderParam(searchParams.get('sort_order'), 'desc')
    if (!sortOrderParam) return validationError('sort_order must be asc or desc')
    let sortOrder = sortOrderParam
    let sectionId = sectionIdParam.value
    if (listQuery) {
      if (listQuery.query) search = listQuery.query
      if (listQuery.filter.section) {
        if (/^\d+$/.test(listQuery.filter.section)) {
          sectionId = Number(listQuery.filter.section)
        } else {
          section = listQuery.filter.section
        }
      }
      if (listQuery.filter.assignee !== undefined) {
        const assignee = parseAssigneeFilter(listQuery.filter.assignee)
        if (!assignee.ok) {
          return NextResponse.json(
            { success: false, error: 'Validation error', message: assignee.error },
            { status: 400 },
          )
        }
        assignedTo = String(listQuery.filter.assignee)
      }
      if (listQuery.filter.status) {
        const normalizedStatus = normalizeTaskStatus(listQuery.filter.status)
        if (!normalizedStatus) {
          return NextResponse.json(
            {
              success: false,
              error: 'Validation error',
              message: 'filter.status must be open, Normal, Archive, or Deleted',
            },
            { status: 400 },
          )
        }
        status = normalizedStatus
      }
      if (listQuery.filter.label) {
        labelsParam = Array.isArray(listQuery.filter.label)
          ? listQuery.filter.label
          : [listQuery.filter.label]
      }
      if (listQuery.filter.updated_since) updatedSince = listQuery.filter.updated_since
      if (listQuery.sortBy) sortBy = listQuery.sortBy
      if (listQuery.sortOrder) sortOrder = listQuery.sortOrder
      limit = resolveListLimit(listQuery, limit)
    }

    const invalidDateParam = findInvalidDateParam({
      updated_since: updatedSince,
      created_since: createdSince,
      due_date_before: dueDateBefore,
      due_date_after: dueDateAfter,
    })
    if (invalidDateParam) {
      return validationError(`${invalidDateParam} must be a valid date or datetime, e.g. 2026-10-14 or 2026-10-14T03:00:00Z`)
    }

    const TASK_SORT_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'priority', 'title', 'id'] as const
    if (listQuery?.sortBy && !TASK_SORT_FIELDS.includes(listQuery.sortBy as (typeof TASK_SORT_FIELDS)[number])) {
      return validationError(`sort must be one of ${TASK_SORT_FIELDS.join(', ')}`)
    }

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

    const where: any = {
      projectId: { in: accessibleProjectIds },
      status
    }

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

    if (sectionId) {
      where.sectionId = sectionId
    } else if (section) {
      where.section = section
    }

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

    if (priorityFilter.length) {
      const byIndex = { priority: { priority_index: { in: priorityFilter } } }
      where.AND = priorityFilter.includes(0)
        ? [{ OR: [byIndex, { priority: { is: null } }] }]
        : [byIndex]
    }

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

    if (createdBy) {
      where.userId = createdBy
    }

    if (updatedSince) {
      where.updatedAt = { gte: new Date(updatedSince) }
    }
    if (createdSince) {
      where.createdAt = { gte: new Date(createdSince) }
    }

    if (hasComments !== undefined) {
      if (hasComments) {
        where.comments = { some: {} }
      } else {
        where.comments = { none: {} }
      }
    }

    if (hasAttachments !== undefined) {
      if (hasAttachments) {
        where.attachments = { some: {} }
      } else {
        where.attachments = { none: {} }
      }
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description_: { content: { contains: search, mode: 'insensitive' } } },
        { ticketNumber: { contains: search, mode: 'insensitive' } }
      ]
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

    const orderBy: any[] = []
    if (sortBy === 'createdAt') {
      orderBy.push({ createdAt: sortOrder }, { id: 'asc' })
    } else if (sortBy === 'updatedAt') {
      orderBy.push({ updatedAt: { sort: sortOrder, nulls: 'last' } }, { id: 'asc' })
    } else if (sortBy === 'dueDate') {
      orderBy.push({ dueDate: sortOrder }, { id: 'asc' })
    } else if (sortBy === 'priority') {
      orderBy.push({ priority: { Priority_Value: sortOrder } }, { id: 'asc' })
    } else if (sortBy === 'title') {
      orderBy.push({ title: sortOrder }, { id: 'asc' })
    } else if (sortBy === 'id') {
      orderBy.push({ id: sortOrder })
    } else {
      orderBy.push({ updatedAt: 'desc' }, { id: 'asc' })
    }

    const total = await prisma.task.count({ where })

    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        ticketNumber: true,
        uniqueIndex: true,
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
            uniqueIndex: true,
            projectId: true
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
        permanentlyDeleteAt: true,
        sectionChangedAt: true,
        lastCommentAt: true,
        agent: {
          select: mcpVisibleAgentSelect(user.id),
        },
        assignees: {
          where: {
            OR: [
              { agentId: null },
              { agent: accessibleAgentWhere(user.id) },
            ],
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
              },
            },
            agent: { select: mcpVisibleAgentSelect(user.id) },
            agentAssigner: { select: mcpVisibleAgentSelect(user.id) },
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
            uniqueIndex: true,
            projectId: true
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy,
      take: limit,
      ...(cursorId
        ? { cursor: { id: cursorId }, skip: 1 }
        : { skip: usesCursor ? 0 : offset }),
    })

    const uniqueProjects = new Set(tasks.map(t => t.projectId))
    const uniqueSections = new Set(tasks.map(t => t.section).filter(Boolean))

    const taskList: TaskListItem[] = tasks.map(task => {
      task = stripForeignTaskRelations(task)
      const agent = mapVisibleMcpAgent(task.agent, user.id, task.projectId)
      const assignees = task.assignees
        .map((assignee) => mapTaskAssignee(assignee, user.id, task.projectId))
        .filter((assignee): assignee is McpTaskAssignee => Boolean(assignee))
      return {
        id: task.id,
        ticketNumber: task.ticketNumber || undefined,
        uniqueIndex: task.uniqueIndex,
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
        assignees,
        assigneeCount: assignees.length,
        labels: task.taskLabels.map(mapMcpTaskLabel),
        labelCount: task._count.taskLabels,
        commentCount: task._count.comments,
        savedContent: task.savedContent,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt?.toISOString() || undefined,
        permanentlyDeleteAt: task.permanentlyDeleteAt?.toISOString() || null,
        ...(agent ? { agent } : {}),
      }
    })

    const presentedTasks = taskList.map((task) => withTaskPresentation(task))
    const projectedTasks = listQuery?.fields.length
      // @ts-expect-error TaskListItem has no string index signature
      ? projectRows(presentedTasks as Array<Record<string, unknown>>, listQuery.fields)
      : presentedTasks

    const nextCursor =
      tasks.length === limit
        ? encodeCursor(tasks[tasks.length - 1].id)
        : null

    const response: ListTasksResponse = {
      success: true,
      tasks: projectedTasks as TaskListItem[],
      total,
      limit,
      offset: usesCursor ? 0 : offset,
      nextCursor,
      ...(listQuery?.fields.length
        ? {}
        : {
            metadata: {
              projectCount: uniqueProjects.size,
              sectionCount: uniqueSections.size,
            },
          }),
    }

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof TaskIdentifierAmbiguityError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }
    reportMcpOperationCrash(request, error)
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

  })(request)
}
