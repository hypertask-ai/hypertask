import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { buildMcpTaskUrl } from '@/lib/mcp/boards/links'
import { normalizeTaskRelationType } from '@/lib/mcp/tasks/relationType'
import {
  findTaskByIdentifier,
  TaskIdentifierAmbiguityError,
  validateTaskIdentifier,
} from '@/lib/mcp/tasks/resolveTask'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

const relatedTaskSelect = {
  id: true,
  ticketNumber: true,
  title: true,
  status: true,
  projectId: true,
  uniqueIndex: true,
} satisfies Prisma.TaskSelect

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

/** Coerce a body value to a positive int task id, or null if not one. */
const idFor = (v: unknown): number | null => parsePositiveInteger(v)
/** Coerce a body value to a non-empty ticket_number string, or null. */
const ticketFor = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null

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
      { success: false, error: 'Request body must be valid JSON' },
      { status: 400 }
    )
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: 'Request body must be a JSON object' },
      { status: 400 }
    )
  }

  const {
    source_task_id,
    source_ticket_number,
    source_unique_index,
    source_project_id,
    target_task_id,
    target_ticket_number,
    target_unique_index,
    target_project_id,
    project_id,
    relation_type,
  } = body as {
    source_task_id?: unknown
    source_ticket_number?: unknown
    source_unique_index?: unknown
    source_project_id?: unknown
    target_task_id?: unknown
    target_ticket_number?: unknown
    target_unique_index?: unknown
    target_project_id?: unknown
    project_id?: unknown
    relation_type?: unknown
  }

  const projectId = idFor(project_id)
  const sourceIdentifier = {
    task_id: idFor(source_task_id),
    ticket_number: ticketFor(source_ticket_number),
    unique_index: idFor(source_unique_index),
    project_id: idFor(source_project_id) ?? projectId,
  }
  const targetIdentifier = {
    task_id: idFor(target_task_id),
    ticket_number: ticketFor(target_ticket_number),
    unique_index: idFor(target_unique_index),
    project_id: idFor(target_project_id) ?? projectId,
  }

  const sourceValidation = validateTaskIdentifier(sourceIdentifier)
  if (!sourceValidation.valid) {
    return validationError(`Invalid source task identifier: ${sourceValidation.error}`)
  }
  const targetValidation = validateTaskIdentifier(targetIdentifier)
  if (!targetValidation.valid) {
    return validationError(`Invalid target task identifier: ${targetValidation.error}`)
  }

  const relationType = normalizeTaskRelationType(relation_type)
  if (relationType === null) {
    return validationError(
      'relation_type must be one of RelatedTo, BlockedBy, or BlockedTo'
    )
  }

  let sourceTask
  try {
    sourceTask = await findTaskByIdentifier(
      ctx.user,
      sourceIdentifier,
      ctx.agentId
    )
  } catch (error) {
    if (error instanceof TaskIdentifierAmbiguityError) {
      return validationError(`source_ticket_number: ${error.message}`)
    }
    throw error
  }

  let targetTask
  try {
    targetTask = await findTaskByIdentifier(
      ctx.user,
      targetIdentifier,
      ctx.agentId
    )
  } catch (error) {
    if (error instanceof TaskIdentifierAmbiguityError) {
      return validationError(`target_ticket_number: ${error.message}`)
    }
    throw error
  }

  if (!sourceTask || !targetTask) {
    return NextResponse.json(
      { success: false, error: 'Task not found or access denied' },
      { status: 404 }
    )
  }

  if (sourceTask.id === targetTask.id) {
    return validationError('A task cannot have a relation to itself')
  }

  try {
    const relation = await prisma.taskRelations.upsert({
      where: {
        sourceTaskId_targetTaskId: {
          sourceTaskId: sourceTask.id,
          targetTaskId: targetTask.id,
        },
      },
      create: {
        sourceTaskId: sourceTask.id,
        targetTaskId: targetTask.id,
        relationType,
      },
      // On an existing pair, update the type so a caller "fixing" a RelatedTo to
      // BlockedBy actually takes effect, rather than silently keeping the old type.
      update: { relationType },
      select: {
        id: true,
        sourceTaskId: true,
        targetTaskId: true,
        relationType: true,
      },
    })

    return NextResponse.json({ success: true, relation })
  } catch (error) {
    console.error('[MCP Task Relations] POST Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create task relation' },
      { status: 500 }
    )
  }
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
  const taskId = idFor(Number(searchParams.get('task_id')))
  const ticketNumber = ticketFor(searchParams.get('ticket_number'))
  const uniqueIndex = idFor(Number(searchParams.get('unique_index')))
  const projectId = idFor(Number(searchParams.get('project_id')))
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

  try {
    const accessibleTaskWhere = {
      status: { not: 'Deleted' },
      project: getProjectWhere(ctx.user.id, ctx.agentId),
    } satisfies Prisma.TaskWhereInput
    const relations = await prisma.taskRelations.findMany({
      where: {
        OR: [
          {
            sourceTaskId: task.id,
            targetTask: accessibleTaskWhere,
          },
          {
            targetTaskId: task.id,
            sourceTask: accessibleTaskWhere,
          },
        ],
      },
      select: {
        sourceTaskId: true,
        relationType: true,
        sourceTask: { select: relatedTaskSelect },
        targetTask: { select: relatedTaskSelect },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      success: true,
      relations: relations.map((relation) => {
        const outgoing = relation.sourceTaskId === task.id
        const otherTask = outgoing ? relation.targetTask : relation.sourceTask

        return {
          relationType: relation.relationType,
          direction: outgoing ? 'outgoing' : 'incoming',
          // Sibling endpoint /mcp/tasks/related returns a url; without one a
          // client has no way to link the task and falls back to a search URL.
          otherTask: {
            ...otherTask,
            url: buildMcpTaskUrl(otherTask.projectId, otherTask.uniqueIndex),
          },
        }
      }),
    })
  } catch (error) {
    console.error('[MCP Task Relations] GET Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list task relations' },
      { status: 500 }
    )
  }
}

// Remove a relation between two tasks, so a mistakenly-declared dependency can be
// cleared (not just retyped). Idempotent: deleting a non-existent relation is 200.
export async function DELETE(request: NextRequest) {
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
      { success: false, error: 'Request body must be valid JSON' },
      { status: 400 }
    )
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: 'Request body must be a JSON object' },
      { status: 400 }
    )
  }

  const {
    source_task_id,
    source_ticket_number,
    source_unique_index,
    source_project_id,
    target_task_id,
    target_ticket_number,
    target_unique_index,
    target_project_id,
    project_id,
  } = body as Record<string, unknown>

  const projectId = idFor(project_id)
  const sourceIdentifier = {
    task_id: idFor(source_task_id),
    ticket_number: ticketFor(source_ticket_number),
    unique_index: idFor(source_unique_index),
    project_id: idFor(source_project_id) ?? projectId,
  }
  const targetIdentifier = {
    task_id: idFor(target_task_id),
    ticket_number: ticketFor(target_ticket_number),
    unique_index: idFor(target_unique_index),
    project_id: idFor(target_project_id) ?? projectId,
  }

  const sourceValidation = validateTaskIdentifier(sourceIdentifier)
  if (!sourceValidation.valid) {
    return validationError(`Invalid source task identifier: ${sourceValidation.error}`)
  }
  const targetValidation = validateTaskIdentifier(targetIdentifier)
  if (!targetValidation.valid) {
    return validationError(`Invalid target task identifier: ${targetValidation.error}`)
  }

  let sourceTask
  try {
    sourceTask = await findTaskByIdentifier(
      ctx.user,
      sourceIdentifier,
      ctx.agentId
    )
  } catch (error) {
    if (error instanceof TaskIdentifierAmbiguityError) {
      return validationError(`source_ticket_number: ${error.message}`)
    }
    throw error
  }

  let targetTask
  try {
    targetTask = await findTaskByIdentifier(
      ctx.user,
      targetIdentifier,
      ctx.agentId
    )
  } catch (error) {
    if (error instanceof TaskIdentifierAmbiguityError) {
      return validationError(`target_ticket_number: ${error.message}`)
    }
    throw error
  }
  if (!sourceTask || !targetTask) {
    return NextResponse.json(
      { success: false, error: 'Task not found or access denied' },
      { status: 404 }
    )
  }

  try {
    const result = await prisma.taskRelations.deleteMany({
      where: { sourceTaskId: sourceTask.id, targetTaskId: targetTask.id },
    })
    return NextResponse.json({ success: true, deleted: result.count })
  } catch (error) {
    console.error('[MCP Task Relations] DELETE Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete task relation' },
      { status: 500 }
    )
  }
}
