import { InviteStatus, type Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

export const ACCOUNT_MANAGEMENT_KEY_PREFIX = "htmk_";
export const TEAM_MANAGEMENT_KEY_PREFIX = "httk_";

export type ManagementKeyTeam = {
  id: string;
  title: string | null;
  isOwner: boolean;
};

export type ManagementKeyTeamGrant = ManagementKeyTeam & {
  accessBinding: string;
};

type TeamScopeDatabase = Pick<typeof prisma, "team">;

const teamAccessWhere = (userId: number): Prisma.TeamWhereInput => ({
  OR: [
    { googleAccount: { is: { userId } } },
    {
      members: {
        some: { userId, status: InviteStatus.Accepted },
      },
    },
  ],
});

export async function listManagementKeyTeams(
  userId: number,
  database: TeamScopeDatabase = prisma,
): Promise<ManagementKeyTeam[]> {
  const teams = await database.team.findMany({
    where: teamAccessWhere(userId),
    select: {
      id: true,
      title: true,
      googleAccount: { select: { userId: true } },
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });

  return teams.map((team) => ({
    id: team.id,
    title: team.title,
    isOwner: team.googleAccount.userId === userId,
  }));
}

export async function getManagementKeyTeam(
  userId: number,
  teamId: string,
  database: TeamScopeDatabase = prisma,
): Promise<ManagementKeyTeamGrant | null> {
  const team = await database.team.findFirst({
    where: { id: teamId, ...teamAccessWhere(userId) },
    select: {
      id: true,
      title: true,
      googleAccount: { select: { id: true, userId: true } },
      members: {
        where: { userId, status: InviteStatus.Accepted },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!team) return null;

  const isOwner = team.googleAccount.userId === userId;
  let accessBinding: string | null = null;
  if (isOwner) {
    accessBinding = `owner:${team.googleAccount.id}`;
  } else if (team.members[0]) {
    accessBinding = `member:${team.members[0].id}`;
  }
  if (!accessBinding) return null;

  return {
    id: team.id,
    title: team.title,
    isOwner,
    accessBinding,
  };
}

export const agentWithinTeamWhere = (
  teamId: string,
): Prisma.AgentWhereInput => ({
  members: {
    some: { project: { teamId } },
    none: {
      project: {
        OR: [{ teamId: null }, { teamId: { not: teamId } }],
      },
    },
  },
});
