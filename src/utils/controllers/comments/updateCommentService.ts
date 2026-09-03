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
import { publicAgentSelect } from '@/lib/agents/publicAgent'

export interface UpdateCommentParams {
  commentId: number
  text: string
  userId: number
  agentId?: string | null
  attachments?: Array<{
    fileType: string
    fileSource: string
    fileName: string
    fileSize?: string | null
  }>
  /** Set only when attachments is a complete snapshot and removals are intentional. */
  replaceAttachments?: boolean
}

/**
 * Updates a comment and runs all post-update hooks.
 * The authenticated user must own the stored comment.
 */
export async function updateCommentService(params: UpdateCommentParams) {
  const { commentId, text, userId, agentId, attachments, replaceAttachments } = params

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, creatorId: userId },
    select: { id: true, taskId: true, task: { select: { projectId: true } } }
  })

  if (!comment) {
    throw new Error('Comment not found or not owned by user')
  }

  await invalidateHyperAiCommentOrigin(commentId)
  const updatedComment = await prisma.$transaction(async (transaction) => {
    if (attachments && replaceAttachments) {
      const existingAttachments = await transaction.attachment.findMany({
        where: { commentId },
        select: {
          id: true,
          fileSource: true,
          fileType: true,
          fileName: true,
          fileSize: true
        }
      })
      const desiredAttachments = Array.from(
        new Map(
          attachments.map((attachment) => [attachment.fileSource, attachment])
        ).values()
      )
      const desiredSources = new Set(
        desiredAttachments.map((attachment) => attachment.fileSource)
      )
      const attachmentIdsToDelete = existingAttachments
        .filter((attachment) => !desiredSources.has(attachment.fileSource))
        .map((attachment) => attachment.id)
      if (attachmentIdsToDelete.length > 0) {
        await transaction.attachment.deleteMany({
          where: { id: { in: attachmentIdsToDelete } }
        })
      }

      const desiredBySource = new Map(
        desiredAttachments.map((attachment) => [attachment.fileSource, attachment])
      )
      await Promise.all(
        existingAttachments.map((existingAttachment) => {
          const desiredAttachment = desiredBySource.get(existingAttachment.fileSource)
          if (
            !desiredAttachment ||
            (existingAttachment.fileType === desiredAttachment.fileType &&
              existingAttachment.fileName === desiredAttachment.fileName &&
              existingAttachment.fileSize === desiredAttachment.fileSize)
          ) {
            return Promise.resolve()
          }
          return transaction.attachment.update({
            where: { id: existingAttachment.id },
            data: {
              fileType: desiredAttachment.fileType,
              fileName: desiredAttachment.fileName,
              fileSize: desiredAttachment.fileSize
            }
          })
        })
      )

      const existingSources = new Set(existingAttachments.map((attachment) => attachment.fileSource))
      const attachmentsToCreate = desiredAttachments.filter(
        (attachment) => !existingSources.has(attachment.fileSource)
      )
      if (attachmentsToCreate.length > 0) {
        await transaction.attachment.createMany({
          data: attachmentsToCreate.map((attachment) => ({
            fileType: attachment.fileType,
            fileSource: attachment.fileSource,
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            commentId,
            taskId: comment.taskId
          }))
        })
      }
    }

    return transaction.comment.update({
      where: { id: commentId },
      data: { text, summary: null },
      include: {
        creator: { select: { id: true, email: true, displayName: true } },
        agent: { select: publicAgentSelect },
        attachments: true
      }
    })
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
