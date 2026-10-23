import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'
import { projectContentAccessWhere } from '@/utils/controllers/projects/getAllIncludes'
import prisma from '@/lib/prisma'
import { deleteCommentInTurbopuffer } from '@/utils/controllers/turbopuffer/turbopufferHelper'

export interface DeleteCommentParams {
  commentId: number
  userId?: number
  agentId?: string | null
  teamScope?: AgentTokenTeamScope | null
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

  const remove = async (db: typeof prisma | import('@prisma/client').Prisma.TransactionClient) => {
    if (params.teamScope != null) {
      await db.$queryRaw`SELECT id FROM "Task" WHERE id = ${comment.taskId} FOR UPDATE`
      if (params.userId == null || !await db.comment.findFirst({
        where: { id: commentId, task: { project: projectContentAccessWhere(params.userId, params.agentId, params.teamScope) } }, select: { id: true },
      })) throw new Error('Comment not found or access denied')
    }
  await db.notification.updateMany({
    where: { commentId },
    data: { status: 'Deleted' }
  })

  await db.attachment.deleteMany({
    where: { commentId }
  })

  const deleteResult = await db.comment.deleteMany({
    where: {
      id: commentId
    }
  })

  if (deleteResult.count === 0) {
    throw new Error('Comment not found')
  }

  if (comment.taskId !== null && comment.creatorId !== null) {
    await db.task.update({
      where: { id: comment.taskId },
      data: { totalComments: { decrement: 1 } },
    })
  }

  }
  if (params.teamScope != null) await prisma.$transaction(remove)
  else await remove(prisma)

  await deleteCommentInTurbopuffer(commentId)

  return { deleted: true }
}
