import { isPlanLimitReachedError, planLimitResponse } from '@/lib/planLimits';
import { IdempotencyAccessError } from "@/lib/mcp/idempotency/idempotencyStore"
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import type { AttachmentFileInput } from "@/lib/mcp-server/validations/attachment.validation";
import { HTPR_7514_INLINE_AGENT_IMAGES_FLAG } from "@/lib/flags/keys";
import { inlineAgentImagesForUser } from "@/lib/media/inlineAgentImages.server";
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit, mcpRouteUnauthorizedResponse as mcpUnauthorizedResponse, readMcpRouteJsonBody as readJsonBody } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

import type { McpAgentSummary } from '@/lib/mcp/agents'
import {
  getMcpSessionAgentSummary,
  mapVisibleMcpAgent,
  mcpVisibleAgentSelect,
} from '@/lib/mcp/agents'
import prisma from '@/lib/prisma'
import {
  buildMcpImageUrls,
  persistUrlsForComment,
} from '@/utils/controllers/urls/extractUrlsFromContent'
import { convertPlainTextMentionsToHtml, resolveTextMentions } from '@/utils/controllers/comments/processMentions'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import { AgentInvocationNotPendingError } from '@/utils/controllers/comments/agentInvocationCorrelation'
import { findTaskByIdentifier, taskIdentifierErrorResponse, validateTaskIdentifier } from '@/lib/mcp/tasks/resolveTask'
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

import { buildMcpTaskUrl } from '@/lib/mcp/boards/links'
import {
  commentReactionInclude,
  mapMcpCommentReaction,
  reactionAgentIds,
  type McpCommentReaction,
  type VisibleReactionAgents,
} from '@/lib/mcp/comments/reactionResponse'
import { loadVisibleReactionAgents } from '@/lib/mcp/comments/visibleReactionAgents'
import { overlayDurableAgentDisplayName } from '@/lib/agents/publicAgent'
import { isFeatureEnabled } from '@/lib/flags'
import { COMMENT_KINDS, parseCommentKind, routeComment, type CommentKind } from './agentChatterRouting'
import { HTPR_7341_AGENT_CHATTER_TO_LOG_FLAG, HTPR_7512_ATTACH_KEEPS_COMMENT_FLAG } from '@/lib/flags/keys'
import { parseNumericCursor, parseUpdatedSince, projectRows } from '@/lib/mcp/listQuery'
import { readListQuery } from '@/lib/mcp/readListQuery'

export interface CommentItem {
  id: number
  text: string
  commentText: string
  createdAt: string
  editedAt: string | null
  editedBy: { userId: number; agentId: string | null; isAgent?: true } | null
  type?: 'comment' | 'activity'
  activity?: Prisma.JsonValue | null
  creatorId?: number
  creator?: {
    id: number
    email: string
    displayName?: string
  }
  agent?: McpAgentSummary
  agent_display_name?: string
  attachments?: Array<{
    id: number
    fileName: string
    fileType: string
    fileSize: number | string
    fileSource: string
  }>
  reactions?: McpCommentReaction[]
}

export interface ListCommentsResponse {
  success: boolean
  comments: CommentItem[]
  total: number
  limit: number
  offset: number
  nextCursor?: string | null
}

export interface McpMentionInput {
  user_id: number
  display_name: string
}

export interface AddCommentRequest {
  dry_run?: boolean
  kind?: CommentKind
  task_id?: number
  ticket_number?: string
  unique_index?: number
  text: string
  attachments?: AttachmentFileInput[]
  inline_images?: boolean
  content_type?: 'html' | 'markdown'
  project_id?: number
  images?: string[]
  has_attachments?: boolean
  mentions?: McpMentionInput[]
  reply_to_comment_id?: number
  reply_to_invocation_id?: number
}

export type AddCommentResponse = {
  success: boolean
  routedTo: 'comments'
  visibleToPeople: true
  url: string
  idempotent_replayed?: true
  agent?: McpAgentSummary
  comment: {
    kind: string | null
    id: number
    text: string
    createdAt: string
    editedAt: string | null
    editedBy: { userId: number; agentId: string | null; isAgent?: true } | null
    creatorId?: number
    agent?: McpAgentSummary
    agent_display_name?: string
    attachments?: Array<{
      id: number
      fileName: string
      fileType: string
      fileSize: string
      fileSource?: string
    }>
  }
} | {
  success: boolean
  routedTo: 'log'
  visibleToPeople: false
  notice: string
  url: string
  idempotent_replayed?: true
  activity: {
    id: string
    runId: string
    type: string
    text: string
    createdAt: string
  }
}

type AgentLogPrincipal = { userId: number; agentId: string; teamScope: AgentTokenTeamScope | null; displayName: string; source: 'agent' }

async function prepareAgentLogEntry(principal: AgentLogPrincipal, html: string) {
  const { runtimeAgentRunsEnabledFor } = await import('@/lib/agentRuns/service')
  if (!(await runtimeAgentRunsEnabledFor(principal))) return null
  const { AGENT_RUN_ACTIVITY_TEXT_MAX_LENGTH } = await import('@/lib/agentRuns/model')
  const text = (await htmlToLogText(html)).slice(0, AGENT_RUN_ACTIVITY_TEXT_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, '')
  return text ? { principal, text } : null
}

async function htmlToLogText(html: string) {
  const { parse } = await import('node-html-parser')
  const root = parse(html)
  for (const anchor of root.querySelectorAll('a')) {
    const href = anchor.getAttribute('href')?.trim()
    const label = anchor.text.trim()
    if (!href || href === label) continue
    anchor.set_content(escapeHtmlText(label ? `${label} (${href})` : href))
  }
  return root.structuredText.trim()
}

function escapeHtmlText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const commentInclude = (userId: number, projectId: number) => ({
  creator: {
    select: {
      id: true,
      email: true,
      displayName: true
    }
  },
  agent: {
    select: mcpVisibleAgentSelect(userId, projectId),
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
})

function mapCommentToResponse(
  comment: any,
  userId: number,
  projectId: number,
  includeActivity = false,
  reactionAgents: VisibleReactionAgents = new Map()
): CommentItem {
  const agent = mapVisibleMcpAgent(comment.agent, userId, projectId)
  const agentVisible = !comment.agent ? !comment.agentDisplayName : Boolean(agent)
  const agentDisplayName = agentVisible
    ? comment.agentDisplayName
    : 'Private agent'
  const mappedComment: CommentItem = {
    id: comment.id,
    text: comment.text,
    commentText: comment.commentText || comment.text,
    createdAt: comment.createdAt.toISOString(),
    editedAt: comment.editedAt?.toISOString() ?? null,
    editedBy: comment.editedByUserId != null
      ? {
          userId: comment.editedByUserId,
          agentId: comment.editedByAgentId && reactionAgents.has(comment.editedByAgentId) ? comment.editedByAgentId : null,
          ...(comment.editedByAgentId ? { isAgent: true as const } : {})
        }
      : null,
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
    reactions: comment.reactions.map((reaction: Parameters<typeof mapMcpCommentReaction>[0]) =>
      mapMcpCommentReaction(reaction, reactionAgents)
    )
  }

  if (!includeActivity) return mappedComment

  return withActivityMetadata(mappedComment, comment.activity)
}

function applyDurableCommentAttribution<T extends object>(
  mapped: T,
  comment: any,
  userId: number,
  projectId: number
): T {
  return overlayDurableAgentDisplayName(mapped, {
    hasAgentRow: Boolean(comment.agent),
    visibleAgent: mapVisibleMcpAgent(comment.agent, userId, projectId),
    storedDisplayName: comment.agentDisplayName,
  })
}

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return await mcpUnauthorizedResponse(request)
    }
    const user = ctx.user;
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

    const parsedListQuery = readListQuery(searchParams)
    if (parsedListQuery.error) return parsedListQuery.error
    const listQuery = parsedListQuery.listQuery

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

    const task = await findTaskByIdentifier(
      user,
      {
        task_id: taskId,
        ticket_number: ticketNumber,
        unique_index: uniqueIndex,
        project_id: projectId,
      },
      ctx.agentId, undefined, ctx.teamScope
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

    const commentWhere: Prisma.CommentWhereInput = includeActivity
      ? { taskId: task.id }
      : { taskId: task.id, activity: { equals: Prisma.DbNull } }
    if (ctx.teamScope != null) commentWhere.task = { project: getProjectWhere(user.id, ctx.agentId, ctx.teamScope) }
    if (listQuery?.query) {
      commentWhere.text = { contains: listQuery.query, mode: 'insensitive' }
    }
    if (listQuery?.filter.updated_since) {
      const since = parseUpdatedSince(listQuery.filter.updated_since)
      if (!since) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation error',
            message: 'filter.updated_since must be an ISO datetime',
          },
          { status: 400 },
        )
      }
      commentWhere.createdAt = { gte: since }
    }

    const COMMENT_SORT_FIELDS = ['createdAt', 'id'] as const
    if (listQuery?.sortBy && !COMMENT_SORT_FIELDS.includes(listQuery.sortBy as 'createdAt' | 'id')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'sort must be createdAt or id',
        },
        { status: 400 },
      )
    }
    const cursorId = listQuery?.cursor ? parseNumericCursor(listQuery.cursor) : null
    if (listQuery?.cursor && cursorId === null) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'cursor must be a previous nextCursor value',
        },
        { status: 400 },
      )
    }

    const total = await prisma.comment.count({
      where: commentWhere
    })

    const sortField = listQuery?.sortBy === 'id' ? 'id' : 'createdAt'
    const effectiveSortOrder = requestedSortOrder
      ? (requestedSortOrder as 'asc' | 'desc')
      : listQuery?.sortOrder ??
        (includeActivity ? 'asc' : (sortOrder as 'asc' | 'desc'))
    const pageLimit = listQuery?.limit ?? limit
    const comments = await prisma.comment.findMany({
      where: commentWhere,
      include: commentInclude(user.id, task.projectId),
      orderBy: [
        { [sortField]: effectiveSortOrder },
        { id: effectiveSortOrder },
      ],
      take: pageLimit,
      skip: cursorId ? 1 : offset,
      ...(cursorId ? { cursor: { id: cursorId } } : {}),
    })

    const reactionAgents = await loadVisibleReactionAgents(
      [...new Set([
        ...reactionAgentIds(comments),
        ...comments.flatMap((comment) => comment.editedByAgentId ? [comment.editedByAgentId] : [])
      ])],
      user.id,
      task.projectId
    )

    const commentList: CommentItem[] = comments.map((comment) =>
      mapCommentToResponse(comment, user.id, task.projectId, includeActivity, reactionAgents)
    ).map((mapped, index) =>
      applyDurableCommentAttribution(
        mapped,
        comments[index],
        user.id,
        task.projectId
      )
    )

    const response: ListCommentsResponse = {
      success: true,
      comments: (listQuery?.fields.length
        // @ts-expect-error CommentItem has no string index signature
        ? projectRows(commentList as Array<Record<string, unknown>>, listQuery.fields)
        : commentList) as CommentItem[],
      total,
      limit: pageLimit,
      offset: cursorId ? 0 : offset,
      nextCursor: comments.length === pageLimit ? String(comments[comments.length - 1].id) : null,
    }

    return NextResponse.json(response)
  } catch (error) {
    const identifierResponse = taskIdentifierErrorResponse(error)
    if (identifierResponse) return identifierResponse
    console.error('Error getting comments:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }

  })(request)
}

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
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
    const parsedBody = await readJsonBody<AddCommentRequest>(request)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body
    if (body.inline_images !== undefined && typeof body.inline_images !== "boolean") {
      return NextResponse.json(buildFieldError("invalid_field", "inline_images", "inline_images must be a boolean"), { status: 400 });
    }
    let hasImageAttachments = false;
    if (body.attachments !== undefined && await isFeatureEnabled(HTPR_7514_INLINE_AGENT_IMAGES_FLAG, user.id)) {
      const { inlineAttachmentsSchema } = await import("@/lib/mcp-server/validations/attachment.validation");
      const attachmentInput = inlineAttachmentsSchema.safeParse(body.attachments);
      if (!attachmentInput.success) {
        return NextResponse.json(buildFieldError("invalid_field", "attachments", attachmentInput.error.issues[0]?.message ?? "Invalid attachments"), { status: 400 });
      }
      const { isBrowserRenderableImage } = await import("@/lib/media/browserRenderableImage");
      hasImageAttachments = attachmentInput.data?.some((file) => isBrowserRenderableImage(file.content_type, file.filename)) ?? false;
    }
    const { dry_run, task_id, ticket_number, unique_index, text, content_type, project_id, images, has_attachments, mentions, reply_to_comment_id, reply_to_invocation_id } = body
    if (dry_run !== undefined && typeof dry_run !== 'boolean') {
      return NextResponse.json(
        buildFieldError('invalid_field', 'dry_run', 'dry_run must be a boolean'),
        { status: 400 }
      )
    }
    if (has_attachments !== undefined && typeof has_attachments !== 'boolean') {
      return NextResponse.json(
        buildFieldError('invalid_field', 'has_attachments', 'has_attachments must be a boolean'),
        { status: 400 }
      )
    }
    const dryRun = dry_run ?? false
    let kind: CommentKind | undefined
    try {
      kind = parseCommentKind(body.kind)
    } catch (error) {
      return NextResponse.json(
        buildFieldError('invalid_field', 'kind', error instanceof Error ? error.message : 'Invalid kind', COMMENT_KINDS),
        { status: 400 }
      )
    }
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

    const task = await findTaskByIdentifier(
      user,
      {
        task_id,
        ticket_number,
        unique_index,
        project_id,
      },
      ctx.agentId, undefined, ctx.teamScope
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

    const taskWithOwner = await prisma.task.findUnique({
      where: { id: task.id },
      select: { userId: true, projectId: true, uniqueIndex: true }
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

    let sanitizedText = formatRichTextInput(
      text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      content_type
    )

    if (mentions && mentions.length > 0) {
      sanitizedText = convertPlainTextMentionsToHtml(sanitizedText, mentions)
    }

    sanitizedText = await resolveTextMentions(
      sanitizedText,
      taskWithOwner.projectId,
      user.id,
    )
    sanitizedText = await inlineAgentImagesForUser(sanitizeRichHtml(sanitizedText), user.id, { inlineImages: body.inline_images, attachments: images?.map((url: string) => ({ url })) })
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

    const agentLogPrincipal = ctx.agentId
      ? {
          userId: user.id,
          agentId: ctx.agentId,
          teamScope: ctx.teamScope,
          displayName: userObj.displayName?.trim() || 'Hypertask agent',
          source: 'agent' as const,
        }
      : null
    const agentLogEntry = routeComment({
      agentId: ctx.agentId,
      kind,
      replyToCommentId: reply_to_comment_id,
      replyToInvocationId: reply_to_invocation_id,
      mentionsPerson: textMentionIds.length > 0 || (mentions?.length ?? 0) > 0,
      hasImages: (images?.length ?? 0) > 0 || /<img\b/i.test(sanitizedText) || hasImageAttachments ||
        (has_attachments === true && await isFeatureEnabled(HTPR_7512_ATTACH_KEEPS_COMMENT_FLAG, user.id)),
      flagEnabled: await isFeatureEnabled(HTPR_7341_AGENT_CHATTER_TO_LOG_FLAG, user.id),
    }) === 'log' && agentLogPrincipal
      ? await prepareAgentLogEntry(agentLogPrincipal, sanitizedText)
      : null
    const routedTo = agentLogEntry ? 'log' as const : 'comments' as const

    if (dryRun) {
      return NextResponse.json(
        {
          success: true,
          dry_run: true,
          valid: true,
          would: {
            routedTo,
            ...(kind === undefined ? {} : { kind }),
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
        if (agentLogEntry) {
          const { createRuntimeAgentRun, createAgentRunActivity } = await import('@/lib/agentRuns/service')
          const { parseAgentRunActivityInput } = await import('@/lib/agentRuns/model')
          const run = await createRuntimeAgentRun(agentLogEntry.principal, { taskId: task.id, title: null, source: 'runtime' })
          const result = run
            ? await createAgentRunActivity(agentLogEntry.principal, run.id, parseAgentRunActivityInput({ type: 'thought', text: agentLogEntry.text }), clientIdempotencyKey)
            : null
          if (result) {
            const { id, runId, type, text, createdAt } = result.activity
            return {
              success: true,
              routedTo: 'log' as const,
              visibleToPeople: false,
              notice: 'Saved to the agent log, not the ticket thread; people do not see it. Resend with kind (question|qa|done) to post for people.',
              url: buildMcpTaskUrl(taskWithOwner.projectId, taskWithOwner.uniqueIndex),
              activity: { id, runId, type, text, createdAt },
            }
          }
        }

        const comment = await createCommentService({
          kind,
          text: sanitizedText,
          creatorId: user.id,
          taskId: task.id,
          ownerId: taskWithOwner.userId,
          currentUser: userObj,
          agentId: ctx.agentId || undefined,
          teamScope: ctx.teamScope,
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
          imageUrls,
          { userId: user.id, agentId: ctx.agentId, teamScope: ctx.teamScope }
        )

        const commentWithAttachments = await prisma.comment.findUnique({
          where: { id: comment.id },
          include: commentInclude(user.id, task.projectId)
        })

        const editorAgents = await loadVisibleReactionAgents(
          comment.editedByAgentId ? [comment.editedByAgentId] : [],
          user.id,
          task.projectId
        )
        const mappedComment = commentWithAttachments
          ? mapCommentToResponse(commentWithAttachments, user.id, task.projectId, false, editorAgents)
          : null
        const attributedComment = mappedComment
          ? applyDurableCommentAttribution(
              mappedComment,
              commentWithAttachments,
              user.id,
              task.projectId
            )
          : null

        const sessionAgent = await getMcpSessionAgentSummary(ctx.agentId, user.id);

        return {
          success: true,
          routedTo: 'comments' as const,
          visibleToPeople: true,
          url: buildMcpTaskUrl(taskWithOwner.projectId, taskWithOwner.uniqueIndex),
          ...(sessionAgent ? { agent: sessionAgent } : {}),
          comment: {
            kind: comment.kind ?? null,
            id: comment.id,
            text: comment.text || sanitizedText,
            createdAt: (comment.createdAt instanceof Date ? comment.createdAt : new Date()).toISOString(),
            editedAt: comment.editedAt?.toISOString() ?? null,
            editedBy: comment.editedByUserId != null
              ? {
                  userId: comment.editedByUserId,
                  agentId: comment.editedByAgentId && editorAgents.has(comment.editedByAgentId) ? comment.editedByAgentId : null,
                  ...(comment.editedByAgentId ? { isAgent: true as const } : {})
                }
              : null,
            creatorId: comment.creatorId || user.id,
            ...(attributedComment?.agent ? { agent: attributedComment.agent } : {}),
            ...(attributedComment?.agent_display_name
              ? { agent_display_name: attributedComment.agent_display_name }
              : {}),
            attachments: attributedComment?.attachments?.map(att => ({
              id: att.id,
              fileName: att.fileName,
              fileType: att.fileType,
              fileSize: String(att.fileSize),
              fileSource: att.fileSource,
            })) || []
          }
        }
      },
      ctx.teamScope != null ? ctx.agentId : undefined,
      ctx.teamScope
    )

    return NextResponse.json(mcpResponse, { status: 201 })
  } catch (error) {
    if (isPlanLimitReachedError(error)) {
      const response = planLimitResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    if (error instanceof IdempotencyAccessError) return NextResponse.json({ error: error.message }, { status: 404 })
    const identifierResponse = taskIdentifierErrorResponse(error)
    if (identifierResponse) return identifierResponse
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
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }

  })(request)
}
