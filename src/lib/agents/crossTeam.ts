import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HTPR_8084_CROSS_TEAM_AGENTS_FLAG } from "@/lib/flags/definitions/htpr-8084-cross-team-agents";

export async function crossTeamAgentsEnabled(userId: number): Promise<boolean> {
  const { isFeatureEnabled } = await import("@/lib/flags");
  return isFeatureEnabled(HTPR_8084_CROSS_TEAM_AGENTS_FLAG, userId);
}

export function ownerTeamWhere(userId: number): Prisma.TeamWhereInput {
  return { OR: [
    { googleAccount: { userId } },
    { members: { some: { userId, status: "Accepted" } } },
  ] };
}

export async function crossTeamProjectFence(
  agentId: string,
  userId: number,
  database: Pick<Prisma.TransactionClient, "agent"> = prisma,
): Promise<Prisma.ProjectWhereInput | null> {
  const agent = await database.agent.findFirst({
    where: { id: agentId, userId, revokedAt: null },
    select: { crossTeamHomeTeamId: true },
  });
  if (!agent) return { id: { in: [] } };
  if (!agent.crossTeamHomeTeamId) return null;
  const enabled = await crossTeamAgentsEnabled(userId);
  return {
    ...(enabled ? {} : { teamId: agent.crossTeamHomeTeamId }),
    team: ownerTeamWhere(userId),
    members: { some: { agentId, status: "Accepted", agent: { userId, revokedAt: null, archivedAt: null } } },
  };
}
