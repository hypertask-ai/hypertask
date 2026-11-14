import { DecisionRequestStatus, type Prisma } from "@prisma/client";
import { NONTERMINAL_AGENT_RUN_STATUSES } from "@/lib/agentRuns/model";
import { blockerStillOpen } from "@/lib/mcp/tasks/blockerStillOpen";

type RecordedBlocker = {
  status: string;
  section: string;
  projectId: number;
};

export function takenWorkWhere(
  callerAgentId: string | null,
): Prisma.TaskWhereInput {
  return {
    pullRequests: { none: { lifecycle: "open" } },
    decisionRequests: { none: { status: DecisionRequestStatus.Pending } },
    agentRuns: {
      none: {
        status: { in: NONTERMINAL_AGENT_RUN_STATUSES },
        ...(callerAgentId ? { NOT: { agentId: callerAgentId } } : {}),
      },
    },
  };
}

export function hasOpenRecordedBlocker(
  task: {
    relatedFromTasks: Array<{ targetTask: RecordedBlocker }>;
    relatedToTasks: Array<{ sourceTask: RecordedBlocker }>;
  },
  doneTitlesByProject: ReadonlyMap<number, ReadonlySet<string> | undefined>,
): boolean {
  const blockers = [
    ...task.relatedFromTasks.map((relation) => relation.targetTask),
    ...task.relatedToTasks.map((relation) => relation.sourceTask),
  ];
  return blockers.some((blocker) =>
    blockerStillOpen(blocker, doneTitlesByProject.get(blocker.projectId)),
  );
}
