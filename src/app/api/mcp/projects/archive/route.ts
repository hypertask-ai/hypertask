import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import {
  HTPR_6470_PROJECT_DELETE_FLAG,
  isFeatureEnabled,
} from '@/lib/flags'
import deleteProject from '@/utils/controllers/projects/delete'

/**
 * Archive, restore, or explicitly delete a board.
 *
 * Archive and restore remain owner-only and reversible. Delete reuses the web
 * app's owner-or-admin lifecycle path and is separately feature-gated.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    let body: { project_id?: unknown; status?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }

    const projectId = Number(body.project_id)
    if (!Number.isInteger(projectId) || projectId < 1) {
      return NextResponse.json(
        { success: false, error: 'project_id must be a positive integer' },
        { status: 400 }
      )
    }

    const status = body.status === undefined ? 'Archive' : body.status
    if (status !== 'Archive' && status !== 'Normal' && status !== 'Deleted') {
      return NextResponse.json(
        { success: false, error: "status must be 'Archive', 'Normal', or 'Deleted'" },
        { status: 400 }
      )
    }

    if (status === 'Deleted') {
      if (!(await isFeatureEnabled(HTPR_6470_PROJECT_DELETE_FLAG, ctx.user.id))) {
        return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
      }
      const response = await deleteProject(projectId, ctx.user.id)
      return NextResponse.json(response.json, { status: response.status })
    }

    // Owner only. A member archiving a shared board would take it away from
    // everyone else on it.
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: ctx.user.id, status: { not: 'Deleted' } },
      select: { id: true, name: true, title: true, status: true },
    })

    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Board not found, or you do not own it' },
        { status: 404 }
      )
    }

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { status },
      select: { id: true, name: true, title: true, status: true },
    })

    return NextResponse.json({ success: true, project: updated })
  } catch (error) {
    console.error('[MCP Archive Board] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
