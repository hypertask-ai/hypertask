import { NextRequest, NextResponse } from 'next/server'

import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import {
  findTaskByIdentifier,
  TaskIdentifierAmbiguityError,
  validateTaskIdentifier,
} from '@/lib/mcp/tasks/resolveTask'
import { listPages } from '@/utils/controllers/pages/pageService'
import { canAccessProject } from '../_lib/routeUtils'

function parseQueryId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null

  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const searchParams = request.nextUrl.searchParams
    const rawTaskId = searchParams.get('task_id')
    const rawTicketNumber = searchParams.get('ticket_number')
    const rawUniqueIndex = searchParams.get('unique_index')
    const rawProjectId = searchParams.get('project_id')
    const hasTaskIdentifier =
      rawTaskId !== null ||
      rawTicketNumber !== null ||
      rawUniqueIndex !== null
    // Without unique_index, project_id keeps its established project-list meaning.
    const hasProjectIdentifier =
      rawProjectId !== null && rawUniqueIndex === null

    if (hasTaskIdentifier && hasProjectIdentifier) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'task_id/ticket_number/unique_index/project_id',
          'Provide either a task identifier or project_id, not both'
        ),
        { status: 400 }
      )
    }

    if (!hasTaskIdentifier && !hasProjectIdentifier) {
      return NextResponse.json(
        buildFieldError(
          'missing_field',
          'task_id/ticket_number/unique_index/project_id',
          'Either task_id, ticket_number, (project_id + unique_index), or project_id is required'
        ),
        { status: 400 }
      )
    }

    if (hasTaskIdentifier) {
      const taskId = rawTaskId === null ? undefined : parseQueryId(rawTaskId)
      if (taskId === null) {
        return NextResponse.json(
          buildFieldError(
            'invalid_field',
            'task_id',
            'task_id must be a positive integer'
          ),
          { status: 400 }
        )
      }

      const ticketNumber = rawTicketNumber?.trim() || undefined
      if (rawTicketNumber !== null && ticketNumber === undefined) {
        return NextResponse.json(
          buildFieldError(
            'invalid_field',
            'ticket_number',
            'ticket_number must be a non-empty string'
          ),
          { status: 400 }
        )
      }
      const uniqueIndex = rawUniqueIndex === null
        ? undefined
        : parseQueryId(rawUniqueIndex)
      if (uniqueIndex === null) {
        return NextResponse.json(
          buildFieldError(
            'invalid_field',
            'unique_index',
            'unique_index must be a positive integer'
          ),
          { status: 400 }
        )
      }

      const projectId = rawProjectId === null
        ? undefined
        : parseQueryId(rawProjectId)
      if (projectId === null) {
        return NextResponse.json(
          buildFieldError(
            'invalid_field',
            'project_id',
            'project_id must be a positive integer'
          ),
          { status: 400 }
        )
      }

      const identifier = {
        task_id: taskId,
        ticket_number: ticketNumber,
        unique_index: uniqueIndex,
        project_id: projectId,
      }
      const validation = validateTaskIdentifier(identifier)
      if (!validation.valid) {
        return NextResponse.json(
          buildFieldError(validation.code, validation.field, validation.error),
          { status: 400 }
        )
      }

      const task = await findTaskByIdentifier(
        ctx.user,
        identifier,
        ctx.agentId
      )
      if (!task || !(await canAccessProject(task.projectId, ctx))) {
        return NextResponse.json(
          buildFieldError(
            'not_found',
            'task_id',
            'Task not found or access denied'
          ),
          { status: 404 }
        )
      }

      const pages = await listPages({ taskId: task.id })
      return NextResponse.json({ pages })
    }

    const projectId = parseQueryId(rawProjectId)
    if (projectId === null) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'project_id',
          'project_id must be a positive integer'
        ),
        { status: 400 }
      )
    }

    if (!(await canAccessProject(projectId, ctx))) {
      return NextResponse.json(
        buildFieldError('not_found', 'project_id', 'Project not found'),
        { status: 404 }
      )
    }

    const pages = await listPages({ projectId })
    return NextResponse.json({ pages })
  } catch (error) {
    if (error instanceof TaskIdentifierAmbiguityError) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'ticket_number',
          'Ticket number is ambiguous across accessible projects; use task_id or (project_id + unique_index)'
        ),
        { status: 400 }
      )
    }

    console.error('[MCP List Pages] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
