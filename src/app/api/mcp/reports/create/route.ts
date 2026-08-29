import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  IdempotencyInProgressError,
  normalizeIdempotencyKey,
  withIdempotency,
} from '@/lib/mcp/idempotency/idempotencyStore'
import {
  createReport,
  getReportUrl,
  REPORT_CAPABILITIES,
  ReportValidationError,
} from '@/utils/controllers/reports/reportService'
import {
  isRequestBody,
  parsePositiveInteger,
} from '../../pages/_lib/routeUtils'

type CreateReportBody = {
  project_id?: unknown
  slug?: unknown
  title?: unknown
  description?: unknown
  body_html?: unknown
}

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
    const body = parsedBody as CreateReportBody

    const projectId = parsePositiveInteger(body.project_id)
    if (projectId === null) {
      return NextResponse.json(
        buildFieldError(
          body.project_id === undefined ? 'missing_field' : 'invalid_field',
          'project_id',
          'project_id must be a positive integer'
        ),
        { status: 400 }
      )
    }

    if (typeof body.slug !== 'string') {
      return NextResponse.json(
        buildFieldError(
          body.slug === undefined ? 'missing_field' : 'invalid_field',
          'slug',
          'slug must be a string'
        ),
        { status: 400 }
      )
    }

    if (typeof body.title !== 'string') {
      return NextResponse.json(
        buildFieldError(
          body.title === undefined ? 'missing_field' : 'invalid_field',
          'title',
          'title must be a string'
        ),
        { status: 400 }
      )
    }

    if (
      body.description !== undefined &&
      body.description !== null &&
      typeof body.description !== 'string'
    ) {
      return NextResponse.json(
        buildFieldError('invalid_field', 'description', 'description must be a string or null'),
        { status: 400 }
      )
    }

    if (typeof body.body_html !== 'string') {
      return NextResponse.json(
        buildFieldError(
          body.body_html === undefined ? 'missing_field' : 'invalid_field',
          'body_html',
          `body_html must be a string\n\n${REPORT_CAPABILITIES}`
        ),
        { status: 400 }
      )
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

    const response = await withIdempotency(
      'create_report',
      ctx.user.id,
      idempotencyKey,
      body,
      async () => {
        const report = await createReport({
          userId: ctx.user.id,
          agentId: ctx.agentId,
          projectId,
          slug: body.slug as string,
          title: body.title as string,
          description: body.description as string | null | undefined,
          bodyHtml: body.body_html as string,
        })

        if (!report) {
          throw new Error('Project not found or access denied')
        }

        return {
          success: true as const,
          report: {
            id: report.id,
            project_id: report.projectId,
            slug: report.slug,
            title: report.title,
            description: report.description,
            body_html: report.bodyHtml,
            created_at: report.createdAt,
            updated_at: report.updatedAt,
            url: getReportUrl(report.projectId, report.slug),
          },
        }
      }
    )

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    if (error instanceof ReportValidationError) {
      return NextResponse.json(
        buildFieldError('invalid_field', error.field, error.message),
        { status: 400 }
      )
    }

    if (
      error instanceof Error &&
      error.message === 'Project not found or access denied'
    ) {
      return NextResponse.json(
        buildFieldError('not_found', 'project_id', error.message),
        { status: 404 }
      )
    }

    console.error('[MCP Create Report] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
