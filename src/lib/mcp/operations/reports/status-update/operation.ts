import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard'
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { HTPR_8219_STATUS_UPDATE_DOOR_FLAG } from '@/lib/flags/definitions/htpr-8219-status-update-door'
import { isFeatureEnabled } from '@/lib/flags'
import { parsePositiveInteger } from '@/lib/mcp/operations/pages/helpers'
import {
  generateStatusUpdateReport,
  StatusUpdateBoardNotFoundError,
  StatusUpdateGenerationError,
  StatusUpdatesDisabledError,
} from '@/utils/controllers/reports/statusUpdate'

export const POST = wrapMcpRoute(async (request: NextRequest) => {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const roleRefusal = await requireAgentWriteRole(ctx)
    if (roleRefusal) return roleRefusal

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const enabled = await isFeatureEnabled(
      HTPR_8219_STATUS_UPDATE_DOOR_FLAG,
      ctx.user.id
    )
    if (!enabled) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const rawProjectId = body?.project_id
    const projectId =
      rawProjectId !== null && rawProjectId !== undefined && /^\d+$/.test(String(rawProjectId))
        ? parsePositiveInteger(Number(rawProjectId))
        : null
    if (projectId === null) {
      return NextResponse.json(
        buildFieldError(
          rawProjectId === null || rawProjectId === undefined ? 'missing_field' : 'invalid_field',
          'project_id',
          'project_id must be a positive integer'
        ),
        { status: 400 }
      )
    }

    const range = typeof body?.range === 'string' ? body.range : null
    const statusUpdate = await generateStatusUpdateReport({
      projectId,
      userId: ctx.user.id,
      actingAgentId: ctx.agentId,
      teamScope: ctx.teamScope,
      range,
    })

    return NextResponse.json({
      success: true,
      url: statusUpdate.url,
      headline: statusUpdate.headline,
      title: statusUpdate.title,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TeamKeyOnlyRefusal') {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 })
    }
    if (error instanceof StatusUpdateBoardNotFoundError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 })
    }
    if (error instanceof StatusUpdatesDisabledError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }
    if (error instanceof StatusUpdateGenerationError) {
      reportMcpOperationCrash(request, error.cause ?? error)
      return NextResponse.json({ success: false, error: error.message }, { status: 502 })
    }
    console.error('[MCP Status Update] Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      { success: false, error: 'Could not generate the status update' },
      { status: 500 }
    )
  }
})
