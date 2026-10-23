import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import { agentScopeEnforced } from "@/lib/auth/agentScope";
import type { Prisma } from "@prisma/client";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export function notificationBoardAccessWhere(userId: number, agentId?: string | null, teamScope?: AgentTokenTeamScope | null): Prisma.NotificationWhereInput {
  if (teamScope == null && (!agentId || !agentScopeEnforced())) return {};
  const project = projectContentAccessWhere(userId, agentId, teamScope);
  return {
    project,
    OR: [{ taskId: null }, { task: { project } }],
  };
}
