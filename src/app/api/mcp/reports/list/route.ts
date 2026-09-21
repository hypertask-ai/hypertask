import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  getReportUrl,
  listReports,
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

    const rawProjectId = request.nextUrl.searchParams.get('project_id')
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

    const reports = await listReports({
      userId: ctx.user.id,
      agentId: ctx.agentId,
      projectId,
    })
    if (!reports) {
      return NextResponse.json(
        buildFieldError('not_found', 'project_id', 'Project not found or access denied'),
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      reports: reports.map((report) => ({
        id: report.id,
        project_id: report.projectId,
        slug: report.slug,
        title: report.title,
        description: report.description,
        created_at: report.createdAt,
        updated_at: report.updatedAt,
        url: getReportUrl(report.projectId, report.slug),
      })),
    })
  } catch (error) {
    console.error('[MCP List Reports] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
