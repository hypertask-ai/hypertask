import { agentScopeEnforced } from "@/lib/auth/agentScope";
import type { Prisma } from "@prisma/client";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export function notificationBoardAccessWhere(userId: number, agentId?: string | null): Prisma.NotificationWhereInput {
  if (!agentId || !agentScopeEnforced()) return {};
  const project = projectContentAccessWhere(userId, agentId);
  return {
    project,
    OR: [{ taskId: null }, { task: { project } }],
  };
}
