import { Prisma, type PrismaClient } from "@prisma/client";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const DEFAULT_SEEDED_AGENT_NAME = "Hyper AI";

const TEAM_AGENT_SEED_LOCK_NAMESPACE = 6_512;

type AgentLookupClient = Pick<PrismaClient, "agent">;

function acceptedHumanBoardWhere(userId: number): Prisma.ProjectWhereInput {
  return {
    status: "Normal",
    AND: [
      getProjectWhere(userId),
      {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: { userId, agentId: null, status: "Accepted" },
            },
          },
        ],
      },
    ],
  };
}

/** Same access GET /api/agents already granted before it calls seed. */
function accessibleTeamWhere(userId: number): Prisma.TeamWhereInput {
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

async function findTeamAccessBoard(
  database: Pick<PrismaClient, "project" | "team">,
  userId: number,
  teamId: string,
) {
  const canUseTeam = await database.team.findFirst({
    where: { id: teamId, ...accessibleTeamWhere(userId) },
    select: { id: true },
  });
  if (!canUseTeam) return null;

  return database.project.findFirst({
    where: {
      teamId,
      status: "Normal",
      OR: [
        { ownerId: userId },
        { members: { some: { userId, agentId: null } } },
      ],
    },
    select: { id: true },
    orderBy: { id: "desc" },
  });
}

async function findActiveOwnedAgentOnTeam(
  database: AgentLookupClient,
  userId: number,
  teamId: string,
) {
  return database.agent.findFirst({
    where: {
      userId,
      revokedAt: null,
      archivedAt: null,
      members: { some: { project: { teamId, status: "Normal" } } },
    },
    select: { id: true },
  });
}

export async function lockTeamAgentSeed(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: number,
  teamId: string,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`htpr-6512:${userId}:${teamId}`}, ${TEAM_AGENT_SEED_LOCK_NAMESPACE}))::text AS lock_result`,
  );
}

/**
 * If this person can use a team board but owns no live agent there, create
 * one native agent on that board so Agent Chat and GET /api/agents are not
 * empty. Guest boards already seed "Hyper AI"; regular team boards did not.
 */
export async function ensureDefaultTeamAgent(
  userId: number,
  teamId: string,
  database: PrismaClient,
): Promise<{ id: string; created: boolean } | null> {
  const existing = await findActiveOwnedAgentOnTeam(database, userId, teamId);
  if (existing) return { id: existing.id, created: false };

  const board = await database.project.findFirst({
    where: { teamId, ...acceptedHumanBoardWhere(userId) },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (!board) {
    const teamBoard = await findTeamAccessBoard(database, userId, teamId);
    if (teamBoard) {
      return database.$transaction(async (tx) => {
        await lockTeamAgentSeed(tx, userId, teamId);
        const raced = await findActiveOwnedAgentOnTeam(tx, userId, teamId);
        if (raced) return { id: raced.id, created: false };

        const agent = await tx.agent.create({
          data: {
            displayName: DEFAULT_SEEDED_AGENT_NAME,
            userId,
            runtimeType: "NATIVE",
          },
          select: { id: true },
        });
        await tx.member.create({
          data: {
            projectId: teamBoard.id,
            userId,
            agentId: agent.id,
          },
        });
        return { id: agent.id, created: true };
      });
    }
  }
  if (!board) return null;

  return database.$transaction(async (tx) => {
    await lockTeamAgentSeed(tx, userId, teamId);
    const raced = await findActiveOwnedAgentOnTeam(tx, userId, teamId);
    if (raced) return { id: raced.id, created: false };

    const agent = await tx.agent.create({
      data: {
        displayName: DEFAULT_SEEDED_AGENT_NAME,
        userId,
        runtimeType: "NATIVE",
      },
      select: { id: true },
    });
    await tx.member.create({
      data: {
        projectId: board.id,
        userId,
        agentId: agent.id,
      },
    });
    return { id: agent.id, created: true };
  });
}

export async function ensureDefaultAgentsOnAccessibleTeams(
  userId: number,
  database: PrismaClient,
): Promise<number> {
  const boards = await database.project.findMany({
    where: {
      teamId: { not: null },
      ...acceptedHumanBoardWhere(userId),
    },
    select: { teamId: true },
  });
  const teamIds = [
    ...new Set(
      boards
        .map((board) => board.teamId)
        .filter((teamId): teamId is string => Boolean(teamId)),
    ),
  ];
  const extraTeams = await database.team.findMany({
    where: accessibleTeamWhere(userId),
    select: { id: true },
  });
  for (const team of extraTeams) {
    if (!teamIds.includes(team.id)) teamIds.push(team.id);
  }

  let created = 0;
  for (const teamId of teamIds) {
    const result = await ensureDefaultTeamAgent(userId, teamId, database);
    if (result?.created) created += 1;
  }
  return created;
}
