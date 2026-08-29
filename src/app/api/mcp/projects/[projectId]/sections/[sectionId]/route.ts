import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { updateSection, deleteSection } from '@/lib/mcp/sections/services'
import { broadcastBoardChange } from '@/lib/realtime/server'

export interface SectionListItem {
  id: number
  section_title: string
  projectId: number
  visibility: boolean
  deleted: boolean
  ranking: string
  autoAssign: number | string | null
  taskCount: number
}

/**
 * PATCH /api/mcp/projects/:projectId/sections/:sectionId
 *
 * Update a section (rename, move, done state, and/or auto-assignee).
 *
 * Body:
 * - title: string (optional) - New section title
 * - move_after_section_id: number (optional) - Move section to appear after this ID
 * - is_done: boolean | null (optional) - Tickets here are finished. null clears the
 *   explicit flag and falls back to the column-name guess.
 * - auto_assign: number | string | null (optional) - User ID, agent ID, or null to clear.
 * - At least one must be provided
 */
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ projectId: string; sectionId: string }> }
) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication error',
          message: 'Invalid or expired JWT token'
        },
        { status: 401 }
      )
    }
    const user = ctx.user;
    const projectId = parseInt(params.projectId)
    const sectionId = parseInt(params.sectionId)

    if (isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'projectId must be a positive integer',
          details: { field: 'projectId', code: 'invalid_format' }
        },
        { status: 400 }
      )
    }

    if (isNaN(sectionId) || sectionId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'sectionId must be a positive integer',
          details: { field: 'sectionId', code: 'invalid_format' }
        },
        { status: 400 }
      )
    }

    let body: {
      title?: string
      move_after_section_id?: number
      is_done?: boolean | null
      auto_assign?: number | string | null
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'Invalid request body',
          details: { field: 'body', code: 'invalid_json' }
        },
        { status: 400 }
      )
    }

    const title = typeof body?.title === 'string' ? body.title.trim() : undefined
    const moveAfterSectionId =
      body?.move_after_section_id != null
        ? parseInt(String(body.move_after_section_id))
        : undefined

    // null is meaningful here (clear the flag, fall back to the name guess), so
    // presence is what counts, not truthiness.
    const isDoneProvided = typeof body === 'object' && body !== null && 'is_done' in body
    const isDone = isDoneProvided ? body.is_done ?? null : undefined
    const autoAssignProvided =
      typeof body === 'object' && body !== null && 'auto_assign' in body
    const autoAssign = autoAssignProvided ? body.auto_assign ?? null : undefined

    if (isDoneProvided && isDone !== null && typeof isDone !== 'boolean') {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'is_done must be a boolean or null',
          details: { field: 'is_done', code: 'invalid_type' }
        },
        { status: 400 }
      )
    }

    if (
      autoAssignProvided &&
      autoAssign !== null &&
      !(
        (typeof autoAssign === 'number' && Number.isInteger(autoAssign) && autoAssign > 0) ||
        (typeof autoAssign === 'string' && autoAssign.trim().length > 0)
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'auto_assign must be a positive user ID, agent ID, or null',
          details: { field: 'auto_assign', code: 'invalid_type' }
        },
        { status: 400 }
      )
    }

    if (!title && moveAfterSectionId == null && !isDoneProvided && !autoAssignProvided) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'At least one of title, move_after_section_id, is_done or auto_assign must be provided',
          details: { field: 'body', code: 'missing_fields' }
        },
        { status: 400 }
      )
    }

    if (title !== undefined && title.length > 200) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'title must be between 1 and 200 characters',
          details: { field: 'title', code: 'invalid_length' }
        },
        { status: 400 }
      )
    }

    if (moveAfterSectionId != null && (isNaN(moveAfterSectionId) || moveAfterSectionId <= 0)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'move_after_section_id must be a positive integer',
          details: { field: 'move_after_section_id', code: 'invalid_type' }
        },
        { status: 400 }
      )
    }

    const result = await updateSection({
      projectId,
      sectionId,
      userId: user.id,
      title: title || undefined,
      moveAfterSectionId,
      isDone,
      autoAssign
    }, ctx.agentId)

    if (!result.success) {
      const payload: Record<string, unknown> = { success: false, error: result.error }
      if (result.message) payload.message = result.message
      if (result.details) payload.details = result.details
      return NextResponse.json(payload, { status: result.status })
    }

    const taskCount = await prisma.task.count({
      where: {
        projectId,
        section: result.section.section_title,
        status: 'Normal'
      }
    })

    void broadcastBoardChange(projectId, { originUserId: user.id })

    return NextResponse.json(
      {
        success: true,
        section: { ...result.section, taskCount },
        message: 'Section updated successfully'
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error updating section:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while updating the section'
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/mcp/projects/:projectId/sections/:sectionId
 *
 * Delete a section. Tasks in the section are moved to the first section.
 */
export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ projectId: string; sectionId: string }> }
) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication error',
          message: 'Invalid or expired JWT token'
        },
        { status: 401 }
      )
    }
    const user = ctx.user;
    const projectId = parseInt(params.projectId)
    const sectionId = parseInt(params.sectionId)

    if (isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'projectId must be a positive integer',
          details: { field: 'projectId', code: 'invalid_format' }
        },
        { status: 400 }
      )
    }

    if (isNaN(sectionId) || sectionId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'sectionId must be a positive integer',
          details: { field: 'sectionId', code: 'invalid_format' }
        },
        { status: 400 }
      )
    }

    const result = await deleteSection({
      projectId,
      sectionId,
      userId: user.id
    }, ctx.agentId)

    if (!result.success) {
      const payload: Record<string, unknown> = { success: false, error: result.error }
      if (result.message) payload.message = result.message
      return NextResponse.json(payload, { status: result.status })
    }

    void broadcastBoardChange(projectId, { originUserId: user.id })

    return NextResponse.json(
      { success: true, message: result.message },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error deleting section:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while deleting the section'
      },
      { status: 500 }
    )
  }
}
