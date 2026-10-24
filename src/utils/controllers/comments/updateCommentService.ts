import { verifyTaskAttachmentLinks } from "@/lib/storage/verifyTaskAttachmentLinks";
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'
import prisma from '@/lib/prisma'
import { projectContentAccessWhere } from '@/utils/controllers/projects/getAllIncludes'
import { upsertCommentToTurbopuffer } from '@/utils/controllers/turbopuffer/turbopufferHelper'
import scheduleTaskSummaryGeneration from '@/pages/api/queues/FAST/generateSummary'
import scheduleCommentSummaryGeneration from '@/pages/api/queues/FAST/generateCommentSummary'
import { processMentionsFromCommentText } from './processMentions'
import { omitCommentSeen } from './readReceipts'
import { invalidateHyperAiCommentOrigin } from '@/lib/ai/hyperAiConfirmation'
import { publicAgentSelect } from '@/lib/agents/publicAgent'
import { normalizeBlockHtml } from '@/lib/mcp/normalizeBlockHtml'

export interface UpdateCommentParams {
  commentId: number
  text: string
  userId: number
  teamScope?: AgentTokenTeamScope | null
  agentId?: string | null
  attachments?: Array<{
    fileType: string
    fileSource: string
    fileName: string
    fileSize?: string | null
  }>
  replaceAttachments?: boolean
}

export async function updateCommentService(params: UpdateCommentParams) {
  const { commentId, text: inputText, userId, agentId, teamScope, attachments, replaceAttachments } = params
  const text = normalizeBlockHtml(inputText)

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, creatorId: userId, task: { project: projectContentAccessWhere(userId, agentId, teamScope) } },
    select: { id: true, taskId: true, text: true, task: { select: { projectId: true } } }
  })

  if (!comment) {
    throw new Error('Comment not found or not owned by user')
  }

  await invalidateHyperAiCommentOrigin(commentId)
  const textChanged = text !== normalizeBlockHtml(comment.text)
  const updatedComment = await prisma.$transaction(async (transaction) => {
    const measuredSizes = attachments && replaceAttachments
      ? await verifyTaskAttachmentLinks(transaction, attachments.map((attachment) => attachment.fileSource), { commentId }, {
        actorUserId: userId, agentId, entryPoint: "comments.update",
      })
      : new Map<string, number>()

    if (teamScope != null) {
      await transaction.$queryRaw`SELECT id FROM "Task" WHERE id = ${comment.taskId} FOR UPDATE`
      const allowed = await transaction.comment.findFirst({
        where: { id: commentId, creatorId: userId, task: { project: projectContentAccessWhere(userId, agentId, teamScope) } }, select: { id: true },
      })
      if (!allowed) throw new Error('Comment not found or access denied')
    }
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
            fileSize: measuredSizes.has(attachment.fileSource) ? String(measuredSizes.get(attachment.fileSource)) : attachment.fileSize,
            commentId,
            taskId: comment.taskId
          }))
        })
      }
    }

    const markEdited = textChanged || (await transaction.comment.updateMany({
      where: { id: commentId, text: comment.text },
      data: { summary: null }
    })).count === 0

    return transaction.comment.update({
      where: { id: commentId },
      data: {
        text,
        summary: null,
        ...(markEdited ? { editedAt: new Date(), editedByUserId: userId, editedByAgentId: agentId ?? null } : {})
      },
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

  upsertCommentToTurbopuffer(commentId)
  scheduleTaskSummaryGeneration({ taskId: comment.taskId, agentId: agentId ?? null })

  await processMentionsFromCommentText({
    text,
    commentId,
    taskId: comment.taskId,
    projectId: comment.task.projectId,
    mentionedBy: userId
  })

  return omitCommentSeen(updatedComment)
}
