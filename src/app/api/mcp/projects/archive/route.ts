import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'

/**
 * Archive or unarchive a board.
 *
 * The CLI could create boards but never remove them, so throwaway test boards
 * piled up with no way to clear them from any machine-facing surface
 * (HTPR-4780). Archive only, and only for the owner: it is reversible, and
 * deletion of a whole board is not something an agent should be able to do.
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
    if (status !== 'Archive' && status !== 'Normal') {
      return NextResponse.json(
        { success: false, error: "status must be 'Archive' or 'Normal'" },
        { status: 400 }
      )
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
