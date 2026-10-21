import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export type TAgentWorkingOn = {
  ticket: string;
  title: string;
  url: string;
  since: string;
  expiresAt: string;
};

export async function workingOnByAgent(
  agentIds: string[],
  userId: number,
): Promise<Map<string, TAgentWorkingOn>> {
  if (agentIds.length === 0) return new Map();

  const leases = await prisma.taskLease.findMany({
    where: {
      agentId: { in: agentIds },
      expiresAt: { gt: new Date() },
      task: { project: getProjectWhere(userId) },
    },
    orderBy: { heartbeatAt: "desc" },
    select: {
      agentId: true,
      createdAt: true,
      expiresAt: true,
      task: {
        select: {
          title: true,
          ticketNumber: true,
          uniqueIndex: true,
          projectId: true,
        },
      },
    },
  });

  const byAgent = new Map<string, TAgentWorkingOn>();
  for (const lease of leases) {
    if (!lease.agentId || byAgent.has(lease.agentId)) continue;
    byAgent.set(lease.agentId, {
      ticket: lease.task.ticketNumber ?? String(lease.task.uniqueIndex),
      title: lease.task.title,
      url: `/detail/project-${lease.task.projectId}/${lease.task.uniqueIndex}`,
      since: lease.createdAt.toISOString(),
      expiresAt: lease.expiresAt.toISOString(),
    });
  }
  return byAgent;
}
