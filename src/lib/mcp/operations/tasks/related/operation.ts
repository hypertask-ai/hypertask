import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  handleRelatedTasksGet,
  handleRelatedTasksPost,
} from '@/lib/mcp/tasks/relatedTasks'
import {
  findTaskByIdentifier,
  TaskIdentifierAmbiguityError,
  validateTaskIdentifier,
} from '@/lib/mcp/tasks/resolveTask'

function validationError(message: string) {
  return NextResponse.json(
    { success: false, error: message },
    { status: 400 }
  )
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null
}

export async function GET(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited
  const ctx = await validateMcpAuth(request)
  if (!ctx) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Invalid or missing authentication token.',
      },
      { status: 401 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const rawTaskId = searchParams.get('task_id')
  const rawTicketNumber = searchParams.get('ticket_number')
  const rawUniqueIndex = searchParams.get('unique_index')
  const rawProjectId = searchParams.get('project_id')
  const taskId = rawTaskId === null
    ? undefined
    : parsePositiveInteger(Number(rawTaskId))
  if (taskId === null) {
    return validationError('task_id must be a positive integer')
  }
  const ticketNumber = rawTicketNumber?.trim() || undefined
  if (rawTicketNumber !== null && ticketNumber === undefined) {
    return validationError('ticket_number must be a non-empty string')
  }
  const uniqueIndex = rawUniqueIndex === null
    ? undefined
    : parsePositiveInteger(Number(rawUniqueIndex))
  if (uniqueIndex === null) {
    return validationError('unique_index must be a positive integer')
  }
  const projectId = rawProjectId === null
    ? undefined
    : parsePositiveInteger(Number(rawProjectId))
  if (projectId === null) {
    return validationError('project_id must be a positive integer')
  }
  const identifier = {
    task_id: taskId,
    ticket_number: ticketNumber,
    unique_index: uniqueIndex,
    project_id: projectId,
  }
  const validation = validateTaskIdentifier(identifier)
  if (!validation.valid) {
    return validationError(validation.error)
  }

  let task
  try {
    task = await findTaskByIdentifier(ctx.user, identifier, ctx.agentId)
  } catch (error) {
    if (error instanceof TaskIdentifierAmbiguityError) {
      return validationError(`ticket_number: ${error.message}`)
    }
    throw error
  }
  if (!task) {
    return NextResponse.json(
      { success: false, error: 'Task not found or access denied' },
      { status: 404 }
    )
  }

  const limitParam = searchParams.get('limit')

  return handleRelatedTasksGet(request, ctx, {
    taskId: task.id,
    limit: limitParam === null ? null : Number(limitParam),
  })
}

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited
  const ctx = await validateMcpAuth(request)
  if (!ctx) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Invalid or missing authentication token.',
      },
      { status: 401 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Request body must be valid JSON',
      },
      { status: 400 }
    )
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const input = body as Record<string, unknown>
    const hasTaskIdentifier = [
      'task_id',
      'ticket_number',
      'unique_index',
      'project_id',
    ].some((field) => field in input)

    if (hasTaskIdentifier) {
      if (input.text !== undefined) {
        return validationError('Provide either a task identifier or text, not both')
      }

      const taskId = input.task_id === undefined
        ? undefined
        : parsePositiveInteger(input.task_id)
      if (taskId === null) {
        return validationError('task_id must be a positive integer')
      }
      const ticketNumber = input.ticket_number === undefined
        ? undefined
        : typeof input.ticket_number === 'string' && input.ticket_number.trim()
          ? input.ticket_number.trim()
          : null
      if (ticketNumber === null) {
        return validationError('ticket_number must be a non-empty string')
      }
      const uniqueIndex = input.unique_index === undefined
        ? undefined
        : parsePositiveInteger(input.unique_index)
      if (uniqueIndex === null) {
        return validationError('unique_index must be a positive integer')
      }
      const projectId = input.project_id === undefined
        ? undefined
        : parsePositiveInteger(input.project_id)
      if (projectId === null) {
        return validationError('project_id must be a positive integer')
      }
      const identifier = {
        task_id: taskId,
        ticket_number: ticketNumber,
        unique_index: uniqueIndex,
        project_id: projectId,
      }
      const validation = validateTaskIdentifier(identifier)
      if (!validation.valid) {
        return validationError(validation.error)
      }

      let task
      try {
        task = await findTaskByIdentifier(ctx.user, identifier, ctx.agentId)
      } catch (error) {
        if (error instanceof TaskIdentifierAmbiguityError) {
          return validationError(`ticket_number: ${error.message}`)
        }
        throw error
      }
      if (!task) {
        return NextResponse.json(
          { success: false, error: 'Task not found or access denied' },
          { status: 404 }
        )
      }

      const limit = input.limit === undefined ? null : Number(input.limit)
      return handleRelatedTasksGet(request, ctx, {
        taskId: task.id,
        limit,
      })
    }
  }

  return handleRelatedTasksPost(request, ctx, body)
}
