import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  getReportUrl,
  REPORT_CAPABILITIES,
  ReportValidationError,
  updateReport,
} from '@/utils/controllers/reports/reportService'
import {
  isRequestBody,
  parsePositiveInteger,
} from '../../pages/_lib/routeUtils'

type UpdateReportBody = {
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
    const body = parsedBody as UpdateReportBody

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

    if (body.title !== undefined && typeof body.title !== 'string') {
      return NextResponse.json(
        buildFieldError('invalid_field', 'title', 'title must be a string'),
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

    if (body.body_html !== undefined && typeof body.body_html !== 'string') {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'body_html',
          `body_html must be a string\n\n${REPORT_CAPABILITIES}`
        ),
        { status: 400 }
      )
    }

    const report = await updateReport({
      userId: ctx.user.id,
      agentId: ctx.agentId,
      projectId,
      slug: body.slug,
      title: body.title as string | undefined,
      description: body.description as string | null | undefined,
      bodyHtml: body.body_html as string | undefined,
    })

    if (!report) {
      return NextResponse.json(
        buildFieldError('not_found', 'slug', 'Report not found or access denied'),
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
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
    })
  } catch (error) {
    if (error instanceof ReportValidationError) {
      return NextResponse.json(
        buildFieldError('invalid_field', error.field, error.message),
        { status: 400 }
      )
    }

    console.error('[MCP Update Report] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
