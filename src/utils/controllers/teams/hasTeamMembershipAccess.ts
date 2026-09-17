import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

export function teamAccessWhere(userId: number): Prisma.TeamWhereInput {
  return {
    OR: [
      { googleAccount: { is: { userId } } },
      { members: { some: { userId, status: "Accepted" } } },
      {
        projects: {
          some: {
            status: "Normal",
            OR: [
              { ownerId: userId },
              { members: { some: { userId, agentId: null } } },
            ],
          },
        },
      },
    ],
  };
}

/** True when the user owns, belongs to, or can access a board on the team. */
export async function hasTeamMembershipAccess(
  userId: number,
  teamId: string
): Promise<boolean> {
  const team = await prisma.team.findFirst({
    where: { id: teamId, ...teamAccessWhere(userId) },
    select: { id: true },
  });

  return Boolean(team);
}

export async function findSoleAccessibleTeamId(
  userId: number,
): Promise<string | null> {
  const teams = await prisma.team.findMany({
    where: teamAccessWhere(userId),
    select: { id: true },
    take: 2,
  });
  return teams.length === 1 ? teams[0].id : null;
}
