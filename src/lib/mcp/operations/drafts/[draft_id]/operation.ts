import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'

interface DraftResponse {
  id: number
  taskId: number
  ticketNumber?: string
  draftType: string
  text: string
  status: string
  updatedAt: string
  createdBy?: {
    id: number
    email: string
    displayName?: string
  }
}

interface UpdateDraftResponse {
  success: boolean
  draft: DraftResponse
  message: string
}

interface DeleteDraftResponse {
  success: boolean
  message: string
}

async function findDraftWithAccess(draftId: number, userId: number) {
  return prisma.drafts.findUnique({
    where: { id: draftId },
    include: {
      task: {
        include: {
          project: {
            select: {
              ownerId: true,
              members: { select: { userId: true } }
            }
          }
        }
      }
    }
  })
}

function mapDraftToResponse(draft: any): DraftResponse {
  return {
    id: draft.id,
    taskId: draft.taskId,
    ticketNumber: draft.task?.ticketNumber || undefined,
    draftType: draft.type.toLowerCase(),
    text: draft.content,
    status: 'Draft',
    updatedAt: draft.updatedAt instanceof Date ? draft.updatedAt.toISOString() : draft.updatedAt,
    createdBy: draft.user ? {
      id: draft.user.id,
      email: draft.user.email,
      displayName: draft.user.displayName || undefined
    } : undefined
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ draft_id: string }> }) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized. Invalid or missing authentication token.",
        },
        { status: 401 }
      );
    }
    const user = ctx.user;

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    const draftId = parseInt(params.draft_id)
    if (isNaN(draftId) || draftId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid draft_id', message: 'draft_id must be a positive integer' },
        { status: 400 }
      )
    }

    let body: { text: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', message: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }

    const { text } = body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Validation error', message: 'text is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    const draft = await findDraftWithAccess(draftId, user.id)

    if (!draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    const project = draft.task.project
    const hasAccess = project.ownerId === user.id || project.members.some((m) => m.userId === user.id)

    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Permission denied', message: 'You do not have access to this task' },
        { status: 403 }
      )
    }

    if (draft.userId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Permission denied', message: 'You can only update your own drafts' },
        { status: 403 }
      )
    }

    const updatedDraft = await prisma.drafts.update({
      where: { id: draftId },
      data: {
        content: text,
        updatedAt: new Date()
      },
      include: {
        task: { select: { ticketNumber: true } },
        user: { select: { id: true, email: true, displayName: true } }
      }
    })

    const response: UpdateDraftResponse = {
      success: true,
      draft: mapDraftToResponse(updatedDraft),
      message: 'Draft updated successfully'
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[MCP PATCH Draft] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ draft_id: string }> }) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized. Invalid or missing authentication token.",
        },
        { status: 401 }
      );
    }
    const user = ctx.user;

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    const draftId = parseInt(params.draft_id)
    if (isNaN(draftId) || draftId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid draft_id', message: 'draft_id must be a positive integer' },
        { status: 400 }
      )
    }

    const draft = await findDraftWithAccess(draftId, user.id)

    if (!draft) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
    }

    const project = draft.task.project
    const hasAccess = project.ownerId === user.id || project.members.some((m) => m.userId === user.id)

    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Permission denied', message: 'You do not have access to this task' },
        { status: 403 }
      )
    }

    if (draft.userId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Permission denied', message: 'You can only delete your own drafts' },
        { status: 403 }
      )
    }

    await prisma.drafts.delete({ where: { id: draftId } })

    const response: DeleteDraftResponse = {
      success: true,
      message: 'Draft deleted successfully'
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[MCP DELETE Draft] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
