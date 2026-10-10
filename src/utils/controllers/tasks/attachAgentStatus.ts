import prisma from "@/lib/prisma";
import { AGENT_STATUS_MAX_AGE_MS } from "@/lib/agentStatus/chip";

export type AgentStatusSummary = {
  agentName: string;
  at: string;
};

export { AGENT_STATUS_MAX_AGE_MS };

type TaskWithId = { id: number };

/**
 * HTPR-7071: one batched AgentRun read for the whole board (index
 * [taskId, status]), never a query per card.
 */
export const attachAgentStatus = async <T extends TaskWithId>(
  tasks: T[],
  now: number = Date.now(),
): Promise<Array<T & { agentStatus: AgentStatusSummary | null }>> => {
  const runs = tasks.length
    ? await prisma.agentRun.findMany({
        where: {
          taskId: { in: tasks.map((task) => task.id) },
          status: "ACTIVE",
          lastActivityAt: { gte: new Date(now - AGENT_STATUS_MAX_AGE_MS) },
        },
        orderBy: { lastActivityAt: "desc" },
        select: {
          taskId: true,
          lastActivityAt: true,
          agent: { select: { displayName: true } },
        },
      })
    : [];
  const byTask = new Map<number, AgentStatusSummary>();
  for (const run of runs) {
    if (run.taskId == null || byTask.has(run.taskId)) continue;
    byTask.set(run.taskId, {
      agentName: run.agent.displayName,
      at: run.lastActivityAt.toISOString(),
    });
  }
  return tasks.map((task) => ({
    ...task,
    agentStatus: byTask.get(task.id) ?? null,
  }));
};
