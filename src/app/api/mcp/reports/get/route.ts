import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  getReport,
  getReportUrl,
  ReportValidationError,
} from '@/utils/controllers/reports/reportService'
import { parsePositiveInteger } from '../../pages/_lib/routeUtils'

export async function GET(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const searchParams = request.nextUrl.searchParams
    const rawProjectId = searchParams.get('project_id')
    const projectId =
      rawProjectId !== null && /^\d+$/.test(rawProjectId)
        ? parsePositiveInteger(Number(rawProjectId))
        : null
    if (projectId === null) {
      return NextResponse.json(
        buildFieldError(
          rawProjectId === null ? 'missing_field' : 'invalid_field',
          'project_id',
          'project_id must be a positive integer'
        ),
        { status: 400 }
      )
    }

    const slug = searchParams.get('slug')
    if (slug === null || !slug.trim()) {
      return NextResponse.json(
        buildFieldError(
          slug === null ? 'missing_field' : 'invalid_field',
          'slug',
          'slug must be a non-empty string'
        ),
        { status: 400 }
      )
    }

    const report = await getReport({
      userId: ctx.user.id,
      agentId: ctx.agentId,
      projectId,
      slug,
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

    console.error('[MCP Get Report] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
