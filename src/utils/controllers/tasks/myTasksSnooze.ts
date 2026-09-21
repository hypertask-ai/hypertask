import { logger as htLogger } from "#logger";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { parseMyTasksSnoozeUntil } from "@/lib/myTasksSnooze";
import { userCanAccessTask } from "@/utils/controllers/tasks/assertTaskAccess";

export type SetMyTasksSnoozeResult =
  | {
      ok: true;
      assignmentId: number;
      taskId: number;
      snoozeUntil: string | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Sets or clears snooze on the caller's person assignment row.
 * Prefer immutable Assignees.id; taskId falls back for the command palette.
 */
function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function setMyTasksSnooze(args: {
  userId: number;
  assignmentId?: number;
  taskId?: number;
  snoozeUntil: unknown;
  now?: Date;
}): Promise<SetMyTasksSnoozeResult> {
  const now = args.now ?? new Date();
  const parsed = parseMyTasksSnoozeUntil(args.snoozeUntil, now);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const byAssignment = isPositiveInt(args.assignmentId);
  const byTask = isPositiveInt(args.taskId);
  if (!byAssignment && !byTask) {
    return {
      ok: false,
      status: 400,
      error: "assignmentId or taskId is required",
    };
  }

  try {
    const assignment = await prisma.assignees.findFirst({
      where: {
        ...(byAssignment ? { id: args.assignmentId } : { taskId: args.taskId }),
        userId: args.userId,
        agentId: null,
      },
      select: { id: true, taskId: true },
    });

    if (!assignment) {
      return { ok: false, status: 404, error: "Assignment not found" };
    }

    const task = await prisma.task.findFirst({
      where: { id: assignment.taskId, deletedAt: null, status: "Normal" },
      select: { id: true },
    });
    if (!task) {
      return { ok: false, status: 404, error: "Task not found" };
    }

    if (!(await userCanAccessTask(args.userId, assignment.taskId))) {
      return { ok: false, status: 403, error: "Forbidden" };
    }

    const updated = await prisma.assignees.updateMany({
      where: {
        id: assignment.id,
        userId: args.userId,
        agentId: null,
      },
      data: { snoozeUntil: parsed.snoozeUntil },
    });
    if (updated.count !== 1) {
      return { ok: false, status: 409, error: "Assignment changed; retry" };
    }

    return {
      ok: true,
      assignmentId: assignment.id,
      taskId: assignment.taskId,
      snoozeUntil: parsed.snoozeUntil ? parsed.snoozeUntil.toISOString() : null,
    };
  } catch (error) {
    htLogger.error("[myTasksSnooze] set failed", error);
    return { ok: false, status: 500, error: "Unable to snooze task" };
  }
}

/**
 * Hide or restore a My Tasks row when Remind Me is set or fires.
 * No assignment (created/watching only) is a no-op.
 */
export async function syncMyTasksSnoozeFromReminder(args: {
  userId: number;
  taskId: number;
  snoozeUntil: Date | string | null;
  client?: Prisma.TransactionClient | typeof prisma;
}): Promise<void> {
  const client = args.client ?? prisma;
  const parsed = parseMyTasksSnoozeUntil(args.snoozeUntil);
  if (!parsed.ok) return;
  await client.assignees.updateMany({
    where: {
      userId: args.userId,
      taskId: args.taskId,
      agentId: null,
    },
    data: { snoozeUntil: parsed.snoozeUntil },
  });
}
