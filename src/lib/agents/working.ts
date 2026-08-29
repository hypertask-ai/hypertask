import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

/**
 * What an agent is doing right now.
 *
 * A task lease with an agentId that has not expired IS "this agent is holding
 * that ticket", which is the same signal `/api/mcp/agents/presence` reports.
 * Both the register and the agent page ask this question, so it lives here
 * rather than being written twice and drifting.
 */
export type TAgentWorkingOn = {
  ticket: string;
  title: string;
  /** In-app path, so the card can link with next/link. */
  url: string;
  /** When the lease was taken, for "working for 4 min". */
  since: string;
  /** The spinner has to stop on its own when a lease ages out. */
  expiresAt: string;
};

/**
 * Scoped to boards the caller can see, like every other agent read: an owner
 * can keep an agent on a board they were removed from, and the register must
 * not become a way to read titles off it.
 */
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
    // Deliberately uncapped: a cap here would silently report an agent as idle
    // because its lease fell past the cut, which is worse than the query being
    // a few rows longer. The set is bounded already — live leases held by up to
    // 200 of your own agents, and an agent normally holds one.
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
    // Newest heartbeat wins: an agent holding two leases is working on the one
    // it last touched, and showing both would need a list where the card has
    // one line.
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
