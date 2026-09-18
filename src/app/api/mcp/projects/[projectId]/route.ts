import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  HTPR_6470_PROJECT_DELETE_FLAG,
  isFeatureEnabled,
} from '@/lib/flags'
import deleteProject from '@/utils/controllers/projects/delete'

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> },
) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 },
      )
    }

    if (!(await isFeatureEnabled(HTPR_6470_PROJECT_DELETE_FLAG, ctx.user.id))) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const { projectId: rawProjectId } = await props.params
    const projectId = Number(rawProjectId)
    if (!Number.isInteger(projectId) || projectId < 1) {
      return NextResponse.json(
        { success: false, error: 'projectId must be a positive integer' },
        { status: 400 },
      )
    }

    const response = await deleteProject(projectId, ctx.user.id)
    return NextResponse.json(response.json, { status: response.status })
  } catch (error) {
    console.error('[MCP Delete Board] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    )
  }
}
