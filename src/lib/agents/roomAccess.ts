import type { BoardKnowledgePrincipal } from "@/lib/rag/retrieveBoardKnowledge";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export async function loadUserAgentRoom(roomId: string, userId: number) {
  return prisma.agentRoom.findFirst({
    where: {
      id: roomId,
      project: { status: "Normal", ...getProjectWhere(userId) },
    },
    include: {
      project: { select: { id: true, name: true, title: true } },
    },
  });
}

export async function loadAgentTokenRoom(roomId: string, agentId: string, principal?: BoardKnowledgePrincipal) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, revokedAt: null, archivedAt: null },
    select: { id: true, userId: true },
  });
  if (!agent) {
    return null;
  }
  return prisma.agentRoom.findFirst({
    where: {
      id: roomId,
      project: {
        ...(principal?.teamScope != null ? getProjectWhere(principal.userId, agentId, principal.teamScope) : {}),
        status: "Normal",
        members: {
          some: {
            agentId,
            status: "Accepted",
            agent: { revokedAt: null, archivedAt: null },
          },
        },
      },
    },
    include: {
      project: { select: { id: true, name: true, title: true } },
    },
  });
}
