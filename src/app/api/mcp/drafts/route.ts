import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { findTaskByIdentifier, validateTaskIdentifier } from '@/lib/mcp/tasks/resolveTask'

export interface DraftItem {
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

export interface CreateDraftResponse {
  success: boolean
  draft: DraftItem
  message: string
}

export interface ListDraftsResponse {
  success: boolean
  drafts: DraftItem[]
}

function mapDraftToResponse(draft: any): DraftItem {
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

export async function POST(request: NextRequest) {
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

    let body: {
      ticket_number?: string
      task_id?: number
      unique_index?: number
      project_id?: number
      draft_type: string
      text: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', message: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }

    const { ticket_number, task_id, unique_index, project_id, draft_type, text } = body

    if (!draft_type || !['description', 'comment'].includes(draft_type)) {
      return NextResponse.json(
        { success: false, error: 'Validation error', message: 'draft_type must be "description" or "comment"' },
        { status: 400 }
      )
    }

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Validation error', message: 'text is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    const validation = validateTaskIdentifier({ task_id, ticket_number, unique_index, project_id })
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }

    const task = await findTaskByIdentifier(
      user,
      { task_id, ticket_number, unique_index, project_id },
      ctx.agentId
    )
    if (!task) {
      return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 })
    }

    const draftTypeEnum = draft_type === 'comment' ? 'Comment' as const : 'Description' as const

    const existing = await prisma.drafts.findFirst({
      where: {
        taskId: task.id,
        type: draftTypeEnum,
        userId: user.id
      }
    })

    if (existing) {
      const newDraft = await prisma.drafts.update({
        where: {
          id: existing.id
        },
        data:{
          content: text,
          saved: false,
          // Drafts.updatedAt is @default(now()) with no @updatedAt, so an update
          // keeps the original timestamp unless we set it here.
          updatedAt: new Date(),
        },
        include: {
          task: { select: { ticketNumber: true } },
          user: { select: { id: true, email: true, displayName: true } }
        }
      })
      const response: CreateDraftResponse = {
        success: true,
        draft: mapDraftToResponse(newDraft),
        message: 'Draft updated successfully'
      }
  
      return NextResponse.json(response, { status: 200 })
    }

    const draft = await prisma.drafts.create({
      data: {
        taskId: task.id,
        projectId: task.projectId,
        type: draftTypeEnum,
        content: text,
        userId: user.id,
        saved: false
      },
      include: {
        task: { select: { ticketNumber: true } },
        user: { select: { id: true, email: true, displayName: true } }
      }
    })

    const response: CreateDraftResponse = {
      success: true,
      draft: mapDraftToResponse(draft),
      message: 'Draft created successfully'
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    console.error('[MCP POST Draft] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
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

    const searchParams = request.nextUrl.searchParams
    const taskId = searchParams.get('task_id') ? parseInt(searchParams.get('task_id')!) : null
    const ticketNumber = searchParams.get('ticket_number') || undefined
    const uniqueIndexParam = searchParams.get('unique_index')
    const uniqueIndex = uniqueIndexParam ? (isNaN(parseInt(uniqueIndexParam)) ? null : parseInt(uniqueIndexParam)) : null
    const projectId = searchParams.get('project_id') ? parseInt(searchParams.get('project_id')!) : null

    const validation = validateTaskIdentifier({ task_id: taskId, ticket_number: ticketNumber, unique_index: uniqueIndex, project_id: projectId })
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }

    const task = await findTaskByIdentifier(
      user,
      {
        task_id: taskId,
        ticket_number: ticketNumber,
        unique_index: uniqueIndex,
        project_id: projectId,
      },
      ctx.agentId
    )

    if (!task) {
      return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 })
    }

    const drafts = await prisma.drafts.findMany({
      // Drafts are private, unpublished text. Every other draft route already
      // refuses to touch someone else's; listing leaked theirs in full.
      where: { taskId: task.id, userId: user.id, content: { not: "<p></p>" }},
      include: {
        task: { select: { ticketNumber: true } },
        user: { select: { id: true, email: true, displayName: true } }
      },
      orderBy: { updatedAt: 'desc' }
    })

    const draftList = drafts.map(mapDraftToResponse)

    const response: ListDraftsResponse = {
      success: true,
      drafts: draftList
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[MCP GET Drafts] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
