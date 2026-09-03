import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { validateMcpAuth, checkMcpRateLimit, mcpUnauthorizedResponse } from '@/lib/mcp/auth'
import type { McpAgentSummary } from '@/lib/mcp/agents'
import { getMcpSessionAgentSummary, mapMcpAgent, mcpAgentSelect } from '@/lib/mcp/agents'
import prisma from '@/lib/prisma'
import {
  buildMcpImageUrls,
  persistUrlsForComment,
} from '@/utils/controllers/urls/extractUrlsFromContent'
import { convertPlainTextMentionsToHtml, resolveTextMentions } from '@/utils/controllers/comments/processMentions'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import { AgentInvocationNotPendingError } from '@/utils/controllers/comments/agentInvocationCorrelation'
import { findTaskByIdentifier, validateTaskIdentifier } from '@/lib/mcp/tasks/resolveTask'
import { validateProjectMemberIds } from '@/lib/mcp/tasks/services'
import { broadcastTaskComment } from '@/lib/realtime/server'
import { sanitizeRichHtml } from '@/utils/helperFunctions/sanitizeRichHtml'
import { extractTipTapContent } from '@/utils/helperFunctions/multiPages'
import { normalizeBlockHtml } from '@/lib/mcp/normalizeBlockHtml'
import { formatRichTextInput } from '@/utils/helperFunctions/markdownToHtml'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { CONTENT_TYPE_ALLOWED_VALUES } from '@/lib/mcp/tasks/validators'
import { withActivityMetadata } from '@/lib/mcp/comments/activityMetadata'
import { requireRole } from '@/lib/mcp/agents/scopes'
import {
  IdempotencyInProgressError,
  normalizeIdempotencyKey,
  withIdempotency,
} from '@/lib/mcp/idempotency/idempotencyStore'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import {
  commentReactionInclude,
  mapMcpCommentReaction,
  type McpCommentReaction,
} from '@/lib/mcp/comments/reactionResponse'
import { isAgentVisibleToUser } from '@/lib/agents/visibility'

export interface CommentItem {
  id: number
  text: string
  commentText: string
  createdAt: string
  /** Present only when include_activity=true so callers can distinguish row kinds. */
  type?: 'comment' | 'activity'
  /** Raw activity payload, matching the app comment endpoint. Present only when include_activity=true. */
  activity?: Prisma.JsonValue | null
  creatorId?: number
  creator?: {
    id: number
    email: string
    displayName?: string
  }
  agent?: McpAgentSummary
  /** Preserved display name when the comment's managed agent was deleted. */
  agent_display_name?: string
  attachments?: Array<{
    id: number
    fileName: string
    fileType: string
    fileSize: number | string
    fileSource: string // URL to the attachment
  }>
  reactions?: McpCommentReaction[]
}

export interface ListCommentsResponse {
  success: boolean
  comments: CommentItem[]
  total: number
  limit: number
  offset: number
}

export interface McpMentionInput {
  user_id: number
  display_name: string
}

export interface AddCommentRequest {
  dry_run?: boolean
  task_id?: number
  ticket_number?: string
  unique_index?: number
  text: string
  content_type?: 'html' | 'markdown'
  project_id?: number
  images?: string[] // Array of S3 image URLs
  /** Optional: when MCP sends plain text like "@John Doe", pass mentions to convert to HTML and trigger notifications */
  mentions?: McpMentionInput[]
  /** Source comment ID when an authenticated agent directly answers a request. */
  reply_to_comment_id?: number
  /**
   * Durable invocation token when an authenticated agent directly answers a
   * request: the agent's `Mentioned` notification ID. Use this for description
   * mentions, which have no source comment.
   */
  reply_to_invocation_id?: number
}

export interface AddCommentResponse {
  success: boolean
  idempotent_replayed?: true
  /** MCP session agent that performed this action */
  agent?: McpAgentSummary
  comment: {
    id: number
    text: string
    createdAt: string
    creatorId?: number
    agent?: McpAgentSummary
    attachments?: Array<{
      id: number
      fileName: string
      fileType: string
      fileSize: string
      fileSource?: string
    }>
  }
}

// Shared comment include structure
const commentInclude = {
  creator: {
    select: {
      id: true,
      email: true,
      displayName: true
    }
  },
  agent: {
    select: { ...mcpAgentSelect, userId: true, visibility: true },
  },
  attachments: {
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      fileSource: true
    }
  },
  reactions: commentReactionInclude
}

// Helper function to map comment to response format. Activity-inclusive responses
// retain the app endpoint's raw activity payload and add an explicit row type.
function mapCommentToResponse(
  comment: any,
  userId: number,
  includeActivity = false
): CommentItem {
  const agentVisible =
    !comment.agent || isAgentVisibleToUser(comment.agent, userId)
  const agent = mapMcpAgent(agentVisible ? comment.agent : null)
  const agentDisplayName = agentVisible
    ? comment.agentDisplayName
    : 'Private agent'
  const mappedComment: CommentItem = {
    id: comment.id,
    text: comment.text,
    commentText: comment.commentText || comment.text,
    createdAt: comment.createdAt.toISOString(),
    creatorId: comment.creatorId || undefined,
    creator: comment.creator ? {
      id: comment.creator.id,
      email: comment.creator.email,
      displayName: comment.creator.displayName || undefined
    } : undefined,
    ...(agent ? { agent } : {}),
    ...(agentDisplayName
      ? { agent_display_name: agentDisplayName }
      : {}),
    attachments: comment.attachments.map((a: any) => ({
      id: a.id,
      fileName: a.fileName || '',
      fileType: a.fileType,
      fileSize: a.fileSize ? (typeof a.fileSize === 'string' ? parseInt(a.fileSize) || 0 : a.fileSize) : 0,
      fileSource: a.fileSource || ''
    })),
    reactions: comment.reactions.map(mapMcpCommentReaction)
  }

  if (!includeActivity) return mappedComment

  return withActivityMetadata(mappedComment, comment.activity)
}

/**
 * GET /api/mcp/comments
 *
 * Gets all user comments for a specific task. Activity logs (assignments, moves, etc.) are excluded
 * unless include_activity=true. Activity-inclusive history matches the app endpoint's chronological order.
 * Supports pagination and sorting by creation date for the default comments-only response.
 */
export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return await mcpUnauthorizedResponse(request)
    }
    const user = ctx.user;
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const taskId = searchParams.get('task_id') ? parseInt(searchParams.get('task_id')!) : null
    const ticketNumber = searchParams.get('ticket_number') || undefined
    const uniqueIndexParam = searchParams.get('unique_index')
    const uniqueIndex = uniqueIndexParam ? (isNaN(parseInt(uniqueIndexParam)) ? null : parseInt(uniqueIndexParam)) : null
    const projectId = searchParams.get('project_id') ? parseInt(searchParams.get('project_id')!) : null
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0)
    const requestedSortOrder = searchParams.get('sort_order')
    const sortOrder = requestedSortOrder || 'desc'
    const includeActivity = searchParams.get('include_activity') === 'true'

    // Validate task identifier
    const validation = validateTaskIdentifier({ task_id: taskId, ticket_number: ticketNumber, unique_index: uniqueIndex, project_id: projectId })
    if (!validation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error
        },
        { status: 400 }
      )
    }

    // Find task
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
      return NextResponse.json(
        {
          success: false,
          error: 'Task not found or access denied'
        },
        { status: 404 }
      )
    }

    // Keep the existing comments-only filter unless activity was explicitly requested.
    const commentWhere: Prisma.CommentWhereInput = includeActivity
      ? { taskId: task.id }
      : { taskId: task.id, activity: { equals: Prisma.DbNull } }

    // Count the same row set returned below so pagination metadata stays accurate.
    const total = await prisma.comment.count({
      where: commentWhere
    })

    // History reads oldest-first, like the app endpoint, unless the caller asked
    // for an order explicitly. An explicit sort_order always wins.
    const effectiveSortOrder =
      includeActivity && !requestedSortOrder ? 'asc' : (sortOrder as 'asc' | 'desc')
    const comments = await prisma.comment.findMany({
      where: commentWhere,
      include: commentInclude,
      orderBy: {
        createdAt: effectiveSortOrder
      },
      take: limit,
      skip: offset
    })

    // Transform to response format
    const commentList: CommentItem[] = comments.map((comment) =>
      mapCommentToResponse(comment, user.id, includeActivity)
    )

    const response: ListCommentsResponse = {
      success: true,
      comments: commentList,
      total,
      limit,
      offset
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error getting comments:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/mcp/comments
 * 
 * Adds a comment to a task.
 */
export async function POST(request: NextRequest) {
  try {
    // Validate authentication
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return await mcpUnauthorizedResponse(request)
    }
    if (ctx.agentId) {
      const scopeError = await requireRole(ctx, 'write')
      if (scopeError) return scopeError
    }
    const user = ctx.user;
    // Parse request body
    const parsedBody = await readJsonBody<AddCommentRequest>(request)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body
    const { dry_run, task_id, ticket_number, unique_index, text, content_type, project_id, images, mentions, reply_to_comment_id, reply_to_invocation_id } = body
    if (dry_run !== undefined && typeof dry_run !== 'boolean') {
      return NextResponse.json(
        buildFieldError('invalid_field', 'dry_run', 'dry_run must be a boolean'),
        { status: 400 }
      )
    }
    const dryRun = dry_run ?? false
    const { dry_run: _dryRun, ...idempotencyBody } = body

    if (
      reply_to_comment_id !== undefined &&
      (!Number.isSafeInteger(reply_to_comment_id) || reply_to_comment_id <= 0)
    ) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'reply_to_comment_id',
          'reply_to_comment_id must be a positive integer'
        ),
        { status: 400 }
      )
    }
    if (reply_to_comment_id !== undefined && !ctx.agentId) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'reply_to_comment_id',
          'reply_to_comment_id is only supported for authenticated agent replies'
        ),
        { status: 400 }
      )
    }

    if (
      reply_to_invocation_id !== undefined &&
      (!Number.isSafeInteger(reply_to_invocation_id) || reply_to_invocation_id <= 0)
    ) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'reply_to_invocation_id',
          'reply_to_invocation_id must be a positive integer'
        ),
        { status: 400 }
      )
    }
    if (reply_to_invocation_id !== undefined && !ctx.agentId) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'reply_to_invocation_id',
          'reply_to_invocation_id is only supported for authenticated agent replies'
        ),
        { status: 400 }
      )
    }
    // Both identify the same invocation. Accepting two conflicting pointers
    // would let one reply claim a request it was not answering.
    if (
      reply_to_invocation_id !== undefined &&
      reply_to_comment_id !== undefined
    ) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'reply_to_invocation_id',
          'Provide either reply_to_comment_id or reply_to_invocation_id, not both'
        ),
        { status: 400 }
      )
    }

    let clientIdempotencyKey: string | null
    try {
      clientIdempotencyKey = normalizeIdempotencyKey(
        request.headers.get('Idempotency-Key')
      )
    } catch (error) {
      return NextResponse.json(
        {
          ...buildFieldError(
            'invalid_field',
            'Idempotency-Key',
            error instanceof Error ? error.message : 'Invalid Idempotency-Key header'
          ),
          ...(dryRun && { valid: false })
        },
        { status: 400 }
      )
    }

    // Validate input
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        {
          ...buildFieldError('missing_field', 'text', 'Comment text is required'),
          ...(dryRun && { valid: false })
        },
        { status: 400 }
      )
    }

    if (text.length > 5000) {
      return NextResponse.json(
        {
          ...buildFieldError(
            'invalid_field',
            'text',
            'Comment text must be 5000 characters or less'
          ),
          ...(dryRun && { valid: false })
        },
        { status: 400 }
      )
    }

    if (content_type !== undefined && content_type !== 'html' && content_type !== 'markdown') {
      return NextResponse.json(
        {
          ...buildFieldError(
            'invalid_field',
            'content_type',
            'Invalid content_type. Must be one of: html, markdown',
            CONTENT_TYPE_ALLOWED_VALUES
          ),
          ...(dryRun && { valid: false })
        },
        { status: 400 }
      )
    }

    // Validate task identifier
    const validation = validateTaskIdentifier({ task_id, ticket_number, unique_index, project_id })
    if (!validation.valid) {
      return NextResponse.json(
        {
          ...buildFieldError(validation.code, validation.field, validation.error),
          ...(dryRun && { valid: false })
        },
        { status: 400 }
      )
    }

    // Validate ticket_number format if provided
    if (ticket_number && !/^[a-zA-Z0-9_-]+$/.test(ticket_number)) {
      return NextResponse.json(
        {
          ...buildFieldError(
            'invalid_field',
            'ticket_number',
            'Invalid ticket_number format'
          ),
          ...(dryRun && { valid: false })
        },
        { status: 400 }
      )
    }

    // Validate images (optional array of S3 URLs)
    if (images !== undefined) {
      if (!Array.isArray(images)) {
        return NextResponse.json(
          {
            ...buildFieldError(
              'invalid_field',
              'images',
              'images must be an array of strings'
            ),
            ...(dryRun && { valid: false })
          },
          { status: 400 }
        )
      }

      // Validate each image URL is a string and looks like a URL
      for (let i = 0; i < images.length; i++) {
        const imageUrl = images[i]
        if (typeof imageUrl !== 'string' || imageUrl.trim().length === 0) {
          return NextResponse.json(
            {
              ...buildFieldError(
                'invalid_field',
                `images[${i}]`,
                `images[${i}] must be a non-empty string URL`
              ),
              ...(dryRun && { valid: false })
            },
            { status: 400 }
          )
        }

        // Basic URL validation (should start with http:// or https://)
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          return NextResponse.json(
            {
              ...buildFieldError(
                'invalid_field',
                `images[${i}]`,
                `images[${i}] must be a valid HTTP/HTTPS URL`
              ),
              ...(dryRun && { valid: false })
            },
            { status: 400 }
          )
        }
      }
    }

    if (mentions !== undefined) {
      if (!Array.isArray(mentions)) {
        return NextResponse.json(
          {
            ...buildFieldError('invalid_field', 'mentions', 'mentions must be an array'),
            ...(dryRun && { valid: false })
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
            ...buildFieldError(
              'invalid_field',
              'mentions',
              'mentions must include positive integer user_id and non-empty display_name'
            ),
            ...(dryRun && { valid: false })
          },
          { status: 400 }
        )
      }
    }

    // Find task
    const task = await findTaskByIdentifier(
      user,
      {
        task_id,
        ticket_number,
        unique_index,
        project_id,
      },
      ctx.agentId
    )

    if (!task) {
      return NextResponse.json(
        {
          ...buildFieldError(
            'not_found',
            'task_id/ticket_number',
            'Task not found or access denied'
          ),
          ...(dryRun && { valid: false })
        },
        { status: 404 }
      )
    }

    // Get task owner for the API call
    const taskWithOwner = await prisma.task.findUnique({
      where: { id: task.id },
      select: { userId: true, projectId: true }
    })

    if (!taskWithOwner) {
      return NextResponse.json(
        {
          ...buildFieldError('not_found', 'task_id/ticket_number', 'Task not found'),
          ...(dryRun && { valid: false })
        },
        { status: 404 }
      )
    }

    if (mentions && mentions.length > 0) {
      const memberCheck = await validateProjectMemberIds(
        taskWithOwner.projectId,
        mentions.map((mention) => mention.user_id)
      )

      if (memberCheck.error) {
        return NextResponse.json(
          {
            ...buildFieldError(
              memberCheck.error.status === 404 ? 'not_found' : 'invalid_field',
              'mentions',
              memberCheck.error.message
            ),
            ...(dryRun && { valid: false })
          },
          { status: memberCheck.error.status }
        )
      }

      if (memberCheck.invalidIds.length > 0) {
        return NextResponse.json(
          {
            ...buildFieldError(
              'invalid_field',
              'mentions',
              `User(s) ${memberCheck.invalidIds.join(', ')} are not members of this project and cannot be mentioned.`
            ),
            details: { field: 'mentions', code: 'not_project_member', invalidIds: memberCheck.invalidIds },
            ...(dryRun && { valid: false })
          },
          { status: 400 }
        )
      }
    }

    // Get user object for createCommentService (needs id, email, displayName, photoURL)
    const userObj = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        photoURL: true
      }
    })

    if (!userObj) {
      return NextResponse.json(
        {
          ...buildFieldError('not_found', 'user_id', 'User not found'),
          ...(dryRun && { valid: false })
        },
        { status: 404 }
      )
    }

    // Sanitize text (trim and normalize line endings)
    let sanitizedText = formatRichTextInput(
      text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      content_type
    )

    // Convert plain text @mentions to HTML when mentions array is provided (MCP format)
    if (mentions && mentions.length > 0) {
      sanitizedText = convertPlainTextMentionsToHtml(sanitizedText, mentions)
    }

    // Resolve any remaining plain "@Name" / "@<id>" tokens against project
    // members so CLI/MCP callers don't have to hand-write mention spans (HTPR-3783).
    sanitizedText = await resolveTextMentions(
      sanitizedText,
      taskWithOwner.projectId,
      user.id,
    )
    sanitizedText = sanitizeRichHtml(sanitizedText)
    sanitizedText = normalizeBlockHtml(sanitizedText)

    const textMentionIds = extractTipTapContent(sanitizedText).mentions.map((id) => parseInt(id, 10))
    if (textMentionIds.length > 0) {
      const memberCheck = await validateProjectMemberIds(
        taskWithOwner.projectId,
        textMentionIds
      )

      if (memberCheck.error) {
        return NextResponse.json(
          {
            ...buildFieldError(
              memberCheck.error.status === 404 ? 'not_found' : 'invalid_field',
              'text',
              memberCheck.error.message
            ),
            ...(dryRun && { valid: false })
          },
          { status: memberCheck.error.status }
        )
      }

      if (memberCheck.invalidIds.length > 0) {
        return NextResponse.json(
          {
            ...buildFieldError(
              'invalid_field',
              'text',
              `User(s) ${memberCheck.invalidIds.join(', ')} are not members of this project and cannot be mentioned.`
            ),
            details: { field: 'text', code: 'not_project_member', invalidIds: memberCheck.invalidIds },
            ...(dryRun && { valid: false })
          },
          { status: 400 }
        )
      }
    }

    if (dryRun) {
      return NextResponse.json(
        {
          success: true,
          dry_run: true,
          valid: true,
          would: {
            task_id: task.id,
            text: sanitizedText,
            content_type: 'html',
            images: images || [],
            mentions: mentions || [],
            ...(reply_to_comment_id === undefined ? {} : { reply_to_comment_id }),
            ...(reply_to_invocation_id === undefined
              ? {}
              : { reply_to_invocation_id })
          }
        },
        { status: 200 }
      )
    }

    const mcpResponse = await withIdempotency(
      'create_comment',
      user.id,
      clientIdempotencyKey,
      idempotencyBody,
      async (): Promise<AddCommentResponse> => {
        const comment = await createCommentService({
          text: sanitizedText,
          creatorId: user.id,
          taskId: task.id,
          ownerId: taskWithOwner.userId,
          currentUser: userObj,
          agentId: ctx.agentId || undefined,
          directReplySourceCommentId: ctx.agentId ? reply_to_comment_id : undefined,
          directReplyInvocationId: ctx.agentId ? reply_to_invocation_id : undefined
        })

        void broadcastTaskComment(task.id, { originUserId: user.id })

        const imageUrls =
          images && images.length > 0 ? buildMcpImageUrls(images, task.id) : []

        await persistUrlsForComment(
          sanitizedText,
          task.id,
          comment.id,
          'POST',
          imageUrls
        )

        // Fetch comment with attachments for response
        const commentWithAttachments = await prisma.comment.findUnique({
          where: { id: comment.id },
          include: commentInclude
        })

        const mappedComment = commentWithAttachments
          ? mapCommentToResponse(commentWithAttachments, user.id)
          : null

        const sessionAgent = await getMcpSessionAgentSummary(ctx.agentId, user.id);

        return {
          success: true,
          ...(sessionAgent ? { agent: sessionAgent } : {}),
          comment: {
            id: comment.id,
            text: comment.text || sanitizedText,
            createdAt: (comment.createdAt instanceof Date ? comment.createdAt : new Date()).toISOString(),
            creatorId: comment.creatorId || user.id,
            ...(mappedComment?.agent ? { agent: mappedComment.agent } : {}),
            attachments: mappedComment?.attachments?.map(att => ({
              id: att.id,
              fileName: att.fileName,
              fileType: att.fileType,
              fileSize: String(att.fileSize),
              fileSource: att.fileSource,
            })) || []
          }
        }
      }
    )

    return NextResponse.json(mcpResponse, { status: 201 })
  } catch (error) {
    if (error instanceof AgentInvocationNotPendingError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 409 }
      )
    }
    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 409 }
      )
    }
    console.error('Error adding comment:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
}
