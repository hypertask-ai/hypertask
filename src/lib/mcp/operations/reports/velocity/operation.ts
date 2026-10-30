import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { HTPR_8219_VELOCITY_REPORT_FLAG } from '@/lib/flags/definitions/htpr-8219-velocity-report'
import { isFeatureEnabled } from '@/lib/flags'
import { parsePositiveInteger } from '@/lib/mcp/operations/pages/helpers'
import { loadVelocityReport } from '@/utils/controllers/reports/velocityReport'

export const GET = wrapMcpRoute(async (request: NextRequest) => {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const enabled = await isFeatureEnabled(
      HTPR_8219_VELOCITY_REPORT_FLAG,
      ctx.user.id
    )
    if (!enabled) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

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

    const report = await loadVelocityReport({
      projectId,
      userId: ctx.user.id,
      actingUserId: ctx.user.id,
      actingAgentId: ctx.agentId,
      teamScope: ctx.teamScope,
      rangeKey: searchParams.get('range'),
    })

    if (!report) {
      return NextResponse.json(
        buildFieldError('not_found', 'project_id', 'Board not found or access denied'),
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, report })
  } catch (error) {
    console.error('[MCP Velocity Report] Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      { error: 'Unable to load the board report' },
      { status: 500 }
    )
  }
})
