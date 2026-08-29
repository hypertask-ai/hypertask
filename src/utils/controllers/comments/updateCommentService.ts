/**
 * Shared comment update logic used by both Pages API and MCP route.
 * Single source of truth for: DB update, activity, search index, summary scheduling, mentions.
 */
import prisma from '@/lib/prisma'
import { upsertCommentToTurbopuffer } from '@/utils/controllers/turbopuffer/turbopufferHelper'
import scheduleTaskSummaryGeneration from '@/pages/api/queues/FAST/generateSummary'
import scheduleCommentSummaryGeneration from '@/pages/api/queues/FAST/generateCommentSummary'
import { processMentionsFromCommentText } from './processMentions'
import { omitCommentSeen } from './readReceipts'
import { invalidateHyperAiCommentOrigin } from '@/lib/ai/hyperAiConfirmation'

export interface UpdateCommentParams {
  commentId: number
  text: string
  userId: number
  agentId?: string | null
}

/**
 * Updates a comment and runs all post-update hooks.
 * Caller must ensure: comment exists, user is the creator.
 */
export async function updateCommentService(params: UpdateCommentParams) {
  const { commentId, text, userId, agentId } = params

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, taskId: true, task: { select: { projectId: true } } }
  })

  if (!comment) {
    throw new Error('Comment not found')
  }

  await invalidateHyperAiCommentOrigin(commentId)
  const updatedComment = await prisma.comment.update({
    where: { id: commentId },
    data: { text, summary: null },
    include: {
      creator: { select: { id: true, email: true, displayName: true } }
    }
  })

  await scheduleCommentSummaryGeneration({ commentId }).catch((err) =>
    console.warn('[updateCommentService] comment summary schedule failed:', err)
  )

  // Post-update hooks (same as Pages API)
  upsertCommentToTurbopuffer(commentId)
  scheduleTaskSummaryGeneration({ taskId: comment.taskId, agentId: agentId ?? null })

  // Process mentions for notifications
  await processMentionsFromCommentText({
    text,
    commentId,
    taskId: comment.taskId,
    projectId: comment.task.projectId,
    mentionedBy: userId
  })

  return omitCommentSeen(updatedComment)
}
