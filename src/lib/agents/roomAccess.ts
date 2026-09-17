import prisma from "@/lib/prisma";
import { HTPR_6557_AGENT_ROOMS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const agentRoomsEnabled = (userId: number) =>
  isFeatureEnabled(HTPR_6557_AGENT_ROOMS_FLAG, userId);

export async function loadUserAgentRoom(roomId: string, userId: number) {
  if (!(await agentRoomsEnabled(userId))) {
    return null;
  }
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

export async function loadAgentTokenRoom(roomId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, revokedAt: null, archivedAt: null },
    select: { id: true, userId: true },
  });
  if (
    !agent ||
    !(await agentRoomsEnabled(agent.userId))
  ) {
    return null;
  }
  return prisma.agentRoom.findFirst({
    where: {
      id: roomId,
      project: {
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
