import type { Prisma } from "@prisma/client";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

// Historical notification project IDs cannot authorize a task moved to another board.
export function notificationBoardAccessWhere(userId: number, agentId?: string | null): Prisma.NotificationWhereInput {
  if (!agentId) return {};
  const project = projectContentAccessWhere(userId, agentId);
  return {
    project,
    OR: [{ taskId: null }, { task: { project } }],
  };
}
