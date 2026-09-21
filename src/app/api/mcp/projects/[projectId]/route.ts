import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { HTPR_6587_PROJECT_UPDATE_FLAG, isFeatureEnabled } from '@/lib/flags'
import prisma from '@/lib/prisma'
import { taskWriteAccessWhere } from '@/utils/controllers/projects/getAllIncludes'

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status })
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> },
) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return errorResponse('Unauthorized. Invalid or missing authentication token.', 401)
    }
    if (!(await isFeatureEnabled(HTPR_6587_PROJECT_UPDATE_FLAG, ctx.user.id))) {
      return errorResponse('Not found', 404)
    }

    const { projectId: rawProjectId } = await props.params
    const projectId = Number(rawProjectId)
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      return errorResponse('projectId must be a positive integer', 400)
    }

    let body: { title?: unknown }
    try {
      body = await request.json()
    } catch {
      return errorResponse('Request body must be valid JSON', 400)
    }

    if (typeof body.title !== 'string') {
      return errorResponse('title must be a string', 400)
    }
    const title = body.title.trim()
    if (!title || title.length > 200) {
      return errorResponse('title must contain 1 to 200 characters', 400)
    }

    const updated = await prisma.project.updateMany({
      where: {
        id: projectId,
        status: 'Normal',
        ...taskWriteAccessWhere(ctx.user.id, ctx.agentId),
      },
      data: { title },
    })
    if (updated.count === 0) {
      return errorResponse('Project not found or access denied', 404)
    }

    return NextResponse.json({
      success: true,
      project: { id: projectId, title },
    })
  } catch (error) {
    console.error('[MCP Update Project] Error:', error)
    return errorResponse('Internal server error', 500)
  }
}
