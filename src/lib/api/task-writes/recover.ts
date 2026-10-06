import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import { cancelTaskDeleteJob } from "@/pages/api/queues/taskDeleteQueue"
import prisma from '@/lib/prisma'
import {
  TaskHardDeleteInProgressError,
  updateTaskAndSubtasks,
} from "@/pages/api/queues/tasks/taskDeleteReminder"
import { upsertTaskToTurbopuffer } from '@/utils/controllers/turbopuffer/turbopufferHelper'
import { taskWriteAccessWhere } from '@/utils/controllers/projects/getAllIncludes'
import { AgentMutationLeaseConflictError } from '@/lib/mcp/tasks/agentMutationFence'

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  operation: async ({ taskId, agentId }, session) => {
    const actingAgentId =
      typeof agentId === "string" && agentId.length > 0 ? agentId : null
    if (agentId != null && !actingAgentId) {
      return NextResponse.json({ message: "Invalid agent id" }, { status: 400 })
    }

    if (parseInt(taskId as string) === null || parseInt(taskId as string) === undefined || parseInt(taskId as string) <0 ) return NextResponse.json({message:"Missing required information"}, { status: 400 })
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
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
    if (!allowedTask) return NextResponse.json({message:"Task not found or access denied"}, { status: 404 })
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

    return NextResponse.json({message:"Success"}, { status: 200 })
  },
});

export const POST: TaskWriteRoute = async (request, session) => {
  try {
    const req = { body: await request.json() };
    const { taskId, agentId } = req.body;
    return await route({ ...request, headers: request.headers, json: async () => ({ taskId, agentId }) }, session);
  } catch (error) {
    if (error instanceof AgentMutationLeaseConflictError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    if (error instanceof TaskHardDeleteInProgressError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.log(error)
    return NextResponse.json(error, { status: 500 })
  }
};
