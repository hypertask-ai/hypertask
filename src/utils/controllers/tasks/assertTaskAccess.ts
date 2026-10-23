import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { agentScopeEnforced, recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import type { Prisma, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getProjectWhere, taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export function taskAccessWhere(
  userId: number,
  taskId: number | undefined,
  options: {
    agentId?: string | null;
    teamScope?: AgentTokenTeamScope | null;
    projectStatus?: Status;
    taskStatus?: Status;
    scope?: "team" | "content";
  } = {},
): Prisma.TaskWhereInput {
  const projectAccess = options.scope === "content"
    ? taskWriteAccessWhere(userId, options.agentId, options.teamScope)
    : getProjectWhere(userId, options.agentId, options.teamScope);
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
  teamScope?: AgentTokenTeamScope | null,
): Promise<boolean> {
  if (!Number.isInteger(taskId) || taskId <= 0) return false;
  const task = await prisma.task.findFirst({
    where: taskAccessWhere(userId, taskId, { agentId, teamScope }),
    select: { id: true, ...(agentId && !agentScopeEnforced() ? { projectId: true } : {}) },
  });
  if (task) recordAgentBoardScopeMiss(task.projectId);
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
