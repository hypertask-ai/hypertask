import type { Prisma } from "@prisma/client";

import type { AgentRuntimeSnapshot } from "@/lib/agents/runtimeState";

export type AgentPoolScope = {
  /** Every ticket in the agent's intake columns, narrowed by its label scope. */
  sourceScopeWhere: Prisma.TaskWhereInput;
  /** The part of that pool the agent could actually pick up next. */
  eligiblePoolWhere: Prisma.TaskWhereInput;
  /** Explicit assignments, which ignore label and column scope entirely. */
  assignedWhere: Prisma.TaskWhereInput;
};

/**
 * A label-scoped agent only discovers work carrying its label, and never work
 * another agent already owns, so counting whole intake columns overstates its
 * pool. An explicit assignment is the opposite case: it reaches the agent
 * whatever the ticket's label or column, so it is never scope-filtered.
 */
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
