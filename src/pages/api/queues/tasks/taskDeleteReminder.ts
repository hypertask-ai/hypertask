
import { subMinutes } from "date-fns"


import type { NextApiRequest, NextApiResponse } from 'next'
import { scheduleTaskDeleteJob } from "../taskDeleteQueue";
import Sugar from "sugar";
import prisma from "@/lib/prisma";
import { stripForeignTaskRelations } from "@/lib/tasks/sameBoardRelations";
import globalConstants from "@/lib/constants";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  AgentMutationLeaseConflictError,
  assertAgentAssignmentChangeAllowed,
  cancelAgentMutationLeaseForHumanOverride,
} from "@/lib/mcp/tasks/agentMutationFence";
import {
  AgentDoneLifecycleDeniedError,
  assertAgentMayLeaveDoneForTasks,
} from "@/lib/mcp/tasks/agentDoneLifecycle";
import { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";

export class TaskHardDeleteInProgressError extends Error {
  constructor() {
    super("Task hard deletion is already in progress. Refresh to confirm its current state.")
    this.name = "TaskHardDeleteInProgressError"
  }
}


export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { taskId, agentId } = req.body;
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  const signedSession = verifySession(req.cookies[SESSION_COOKIE]);
  const actingAgent = resolveActingAgent({
    sessionAgentId: signedSession?.agentId ?? null,
    bodyAgentId: agentId,
  });
  if (!actingAgent.ok) {
    return res.status(actingAgent.status).json({ message: actingAgent.message });
  }
  const actingAgentId = actingAgent.agentId;

  const remindAtDate = Sugar.Date.create("30 Days from now")
  if (!taskId || !remindAtDate) return res.status(400).json({ message: "Missing Required Information" })

  try {
    const [allowedTask, ownedAgent] = await Promise.all([
      prisma.task.findFirst({
        where: {
          id: taskId,
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
    ]);
    if (actingAgentId && !ownedAgent) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!allowedTask) {
      return res.status(404).json({ message: "Task not found or access denied" });
    }

    const timeNow = new Date()
    const taskUpdated = await updateTaskTreeStatus(
      taskId,
      "Deleted",
      timeNow,
      remindAtDate,
      session.userId,
      actingAgentId
    )
    await scheduleTaskDeleteJob(
      globalConstants.TaskDeletePrefixKey + taskId,
      taskId,
      subMinutes(remindAtDate, 0),
    );
    return res.status(200).json(taskUpdated)
  } catch (error) {
    if (error instanceof AgentMutationLeaseConflictError) {
      return res.status(409).json({ message: error.message })
    }
    if (error instanceof TaskHardDeleteInProgressError) {
      return res.status(409).json({ message: error.message })
    }
    if (error instanceof AgentDoneLifecycleDeniedError) {
      return res.status(error.status).json({ message: error.message, code: error.code })
    }
    console.log("🚀 ~ error:", error)

    return res.status(500).json(error)
  }

};

export async function updateTaskAndSubtasks(
  taskUpdated: { id: number },
  shouldDeleteOrRecover: "Deleted" | "Normal",
  timeNow: Date | null = null,
  remindAtDate: Date | null = null,
  actingUserId: number | null = null,
  actingAgentId: string | null = null,
) {
  return updateTaskTreeStatus(
    taskUpdated.id,
    shouldDeleteOrRecover,
    timeNow,
    remindAtDate,
    actingUserId,
    actingAgentId
  )
}

type TaskTreeRow = { id: number }
type LockedTaskTreeRow = {
  id: number
  status: string
  sectionId: number | null
  hardDeleteProcessingAt: Date | null
}

async function updateTaskTreeStatus(
  rootTaskId: number,
  status: "Deleted" | "Normal",
  deletedAt: Date | null,
  permanentlyDeleteAt: Date | null,
  actingUserId: number | null,
  actingAgentId: string | null
) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<TaskTreeRow[]>`
      WITH RECURSIVE task_tree AS (
        -- HTPR-7187: stay on the root's board; legacy cross-board sub-tasks
        -- are not trashed with the parent.
        SELECT id, "projectId" FROM "Task" WHERE id = ${rootTaskId}
        UNION
        SELECT child.id, child."projectId"
        FROM "Task" child
        INNER JOIN task_tree parent
          ON child."parentTaskId" = parent.id
          AND child."projectId" = parent."projectId"
      )
      SELECT id FROM task_tree ORDER BY id
    `
    const taskIds = [...new Set(rows.map(({ id }) => id))].sort((a, b) => a - b)
    if (taskIds.length === 0) throw new Error("Task not found")

    for (const id of taskIds) {
      await assertAgentAssignmentChangeAllowed(tx, id, actingAgentId, actingUserId, {
        allowHumanOverride: actingAgentId == null && actingUserId != null,
      })
    }
    const lockedRows = await tx.$queryRaw<LockedTaskTreeRow[]>`
      SELECT id, status, "sectionId", "hardDeleteProcessingAt"
      FROM "Task"
      WHERE id IN (${Prisma.join(taskIds)})
      ORDER BY id
      FOR UPDATE
    `
    if (lockedRows.length !== taskIds.length) throw new Error("Task not found")
    const hardDeleteInProgress = lockedRows.some(
      ({ hardDeleteProcessingAt }) => hardDeleteProcessingAt != null,
    )
    if (hardDeleteInProgress) {
      throw new TaskHardDeleteInProgressError()
    }
    const isHumanOverride = actingAgentId == null && actingUserId != null
    const targetAlreadyApplied = lockedRows.every(({ status: currentStatus }) =>
      status === "Normal" ? currentStatus === "Normal" : currentStatus === "Deleted"
    )
    if (targetAlreadyApplied) {
      return stripForeignTaskRelations(await tx.task.findUniqueOrThrow({
        where: { id: rootTaskId },
        select: {
          id: true,
          projectId: true,
          subTasks: { orderBy: { status: "desc" } },
          parentTask: { include: { subTasks: true } },
        },
      }))
    }
    if (isHumanOverride) {
      for (const id of taskIds) {
        await cancelAgentMutationLeaseForHumanOverride(tx, id, actingUserId)
      }
    }
    if (status === "Deleted") {
      await assertAgentMayLeaveDoneForTasks(
        tx,
        lockedRows,
        status,
        actingAgentId,
      )
    }
    await tx.task.updateMany({
      where: { id: { in: taskIds } },
      data: {
        status,
        deletedAt,
        permanentlyDeleteAt,
        hardDeleteProcessingAt: status === "Normal" ? null : undefined,
      },
    })
    if (status === "Normal") {
      await tx.task.update({
        where: { id: rootTaskId },
        data: { parentTaskId: null },
      })
    }
    await tx.notification.deleteMany({
      where: { taskId: { in: taskIds } },
    })
    return stripForeignTaskRelations(await tx.task.findUniqueOrThrow({
      where: { id: rootTaskId },
      select: {
        id: true,
        projectId: true,
        subTasks: { orderBy: { status: "desc" } },
        parentTask: { include: { subTasks: true } },
      },
    }))
  }, { timeout: 30_000 })
}
