import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  deleteReport,
  getReportUrl,
  ReportValidationError,
} from '@/utils/controllers/reports/reportService'
import {
  isRequestBody,
  parsePositiveInteger,
} from '../../pages/_lib/routeUtils'

type DeleteReportBody = {
  project_id?: unknown
  slug?: unknown
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
    const body = parsedBody as DeleteReportBody

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

    const report = await deleteReport({
      userId: ctx.user.id,
      agentId: ctx.agentId,
      projectId,
      slug: body.slug,
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

    console.error('[MCP Delete Report] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
