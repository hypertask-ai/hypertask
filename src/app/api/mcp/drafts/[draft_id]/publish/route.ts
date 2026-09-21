import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import {
  persistUrlsForComment,
  persistUrlsForDescription,
} from '@/utils/controllers/urls/extractUrlsFromContent'
import { signSession, SESSION_COOKIE } from '@/lib/auth/session'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'

interface PublishDraftResponse {
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

export async function POST(request: NextRequest, props: { params: Promise<{ draft_id: string }> }) {
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
        { success: false, error: 'Permission denied', message: 'You can only publish your own drafts' },
        { status: 403 }
      )
    }

    const taskId = draft.taskId
    const taskTicketNumber = draft.task.ticketNumber || `Task #${taskId}`

    if (draft.type === 'Comment') {
      const taskWithOwner = await prisma.task.findUnique({
        where: { id: taskId },
        select: { userId: true }
      })

      if (!taskWithOwner) {
        return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
      }

      const userObj = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, displayName: true, photoURL: true }
      })

      if (!userObj) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
      }

      const comment = await createCommentService({
        text: draft.content,
        creatorId: user.id,
        taskId: taskId,
        ownerId: taskWithOwner.userId,
        currentUser: userObj,
        agentId: ctx.agentId || undefined,
      })

      await persistUrlsForComment(draft.content, taskId, comment.id, 'POST')

      const response: PublishDraftResponse = {
        success: true,
        message: `Draft published — comment added to ${taskTicketNumber}`
      }

      return NextResponse.json(response)
    }

    if (draft.type === 'Description') {
      const userObj = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, displayName: true, photoURL: true }
      })

      if (!userObj) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASEURL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

      const userCookie = JSON.stringify(slimUserForCookie({
        id: userObj.id,
        email: userObj.email,
        displayName: userObj.displayName,
        photoURL: userObj.photoURL ?? undefined
      }))
      const sessionToken = signSession({ id: userObj.id, email: userObj.email })
      const authCookieHeader = `nookies_user=${encodeURIComponent(userCookie)}; ${SESSION_COOKIE}=${sessionToken}`

      const singleResponse = await fetch(`${baseUrl}/api/tasks/single`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookieHeader
        },
        body: JSON.stringify({
          newTask: {
            id: taskId,
            description: draft.content
          },
          // Without this the TaskUpdateDescription notification is stored with
          // fromAgentId = null, so an agent-written description looks
          // human-authored and lands in Important instead of Updates. Every
          // other agent path already tags itself (HTPR-4719).
          ...(ctx.agentId ? { agentId: ctx.agentId } : {})
        })
      })

      if (!singleResponse.ok) {
        const errorData = await singleResponse.json().catch(() => ({ message: 'Failed to update task description' }))
        return NextResponse.json(
          { success: false, error: errorData.message || `Failed to publish: ${singleResponse.status}` },
          { status: singleResponse.status }
        )
      }

      await persistUrlsForDescription(draft.content, taskId)

      const response: PublishDraftResponse = {
        success: true,
        message: `Draft published — description updated for ${taskTicketNumber}`
      }

      return NextResponse.json(response)
    }

    return NextResponse.json(
      { success: false, error: 'Unknown draft type' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[MCP POST Publish Draft] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
