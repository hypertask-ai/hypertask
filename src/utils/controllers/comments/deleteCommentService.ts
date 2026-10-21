import prisma from '@/lib/prisma'
import { deleteCommentInTurbopuffer } from '@/utils/controllers/turbopuffer/turbopufferHelper'

export interface DeleteCommentParams {
  commentId: number
}

export async function deleteCommentService(params: DeleteCommentParams) {
  const { commentId } = params

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, taskId: true, creatorId: true }
  })

  if (!comment) {
    throw new Error('Comment not found')
  }

  await prisma.notification.updateMany({
    where: { commentId },
    data: { status: 'Deleted' }
  })

  await prisma.attachment.deleteMany({
    where: { commentId }
  })

  const deleteResult = await prisma.comment.deleteMany({
    where: {
      id: commentId
    }
  })

  if (deleteResult.count === 0) {
    throw new Error('Comment not found')
  }

  if (comment.taskId !== null && comment.creatorId !== null) {
    await prisma.task.update({
      where: { id: comment.taskId },
      data: { totalComments: { decrement: 1 } },
    })
  }

  await deleteCommentInTurbopuffer(commentId)

  return { deleted: true }
}
