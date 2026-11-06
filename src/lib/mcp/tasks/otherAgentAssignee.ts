import type { Prisma } from "@prisma/client";

export function otherAgentAssigneeWhere(
  callerAgentId: string,
): Prisma.TaskWhereInput {
  return {
    assignees: {
      none: {
        AND: [
          { agentId: { not: null } },
          { NOT: { agentId: callerAgentId } },
        ],
      },
    },
  };
}
