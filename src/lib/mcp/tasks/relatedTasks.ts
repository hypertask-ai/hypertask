import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { McpAuthContext } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import {
  convertToPlain,
  searchTasks,
  type TurbopufferTaskRow,
} from '@/utils/controllers/turbopuffer/turbopufferHelper'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25
const MAX_QUERY_LENGTH = 2000

export type RelatedTasksGetInput = {
  taskId: number | null
  limit: number | null
}

export type RelatedTasksDependencies = {
  searchTasks: typeof searchTasks
}

type RelatedTask = {
  ticketNumber: string
  title: string
  projectId: number
  url: string
  score?: number
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status })
}

function normalizeLimit(limit: number | null | undefined) {
  if (limit === null || limit === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit <= 0) return null
  return Math.min(limit, MAX_LIMIT)
}

async function getAccessibleProjectIds(ctx: McpAuthContext) {
  const accessibleProjects = await prisma.project.findMany({
    where: {
      status: 'Normal',
      ...getProjectWhere(ctx.user.id, ctx.agentId),
    },
    select: { id: true },
  })

  return accessibleProjects.map((project) => project.id)
}

function mapRelatedTask(row: TurbopufferTaskRow): RelatedTask {
  return {
    ticketNumber: row.ticketNumber,
    title: row.title,
    projectId: row.projectId,
    url: `https://app.hypertask.ai/detail/project-${row.projectId}/${row.uniqueIndex}`,
    score: row.$dist,
  }
}

export async function handleRelatedTasksGet(
  _request: NextRequest,
  ctx: McpAuthContext,
  input: RelatedTasksGetInput,
  dependencies: RelatedTasksDependencies = { searchTasks }
): Promise<NextResponse> {
  if (
    input.taskId === null ||
    !Number.isInteger(input.taskId) ||
    input.taskId <= 0
  ) {
    return errorResponse('task_id must be a positive integer', 400)
  }

  const limit = normalizeLimit(input.limit)
  if (limit === null) {
    return errorResponse('limit must be a positive integer', 400)
  }

  try {
    const resolved = await findTaskByIdentifier(
      ctx.user,
      { task_id: input.taskId },
      ctx.agentId
    )
    if (!resolved) {
      return errorResponse('Task not found or access denied', 404)
    }

    const task = await prisma.task.findFirst({
      where: { id: resolved.id },
      select: {
        title: true,
        description_: {
          select: { content: true },
        },
      },
    })
    if (!task) {
      return errorResponse('Task not found or access denied', 404)
    }

    const accessibleProjectIds = await getAccessibleProjectIds(ctx)
    if (accessibleProjectIds.length === 0) {
      return NextResponse.json({ success: true, related: [] })
    }

    const descriptionText = convertToPlain(
      task.description_?.content ?? ''
    )
    const searchQuery = `${task.title}\n${descriptionText}`.slice(
      0,
      MAX_QUERY_LENGTH
    )
    const rows = await dependencies.searchTasks({
      searchQuery,
      projectIds: accessibleProjectIds,
      status: 'Normal',
      topK: limit + 5,
      keywordOnly: false,
    })
    const related = rows
      .filter((row) => row.id !== String(resolved.id))
      .slice(0, limit)
      .map(mapRelatedTask)

    return NextResponse.json({ success: true, related })
  } catch (error) {
    console.error('[MCP Related Tasks] GET failed:', error)
    return errorResponse('Internal server error', 500)
  }
}

export async function handleRelatedTasksPost(
  _request: NextRequest,
  ctx: McpAuthContext,
  body: unknown,
  dependencies: RelatedTasksDependencies = { searchTasks }
): Promise<NextResponse> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('Request body must be a JSON object', 400)
  }

  const input = body as Record<string, unknown>
  if (typeof input.text !== 'string') {
    return errorResponse('text is required and must be a string', 400)
  }

  const text = input.text.trim()
  if (!text) {
    return errorResponse('text must not be empty', 400)
  }
  if (text.length > MAX_QUERY_LENGTH) {
    return errorResponse(
      `text must be ${MAX_QUERY_LENGTH} characters or less`,
      400
    )
  }

  const rawLimit =
    input.limit === undefined ? undefined : Number(input.limit)
  const limit = normalizeLimit(rawLimit)
  if (limit === null) {
    return errorResponse('limit must be a positive integer', 400)
  }

  try {
    const accessibleProjectIds = await getAccessibleProjectIds(ctx)
    if (accessibleProjectIds.length === 0) {
      return NextResponse.json({ success: true, related: [] })
    }

    const rows = await dependencies.searchTasks({
      searchQuery: text,
      projectIds: accessibleProjectIds,
      status: 'Normal',
      topK: limit,
      keywordOnly: false,
    })

    return NextResponse.json({
      success: true,
      related: rows.slice(0, limit).map(mapRelatedTask),
    })
  } catch (error) {
    console.error('[MCP Related Tasks] POST failed:', error)
    return errorResponse('Internal server error', 500)
  }
}
