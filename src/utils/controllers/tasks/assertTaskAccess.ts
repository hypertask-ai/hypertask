import type { Prisma, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getProjectWhere, taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export function taskAccessWhere(
  userId: number,
  taskId: number,
  options: {
    agentId?: string | null;
    projectStatus?: Status;
    taskStatus?: Status;
    scope?: "team" | "content";
  } = {},
): Prisma.TaskWhereInput {
  const projectAccess = options.scope === "content"
    ? taskWriteAccessWhere(userId, options.agentId)
    : getProjectWhere(userId, options.agentId);
  return {
    id: taskId,
    ...(options.taskStatus ? { status: options.taskStatus } : {}),
    project: {
      ...(options.projectStatus ? { status: options.projectStatus } : {}),
      ...projectAccess,
    },
  };
}

// updateTaskSingle does no membership check of its own. It looks the task up
// by id and writes. Routes that take a caller-supplied taskId therefore have to
// gate access themselves; this is that gate.
export async function userCanAccessTask(
  userId: number,
  taskId: number,
  agentId?: string | null,
): Promise<boolean> {
  if (!Number.isInteger(taskId) || taskId <= 0) return false;
  const task = await prisma.task.findFirst({
    where: taskAccessWhere(userId, taskId, { agentId }),
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
    where: taskAccessWhere(userId, taskId, { scope: "content" }),
    select: { id: true },
  });
  return Boolean(task);
}
