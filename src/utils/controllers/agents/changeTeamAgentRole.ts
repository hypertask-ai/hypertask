import prisma from "@/lib/prisma";
import type { AgentRole } from "@/lib/mcp/agents/scopes";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";

export async function changeTeamAgentRole(
  userId: number,
  teamId: string,
  agentId: string,
  role: AgentRole,
) {
  return prisma.$transaction(async (tx) => {
    const team = await tx.team.findFirst({
      where: { id: teamId, googleAccount: { is: { userId } } },
      select: { id: true },
    });
    if (!team) {
      return { ok: false as const, status: 403, error: "Only the team owner can change agent roles" };
    }

    const agent = await tx.agent.findFirst({
      where: {
        id: agentId,
        ...boardAgentVisibilityWhere(userId),
        members: {
          some: { project: { teamId } },
          every: { project: { OR: [{ teamId }, { teamId: null }] } },
        },
      },
      select: { id: true, permissions: true },
    });
    if (!agent) {
      return { ok: false as const, status: 404, error: "Agent does not exist in this team" };
    }

    const permissions =
      agent.permissions && typeof agent.permissions === "object" && !Array.isArray(agent.permissions)
        ? agent.permissions
        : {};
    await tx.agent.update({
      where: { id: agent.id },
      data: { permissions: { ...permissions, role } },
    });
    return { ok: true as const, agent: { id: agent.id, role } };
  }, { isolationLevel: "Serializable" });
}
