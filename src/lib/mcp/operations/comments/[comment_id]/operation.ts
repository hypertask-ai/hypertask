import { AgentWritingError } from '@/lib/agents/writing'
import { enforceAgentWriting } from '@/lib/agents/writingEnforcement'
import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";
import { inlineAgentImagesForUser } from "@/lib/media/inlineAgentImages.server";
import { agentScopeEnforced, recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { userCanAccessTask } from "@/utils/controllers/tasks/assertTaskAccess"
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import type { McpAgentSummary } from '@/lib/mcp/agents'
import { mapVisibleMcpAgent, mcpVisibleAgentSelect } from '@/lib/mcp/agents'
import { loadVisibleReactionAgents } from '@/lib/mcp/comments/visibleReactionAgents'
import { resolvePublicAgentDisplayName } from '@/lib/agents/publicAgent'
import prisma from '@/lib/prisma'
import { convertPlainTextMentionsToHtml } from '@/utils/controllers/comments/processMentions'
import { updateCommentService } from '@/utils/controllers/comments/updateCommentService'
import { deleteCommentService } from '@/utils/controllers/comments/deleteCommentService'
import { persistUrlsForComment } from '@/utils/controllers/urls/extractUrlsFromContent'
import { generalConfig } from '@/lib/configs/general.config'
import { broadcastTaskComment } from '@/lib/realtime/server'
import { validateProjectMemberIds } from '@/lib/mcp/tasks/services'
import { sanitizeRichHtml } from '@/utils/helperFunctions/sanitizeRichHtml'
import { extractTipTapContent } from '@/utils/helperFunctions/multiPages'
import { normalizeBlockHtml } from '@/lib/mcp/normalizeBlockHtml'
import { CONTENT_TYPE_ALLOWED_VALUES } from '@/lib/mcp/tasks/validators'
import { formatRichTextInput } from '@/utils/helperFunctions/markdownToHtml'

export interface McpMentionInput {
  user_id: number
  display_name: string
}

export interface UpdateCommentRequest {
  text: string
  inline_images?: boolean
  content_type?: 'html' | 'markdown'
  mentions?: McpMentionInput[]
}

export interface UpdateCommentResponse {
  success: boolean
  comment: {
    id: number
    text: string
    createdAt: string
    editedAt: string | null
    editedBy: { userId: number; agentId: string | null; isAgent?: true } | null
    creatorId?: number
    agent?: McpAgentSummary
    agent_display_name?: string
  }
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ comment_id: string }> }) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.'
        },
        { status: 401 }
      )
    }
    const roleRefusal = await requireAgentWriteRole(ctx)
    if (roleRefusal) return roleRefusal
    const user = ctx.user;
    const commentId = parseInt(params.comment_id)
    if (isNaN(commentId) || commentId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid comment_id',
          message: 'comment_id must be a positive integer'
        },
        { status: 400 }
      )
    }

    let body: UpdateCommentRequest
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          message: 'Request body must be valid JSON'
        },
        { status: 400 }
      )
    }

    if (body.inline_images !== undefined && typeof body.inline_images !== "boolean") {
      return NextResponse.json({ success: false, error: "inline_images must be a boolean" }, { status: 400 });
    }
    const { text, content_type, mentions } = body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Comment text is required',
          message: 'text must be a non-empty string'
        },
        { status: 400 }
      )
    }

    if (text.length > 5000) {
      return NextResponse.json(
        {
          success: false,
          error: 'Comment text must be 5000 characters or less'
        },
        { status: 400 }
      )
    }

    if (content_type !== undefined && content_type !== 'html' && content_type !== 'markdown') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid content_type. Must be one of: html, markdown',
          allowedValues: CONTENT_TYPE_ALLOWED_VALUES
        },
        { status: 400 }
      )
    }

    if (mentions !== undefined) {
      if (!Array.isArray(mentions)) {
        return NextResponse.json(
          {
            success: false,
            error: 'mentions must be an array'
          },
          { status: 400 }
        )
      }

      const invalidMention = mentions.find(
        (mention) =>
          !mention ||
          typeof mention.user_id !== 'number' ||
          !Number.isInteger(mention.user_id) ||
          mention.user_id <= 0 ||
          typeof mention.display_name !== 'string' ||
          mention.display_name.trim().length === 0
      )
      if (invalidMention) {
        return NextResponse.json(
          {
            success: false,
            error: 'mentions must include positive integer user_id and non-empty display_name'
          },
          { status: 400 }
        )
      }
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        task: {
          select: {
            id: true,
            projectId: true,
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

    if (!comment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Comment not found'
        },
        { status: 404 }
      )
    }

    const project = comment.task.project
    const hasAccess =
      ctx.agentId && agentScopeEnforced()
        ? await userCanAccessTask(user.id, comment.task.id, ctx.agentId, ctx.teamScope)
        : project.ownerId === user.id || project.members.some((m) => m.userId === user.id)

    if (!hasAccess || (ctx.teamScope != null && !await userCanAccessTask(user.id, comment.task.id, ctx.agentId, ctx.teamScope))) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied',
          message: 'You do not have access to this task'
        },
        { status: 403 }
      )
    }
    recordAgentBoardScopeMiss(comment.task.projectId, "write");

    if (comment.creatorId !== user.id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied',
          message: 'You can only edit your own comments'
        },
        { status: 403 }
      )
    }

    if (mentions && mentions.length > 0) {
      const memberCheck = await validateProjectMemberIds(
        comment.task.projectId,
        mentions.map((mention) => mention.user_id)
      )

      if (memberCheck.error) {
        return NextResponse.json(
          {
            success: false,
            error: memberCheck.error.message
          },
          { status: memberCheck.error.status }
        )
      }

      if (memberCheck.invalidIds.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `User(s) ${memberCheck.invalidIds.join(', ')} are not members of this project and cannot be mentioned.`,
            details: { field: 'mentions', code: 'not_project_member', invalidIds: memberCheck.invalidIds }
          },
          { status: 400 }
        )
      }
    }

    let sanitizedText = formatRichTextInput(
      text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      content_type
    )
    if (mentions && mentions.length > 0) {
      sanitizedText = convertPlainTextMentionsToHtml(sanitizedText, mentions)
    }
    sanitizedText = await inlineAgentImagesForUser(sanitizeRichHtml(sanitizedText), user.id, { inlineImages: body.inline_images })
    sanitizedText = normalizeBlockHtml(sanitizedText)

    const textMentionIds = extractTipTapContent(sanitizedText).mentions.map((id) => parseInt(id, 10))
    if (textMentionIds.length > 0) {
      const memberCheck = await validateProjectMemberIds(
        comment.task.projectId,
        textMentionIds
      )

      if (memberCheck.error) {
        return NextResponse.json(
          {
            success: false,
            error: memberCheck.error.message
          },
          { status: memberCheck.error.status }
        )
      }

      if (memberCheck.invalidIds.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `User(s) ${memberCheck.invalidIds.join(', ')} are not members of this project and cannot be mentioned.`,
            details: { field: 'text', code: 'not_project_member', invalidIds: memberCheck.invalidIds }
          },
          { status: 400 }
        )
      }
    }

    await enforceAgentWriting(ctx.user.id, ctx.agentId, { text: sanitizedText }, { text: comment.text })
    const updatedComment = await updateCommentService({
      commentId,
      text: sanitizedText,
      userId: user.id,
      agentId: ctx.agentId, teamScope: ctx.teamScope,
    })

    await persistUrlsForComment(
      sanitizedText,
      comment.task.id,
      commentId,
      'PUT',
      [],
      { userId: user.id, agentId: ctx.agentId, teamScope: ctx.teamScope }
    )

    const commentWithAgent = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        agentDisplayName: true,
        agent: {
          select: mcpVisibleAgentSelect(user.id, comment.task.projectId),
        },
      },
    })
    const agent = mapVisibleMcpAgent(
      commentWithAgent?.agent,
      user.id,
      comment.task.projectId
    )

    const editorAgents = await loadVisibleReactionAgents(
      updatedComment.editedByAgentId ? [updatedComment.editedByAgentId] : [],
      user.id,
      comment.task.projectId
    )
    const response: UpdateCommentResponse = {
      success: true,
      comment: {
        id: updatedComment.id,
        text: updatedComment.text,
        createdAt: updatedComment.createdAt.toISOString(),
        editedAt: updatedComment.editedAt?.toISOString() ?? null,
        editedBy: updatedComment.editedByUserId != null
          ? {
              userId: updatedComment.editedByUserId,
              agentId: updatedComment.editedByAgentId && editorAgents.has(updatedComment.editedByAgentId) ? updatedComment.editedByAgentId : null,
              ...(updatedComment.editedByAgentId ? { isAgent: true as const } : {})
            }
          : null,
        creatorId: updatedComment.creatorId ?? undefined,
        ...(agent ? { agent } : {}),
      }
    }
    const agentDisplayName = resolvePublicAgentDisplayName({
      hasAgentRow: Boolean(commentWithAgent?.agent),
      visibleAgent: agent,
      storedDisplayName: commentWithAgent?.agentDisplayName,
    })
    if (agentDisplayName) response.comment.agent_display_name = agentDisplayName

    void broadcastTaskComment(comment.task.id, { originUserId: user.id })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof AgentWritingError) return NextResponse.json({ success: false, error: error.message, code: error.code, field: error.field }, { status: 400 })
    console.error('[MCP PATCH Comment] Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred'
      },
      { status: 500 }
    )
  }

  })(request)
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ comment_id: string }> }) {
  return wrapMcpRoute(async (request: NextRequest) => {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)

    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.'
        },
        { status: 401 }
      )
    }
    const roleRefusal = await requireAgentWriteRole(ctx)
    if (roleRefusal) return roleRefusal
    const user = ctx.user;
    const commentId = parseInt(params.comment_id)
    if (isNaN(commentId) || commentId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid comment_id',
          message: 'comment_id must be a positive integer'
        },
        { status: 400 }
      )
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        task: {
          select: {
            id: true,
            projectId: true,
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

    if (!comment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Comment not found'
        },
        { status: 404 }
      )
    }

    const project = comment.task.project
    const hasAccess =
      ctx.agentId && agentScopeEnforced()
        ? await userCanAccessTask(user.id, comment.task.id, ctx.agentId, ctx.teamScope)
        : project.ownerId === user.id || project.members.some((m) => m.userId === user.id)

    if (!hasAccess || (ctx.teamScope != null && !await userCanAccessTask(user.id, comment.task.id, ctx.agentId, ctx.teamScope))) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied',
          message: 'You do not have access to this task'
        },
        { status: 403 }
      )
    }
    recordAgentBoardScopeMiss(comment.task.projectId, "write");

    const hyperAiId = parseInt(
      process.env.NEXT_PUBLIC_HYPERAI_ID || '332',
      10
    )
    const canDelete =
      comment.creatorId === user.id || comment.creatorId === hyperAiId

    if (!canDelete) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied',
          message: 'You can only delete your own comments'
        },
        { status: 403 }
      )
    }

    await deleteCommentService({
      commentId,
    })

    void broadcastTaskComment(comment.task.id, { originUserId: user.id })

    return NextResponse.json(
      {
        success: true,
        message: 'Comment deleted'
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[MCP DELETE Comment] Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred'
      },
      { status: 500 }
    )
  }

  })(request)
}
