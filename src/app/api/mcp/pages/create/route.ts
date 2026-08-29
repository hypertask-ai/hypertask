import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  IdempotencyInProgressError,
  normalizeIdempotencyKey,
  withIdempotency,
} from '@/lib/mcp/idempotency/idempotencyStore'
import {
  findTaskByIdentifier,
  TaskIdentifierAmbiguityError,
  validateTaskIdentifier,
} from '@/lib/mcp/tasks/resolveTask'
import {
  createPage,
  type PageContentType,
} from '@/utils/controllers/pages/pageService'
import {
  canAccessProject,
  getPageUrl,
  isRequestBody,
  parsePositiveInteger,
} from '../_lib/routeUtils'

type CreatePageBody = {
  task_id?: unknown
  ticket_number?: unknown
  unique_index?: unknown
  project_id?: unknown
  title?: unknown
  content?: unknown
  content_type?: unknown
  parent_page_id?: unknown
}

const CONTENT_TYPES = ['markdown', 'html', 'html_canvas'] as const

export async function POST(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    let parsedBody: unknown
    try {
      parsedBody = await request.json()
    } catch {
      return NextResponse.json(
        buildFieldError('invalid_field', 'body', 'Request body must be valid JSON'),
        { status: 400 }
      )
    }
    if (!isRequestBody(parsedBody)) {
      return NextResponse.json(
        buildFieldError('invalid_field', 'body', 'Request body must be a JSON object'),
        { status: 400 }
      )
    }
    const body = parsedBody as CreatePageBody

    const taskId = body.task_id === undefined
      ? undefined
      : parsePositiveInteger(body.task_id)
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

    const ticketNumber = body.ticket_number === undefined
      ? undefined
      : typeof body.ticket_number === 'string' && body.ticket_number.trim()
        ? body.ticket_number.trim()
        : null
    if (ticketNumber === null) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'ticket_number',
          'ticket_number must be a non-empty string'
        ),
        { status: 400 }
      )
    }

    const uniqueIndex = body.unique_index === undefined
      ? undefined
      : parsePositiveInteger(body.unique_index)
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

    const projectId = body.project_id === undefined
      ? undefined
      : parsePositiveInteger(body.project_id)
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

    if (typeof body.content !== 'string') {
      return NextResponse.json(
        buildFieldError(
          body.content === undefined ? 'missing_field' : 'invalid_field',
          'content',
          'content must be a string'
        ),
        { status: 400 }
      )
    }

    const contentType = body.content_type ?? 'markdown'
    if (!CONTENT_TYPES.includes(contentType as PageContentType)) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'content_type',
          'Invalid content_type. Must be one of: markdown, html',
          CONTENT_TYPES
        ),
        { status: 400 }
      )
    }

    if (body.title !== undefined && typeof body.title !== 'string') {
      return NextResponse.json(
        buildFieldError('invalid_field', 'title', 'title must be a string'),
        { status: 400 }
      )
    }

    let parentPageId: number | undefined
    if (body.parent_page_id !== undefined) {
      const parsedParentPageId = parsePositiveInteger(body.parent_page_id)
      if (parsedParentPageId === null) {
        return NextResponse.json(
          buildFieldError(
            'invalid_field',
            'parent_page_id',
            'parent_page_id must be a positive integer'
          ),
          { status: 400 }
        )
      }
      parentPageId = parsedParentPageId
    }

    let idempotencyKey: string | null
    try {
      idempotencyKey = normalizeIdempotencyKey(
        request.headers.get('Idempotency-Key')
      )
    } catch (error) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'Idempotency-Key',
          error instanceof Error
            ? error.message
            : 'Invalid Idempotency-Key header'
        ),
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
        buildFieldError('not_found', 'task_id', 'Task not found or access denied'),
        { status: 404 }
      )
    }

    const response = await withIdempotency(
      'create_page',
      ctx.user.id,
      idempotencyKey,
      body,
      async () => {
        const page = await createPage({
          taskId: task.id,
          title: body.title as string | undefined,
          content: body.content as string,
          contentType: contentType as PageContentType,
          parentPageId,
          userId: ctx.user.id,
          agentId: ctx.agentId,
        })

        return {
          page: {
            publicId: page.publicId,
            id: page.id,
            title: page.title,
            version: page.version,
            url: getPageUrl(page.publicId),
          },
        }
      }
    )

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    if (error instanceof TaskIdentifierAmbiguityError) {
      return NextResponse.json(
        buildFieldError('invalid_field', 'ticket_number', error.message),
        { status: 400 }
      )
    }

    if (error instanceof Error && error.message.includes('not found')) {
      const field = error.message.startsWith('Parent page')
        ? 'parent_page_id'
        : 'task_id'
      return NextResponse.json(
        buildFieldError('not_found', field, error.message),
        { status: 404 }
      )
    }

    console.error('[MCP Create Page] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
