import prisma from "@/lib/prisma";
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

  let assignment: { id: number; taskId: number } | null = null;
  if (
    typeof args.assignmentId === "number" &&
    Number.isInteger(args.assignmentId) &&
    args.assignmentId > 0
  ) {
    assignment = await prisma.assignees.findFirst({
      where: {
        id: args.assignmentId,
        userId: args.userId,
        agentId: null,
      },
      select: { id: true, taskId: true },
    });
  } else if (
    typeof args.taskId === "number" &&
    Number.isInteger(args.taskId) &&
    args.taskId > 0
  ) {
    assignment = await prisma.assignees.findFirst({
      where: {
        taskId: args.taskId,
        userId: args.userId,
        agentId: null,
      },
      select: { id: true, taskId: true },
    });
  } else {
    return {
      ok: false,
      status: 400,
      error: "assignmentId or taskId is required",
    };
  }

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
}
