import prisma from "@/lib/prisma";
import type { Member, User } from "@prisma/client";
import { canAttachAgentToTeam } from "./teamScope";
import {
  publicAgentSelect,
  type PublicAgent,
} from "@/lib/agents/publicAgent";

export async function getAccessibleAgentBoard(
  projectId: number,
  requestingUserId: number,
) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
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
  projectId: number
): Promise<BoardAgentMemberRow[]> {
  const rows = await prisma.member.findMany({
    where: {
      projectId,
      agentId: { not: null },
      agent: { revokedAt: null },
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

export async function addAgentToBoard(
  projectId: number,
  agentId: string,
  requestingUserId: number
): Promise<AddAgentToBoardResult> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, status: "Normal" },
    select: { id: true, ownerId: true, teamId: true },
  });
  if (!project) {
    return { ok: false, status: 404, message: "Project not found" };
  }

  const hasHumanAccess =
    project.ownerId === requestingUserId ||
    (await prisma.member.findFirst({
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

  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      userId: requestingUserId,
      revokedAt: null,
    },
    select: {
      id: true,
      userId: true,
      members: {
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

  const belongsToTargetTeam = canAttachAgentToTeam(
    agent.members.map(({ project: agentProject }) => agentProject.teamId),
    project.teamId,
  );
  if (!belongsToTargetTeam) {
    return {
      ok: false,
      status: 403,
      message: "This agent belongs to another team",
    };
  }

  const existing = await prisma.member.findFirst({
    where: { projectId, agentId },
  });
  if (existing) {
    return { ok: false, status: 400, message: "Agent is already on this board" };
  }

  const member = await prisma.member.create({
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

export type RemoveAgentFromBoardResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export async function removeAgentFromBoard(
  projectId: number,
  agentId: string,
  requestingUserId: number
): Promise<RemoveAgentFromBoardResult> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, status: "Normal" },
    select: { id: true, ownerId: true },
  });
  if (!project) {
    return { ok: false, status: 404, message: "Project not found" };
  }

  const hasHumanAccess =
    project.ownerId === requestingUserId ||
    (await prisma.member.findFirst({
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
      message: "You do not have permission to remove agents from this board",
    };
  }

  const member = await prisma.member.findFirst({
    where: { projectId, agentId },
    include: { agent: { select: publicAgentSelect } },
  });
  if (!member) {
    return { ok: false, status: 404, message: "Agent is not a member of this board" };
  }

  if (member.agent?.userId !== requestingUserId && project.ownerId !== requestingUserId) {
    return {
      ok: false,
      status: 403,
      message: "You can only remove your own agents from this board",
    };
  }

  await prisma.member.delete({ where: { id: member.id } });
  return { ok: true };
}

export async function getBoardAgentIds(projectId: number): Promise<string[]> {
  const rows = await getBoardAgentMembers(projectId);
  return rows.map((r) => r.agent.id);
}
