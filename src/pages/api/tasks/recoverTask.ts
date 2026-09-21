import type { NextApiRequest, NextApiResponse } from 'next'
import { cancelTaskDeleteJob } from '../queues/taskDeleteQueue'
import prisma from '@/lib/prisma'
import {
  TaskHardDeleteInProgressError,
  updateTaskAndSubtasks,
} from '../queues/tasks/taskDeleteReminder'
import { upsertTaskToTurbopuffer } from '@/utils/controllers/turbopuffer/turbopufferHelper'
import { taskWriteAccessWhere } from '@/utils/controllers/projects/getAllIncludes'
import { AgentMutationLeaseConflictError } from '@/lib/mcp/tasks/agentMutationFence'
import { getSessionUser } from '@/lib/auth/getSessionUser'

export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    if (req.method==="POST"){
        const {taskId, agentId} = req.body
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        )
        if (!session) return res.status(401).json({message:"Unauthorized"})

        const actingAgentId =
          typeof agentId === "string" && agentId.length > 0 ? agentId : null
        if (agentId != null && !actingAgentId) {
          return res.status(400).json({ message: "Invalid agent id" })
        }
        
        if (parseInt(taskId as string) === null || parseInt(taskId as string) === undefined || parseInt(taskId as string) <0 ) return res.status(400).json({message:"Missing required information"})
        const [allowedTask, ownedAgent] = await Promise.all([
          prisma.task.findFirst({
              where: {
                  id: Number(taskId),
                  project: taskWriteAccessWhere(session.userId, actingAgentId),
              },
              select: { id: true },
          }),
          actingAgentId
            ? prisma.agent.findFirst({
                where: {
                  id: actingAgentId,
                  userId: session.userId,
                  revokedAt: null,
                },
                select: { id: true },
              })
            : Promise.resolve(null),
        ])
        if (actingAgentId && !ownedAgent) {
          return res.status(403).json({ message: "Forbidden" })
        }
        if (!allowedTask) return res.status(404).json({message:"Task not found or access denied"})
        // Restore the root and every descendant under the same deterministic
        // mutation fences used by deletion.
        const updatedTask = await updateTaskAndSubtasks(
          { id: Number(taskId) },
          "Normal",
          null,
          null,
          session.userId,
          actingAgentId
        )
        // The durable hard-delete claim re-checks status='Deleted' and due time,
        // so a restored task is safe even if best-effort queue cancellation is
        // temporarily unavailable. Never turn a committed restore into a 500.
        try {
          await cancelTaskDeleteJob(Number(taskId))
        } catch (cancelError) {
          console.warn("recoverTask: restored; delete-job cancellation will no-op", cancelError)
        }
        upsertTaskToTurbopuffer(updatedTask.id)


        return res.status(200).json({message:"Success"})
    }
  } catch (error) {
      if (error instanceof AgentMutationLeaseConflictError) {
        return res.status(409).json({ message: error.message })
      }
      if (error instanceof TaskHardDeleteInProgressError) {
        return res.status(409).json({ message: error.message })
      }
      console.log(error)
      return res.status(500).json(error)
  }
}
