export const DEFAULT_SEEDED_AGENT_NAME = "Hyper AI";

export type TeamAgentStore = {
  agent: {
    findFirst: (args: {
      where: Record<string, unknown>;
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: {
        displayName: string;
        userId: number;
        runtimeType: "NATIVE";
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
  project: {
    findFirst: (args: {
      where: Record<string, unknown>;
      select: { id: true };
      orderBy: { id: "desc" };
    }) => Promise<{ id: number } | null>;
    findMany: (args: {
      where: Record<string, unknown>;
      select: { teamId: true };
    }) => Promise<Array<{ teamId: string | null }>>;
  };
  member: {
    create: (args: {
      data: { projectId: number; userId: number; agentId: string };
    }) => Promise<unknown>;
  };
  $transaction: <T>(
    fn: (tx: Omit<TeamAgentStore, "$transaction">) => Promise<T>,
  ) => Promise<T>;
};

function humanBoardAccess(userId: number) {
  return [
    { ownerId: userId },
    { members: { some: { userId, agentId: null } } },
  ];
}

async function findActiveOwnedAgentOnTeam(
  database: Omit<TeamAgentStore, "$transaction">,
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

/**
 * If this person can use a team board but owns no live agent there, create
 * one native agent on that board so Agent Chat and GET /api/agents are not
 * empty. Guest boards already seed "Hyper AI"; regular team boards did not.
 */
export async function ensureDefaultTeamAgent(
  userId: number,
  teamId: string,
  database: TeamAgentStore,
): Promise<{ id: string; created: boolean } | null> {
  const existing = await findActiveOwnedAgentOnTeam(database, userId, teamId);
  if (existing) return { id: existing.id, created: false };

  const board = await database.project.findFirst({
    where: {
      status: "Normal",
      teamId,
      OR: humanBoardAccess(userId),
    },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (!board) return null;

  return database.$transaction(async (tx) => {
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
  database: TeamAgentStore,
): Promise<number> {
  const boards = await database.project.findMany({
    where: {
      status: "Normal",
      teamId: { not: null },
      OR: humanBoardAccess(userId),
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

  let created = 0;
  for (const teamId of teamIds) {
    const result = await ensureDefaultTeamAgent(userId, teamId, database);
    if (result?.created) created += 1;
  }
  return created;
}
