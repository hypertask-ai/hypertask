import type { Prisma, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getProjectWhere, taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export function taskAccessWhere(
  userId: number,
  taskId: number | undefined,
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
    ...(taskId === undefined ? {} : { id: taskId }),
    ...(options.taskStatus ? { status: options.taskStatus } : {}),
    project: {
      ...(options.projectStatus ? { status: options.projectStatus } : {}),
      ...projectAccess,
    },
  };
}

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
