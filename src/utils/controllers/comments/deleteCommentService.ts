/**
 * Shared comment delete logic used by both Pages API and MCP route.
 * Single source of truth for: notifications, attachments, comment delete, search index.
 */
import prisma from '@/lib/prisma'
import { deleteCommentInTurbopuffer } from '@/utils/controllers/turbopuffer/turbopufferHelper'

export interface DeleteCommentParams {
  commentId: number
}

/**
 * Deletes a comment and all related data.
 * Caller must ensure: comment exists and user has task/project access.
 */
export async function deleteCommentService(params: DeleteCommentParams) {
  const { commentId } = params

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, taskId: true, creatorId: true }
  })

  if (!comment) {
    throw new Error('Comment not found')
  }

  // Mark notifications as Deleted
  await prisma.notification.updateMany({
    where: { commentId },
    data: { status: 'Deleted' }
  })

  // Delete attachments for this comment
  await prisma.attachment.deleteMany({
    where: { commentId }
  })

  // Delete comment
  const deleteResult = await prisma.comment.deleteMany({
    where: {
      id: commentId
    }
  })

  if (deleteResult.count === 0) {
    throw new Error('Comment not found')
  }

  // Only real user/agent comments (creatorId IS NOT NULL) are counted
  if (comment.taskId !== null && comment.creatorId !== null) {
    await prisma.task.update({
      where: { id: comment.taskId },
      data: { totalComments: { decrement: 1 } },
    })
  }

  await deleteCommentInTurbopuffer(commentId)

  return { deleted: true }
}
