import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { validateProjectAccess } from '@/lib/mcp/tasks/services'
import { resolveTaskIdOnly } from '@/lib/mcp/tasks/resolveTask'
import upsertTaskDescription from '@/utils/controllers/description/common-description-create'
import { AgentMutationLeaseConflictError } from '@/lib/mcp/tasks/agentMutationFence'

type Body = {
  task_id?: unknown
  version_id?: unknown
  ticket_number?: unknown
  unique_index?: unknown
  project_id?: unknown
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

// POST /api/mcp/tasks/description-restore { task_id, version_id }
// Restores a task's description to a historical snapshot. Restoring first
// snapshots the current description (via upsertTaskDescription), so it is
// itself undoable and never destroys history.
export async function POST(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    let body: Body
    try {
      body = (await request.json()) as Body
    } catch {
      return NextResponse.json(
        buildFieldError('invalid_field', 'body', 'Request body must be valid JSON'),
        { status: 400 }
      )
    }

    // Accept the same identifiers as every other task route, so a caller
    // holding a ticket number does not have to look the numeric id up first.
    const taskId = await resolveTaskIdOnly({
      task_id: positiveInt(body.task_id),
      ticket_number: typeof body.ticket_number === 'string' ? body.ticket_number : null,
      unique_index: positiveInt(body.unique_index),
      project_id: positiveInt(body.project_id),
    })
    const versionId = positiveInt(body.version_id)
    if (taskId === null) {
      const gaveSome =
        body.task_id !== undefined ||
        body.ticket_number !== undefined ||
        body.unique_index !== undefined
      return NextResponse.json(
        buildFieldError(
          gaveSome ? 'invalid_field' : 'missing_field',
          'task_id',
          'Provide task_id, ticket_number, or project_id + unique_index'
        ),
        { status: 400 }
      )
    }
    if (versionId === null) {
      return NextResponse.json(
        buildFieldError(
          body.version_id === undefined ? 'missing_field' : 'invalid_field',
          'version_id',
          'version_id must be a positive integer'
        ),
        { status: 400 }
      )
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    })
    if (!task || (await validateProjectAccess(task.projectId, ctx.user.id, ctx.agentId)).error) {
      return NextResponse.json(
        buildFieldError('not_found', 'task_id', 'Task not found'),
        { status: 404 }
      )
    }

    const snapshot = await prisma.docVersion.findFirst({
      where: { id: versionId, entityType: 'task_description', entityId: taskId },
      select: { contentHtml: true, version: true },
    })
    if (!snapshot) {
      return NextResponse.json(
        buildFieldError('not_found', 'version_id', 'Version not found for this task'),
        { status: 404 }
      )
    }

    await upsertTaskDescription({
      taskId,
      creatorId: ctx.user.id,
      content: snapshot.contentHtml,
      agentId: ctx.agentId,
      actingUserId: ctx.user.id,
    })

    return NextResponse.json({ ok: true, restored_from_version: snapshot.version })
  } catch (error) {
    if (error instanceof AgentMutationLeaseConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[MCP Task Description Restore] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
