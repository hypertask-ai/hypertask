import type { Prisma } from "@prisma/client";

import type { AgentRuntimeSnapshot } from "@/lib/agents/runtimeState";

export type AgentPoolScope = {
  sourceScopeWhere: Prisma.TaskWhereInput;
  eligiblePoolWhere: Prisma.TaskWhereInput;
  assignedWhere: Prisma.TaskWhereInput;
};

export function agentPoolScope(input: {
  agentId: string;
  boardIds: number[];
  sourceSections: AgentRuntimeSnapshot["sourceSections"];
  scopeLabel: string | null;
}): AgentPoolScope {
  const boardScopeWhere: Prisma.TaskWhereInput = {
    projectId: { in: input.boardIds },
    status: "Normal",
    archivedAt: null,
    deletedAt: null,
  };
  const sourceScopeWhere: Prisma.TaskWhereInput = {
    ...boardScopeWhere,
    ...(input.scopeLabel
      ? { taskLabels: { some: { label: { value: input.scopeLabel } } } }
      : {}),
    ...(input.sourceSections.length > 0
      ? {
          OR: input.sourceSections.map(({ boardId, section }) => ({
            projectId: boardId,
            section,
          })),
        }
      : {}),
  };
  return {
    sourceScopeWhere,
    eligiblePoolWhere: {
      AND: [
        sourceScopeWhere,
        {
          assignees: {
            none: { agentId: { not: null, notIn: [input.agentId] } },
          },
        },
      ],
    },
    assignedWhere: {
      AND: [boardScopeWhere, { assignees: { some: { agentId: input.agentId } } }],
    },
  };
}
