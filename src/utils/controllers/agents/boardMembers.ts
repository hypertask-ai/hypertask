import { assertAgentBoardInviteScope } from "@/lib/mcp/agents/delegatedAccess";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import prisma from "@/lib/prisma";
import type { Member, Prisma, User } from "@prisma/client";
import { canAttachAgentToTeam } from "./teamScope";
import {
  publicAgentSelect,
  type PublicAgent,
} from "@/lib/agents/publicAgent";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";
import { crossTeamAgentsEnabled, ownerTeamWhere } from "@/lib/agents/crossTeam";

export async function getAccessibleAgentBoard(
  projectId: number,
  requestingUserId: number,
  actingAgentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
  database: { project: Pick<Prisma.TransactionClient["project"], "findFirst"> } = prisma,
) {
  return database.project.findFirst({
    where: {
      id: projectId,
      ...(teamScope != null ? { AND: [getProjectWhere(requestingUserId, actingAgentId, teamScope)] } : {}),
      status: "Normal",
      OR: [
        { ownerId: requestingUserId },
        {
          members: {
            some: {
              userId: requestingUserId,
              agentId: null,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      teamId: true,
      title: true,
    },
  });
}

export type BoardAgentMemberRow = Member & {
  agent: PublicAgent;
  user: User;
};

export async function getBoardAgentMembers(
  projectId: number,
  requestingUserId: number,
): Promise<BoardAgentMemberRow[]> {
  const rows = await prisma.member.findMany({
    where: {
      projectId,
      agentId: { not: null },
      agent: {
        revokedAt: null,
        archivedAt: null,
        ...boardAgentVisibilityWhere(requestingUserId),
      },
    },
    include: {
      agent: { select: publicAgentSelect },
      user: true,
    },
  });
  return rows.filter((r): r is BoardAgentMemberRow => r.agent != null);
}

export async function getHumanBoardMembers(projectId: number) {
  return prisma.member.findMany({
    where: {
      projectId,
      agentId: null,
    },
    include: {
      user: true,
    },
  });
}

export async function getAgentTeamIds(agentIds: string[]) {
  if (agentIds.length === 0) return new Map<string, string>();

  const memberships = await prisma.member.findMany({
    where: { agentId: { in: agentIds } },
    orderBy: { id: "asc" },
    select: {
      agentId: true,
      project: { select: { teamId: true } },
    },
  });
  const teamIdByAgentId = new Map<string, string>();

  for (const membership of memberships) {
    if (
      membership.agentId &&
      membership.project.teamId &&
      !teamIdByAgentId.has(membership.agentId)
    ) {
      teamIdByAgentId.set(membership.agentId, membership.project.teamId);
    }
  }

  return teamIdByAgentId;
}

export async function isAgentOnBoard(
  projectId: number,
  agentId: string
): Promise<boolean> {
  const row = await prisma.member.findFirst({
    where: {
      projectId,
      agentId,
      agent: { revokedAt: null },
    },
    select: { id: true },
  });
  return row != null;
}

export type AddAgentToBoardResult =
  | { ok: true; member: BoardAgentMemberRow }
  | { ok: false; status: number; message: string };

async function addAgentToBoardTransaction(
  database: Prisma.TransactionClient,
  projectId: number,
  agentId: string,
  requestingUserId: number,
  actingAgentId?: string | null,
): Promise<AddAgentToBoardResult> {
  const enabled = await crossTeamAgentsEnabled(requestingUserId);
  const project = await database.project.findFirst({
    where: { id: projectId, status: "Normal" },
    select: { id: true, ownerId: true, teamId: true },
  });
  if (!project) {
    return { ok: false, status: 404, message: "Project not found" };
  }

  const hasHumanAccess =
    project.ownerId === requestingUserId ||
    (await database.member.findFirst({
      where: {
        projectId,
        userId: requestingUserId,
        agentId: null,
      },
    })) != null;

  if (!hasHumanAccess) {
    return {
      ok: false,
      status: 403,
      message: "You do not have permission to add agents to this board",
    };
  }

  const agent = await database.agent.findFirst({
    where: {
      id: agentId,
      userId: requestingUserId,
      revokedAt: null,
      ...(enabled ? { archivedAt: null } : {}),
    },
    select: {
      id: true,
      userId: true,
      archivedAt: true,
      crossTeamHomeTeamId: true,
      boardHomeTeamId: true,
      credentialTeamId: true,
      credentialTeamAccessBinding: true,
      members: {
        orderBy: { id: "asc" },
        select: { project: { select: { teamId: true } } },
      },
    },
  });
  if (!agent) {
    return {
      ok: false,
      status: 403,
      message: "Agent not found or you do not own this agent",
    };
  }

  if (!project.teamId) {
    return {
      ok: false,
      status: 400,
      message: "Agents can only be added to boards that belong to a team",
    };
  }

  const homeTeamId = agent.crossTeamHomeTeamId ?? agent.boardHomeTeamId ??
    agent.members.find(({ project }) => project.teamId)?.project.teamId ?? project.teamId;
  const belongsToTargetTeam = agent.crossTeamHomeTeamId
    ? project.teamId === agent.crossTeamHomeTeamId
    : canAttachAgentToTeam(
        agent.members.map(({ project }) => project.teamId),
        project.teamId,
      );
  if (
    (agent.credentialTeamId && agent.credentialTeamId !== project.teamId) ||
    (agent.credentialTeamAccessBinding && !agent.credentialTeamId) ||
    (!enabled && !belongsToTargetTeam)
  ) {
    return { ok: false, status: 403, message: "This agent belongs to another team" };
  }
  if (enabled || agent.crossTeamHomeTeamId) {
    const ownerTeamBoard = await database.project.findFirst({
      where: { id: projectId, status: "Normal", team: ownerTeamWhere(requestingUserId) },
      select: { id: true },
    });
    if (!ownerTeamBoard || agent.archivedAt) {
      return { ok: false, status: 403, message: "You do not have permission to add this agent to this team" };
    }
  }

  const existing = await database.member.findFirst({
    where: { projectId, agentId },
  });
  if (existing) {
    return { ok: false, status: 400, message: "Agent is already on this board" };
  }

  if (actingAgentId) {
    await assertAgentBoardInviteScope(database.member, projectId, requestingUserId, actingAgentId);
  }
  const expandsTeams = homeTeamId !== project.teamId || !belongsToTargetTeam;
  const markExpanded = !agent.crossTeamHomeTeamId && expandsTeams;
  if (!agent.boardHomeTeamId || markExpanded) {
    await database.agent.update({
      where: { id: agent.id },
      data: {
        ...(!agent.boardHomeTeamId ? { boardHomeTeamId: homeTeamId } : {}),
        ...(markExpanded ? { crossTeamHomeTeamId: homeTeamId } : {}),
      },
    });
  }
  const member = await database.member.create({
    data: {
      projectId,
      userId: agent.userId,
      agentId: agent.id,
    },
    include: {
      agent: { select: publicAgentSelect },
      user: true,
    },
  });

  if (!member.agent) {
    return { ok: false, status: 500, message: "Failed to add agent to board" };
  }

  return { ok: true, member: member as BoardAgentMemberRow };
}

export async function addAgentToBoard(
  projectId: number,
  agentId: string,
  requestingUserId: number,
  actingAgentId?: string | null,
): Promise<AddAgentToBoardResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => addAgentToBoardTransaction(tx, projectId, agentId, requestingUserId, actingAgentId),
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      const serializationConflict =
        typeof error === "object" && error !== null &&
        "code" in error && error.code === "P2034";
      if (attempt >= 2 || !serializationConflict) throw error;
    }
  }
}

export type RemoveAgentFromBoardResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

type RemoveAgentDatabase = Pick<
  Prisma.TransactionClient,
  "project" | "member" | "taskLease" | "agent"
>;

async function removeAgentFromBoardTransaction(
  database: RemoveAgentDatabase,
  projectId: number,
  agentId: string,
  requestingUserId: number,
): Promise<RemoveAgentFromBoardResult> {
  const project = await database.project.findFirst({
    where: { id: projectId, status: "Normal" },
    select: { id: true, ownerId: true },
  });
  if (!project) {
    return { ok: false, status: 404, message: "Project not found" };
  }

  const hasHumanAccess =
    project.ownerId === requestingUserId ||
    (await database.member.findFirst({
      where: { projectId, userId: requestingUserId, agentId: null },
    })) != null;
  if (!hasHumanAccess) {
    return {
      ok: false,
      status: 403,
      message: "You do not have permission to remove agents from this board",
    };
  }

  const member = await database.member.findFirst({
    where: { projectId, agentId },
    include: { agent: { select: {
      userId: true,
      boardHomeTeamId: true,
      crossTeamHomeTeamId: true,
      members: {
        orderBy: { id: "asc" },
        select: { project: { select: { teamId: true } } },
      },
    } } },
  });
  if (!member) {
    return {
      ok: false,
      status: 404,
      message: "Agent is not a member of this board",
    };
  }
  if (
    member.agent?.userId !== requestingUserId &&
    project.ownerId !== requestingUserId
  ) {
    return {
      ok: false,
      status: 403,
      message: "You can only remove your own agents from this board",
    };
  }

  const activeLease = await database.taskLease.findFirst({
    where: { agentId, expiresAt: { gt: new Date() }, task: { projectId } },
    select: {
      task: { select: { ticketNumber: true, uniqueIndex: true } },
    },
  });
  if (activeLease) {
    const ticket =
      activeLease.task.ticketNumber ?? `task ${activeLease.task.uniqueIndex}`;
    return {
      ok: false,
      status: 409,
      message: `Agent is working ${ticket} on this board. Hand off or wait for it to finish, then remove.`,
    };
  }

  if (member.agent && !member.agent.boardHomeTeamId) {
    const homeTeamId = member.agent.crossTeamHomeTeamId ??
      member.agent.members.find(({ project }) => project.teamId)?.project.teamId;
    if (homeTeamId) {
      await database.agent.update({
        where: { id: agentId },
        data: { boardHomeTeamId: homeTeamId },
      });
    }
  }
  await database.member.delete({ where: { id: member.id } });
  return { ok: true };
}

export async function removeAgentFromBoard(
  projectId: number,
  agentId: string,
  requestingUserId: number,
): Promise<RemoveAgentFromBoardResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) =>
          removeAgentFromBoardTransaction(
            tx,
            projectId,
            agentId,
            requestingUserId,
          ),
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      const serializationConflict =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034";
      if (attempt >= 2 || !serializationConflict) throw error;
    }
  }
}

export async function getBoardAgentIds(
  projectId: number,
  requestingUserId: number,
): Promise<string[]> {
  const rows = await getBoardAgentMembers(projectId, requestingUserId);
  return rows.map((r) => r.agent.id);
}
