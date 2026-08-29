// pages/api/setupReminder.js
// id:`notifications-for-task-${taskId}`

import { subMinutes } from "date-fns"


import type { NextApiRequest, NextApiResponse } from 'next'
import { scheduleTaskDeleteJob } from "../taskDeleteQueue";
import Sugar from "sugar";
import prisma from "@/lib/prisma";
import globalConstants from "@/lib/constants";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  AgentMutationLeaseConflictError,
  assertAgentAssignmentChangeAllowed,
  cancelAgentMutationLeaseForHumanOverride,
} from "@/lib/mcp/tasks/agentMutationFence";
import { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/getSessionUser";

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

  const actingAgentId =
    typeof agentId === "string" && agentId.length > 0 ? agentId : null;
  if (agentId != null && !actingAgentId) {
    return res.status(400).json({ message: "Invalid agent id" });
  }

  const remindAtDate = Sugar.Date.create("30 Days from now")
  if (!taskId || !remindAtDate) return res.status(400).json({ message: "Missing Required Information" })

  try {
    // =============== notification sent into reminders
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
        SELECT id FROM "Task" WHERE id = ${rootTaskId}
        UNION
        SELECT child.id
        FROM "Task" child
        INNER JOIN task_tree parent ON child."parentTaskId" = parent.id
      )
      SELECT id FROM task_tree ORDER BY id
    `
    const taskIds = [...new Set(rows.map(({ id }) => id))].sort((a, b) => a - b)
    if (taskIds.length === 0) throw new Error("Task not found")

    // One deterministic lock order prevents parent/child delete races and
    // deadlocks. Every descendant lease is checked before any status changes.
    for (const id of taskIds) {
      await assertAgentAssignmentChangeAllowed(tx, id, actingAgentId, actingUserId, {
        allowHumanOverride: actingAgentId == null && actingUserId != null,
      })
    }
    // Coordinate restore with the hard-delete claim. If recovery locks first,
    // the claim rechecks status after commit and skips. If deletion claimed
    // first, recovery observes processing state and leaves the task Deleted.
    const lockedRows = await tx.$queryRaw<LockedTaskTreeRow[]>`
      SELECT id, status, "hardDeleteProcessingAt"
      FROM "Task"
      WHERE id IN (${Prisma.join(taskIds)})
      ORDER BY id
      FOR UPDATE
    `
    if (lockedRows.length !== taskIds.length) throw new Error("Task not found")
    // Once the destructive worker claims any row, every competing tree status
    // change must fail. This includes repeated soft-delete requests: allowing
    // one to reset the deadline while deletion is running would acknowledge a
    // state the claimed worker can still permanently remove.
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
      return tx.task.findUniqueOrThrow({
        where: { id: rootTaskId },
        select: {
          id: true,
          subTasks: { orderBy: { status: "desc" } },
          parentTask: { include: { subTasks: true } },
        },
      })
    }
    if (isHumanOverride) {
      for (const id of taskIds) {
        await cancelAgentMutationLeaseForHumanOverride(tx, id, actingUserId)
      }
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
    return tx.task.findUniqueOrThrow({
      where: { id: rootTaskId },
      select: {
        id: true,
        subTasks: { orderBy: { status: "desc" } },
        parentTask: { include: { subTasks: true } },
      },
    })
  }, { timeout: 30_000 })
}
