import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import type { McpAgentSummary } from '@/lib/mcp/agents'
import { mapMcpAgent, mcpAgentSelect } from '@/lib/mcp/agents'
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
  content_type?: 'html' | 'markdown'
  mentions?: McpMentionInput[]
}

export interface UpdateCommentResponse {
  success: boolean
  comment: {
    id: number
    text: string
    createdAt: string
    creatorId?: number
    agent?: McpAgentSummary
  }
}

/**
 * PATCH /api/mcp/comments/:comment_id
 *
 * Updates a comment. User must be the comment creator.
 */
export async function PATCH(request: NextRequest, props: { params: Promise<{ comment_id: string }> }) {
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

    // Find comment with task and project for access check
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

    // Check project access
    const project = comment.task.project
    const hasAccess =
      project.ownerId === user.id ||
      project.members.some((m) => m.userId === user.id)

    if (!hasAccess) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied',
          message: 'You do not have access to this task'
        },
        { status: 403 }
      )
    }

    // Only the creator can edit
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

    // Sanitize and process mentions (MCP-specific: plain text @mentions to HTML)
    let sanitizedText = formatRichTextInput(
      text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      content_type
    )
    if (mentions && mentions.length > 0) {
      sanitizedText = convertPlainTextMentionsToHtml(sanitizedText, mentions)
    }
    sanitizedText = sanitizeRichHtml(sanitizedText)
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

    const updatedComment = await updateCommentService({
      commentId,
      text: sanitizedText,
      userId: user.id,
      agentId: ctx.agentId,
    })

    await persistUrlsForComment(
      sanitizedText,
      comment.task.id,
      commentId,
      'PUT'
    )

    const commentWithAgent = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        agent: { select: mcpAgentSelect },
      },
    })
    const agent = mapMcpAgent(commentWithAgent?.agent)

    const response: UpdateCommentResponse = {
      success: true,
      comment: {
        id: updatedComment.id,
        text: updatedComment.text,
        createdAt: updatedComment.createdAt.toISOString(),
        creatorId: updatedComment.creatorId ?? undefined,
        ...(agent ? { agent } : {}),
      }
    }

    void broadcastTaskComment(comment.task.id, { originUserId: user.id })

    return NextResponse.json(response)
  } catch (error) {
    console.error('[MCP PATCH Comment] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred'
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/mcp/comments/:comment_id
 *
 * Deletes a comment. User must have access to the task's project.
 */
export async function DELETE(request: NextRequest, props: { params: Promise<{ comment_id: string }> }) {
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

    // Check project access
    const project = comment.task.project
    const hasAccess =
      project.ownerId === user.id ||
      project.members.some((m) => m.userId === user.id)

    if (!hasAccess) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permission denied',
          message: 'You do not have access to this task'
        },
        { status: 403 }
      )
    }

    // Only the creator (or HyperAI) can delete
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

    // Only the creator (or HyperAI) can delete
    // const hyperAiId = parseInt(
    //   process.env.NEXT_PUBLIC_HYPERAI_ID || '332',
    //   10
    // )
    // const canDelete =
    //   comment.creatorId === user.id || comment.creatorId === hyperAiId

    // if (!canDelete) {
    //   return NextResponse.json(
    //     {
    //       success: false,
    //       error: 'Permission denied',
    //       message: 'You can only delete your own comments'
    //     },
    //     { status: 403 }
    //   )
    // }

    await deleteCommentService({
      commentId,
      // userId: user.id
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
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred'
      },
      { status: 500 }
    )
  }
}
