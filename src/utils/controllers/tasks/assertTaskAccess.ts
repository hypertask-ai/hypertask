import prisma from "@/lib/prisma";
import { getProjectWhere, taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

// updateTaskSingle does no membership check of its own — it looks the task up
// by id and writes. Routes that take a caller-supplied taskId therefore have to
// gate access themselves; this is that gate.
export async function userCanAccessTask(
  userId: number,
  taskId: number,
  agentId?: string | null,
): Promise<boolean> {
  if (!Number.isInteger(taskId) || taskId <= 0) return false;
  const task = await prisma.task.findFirst({
    where: { id: taskId, project: { ...getProjectWhere(userId, agentId) } },
    select: { id: true },
  });
  return Boolean(task);
}

// Same owner/member check as task writes, so a legacy teamless board still
// counts. userCanAccessTask stays on getProjectWhere for team-scoped callers.
export async function userCanAccessTaskContent(
  userId: number,
  taskId: number,
): Promise<boolean> {
  if (!Number.isInteger(taskId) || taskId <= 0) return false;
  const task = await prisma.task.findFirst({
    where: { id: taskId, project: taskWriteAccessWhere(userId) },
    select: { id: true },
  });
  return Boolean(task);
}
